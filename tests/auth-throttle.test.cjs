const test = require("node:test");
const assert = require("node:assert/strict");
const { createAuthenticationThrottle } = require("../src/lib/auth-throttle.cjs");
const trusted = require("../src/lib/trusted-client.cjs");
const proof = trusted.installTrustedClientProof();
const headers = (values) => ({ get: (key) => values[key] ?? null });
const request = (ip = "192.168.1.22") => ({
  headers: headers({ "x-tepsy-client-ip": ip, [trusted.PROOF_HEADER]: proof }),
});

test("eight simultaneous reservations consume quota before asynchronous verification and expire after fifteen minutes", () => {
  let time = 100000;
  const reserve = createAuthenticationThrottle({ now: () => time });
  const pending = Array.from({ length: 8 }, () => reserve(request()));
  assert.ok(pending.every((entry) => entry.allowed));
  assert.deepEqual(reserve(request()), { allowed: false, retryAfter: 900 });
  time += 899001;
  assert.deepEqual(reserve(request()), { allowed: false, retryAfter: 1 });
  time += 999;
  assert.equal(reserve(request()).allowed, true);
});

test("success credits its own reservation but an old request cannot clear a newer window", () => {
  let time = 100000;
  const reserve = createAuthenticationThrottle({ now: () => time });
  const first = reserve(request());
  for (let index = 0; index < 7; index++) reserve(request());
  first.complete(true);
  assert.equal(reserve(request()).allowed, true);
  const old = reserve(request("192.168.1.33"));
  time += 900000;
  for (let index = 0; index < 8; index++) reserve(request("192.168.1.33"));
  old.complete(true);
  assert.equal(reserve(request("192.168.1.33")).allowed, false);
});

test("full tracking state does not evict active quotas and expired clients free capacity", () => {
  let time = 100000;
  const states = new Map();
  const reserve = createAuthenticationThrottle({ states, maxClients: 2, now: () => time });
  reserve(request("192.168.1.1"));
  reserve(request("192.168.1.2"));
  assert.deepEqual(reserve(request("192.168.1.3")), { allowed: false, retryAfter: 60 });
  assert.equal(states.size, 2);
  time += 900000;
  assert.equal(reserve(request("192.168.1.3")).allowed, true);
  assert.equal(states.size, 1);
});

test("legacy attempt state is reused and legacy peer header remains compatible", () => {
  const states = new Map([["peer", { count: 8, resetAt: 1000000 }]]);
  const reserve = createAuthenticationThrottle({ states, now: () => 100000 });
  assert.deepEqual(
    reserve({
      headers: headers({ "x-restopos-client-ip": "peer", [trusted.PROOF_HEADER]: proof }),
    }),
    { allowed: false, retryAfter: 900 }
  );
  assert.equal(globalThis.__tepsyLoginAttempts, globalThis.__restoposLoginAttempts);
});

test("valid staff logins cannot erase failures from attempts against another credential", () => {
  const reserve = createAuthenticationThrottle({ now: () => 100000 });
  for (let index = 0; index < 7; index++) reserve(request());
  const staffLogin = reserve(request());
  assert.equal(staffLogin.allowed, true);
  staffLogin.complete(true);
  assert.equal(reserve(request()).allowed, true);
  assert.equal(
    reserve(request()).allowed,
    false,
    "Successful staff login must not reset the failed-password quota"
  );
});
