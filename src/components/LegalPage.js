"use client";

import BrandLogo from "@/components/BrandLogo";
import Link from "next/link";
import { useApp } from "@/lib/AppContext";
import { LegalLinks } from "@/components/ui/Workspace";

const copy = {
  tr: {
    privacy: {
      title: "Gizlilik ve veri kullanımı",
      intro:
        "TEPSY bağımsız bir restoran yönetim uygulamasıdır. Bu sayfa standart kurulumun teknik veri kullanımını açıklar. Restoranın kimliğini, iletişim adresini ve kendi veri işleme koşullarını içeren aydınlatma metni, uygulamayı işleten restoran tarafından ayrıca sağlanmalıdır.",
      sections: [
        [
          "Hangi bilgiler işlenir?",
          "İşletme ve personel bilgileri, roller, parola/PIN özetleri, masa ve menü kayıtları, siparişler, isteğe bağlı sipariş notları, tahsilat ve vardiya kayıtları işletmenin sunucusundaki veritabanında tutulur. QR menüden sipariş için müşteri hesabı açılması gerekmez. Sipariş notlarına kimlik, sağlık veya kart bilgileri yazmayın.",
        ],
        [
          "Neden ve nerede?",
          "Bu bilgiler siparişleri hazırlamak, servisi takip etmek, erişimi yönetmek ve hesap kayıtlarını göstermek için kullanılır. Standart uygulama merkezi bir TEPSY bulut hesabına veri göndermez. Sunucu, ağ erişimi, yedekleme ve varsa dış barındırma koşullarını işletmeci belirler.",
        ],
        [
          "Ödeme ve bağlantılar",
          "Uygulama tahsilat tutarını ve yöntemini kaydeder; kart numarası veya CVV isteyen bir alan içermez. Nexo bağlantı kontrolü ve isteğe bağlı TokenX adisyon aktarımı banka ödeme onayı üretmez. TokenX etkinleştirildiğinde ürün isimleri, miktarlar, fiyatlar ve mali kısım bilgileri sağlayıcıya iletilir. Yazıcı, ağ ve barındırma sağlayıcılarının kullanım koşulları kuruluma göre ayrıca değerlendirilmelidir.",
        ],
        [
          "Saklama, erişim ve başvurular",
          "Kayıtlar için bu sürümde otomatik bir saklama süresi uygulanmaz. İşletmeci, uygulanabilir yükümlülüklere göre saklama ve silme sürelerini, erişim yetkilerini ve yedekleri yönetmelidir. Kendi verilerinizle ilgili bilgi veya hak başvurusu için işlem yaptığınız restoranla iletişime geçin.",
        ],
        [
          "Dil ve kapsam",
          "Türkçe ve İngilizce arayüz desteği, her ülkenin mevzuatına uygunluk belgesi değildir. Bu teknik açıklama işletmeye özel KVKK aydınlatmasının veya hukuki değerlendirmenin yerine geçmez.",
        ],
      ],
    },
    terms: {
      title: "Kullanım koşulları",
      intro:
        "TEPSY; salon, sipariş, mutfak ve kasa işlemlerini yönetmek için bağımsız olarak kurulabilen bir yazılımdır. Restoranın satış ve hizmet koşulları ayrıca restoran tarafından belirlenir.",
      sections: [
        [
          "Yazılım lisansı",
          "Kaynak kod MIT lisansı altında sunulur. Kullanım, değiştirme ve dağıtımda proje kökündeki LICENSE dosyasının koşulları geçerlidir. Yazılım, lisansında belirtilen garanti sınırlamalarıyla sağlanır.",
        ],
        [
          "İşletmenin sorumluluğu",
          "İşletmeci menü fiyatlarını, ürün açıklamalarını, alerjen bilgisini, çalışan yetkilerini, cihaz bağlantılarını ve kayıtların doğruluğunu kontrol eder. Yerel sunucunun korunması, yedeklenmesi ve internete açılıyorsa uygun barındırma yapılandırması işletmeciye aittir.",
        ],
        [
          "Sipariş ve tahsilat",
          "QR üzerinden gönderilen talep işletmenin onay akışına tabidir. Manuel kart tahsilatı, dış terminalde yapılan işlemin personel tarafından kayda alınmasıdır; uygulama kendi başına karttan para çekmez. Bağlı terminalin hata veya belirsiz yanıtı başarılı ödeme sayılmamalıdır.",
        ],
        [
          "Fiş ve raporlar",
          "Uygulama çıktıları ve yönetim raporları, yetkili mali cihaz veya resmi belge entegrasyonunun yerine geçtiği iddiasını taşımaz. Kullanılan kurulum için mali belge, vergi ve tüketici yükümlülükleri ayrıca doğrulanmalıdır.",
        ],
        [
          "İçerik ve destek",
          "İşletmeci eklediği görsel, logo ve metinleri kullanma hakkına sahip olmalıdır. Yazılım bir restoran adına müşteri hizmeti sunmaz. Sipariş, iade ve kişisel veri talepleri için ilgili restoranla iletişime geçin.",
        ],
      ],
    },
    cookies: {
      title: "Çerez ve tarayıcı depolama bilgisi",
      intro:
        "Standart sürüm reklam, davranışsal analitik veya üçüncü taraf sosyal medya gömmesi yüklemez. Aşağıdaki kayıtlar oturum ve seçtiğiniz kullanım tercihleri içindir.",
      sections: [
        [
          "Oturum çerezi",
          "tepsy_session giriş yapıldığında oluşturulur, en fazla 12 saat geçerlidir ve çıkışta silinir. Oturumun doğrulanması ve yetkili ekranlara erişim için kullanılır.",
        ],
        [
          "Dil tercihi",
          "Dili değiştirdiğinizde tepsy_lang çerezi bir yıl süreyle ve aynı isimli yerel depolama kaydı süre sınırı olmadan tercihinizi hatırlar. Tarayıcı site verilerini silerek sıfırlayabilirsiniz.",
        ],
        [
          "Diğer yerel kayıtlar",
          "tepsy_curr para birimi görünümü, soundEnabled ses tercihi, tepsy_theme renk teması ve tepsy_opaque saydamlık tercihi tarayıcınızda tutulur. Görünüm tercihleri ve bekleyen QR siparişinin takibi tarayıcıda tutulabilir. Yanıtı alınamayan siparişin içeriği, notu ve istek anahtarı güvenli yeniden deneme için işlem sonuçlanana veya sekme kapanana kadar oturum depolamasında tutulur. Yerel depolama kayıtları site verilerini temizleyene kadar, oturum depolaması ilgili sekmenin oturumu süresince kalır.",
        ],
        [
          "Tercihlerinizi yönetme",
          "Tarayıcınızın site verileri ayarlarından kayıtları görüntüleyebilir veya silebilirsiniz. Oturum çerezini engellemek giriş yapılmasını engelleyebilir. Bu sürümde pazarlama izni isteyen bir form veya takip çerezi onay kutusu bulunmaz.",
        ],
        [
          "Kurulum değişirse",
          "İşletmeci analitik, reklam, üçüncü taraf içerik veya ek veri alanları eklerse envanteri, aydınlatmayı ve gerekli olduğu durumda önceden alınacak izinleri yeniden değerlendirmelidir. İngilizce kullanım seçeneği diğer ülkelerdeki gereklilikleri ortadan kaldırmaz.",
        ],
      ],
    },
  },
  en: {
    privacy: {
      title: "Privacy and data use",
      intro:
        "TEPSY is independent restaurant management software. This page describes the standard installation's technical data use. The restaurant operating the installation must separately provide its identity, contact details and applicable privacy notice.",
      sections: [
        [
          "Information processed",
          "Business and staff details, roles, password/PIN hashes, tables, menu records, orders, optional order notes, payment records and shifts are stored in the restaurant server's database. QR ordering does not require a customer account. Do not enter identity, health or card details in order notes.",
        ],
        [
          "Purpose and location",
          "Records support order preparation, service, access control and accounting views. The standard application does not send records to a central TEPSY cloud account. The operator determines server hosting, network access and backup arrangements.",
        ],
        [
          "Payments and connections",
          "The application records payment amounts and methods; it has no field requesting card numbers or CVV. Nexo connection checks and optional TokenX bill exports do not produce bank payment approvals. When TokenX is enabled, item names, quantities, prices and fiscal departments are sent to the provider. Printer, network and hosting providers must be assessed for each installation.",
        ],
        [
          "Retention and requests",
          "This version does not enforce automatic retention periods. The operator must determine retention and deletion periods, access permissions and backup handling under applicable obligations. Contact the restaurant where you transacted for information or requests about your data.",
        ],
        [
          "Language and scope",
          "Turkish and English support does not certify compliance in every country. This technical explanation does not replace an operator-specific privacy notice or legal assessment.",
        ],
      ],
    },
    terms: {
      title: "Terms of use",
      intro:
        "TEPSY is independently installed software for restaurant floor, order, kitchen and checkout operations. Each restaurant provides its own sales and service terms.",
      sections: [
        [
          "Software licence",
          "The source code is provided under the MIT licence. Use, modification and distribution are subject to the LICENSE file at the project root, including its warranty limitations.",
        ],
        [
          "Operator responsibilities",
          "The operator checks prices, product descriptions, allergen information, staff permissions, device connections and record accuracy. The operator is responsible for protecting and backing up the local server and configuring hosting if it is made publicly accessible.",
        ],
        [
          "Orders and payments",
          "QR requests follow the restaurant's approval workflow. A manual card payment records a staff-confirmed transaction made on an external terminal; the application does not itself charge a card. A connected terminal's error or uncertain response must not be treated as a successful payment.",
        ],
        [
          "Receipts and reports",
          "Application printouts and management reports are not claimed to replace an authorised fiscal device or official document integration. Fiscal documentation, tax and consumer obligations must be checked for each installation.",
        ],
        [
          "Content and support",
          "Operators must hold the rights to images, logos and text they add. The software does not provide customer service on behalf of a restaurant. Contact the relevant restaurant about orders, refunds and personal data.",
        ],
      ],
    },
    cookies: {
      title: "Cookies and browser storage",
      intro:
        "The standard version loads no advertising, behavioural analytics or third-party social media embeds. The records below support sessions and your selected preferences.",
      sections: [
        [
          "Session cookie",
          "tepsy_session is created when you sign in, lasts up to 12 hours and is deleted on sign-out. It verifies your session and access permissions.",
        ],
        [
          "Language preference",
          "When you change language, tepsy_lang remembers your choice in a one-year cookie and in local storage without an automatic expiry. Clear site data in your browser to reset it.",
        ],
        [
          "Other local records",
          "tepsy_curr stores the currency display, soundEnabled your sound preference, tepsy_theme your color theme and tepsy_opaque your transparency preference. Screens may also store view preferences or pending QR order references. An unresolved order body, note and request key remain in session storage for safe retry until the operation resolves or the tab closes. Local storage remains until site data is cleared; session storage lasts for the relevant tab session.",
        ],
        [
          "Your controls",
          "View or delete records in your browser's site-data settings. Blocking the session cookie may prevent sign-in. This version has no marketing consent form or tracking-cookie consent checkbox.",
        ],
        [
          "Changes to an installation",
          "If an operator adds analytics, advertising, third-party content or data fields, they must reassess the inventory, notices and any required prior consent. English language support does not remove local requirements in other countries.",
        ],
      ],
    },
  },
};

export default function LegalPage({ kind }) {
  const { lang, setLang } = useApp();
  const page = copy[lang][kind];
  return (
    <article className="legal-page">
      <header>
        <Link href="/login" className="font-semibold">
          <BrandLogo full />
        </Link>
        <button
          type="button"
          className="secondary-action px-4"
          onClick={() => setLang(lang === "tr" ? "en" : "tr")}
          aria-label={lang === "tr" ? "Switch to English" : "Türkçeye geç"}
        >
          {lang === "tr" ? "English" : "Türkçe"}
        </button>
      </header>
      <h1>{page.title}</h1>
      <p>{page.intro}</p>
      {page.sections.map(([title, body]) => (
        <section key={title}>
          <h2>{title}</h2>
          <p>{body}</p>
        </section>
      ))}
      <p className="text-sm">
        {lang === "tr"
          ? "Teknik içerik güncellemesi: 27 Eylül 2026."
          : "Technical content updated: 27 September 2026."}
      </p>
      <LegalLinks />
    </article>
  );
}
