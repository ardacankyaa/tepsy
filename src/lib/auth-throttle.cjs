const { isIP } = require("node:net");
const { isServerComputerRequest, trustedClientAddress } = require("./trusted-client.cjs");

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
      // Map order is window start order. A full table forgets the oldest window
      // rather than refusing every new client; an attacker who can fill it from
      // that many addresses gains nothing it did not already have.
      states.delete(key);
      while (states.size >= maxClients) states.delete(states.keys().next().value);
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
const ACCOUNT_MAX_PEERS = 1024;

// Groups the addresses one device can cheaply rotate through: an IPv6 host can pick
// any address in its /64, so the /64 counts as one peer. IPv4 addresses (including
// IPv4-mapped IPv6) count individually.
function lockoutPeer(address) {
  const value = String(address || "")
    .toLowerCase()
    .replace(/%.*$/, "");
  const mapped = value.match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/)?.[1];
  if (mapped && isIP(mapped) === 4) return mapped;
  if (isIP(value) === 4) return value;
  if (isIP(value) !== 6) return "unknown";
  const groups = (part) =>
    part ? part.split(":").flatMap((group) => (group.includes(".") ? ["0", "0"] : [group])) : [];
  const [head, tail] = value.split("::");
  const left = groups(head);
  const right = tail === undefined ? [] : groups(tail);
  const full =
    tail === undefined
      ? left
      : [...left, ...Array(Math.max(0, 8 - left.length - right.length)).fill("0"), ...right];
  return `${full
    .slice(0, 4)
    .map((group) => parseInt(group, 16).toString(16))
    .join(":")}::/64`;
}

// Per-account backoff in addition to the per-client quota. Ten failed guesses against
// one staff name or the owner, from any number of peers, lock that account with backoff
// from one to fifteen minutes. Unknown names are tracked the same way, so a lockout
// reveals nothing.
//
// The lock is global, but it refuses only peers that have themselves failed against the
// account. A peer with no failure of its own is always allowed to verify its credential,
// so a remote device cannot lock other devices out of a correct sign-in. Every failed
// guess still counts globally and marks its peer, so an attacker rotating addresses gets
// at most one extra guess per new peer while the lock lasts instead of a fresh quota; an
// IPv6 /64 is one peer. A success credits only that peer's own failures (its typos); the
// failures of other peers remain. The server computer's own loopback address is exempt.
// Only guesses that reach a credential check count: login checks the restaurant code
// first, and a wrong code counts only against the per-client quota.
function createAccountLockout({
  states = new Map(),
  now = Date.now,
  maxAccounts = MAX_CLIENTS,
  maxPeers = ACCOUNT_MAX_PEERS,
} = {}) {
  let lastSweep = 0;
  const expired = (state, timestamp) =>
    !state ||
    (state.lockedUntil <= timestamp && state.lastFailureAt + ACCOUNT_RETENTION_MS <= timestamp);
  // A full table forgets the least recently failed account that is not locked
  // (only if every account is locked, the least recently failed one) instead of
  // refusing new names. Expired entries were already swept.
  function evictAccount(timestamp) {
    let victim = states.keys().next().value;
    for (const [key, state] of states)
      if (!(state.lockedUntil > timestamp)) {
        victim = key;
        break;
      }
    states.delete(victim);
  }
  function reserveAccountAttempt(account, request) {
    if (isServerComputerRequest(request)) return { allowed: true, exempt: true, complete() {} };
    const timestamp = now();
    if (timestamp - lastSweep >= 60000 || states.size >= maxAccounts) {
      for (const [key, state] of states) if (expired(state, timestamp)) states.delete(key);
      lastSweep = timestamp;
    }
    const key = String(account || "");
    const peerKey = lockoutPeer(trustedClientAddress(request));
    let state = states.get(key);
    if (expired(state, timestamp)) {
      states.delete(key);
      state = undefined;
    }
    if (state && !(state.peers instanceof Map)) state.peers = new Map();
    let peer = state?.peers.get(peerKey);
    if (peer && peer.lastFailureAt + ACCOUNT_RETENTION_MS <= timestamp) {
      state.peers.delete(peerKey);
      peer = undefined;
    }
    if (state && state.lockedUntil > timestamp && peer)
      return {
        allowed: false,
        retryAfter: Math.max(1, Math.ceil((state.lockedUntil - timestamp) / 1000)),
      };
    if (!state) {
      if (states.size >= maxAccounts) evictAccount(timestamp);
      state = { failures: 0, lockedUntil: 0, lastFailureAt: timestamp, peers: new Map() };
    }
    // Keep accounts ordered from least to most recently failed.
    states.delete(key);
    states.set(key, state);
    if (!peer) {
      if (state.peers.size >= maxPeers) state.peers.delete(state.peers.keys().next().value);
      peer = { failures: 0, lastFailureAt: timestamp };
    }
    // Keep peers ordered from least to most recently failed.
    state.peers.delete(peerKey);
    state.peers.set(peerKey, peer);
    // Count the guess before any await; only a verified success removes it.
    state.failures += 1;
    peer.failures += 1;
    state.lastFailureAt = timestamp;
    peer.lastFailureAt = timestamp;
    if (state.failures >= ACCOUNT_MAX_FAILURES) {
      const doublings = Math.min(state.failures - ACCOUNT_MAX_FAILURES, 20);
      state.lockedUntil = Math.max(
        state.lockedUntil,
        timestamp + Math.min(ACCOUNT_BASE_LOCK_MS * 2 ** doublings, ACCOUNT_MAX_LOCK_MS)
      );
    }
    let completed = false;
    return {
      allowed: true,
      complete(success) {
        if (completed) return;
        completed = true;
        if (success !== true || states.get(key) !== state || state.peers.get(peerKey) !== peer)
          return;
        state.peers.delete(peerKey);
        state.failures = Math.max(0, state.failures - peer.failures);
        if (state.failures < ACCOUNT_MAX_FAILURES) state.lockedUntil = 0;
        if (state.failures === 0 && state.peers.size === 0) states.delete(key);
      },
    };
  }
  // A changed or reset credential makes earlier guesses irrelevant.
  reserveAccountAttempt.clear = (account) => states.delete(String(account || ""));
  return reserveAccountAttempt;
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

const reserveAccountAttempt = createAccountLockout({ states: accountStates });

module.exports = {
  ACCOUNT_MAX_FAILURES,
  clearAccountLockout: reserveAccountAttempt.clear,
  createAccountLockout,
  createAuthenticationThrottle,
  lockoutPeer,
  loginAccountKey,
  reserveAccountAttempt,
  reserveAuthenticationAttempt: createAuthenticationThrottle({ states }),
};
