const API_ERROR = "Yönetici şifresi sunucu bilgisayarında ayarlanmadan ağ erişimi açılamaz.";

function safePort(value) {
  const port = Number(value);
  return Number.isInteger(port) && port >= 1 && port <= 65535 ? port : 3000;
}

function createBootstrapAccessResponse({ isApi = false, port = 3000 } = {}) {
  if (isApi) {
    return {
      contentType: "application/json; charset=utf-8",
      body: JSON.stringify({ error: API_ERROR }),
    };
  }

  const settingsUrl = `http://localhost:${safePort(port)}/admin/settings`;
  return {
    contentType: "text/html; charset=utf-8",
    body: `<!doctype html>
<html lang="tr">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="noindex, nofollow">
  <title>TEPSY kurulumu bekleniyor</title>
  <style>
    :root { color-scheme: light; font-family: Inter, ui-sans-serif, system-ui, sans-serif; background: #f5f4f1; color: #24231f; }
    * { box-sizing: border-box; }
    body { min-height: 100vh; margin: 0; display: grid; place-items: center; padding: 24px; }
    main { width: min(100%, 520px); padding: 32px; border: 1px solid #e4e1db; border-radius: 18px; background: #fff; box-shadow: 0 18px 60px #28251d12; }
    .mark { display: grid; width: 40px; height: 40px; place-items: center; border-radius: 12px; background: #f5eee0; color: #9b6817; font-weight: 800; }
    h1 { margin: 24px 0 10px; font-size: 23px; letter-spacing: -.025em; }
    p { color: #66645d; font-size: 14px; line-height: 1.65; }
    .address { display: block; margin-top: 12px; padding: 13px 15px; border: 1px solid #dcd8d0; border-radius: 10px; background: #f8f7f5; color: #34342f; font-size: 13px; font-weight: 700; overflow-wrap: anywhere; }
    @media (max-width: 480px) { main { padding: 24px; } }
  </style>
</head>
<body>
  <main>
    <div class="mark" aria-hidden="true">R</div>
    <h1>TEPSY ilk yönetici şifresini bekliyor</h1>
    <p>İlk kurulum güvenliği nedeniyle yönetici şifresi yalnızca TEPSY'un çalıştığı bilgisayardan belirlenebilir. Bu ayarı ağdaki başka bir cihazdan açamazsınız.</p>
    <p>TEPSY sunucu bilgisayarındaki tarayıcıya şu adresi yazın:</p>
    <code class="address">${settingsUrl}</code>
    <p>Bu adresi bu cihazda açmayın; <code>localhost</code> yalnızca TEPSY sunucu bilgisayarını gösterir.</p>
    <p>Yönetici şifresi belirlendikten sonra personel ağı erişimi etkinleşir.</p>
  </main>
</body>
</html>`,
  };
}

module.exports = { createBootstrapAccessResponse };
