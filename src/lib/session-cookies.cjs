function sessionCookieNames(env = process.env) {
  return env.TEPSY_DEMO_MODE === "1"
    ? { current: "tepsy_demo_session", legacy: "restopos_demo_session" }
    : { current: "tepsy_session", legacy: "restopos_session" };
}
module.exports = { sessionCookieNames };
