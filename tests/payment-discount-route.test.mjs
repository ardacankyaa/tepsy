import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import * as finance from "../src/lib/finance.mjs";
import { PaymentRequestError } from "../src/lib/payment-request.mjs";

const source = (
  await readFile(new URL("../src/app/api/pos/payment/route.js", import.meta.url), "utf8")
)
  .replace(/^import[\s\S]*?from "[^"]+";\r?$/gm, "")
  .replace(/export /g, "");
const dependencies = { ...finance, PaymentRequestError };
const prepareDiscounts = new Function(
  ...Object.keys(dependencies),
  `${source}\nreturn prepareDiscounts;`
)(...Object.values(dependencies));

const parsed = { discountPercentBasisPoints: 1000, discountReason: "Manager approval" };

test("remaining discounted order accepts a second table payment after an earlier order closes", () => {
  const remainingOrder = {
    id: "second",
    status: "PENDING",
    totalPrice: "100.00",
    discountPercent: "10.00",
    discountAmount: "10.00",
    discountReason: parsed.discountReason,
    payments: [],
  };

  assert.deepEqual(prepareDiscounts([remainingOrder], parsed), []);
});

test("an existing unpaid discount cannot be silently changed", () => {
  const remainingOrder = {
    id: "second",
    status: "PENDING",
    totalPrice: "100.00",
    discountPercent: "10.00",
    discountAmount: "10.00",
    discountReason: parsed.discountReason,
    payments: [],
  };

  assert.throws(
    () => prepareDiscounts([remainingOrder], { ...parsed, discountPercentBasisPoints: 2000 }),
    (error) => error instanceof PaymentRequestError && error.status === 409
  );
});
