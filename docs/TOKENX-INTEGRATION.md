# TokenX Connect Cloud adisyon aktarımı

Bu ilk sürüm, kart tahsilatı seçildiğinde sunucudaki adisyonun ürün adlarını,
adetlerini, birim fiyatlarını ve indirimini TokenX'e aktarır. Sağlayıcının desteklediği
ve TokenX Connect (Kablosuz) uygulaması etkinleştirilmiş bir cihaz gerekir.
Sadece IP/port girmek veya herhangi bir Beko/Token cihazına sahip olmak yeterli değildir.

## Kurulum

1. Token'dan entegratör erişimi, test/canlı ortam adresleri ve cihaz aktivasyonu alın.
   Müşterinin banka hesabı veya POS şifresi entegratör erişiminin yerine geçmez.
2. Aktif özel kurulumun `.env` dosyasına aşağıdaki değişkenleri tanımlayın ve sunucuyu
   yeniden başlatın. Gerçek değerleri kaynak klasöre veya sürüm kontrolüne koymayın.
   `npm run local:paths` aktif kurulumun konumunu gösterir.

   | Değişken                     | İçerik                                                    |
   | ---------------------------- | --------------------------------------------------------- |
   | `TEPSY_TOKENX_AUTH_URL`      | Sağlayıcının tam kimlik doğrulama URL'si                  |
   | `TEPSY_TOKENX_API_URL`       | Sağlayıcının `/dtokc/integration/v1` ile biten API adresi |
   | `TEPSY_TOKENX_CLIENT_ID`     | Entegratör client-id                                      |
   | `TEPSY_TOKENX_CLIENT_SECRET` | Entegratör client-secret                                  |

   HTTPS zorunludur. `RESTOPOS_TOKENX_*` karşılıkları da desteklenir.
   Varsayılan bir canlı/test hesabı veya otomatik test ortamı seçimi yoktur.

3. Yönetim → Ayarlar → Cihazlar bölümünde **TokenX Connect Cloud · Adisyon aktarımı**
   seçin. Cihazın AV/AT ile başlayan mali numarasını girin.
4. **Cihaz kısımlarını al** düğmesine basın. Her menü kategorisini cihazdaki doğru
   mali kısımla eşleştirin ve kaydedin. Vergi oranları tahmin edilmez; sağlayıcının
   o cihaz için döndürdüğü kısımdan alınır. Eski siparişlerde kategori adı farklıysa
   ilgili geçmiş kategori için de eşleme gereklidir.
5. Cihazda sağlayıcının birden fazla sepet listeleme modunu ve ilgili TokenX
   uygulamasını kullanın. Bu sürüm `Add Basket` kullanır; `Add Instant Basket` kullanmaz.

## Kasadaki akış

Kasa vardiyasını açın, masayı seçin ve kart tahsilatına basın. Tepsy önce adisyonu
aktarır. Personel cihazda ilgili masanın adisyonunu seçip tahsilatı tamamlar,
ardından Tepsy'nin mevcut harici kart tahsilatı onayını verir.

Aktarım başarılı cevabı banka onayı değildir. Tepsy bu aşamada banka işlemi başlatmaz,
webhook ile ödeme onaylamaz veya aktarım cevabına bakarak masayı kapatmaz. Kaydedilen
kart tahsilatı **MANUAL** olarak kalır. Nakit/diğer ödeme akışları otomatik aktarılmaz.

İlk sürüm TL cinsinden, henüz ödeme alınmamış adisyonun tamamını destekler.
Parçalı tahsilat, farklı para birimi, bilinmeyen mali kısım ve tutar uyuşmazlığı
aktarımdan önce reddedilir. Sunucuda kayıtlı geçmiş ürün adı ve fiyatı kullanılır;
tarayıcıdan fiyat/ürün listesi kabul edilmez. Adisyon aktarımından sonra değişmişse
kart kaydı durdurulur; cihazdaki eski adisyon ayrıca kontrol edilmelidir.

## Tekrar gönderim ve hata yönetimi

Siparişler ağ isteğinden **önce** kalıcı bir aktarım kaydına ayrılır. Aynı siparişler
yeniden seçilse, farklı istek anahtarı kullanılsa veya sunucu yeniden başlatılsa da
yeni bir sepet oluşturulmaz. Değişen veya birbiriyle çakışan adisyonlar reddedilir.

Belirsiz cevapta oluşturma isteği otomatik tekrarlanmaz. En az 30 saniye sonra aynı
işlem yeniden denendiğinde mevcut sepet UUID'si sağlayıcıdan sorgulanır; ürünler ve
tutar eşleşirse mevcut aktarım kullanılır. Sorguyla doğrulanamayan, silinmiş veya
üç günden eski kayıtlar yeni sepete dönüştürülmez. Böyle bir durumda cihazdaki
adisyonu ve sağlayıcı kayıtlarını kontrol edin. Tekrar denemeyi açmak için kayıt
dosyasını silmeyin: bu işlem çift mali belge/tahsilat riskini yeniden oluşturabilir.

Aktarım kayıtları cihaz yapılandırma dosyasının yanındaki `terminal-transfers.db`
SQLite dosyasındadır. Ana restoran veritabanının şeması değiştirilmez. Yedekleme ve
geri yükleme planına bu dosyayı da SQLite tutarlı yedek yöntemiyle dahil edin;
veritabanı ve aktarım kayıtlarının birlikte korunması gerekir.

## Destek kapsamı ve doğrulama

| Bağlantı                                | Bu sürüm                                                                |
| --------------------------------------- | ----------------------------------------------------------------------- |
| TokenX bulut API'si                     | Gerçek sağlayıcı protokolüyle adisyon aktarımı                          |
| Cihazın Ethernet/Wi-Fi/mobil bağlantısı | Cihaz ve sağlayıcı destekliyorsa bulut üzerinden                        |
| Doğrudan USB/seri port                  | Henüz eklenmedi; üreticinin IntegrationHub DLL'i ve cihaz testi gerekli |
| NEXO_LOCAL                              | Mevcut erişilebilirlik kontrolü; adisyon veya banka tahsilatı başlatmaz |
| Otomatik banka onayı/hesap kapama       | Henüz eklenmedi; mevcut personel doğrulaması sürer                      |

Otomatik testler istek formatını, tarihsel fiyatları, mali kısım doğrulamasını,
kalıcı tekrar gönderim korumasını ve hata yollarını doğrular. Fiziksel cihazda veya
sağlayıcının canlı hesabında kabul testi yapılmadan cihaz uyumluluğu ve canlı
çalışma onaylanmış sayılmaz. Hesap/cihaz erişimi sağlandığında gerçek bir adisyon,
indirim, başarısız aktarım ve yeniden başlatma senaryolarını test edin.

Resmi kaynaklar:

- [TokenX Cloud geliştirici dokümanı](https://developer.tokeninc.com/token-developer-portal-1/x-platform/token-x-connect-cloud/gelistirici-dokumani-tr)
- [TokenX resmi API koleksiyonu](https://documenter.getpostman.com/view/29891759/2sB34hEzUj)
- [Ürün, miktar ve indirim alanları](https://developer.tokeninc.com/token-developer-portal-1/x-platform/token-x-connect-wire/gelistirici-dokumani)
