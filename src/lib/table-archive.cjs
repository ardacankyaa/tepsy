function canArchiveTable(orders) {
  return orders.every((order) => ["PAID", "CANCELLED"].includes(order.status));
}

function canSetTableAvailable(orders) {
  return canArchiveTable(orders);
}

function canUpdateTableFields(role, body) {
  if (role === "ADMIN") return true;
  if (!["WAITER", "CASHIER"].includes(role)) return false;
  return Object.keys(body).every((key) => ["id", "status"].includes(key));
}

module.exports = { canArchiveTable, canSetTableAvailable, canUpdateTableFields };
