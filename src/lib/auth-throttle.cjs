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
    // server.js replaces these headers with the actual TCP peer before handing the request to Next.
    const key = String(
      request.headers.get("x-tepsy-client-ip") ||
        request.headers.get("x-restopos-client-ip") ||
        "unknown"
    );
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

const states = globalThis.__tepsyLoginAttempts || globalThis.__restoposLoginAttempts || new Map();
globalThis.__tepsyLoginAttempts = states;
globalThis.__restoposLoginAttempts = states;

module.exports = {
  createAuthenticationThrottle,
  reserveAuthenticationAttempt: createAuthenticationThrottle({ states }),
};
