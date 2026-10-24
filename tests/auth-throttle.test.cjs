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

test("account lockout counts concurrent guesses, backs off and treats unknown names alike", () => {
  const {
    createAccountLockout,
    loginAccountKey,
    ACCOUNT_MAX_FAILURES,
  } = require("../src/lib/auth-throttle.cjs");
  let time = 100000;
  const reserve = createAccountLockout({ now: () => time });
  assert.equal(ACCOUNT_MAX_FAILURES, 10);
  assert.equal(loginAccountKey("  ALİ "), loginAccountKey("ali"));
  assert.equal(loginAccountKey(""), "owner");
  for (const account of ["staff:ali", "staff:nobody"]) {
    const pending = Array.from({ length: 10 }, () => reserve(account));
    assert.ok(
      pending.every((entry) => entry.allowed),
      "reservations happen before verification"
    );
    assert.deepEqual(reserve(account), { allowed: false, retryAfter: 60 });
  }
  const lockouts = [];
  for (let round = 0; round < 6; round++) {
    const blocked = reserve("staff:ali");
    time += blocked.retryAfter * 1000;
    assert.equal(reserve("staff:ali").allowed, true);
    lockouts.push(reserve("staff:ali").retryAfter);
  }
  assert.deepEqual(lockouts, [120, 240, 480, 900, 900, 900]);
  time += 900_000;
  const success = reserve("staff:ali");
  success.complete(true);
  assert.equal(reserve("staff:ali").allowed, true, "a success clears earlier failures");
  time += 24 * 60 * 60 * 1000;
  for (let index = 0; index < 9; index++) reserve("staff:nobody");
  assert.equal(reserve("staff:nobody").allowed, true, "failures are forgotten after a day");
});

test("account tracking capacity never evicts an active lockout", () => {
  const { createAccountLockout } = require("../src/lib/auth-throttle.cjs");
  const states = new Map();
  const reserve = createAccountLockout({ states, maxAccounts: 2, now: () => 100000 });
  reserve("staff:a");
  reserve("staff:b");
  assert.deepEqual(reserve("staff:c"), { allowed: false, retryAfter: 60 });
  assert.equal(states.size, 2);
});

test("account lockout refuses only peers that failed themselves and exempts the server computer", () => {
  const { createAccountLockout } = require("../src/lib/auth-throttle.cjs");
  let time = 100000;
  const reserve = createAccountLockout({ now: () => time });
  for (let index = 0; index < 10; index++) reserve("owner", request(`10.9.0.${index}`));
  assert.deepEqual(reserve("owner", request("10.9.0.1")), { allowed: false, retryAfter: 60 });
  const clean = reserve("owner", request("10.9.1.1"));
  assert.equal(clean.allowed, true, "a peer without failures may still verify its credential");
  assert.equal(reserve("owner", request("10.9.1.1")).allowed, false, "until it fails once");
  for (const peer of ["127.0.0.1", "::1", "::ffff:127.0.0.1"])
    for (let index = 0; index < 20; index++)
      assert.equal(reserve("owner", request(peer)).exempt, true);
  assert.equal(reserve("owner", request("127.0.0.2")).exempt, undefined);
  assert.equal(reserve("owner", request("127.0.0.2")).allowed, false);
  // A success credits only the succeeding peer's own failures.
  const own = createAccountLockout({ now: () => time });
  for (let index = 0; index < 6; index++) own("staff:ali", request("10.9.2.1"));
  for (let index = 0; index < 4; index++) own("staff:ali", request(`10.9.3.${index}`));
  assert.equal(own("staff:ali", request("10.9.2.1")).allowed, false);
  own("staff:ali", request("10.9.4.1")).complete(true);
  assert.equal(own("staff:ali", request("10.9.2.1")).allowed, false, "others' failures remain");
  time += 15 * 60_000;
  own("staff:ali", request("10.9.2.1")).complete(true);
  for (let index = 0; index < 5; index++)
    assert.equal(own("staff:ali", request(`10.9.5.${index}`)).allowed, true);
  assert.equal(own("staff:ali", request("10.9.5.0")).allowed, true, "four failures, not ten");
});

test("lockout peers group an IPv6 /64 and normalize IPv4-mapped addresses", () => {
  const { lockoutPeer, createAccountLockout } = require("../src/lib/auth-throttle.cjs");
  assert.equal(lockoutPeer("192.168.1.5"), "192.168.1.5");
  assert.equal(lockoutPeer("::FFFF:192.168.1.5"), "192.168.1.5");
  assert.equal(lockoutPeer("2001:db8:1:2:3:4:5:6"), lockoutPeer("2001:DB8:1:2::9"));
  assert.notEqual(lockoutPeer("2001:db8:1:2::1"), lockoutPeer("2001:db8:1:3::1"));
  assert.equal(lockoutPeer("fe80::1%eth0"), lockoutPeer("fe80::2"));
  assert.equal(lockoutPeer(""), "unknown");
  assert.equal(lockoutPeer("not an address"), "unknown");
  const states = new Map();
  const reserve = createAccountLockout({ states, maxPeers: 2, now: () => 100000 });
  for (const peer of ["10.8.0.1", "10.8.0.2", "10.8.0.3"]) reserve("staff:x", request(peer));
  assert.deepEqual([...states.get("staff:x").peers.keys()], ["10.8.0.2", "10.8.0.3"]);
});
