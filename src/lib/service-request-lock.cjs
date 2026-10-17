const pending = new Map();

async function withServiceRequestLock(tableId, type, operation) {
  const key = `${tableId}:${type}`;
  const preceding = pending.get(key) || Promise.resolve();
  let release;
  const current = new Promise((resolve) => {
    release = resolve;
  });
  pending.set(key, current);
  await preceding;
  try {
    return await operation();
  } finally {
    release();
    if (pending.get(key) === current) pending.delete(key);
  }
}

module.exports = { withServiceRequestLock };
