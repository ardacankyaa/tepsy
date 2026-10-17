const supportedCurrencies = new Set(["₺", "$", "€", "£"]);
async function saveCurrency(fetcher, currency) {
  if (!supportedCurrencies.has(currency)) throw new Error("unsupported-currency");
  const response = await fetcher("/api/config", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ currency }),
  });
  if (!response.ok) throw new Error("currency-save-" + response.status);
  const config = await response.json();
  if (!supportedCurrencies.has(config?.currency)) throw new Error("invalid-currency-response");
  return config.currency;
}
module.exports = { saveCurrency };
