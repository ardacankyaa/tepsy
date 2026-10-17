# Tepsy güvenlik ve işleyiş incelemesi — 15 Ekim 2026

İnceleme; giriş, şifre değiştirme, oturumlar, HTTP/Socket.IO yetkileri, QR müşteri
erişimi, sipariş fiyatları, tahsilat ve TokenX adisyon aktarımını kapsar. Kaynak kodu
incelendi, doğrulanabilen sorunlar düzeltildi ve geçici veritabanlarıyla test edildi.
Bu çalışma, sistemde hiçbir açık veya hata bulunmadığına dair sertifika değildir.

## Doğrulanan ve düzeltilen sorunlar

| Konum                                                                    | Önkoşul ve önceki etki                                                                                                                                                                              | Yapılan düzeltme ve kanıt                                                                                                                                                                                                                                                                                                               |
| ------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/app/api/auth/logout/route.js`, `src/lib/auth-local.js`, `server.js` | Geçerli oturum çerezinin bir kopyasını elinde tutan kişi, kullanıcı çıkış yapsa da süresi dolana kadar API ve Socket.IO erişimini sürdürebiliyordu.                                                 | Çıkışta çerezin SHA-256 özeti kalıcı SQLite iptal listesine yazılır; o oturumun açık bağlantıları kapatılır. HTTP, API ve Socket.IO aynı doğrulayıcıyı kullanır. İptal, sunucu yeniden başlatıldıktan sonra da geçerlidir. Farklı cihazın oturumu korunur. `tests/session-logout.test.mjs` ve gerçek sunucu entegrasyonu bunu doğrular. |
| `src/lib/auth-throttle.cjs`                                              | Geçerli bir personel hesabı bilen kişi, aynı ağ adresinden yaptığı başarısız yönetici şifresi denemelerini araya başarılı personel girişleri ekleyerek silebiliyordu.                               | Başarılı giriş yalnızca kendi denemesini düşürür; önceki hataları temizlemez. Tekrarlanan tamamlama ve eski pencere etkisi de engellenir. `tests/auth-throttle.test.cjs` bu akışı ve 8 deneme / 15 dakika sınırını doğrular.                                                                                                            |
| `src/app/api/auth/change-password/route.js`                              | Aynı eski şifreyle eşzamanlı iki geçerli değiştirme isteği, ikisi de başarılı olup yeni şifreyi birbirinin üzerine yazabiliyordu.                                                                   | Güncelleme, okunan eski şifre özeti hâlâ aynıysa uygulanır. Yarışta ikinci istek 409 döner. `tests/auth-throttle-routes.test.mjs` iki eşzamanlı isteğin yalnızca birinin başarılı olduğunu doğrular.                                                                                                                                    |
| `src/app/api/auth/{login,change-password}/route.js`                      | Ağdan erişen kişi giriş gövdesini sınırsız büyütebiliyordu; JSON tamamen belleğe alınıyordu. `null`, dizi veya yanlış türde alanlar da kontrollü doğrulama yerine sunucu hatasına yol açabiliyordu. | Gövde, Content-Length olmadan parçalı gönderilse de en fazla 16 KiB okunur; okuma süresi 10 saniyeyle sınırlıdır. Hatalı veri kontrollü 400, büyük veri 413 döndürür. Yerel akış testleri ve gerçek HTTP istekleriyle doğrulandı; hizmeti durduracak yük saldırısı yapılmadı.                                                           |

Yeni oturumlar rastgele kimlik içerir. Böylece aynı milisaniyedeki iki giriş aynı
çerezi üretmez. İmza biçimi sıkı doğrulanır; sonuna parça veya alternatif kodlama
eklemek iptal listesini aşamaz. Eski, doğru biçimde imzalanmış oturum çerezleri ve
`RESTOPOS_` uyumluluğu korunur. Yeni iptal veritabanı restoran veritabanına şema
değişikliği uygulamaz ve ham çerez içermez.

Çıkış sırasında kimlik denetimi hâlâ devam eden bir bağlantının sonradan açık
kalması da engellenir: Socket.IO bağlantı kaydı tamamlanınca, herhangi bir personel
odasına katılmadan önce iptal durumu yeniden denetlenir. Bu yarış için başarısız
olan bir regresyon testi eklendi ve düzeltmeden sonra geçti.

## Ödeme ve yetki kontrolleri

- Sipariş fiyatı ve ürün bilgisi sunucudan alınır; istemcinin gönderdiği fiyat ödeme
  otoritesi değildir. Geçmiş ürün adı/fiyatı ve fiş görüntüsü korunur.
- Yinelenen tahsilat, aynı anahtarın farklı istekle kullanılması, fazla tahsilat,
  kapalı kasa, bölünmüş ödeme ve kuruş hesabı senaryoları geçti.
- Garson/mutfak/kasa/yönetici yetkileri, devre dışı bırakılan personel, sahte veya
  süresi dolmuş çerez, farklı yazılmış API yolları ve yabancı Origin denendi.
- QR erişimi token ve masa kapsamında kalır; onaylanmamış sipariş tahsil edilemez.
- TokenX aktarımı banka onayı değildir. Aktarım hatası veya eksik yapılandırma ödeme
  oluşturmaz. Elle kart ödeme kaydı personelin dışarıda alınmış ödemeyi doğrulamasını
  gerektirir; bağlantı testi ödeme onaylamaz.

Bu senaryolarda kalan bir ödeme/yetki açığı doğrulanmadı. Bu sonuç yalnızca incelenen
kod ve çalıştırılan senaryolarla sınırlıdır.

## Bağımlılıklar

Next.js ve eşleşen lint eklentisi 15.5.28'e güncellendi. Bu sürüm üreticinin
[14 Ekim güvenlik duyurusundaki](https://nextjs.org/blog/nextjs-security-update-october-14-2026)
yamaları içerir. Duyurudaki Cache Components/Server Actions özellikleri bu uygulamada
kullanılmıyor; Sharp zaten 0.35.5'ti. Bu nedenle duyurudaki her açığın Tepsy üzerinde
sömürülebildiği iddia edilmez.

15 Ekim taramasında `npm audit --omit=dev` sonucu **0 bildirilmiş açık**.
Geliştirme bağımlılıkları dahil taramada **6 yüksek seviye paket uyarısı** kaldı;
bunların tek kök nedeni `braces` 3.0.3 ve geliştirme araçlarındaki bağımlılık zinciri.
[Yayınlanan kayıtta](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm) yamalı sürüm
bulunmuyor. Bu paket üretim bağımlılıklarında yer almıyor; müşterinin gönderdiği bir
değerin ilgili glob çözümleyicisine ulaştığı bir uygulama yolu doğrulanmadı. Uyarıları
gizlemek için tasarımı etkileyen büyük Tailwind sürüm geçişi yapılmadı.

## Doğrulama kanıtları

- `npm test`: 267/267 başarılı.
- Üretim derlemesi: Next.js 15.5.28 ile başarılı.
- Gerçek üretim sunucusu entegrasyonu: 30/30 grup başarılı. Ödeme, bölünmüş ödeme,
  cihaz/yazıcı, TokenX ve mobil giriş tarayıcı grupları dahil.
- Kanıtlar: `.tepsy/qa/integration-SVcXjE/results.json`,
  `.tepsy/qa/security-unit.log`, `.tepsy/qa/security-audit.json`.
- Son bağlantı korumasından sonra gerçek API/Socket.IO ve ödeme tarayıcı grubuyla
  30 grup tekrar geçti: `.tepsy/qa/integration-VLyDs8/results.json`.
- Python yedekleme/başlatma/yükseltme testleri: 4/4 başarılı.
- Ayrı klasörde yönetilen kurulum testi: ilk kurulum, eşzamanlı başlatma, yeniden
  başlatma, demo ayrımı ve IPv6 senaryoları başarılı. Kanıt:
  `.tepsy/qa/managed-demo-i3BOZc/results.json`.
- Biçim, lint ve sürüm dosyası/bağımlılık kilidi denetimleri başarılı.
- Entegrasyonun korunan restoran verisi, cihaz ayarları ve oturum anahtarı dosyaları
  değişmedi. Testler gerçek restoran veritabanına bağlanmadı.

## Sınırlar ve işletim

Fiziksel POS, banka veya gerçek TokenX hesabı sağlanmadığından gerçek kart çekimi ve
cihazın mali çıktısı doğrulanmadı. İnternet yayını kurulmadı; HTTPS, ters vekil/tünel
başlıkları, yerel kurulum/sıfırlama yollarının dışarıdan kapatılması ve internetteki
giriş denemesi sınırları seçilecek yayın düzeninde ayrıca doğrulanmalı. LAN üzerinde
mevcut HTTP kullanımı ağ trafiğini şifrelemez.

İptal listesinin yedekleme ve geri dönüş koşulları için [işletim belgesine](OPERATIONS.md)
bakın. Çalışan kuruluma düzeltmeleri geçirmek için proje klasöründe
`START.bat` açın; başlatıcı gerektiğinde sunucuyu otomatik durdurup günceller ve
yeniden başlatır. İlk açılış güncellenen kodu
kopyalar ve gerekirse yeniden derler. İnceleme sırasında çalışan restoran kurulumu
otomatik olarak yeniden başlatılmadı.
