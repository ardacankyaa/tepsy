function normalizeSetupCredentials(body) {
  const code =
    typeof body?.restaurantCode === "string"
      ? body.restaurantCode.trim().toLocaleUpperCase("tr-TR")
      : "";
  const password = body?.ownerPassword;
  if (!/^[A-Z0-9ÇĞİÖŞÜ_-]{2,32}$/.test(code))
    return { error: "Restoran kodu 2–32 harf, rakam, tire veya alt çizgiden oluşmalıdır." };
  if (typeof password !== "string" || password.trim().length < 8 || password.length > 128)
    return { error: "İşletme sahibi şifresi 8–128 karakter olmalıdır." };
  if (typeof body.ownerPasswordConfirm !== "string" || body.ownerPasswordConfirm !== password)
    return { error: "Şifreler eşleşmiyor." };
  return { restaurantCode: code, ownerPassword: password };
}
module.exports = { normalizeSetupCredentials };
