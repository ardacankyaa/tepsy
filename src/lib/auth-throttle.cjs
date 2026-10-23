const { trustedClientAddress } = require("./trusted-client.cjs");

const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_MAX_ATTEMPTS = 8;
const MAX_CLIENTS = 8192;

function createAuthenticationThrottle({
  states = new Map(),
  now = Date.now,
  maxClients = MAX_CLIENTS,
} = {}) {
  let lastSweep = 0;
  return function reserveAuthenticationAttempt(request) {
    const timestamp = now();
    if (timestamp - lastSweep >= 60000 || states.size >= maxClients) {
      for (const [key, state] of states) {
        if (!state || state.resetAt <= timestamp) states.delete(key);
      }
      lastSweep = timestamp;
    }
    // Only the peer address stamped by server.js counts; anything else shares one quota.
    const key = trustedClientAddress(request) || "unknown";
    let state = states.get(key);
    if (!state || state.resetAt <= timestamp) {
      if (states.size >= maxClients) return { allowed: false, retryAfter: 60 };
      state = { count: 0, resetAt: timestamp + LOGIN_WINDOW_MS };
      states.set(key, state);
    }
    if (state.count >= LOGIN_MAX_ATTEMPTS) {
      return {
        allowed: false,
        retryAfter: Math.max(1, Math.ceil((state.resetAt - timestamp) / 1000)),
      };
    }
    // Reserve before any await so simultaneous requests cannot all observe the same unused quota.
    state.count += 1;
    let completed = false;
    return {
      allowed: true,
      complete(success) {
        // Credit only this successful request; another account's failures must remain.
        if (completed) return;
        completed = true;
        if (success === true && states.get(key) === state) {
          state.count = Math.max(0, state.count - 1);
          if (state.count === 0) states.delete(key);
        }
      },
    };
  };
}

const ACCOUNT_MAX_FAILURES = 10;
const ACCOUNT_BASE_LOCK_MS = 60 * 1000;
const ACCOUNT_MAX_LOCK_MS = 15 * 60 * 1000;
const ACCOUNT_RETENTION_MS = 24 * 60 * 60 * 1000;

// Per-account backoff in addition to the per-client quota: guesses against one
// staff PIN or the owner password from many addresses still lock that account.
// Unknown accounts are tracked the same way so lockouts reveal nothing.
function createAccountLockout({
  states = new Map(),
  now = Date.now,
  maxAccounts = MAX_CLIENTS,
} = {}) {
  let lastSweep = 0;
  const expired = (state, timestamp) =>
    !state ||
    (state.lockedUntil <= timestamp && state.lastFailureAt + ACCOUNT_RETENTION_MS <= timestamp);
  return function reserveAccountAttempt(account) {
    const timestamp = now();
    if (timestamp - lastSweep >= 60000 || states.size >= maxAccounts) {
      for (const [key, state] of states) if (expired(state, timestamp)) states.delete(key);
      lastSweep = timestamp;
    }
    const key = String(account || "");
    let state = states.get(key);
    if (expired(state, timestamp)) {
      states.delete(key);
      state = undefined;
    }
    if (state && state.lockedUntil > timestamp)
      return {
        allowed: false,
        retryAfter: Math.max(1, Math.ceil((state.lockedUntil - timestamp) / 1000)),
      };
    if (!state) {
      if (states.size >= maxAccounts) return { allowed: false, retryAfter: 60 };
      state = { failures: 0, lockedUntil: 0, lastFailureAt: timestamp };
      states.set(key, state);
    }
    // Count the guess before any await; only a verified success removes it.
    state.failures += 1;
    state.lastFailureAt = timestamp;
    if (state.failures >= ACCOUNT_MAX_FAILURES) {
      const doublings = Math.min(state.failures - ACCOUNT_MAX_FAILURES, 20);
      state.lockedUntil =
        timestamp + Math.min(ACCOUNT_BASE_LOCK_MS * 2 ** doublings, ACCOUNT_MAX_LOCK_MS);
    }
    let completed = false;
    return {
      allowed: true,
      complete(success) {
        if (completed) return;
        completed = true;
        if (success === true && states.get(key) === state) states.delete(key);
      },
    };
  };
}

function loginAccountKey(username) {
  const name = String(username || "")
    .trim()
    .toLocaleLowerCase("tr-TR");
  return name ? `staff:${name}` : "owner";
}

const states = globalThis.__tepsyLoginAttempts || globalThis.__restoposLoginAttempts || new Map();
globalThis.__tepsyLoginAttempts = states;
globalThis.__restoposLoginAttempts = states;
const accountStates = globalThis.__tepsyLoginAccounts || new Map();
globalThis.__tepsyLoginAccounts = accountStates;

module.exports = {
  ACCOUNT_MAX_FAILURES,
  createAccountLockout,
  createAuthenticationThrottle,
  loginAccountKey,
  reserveAccountAttempt: createAccountLockout({ states: accountStates }),
  reserveAuthenticationAttempt: createAuthenticationThrottle({ states }),
};
