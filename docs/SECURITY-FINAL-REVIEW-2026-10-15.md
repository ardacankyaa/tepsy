# Tepsy son güvenlik taraması — 15 Ekim 2026

Önceki [incelemenin](SECURITY-REVIEW-2026-10-15.md) ardından üç alt ajanla bağımsız
kontroller yapıldı. Kapsam: giriş/şifre/oturum, HTTP ve Socket.IO yetkileri,
personel/kurulum/sıfırlama, ödeme/sipariş/kasa/QR/TokenX, görsel yükleme, dosya
yolları, yazıcı ve cihaz bağlantıları, yedek dışa aktarımı, komut ve HTML girdileri,
bağımlılıklar ve yerel kurulum. Canlı restoran verisi kullanılmadı.

## Bu taramada düzeltilenler

### 1. Bekleyen bağlantının eski yetkiyle açılması

Konum: `server.js`, `src/lib/security-policy.cjs`.

Personel yetkisi/PIN'i değişirken, hesap silinirken veya yönetici şifresi değişirken
Socket.IO kimlik denetimi devam edebiliyordu. Henüz bağlı soket listesine alınmayan
bir bağlantı, mevcut bağlantıları kapatan işlemden kaçıp önceki rolüyle sonradan
katılabiliyordu. İlk yönetici kurulumu öncesinde başlayan yerel bağlantı da bu
yarışın kapsamındaydı. Önkoşul, geçerli eski oturumla veya yerel ilk kurulum sırasında
bir bağlantı başlatabilmekti; etki eski yetkiyle olayları almaya devam etmekti.

Yetki değişiklikleri artık süreçte paylaşılan bir revizyonu artırır. Bağlantının
başlangıcındaki revizyon, asenkron kontrollerden sonra ve bağlantı kaydı tamamlanınca
yeniden karşılaştırılır. Güncel olmayan bağlantı personel odasına katılmadan kapanır.
Önce başarısız olan regresyonlar düzeltmeden sonra geçti; API ve sunucunun ayrı modül
kopyalarının aynı revizyonu gördüğü de test edildi.

### 2. Kimlik gerektirmeyen QR isteklerinin sınırsız okunması

Konum: `src/app/api/public/orders/route.js`,
`src/app/api/public/service-requests/route.js`, `src/lib/request-json.mjs`.

QR sipariş, sipariş iptali ve garson/hesap çağrısı gövdeleri token doğrulamasından
önce sınırsız JSON olarak belleğe alınıyordu. Ağdan erişen bir kişi, geçerli QR
tokeni olmadan da büyük veya tamamlanmayan veri gönderebiliyordu.

Bu yollar artık en fazla 32 KiB okur ve 10 saniyede tamamlanmayan gövdeyi iptal eder.
Sınır Content-Length olmadan parçalı gönderimde de uygulanır. Büyük istekler 413,
zaman aşımı 408 döndürür. Girişteki mevcut 16 KiB sınırı aynı ortak okuyucuyla korunur.
Azami normal QR sepeti kabul edilir; geçersiz büyük veri veritabanına ulaşmaz. Gerçek
HTTP üzerinde üç yolun hem uzunluk belirtilen hem parçalı istekleri 413 döndürdü.
Sunucuyu durduracak büyüklükte yük saldırısı yapılmadı.

### 3. Kasa eksiği olduğunda kapanışın hata vermesi

Konum: `src/app/api/pos/shift/route.js`.

Eşzamanlı finans senaryoları sırasında, sayılan nakdin beklenen tutardan az olması
vardiya kapanışında 500 hatası üretti. Kasa farkı doğru hesaplanıyordu; yanıt
oluşturulurken bu negatif fark, negatif ödeme gibi reddediliyordu. Aynı sorun eksi
fark içeren geçmiş vardiyayı okumayı da etkiliyordu. Bu bir işleyiş hatasıydı;
yetkisiz para çekimi veya çift tahsilat gösterilmedi.

Yalnızca hesaplanan kasa farkı işaretli tutar olarak yazılır. Kasa sayımı ve ödeme
girdileri negatif olamaz. Tarihçe, kapanış, değişmez kapanış dökümü ve aynı isteğin
tekrarı regresyon testleriyle doğrulandı. Gerçek sunucuda eşzamanlı aynı anahtarlı
ödemeler tek tahsilatı döndürdü; farklı anahtarlı tam ödemeler yalnızca bir kez
kaydedildi. Ödeme/kapanış yarışı dökümdeki gerçek kayıtlarla tutarlı sonuç verdi.

## Son kaynak durumunun test sonuçları

| Kontrol                             | Sonuç                                                                          |
| ----------------------------------- | ------------------------------------------------------------------------------ |
| Tüm Node birim testleri             | 277/277 geçti                                                                  |
| Gerçek üretim sunucusu entegrasyonu | 32/32 grup geçti                                                               |
| Tüm kayıtlı tarayıcı grupları       | 26/26 geçti; mobil/masaüstü, TR/EN, tema, ödeme, QR ve bağlantı kurtarma dahil |
| Python yedekleme ve yükseltme       | 4/4 geçti                                                                      |
| Üretim derlemesi                    | Next.js 15.5.28 ile başarılı                                                   |
| Ayrı yönetilen kurulum              | 9 kontrol geçti; demo ve normal kurulumun kaynak parmak izi son kodla aynı     |
| Biçim, lint ve sürüm dosyaları      | Başarılı                                                                       |
| Üretim bağımlılığı taraması         | 0 bildirilmiş açık                                                             |

Toplu kanıt: `.tepsy/qa/final-security-2026-10-15.json`. Ayrıntılar:
`.tepsy/qa/integration-5RT9Kr/results.json`, bu klasördeki `fixtures/suite.log`,
`.tepsy/qa/managed-demo-j4Ul4k/results.json`, `.tepsy/qa/final-security-unit.log`
ve `.tepsy/qa/final-security-audit.json`.

Testlerden önce ve sonra işlevsel kaynak parmak izi:
`ebc07a5ad97c3d655aea40b4be46a60289c50f33683b35faa0dfbd01cc4a36fc`.
Entegrasyon sonunda korunan restoran verisi, cihaz ayarları ve oturum anahtarının
değişmediği doğrulandı. Test sunucuları kendilerine ait geçici veritabanları kullandı
ve durduruldu.

## Kapsamın pratik sınırları

İncelenen dosya, yazıcı, görsel, fiyat, ödeme ve QR masa kapsamı yollarında başka
doğrulanmış açık bulunmadı. Salt bir kod deseni veya eksik tercih, sömürü yolu
gösterilmeden açık olarak raporlanmadı. Bu sonuç hiçbir açık veya hata bulunmadığına
dair garanti değildir.

Fiziksel POS ve gerçek banka/TokenX hesabı sağlanmadı. Uygulamanın manuel kart kaydı
dışarıda alınmış ödemeyi kaydeder; banka onayı üretmez. İnternet yayını kurulmadı.
HTTPS, tünel/ters vekil düzeni ve yerel yönetim yollarının dışarıya kapatılması,
seçilecek gerçek yayın ortamında ayrıca doğrulanmalıdır. Canlı yedekten geri dönüş
ve kurulu bilgisayarın dosya izinleri bu taramada değiştirilmedi.

Bağımlılık taramasında üretim paketlerinde 0 bildirilmiş açık vardı. Geliştirme
araçlarında `braces` zincirinden gelen 6 yüksek seviye paket uyarısı devam ediyor;
bunlar altı ayrı kök açık değil. Önceki rapordaki yamasız paket durumu ve uygulama
erişilebilirliği sınırı geçerlidir; uyarılar bastırılmadı.

## Uygulama

Çalışan restoran sunucusu bu tarama sırasında yeniden başlatılmadı. Düzeltmeleri
kuruluma almak için kaynak proje klasöründe `START.bat` açın. Başlatıcı çalışan
kurulumu gerektiğinde otomatik durdurup günceller ve yeniden başlatır; ayrı bir
durdurma komutu gerekmez. Kod ve gerekli derleme güncellenir; mevcut restoran veritabanı
korunur. Oturum iptali/yedekleme koşulları [işletim belgesindedir](OPERATIONS.md).
