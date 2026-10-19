function sessionCookieNames(env = process.env) {
  const instance = env.TEPSY_INSTANCE_ID;
  if (instance !== undefined && !/^[a-f0-9]{32}$/.test(instance))
    throw new Error("TEPSY_INSTANCE_ID must be a 128-bit lowercase hexadecimal identifier.");
  if (instance)
    return { current: `tepsy_${instance}_session`, legacy: `restopos_${instance}_session` };
  return env.TEPSY_DEMO_MODE === "1"
    ? { current: "tepsy_demo_session", legacy: "restopos_demo_session" }
    : { current: "tepsy_session", legacy: "restopos_session" };
}
module.exports = { sessionCookieNames };
