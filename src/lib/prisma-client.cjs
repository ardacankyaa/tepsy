const { PrismaClient } = require("@prisma/client");
const { PrismaBetterSqlite3 } = require("@prisma/adapter-better-sqlite3");

// better-sqlite3 gives Prisma one connection, so a statement issued while an interactive
// transaction is open would run inside it and be rolled back with it. Queue every statement
// behind open transactions, as the separate connections of Prisma 5 effectively did.
function serializedAdapter(factory) {
  return {
    provider: factory.provider,
    adapterName: factory.adapterName,
    connectToShadowDb: () => factory.connectToShadowDb(),
    async connect() {
      const adapter = await factory.connect();
      let tail = Promise.resolve();
      const lock = () => {
        let release;
        const held = new Promise((resolve) => (release = resolve));
        const acquired = tail.then(() => release);
        tail = tail.then(() => held);
        return acquired;
      };
      const exclusive = async (run) => {
        const release = await lock();
        try {
          return await run();
        } finally {
          release();
        }
      };
      const startTransaction = async (isolationLevel) => {
        const release = await lock();
        try {
          const transaction = await adapter.startTransaction(isolationLevel);
          const finish = (method) => async () => {
            try {
              return await transaction[method]();
            } finally {
              release();
            }
          };
          return new Proxy(transaction, {
            get: (target, key) =>
              key === "commit" || key === "rollback"
                ? finish(key)
                : Reflect.get(target, key, target),
          });
        } catch (error) {
          release();
          throw error;
        }
      };
      return new Proxy(adapter, {
        get(target, key) {
          if (key === "queryRaw" || key === "executeRaw" || key === "executeScript")
            return (input) => exclusive(() => target[key](input));
          if (key === "startTransaction") return startTransaction;
          const value = Reflect.get(target, key, target);
          return typeof value === "function" ? value.bind(target) : value;
        },
      });
    },
  };
}

// Existing databases store DateTime values as epoch milliseconds (the Prisma 5 engine format);
// the adapter's ISO-string default would mix formats and break ordering and raw comparisons.
function createPrismaClient(url, options = {}) {
  const factory = new PrismaBetterSqlite3({ url }, { timestampFormat: "unixepoch-ms" });
  return new PrismaClient({ ...options, adapter: serializedAdapter(factory) });
}

module.exports = { createPrismaClient, serializedAdapter };
