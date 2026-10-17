export async function readRequestJson(
  request,
  { maxBytes = 32 * 1024, timeoutMs = 10_000, code = "invalid-json-body" } = {}
) {
  const bodyError = (status) =>
    Object.assign(new Error("Invalid JSON request body."), { code, status });
  const length = request.headers.get("content-length");
  if (length && (!/^\d+$/.test(length) || Number(length) > maxBytes)) throw bodyError(413);
  if (!request.body) throw bodyError(400);
  const reader = request.body.getReader();
  let timer;
  try {
    const read = async () => {
      const chunks = [];
      let size = 0;
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > maxBytes) throw bodyError(413);
        chunks.push(value);
      }
      try {
        return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks)));
      } catch {
        throw bodyError(400);
      }
    };
    return await Promise.race([
      read(),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(bodyError(408)), timeoutMs);
      }),
    ]);
  } catch (error) {
    void reader.cancel().catch(() => {});
    throw error;
  } finally {
    clearTimeout(timer);
    reader.releaseLock();
  }
}
