function parseAmountCents(value) {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const text = String(value).trim().replace(",", ".");
  if (!/^\d+(?:\.\d{1,2})?$/.test(text)) return null;
  const [whole, fraction = ""] = text.split(".");
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  return Number.isSafeInteger(cents) ? cents : null;
}
function centsAmount(cents) {
  if (!Number.isSafeInteger(cents) || cents < 0) throw new RangeError("Invalid cents");
  return `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, "0")}`;
}
function splitRemainingBalance(amount, count) {
  const cents = parseAmountCents(amount),
    people = Number(count);
  if (!Number.isInteger(people) || people < 2 || people > 50 || cents === null || cents < people)
    throw new RangeError("Every person must have a positive share");
  const base = Math.floor(cents / people),
    extra = cents % people;
  return Array.from({ length: people }, (_, index) => base + (index < extra ? 1 : 0));
}
module.exports = { parseAmountCents, centsAmount, splitRemainingBalance };
