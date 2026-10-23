"""Add order replay keys, historical item snapshots and missing tables without rebuilding business tables.

Stop the application before upgrading. A verified pre-upgrade SQLite backup is
mandatory and created automatically. Existing IDs, totals and relations stay intact.
"""
import argparse
from contextlib import closing
import datetime as dt
import importlib.util
from pathlib import Path
import sqlite3


ADDITIONS = {"Order": ("idempotencyKey", "requestFingerprint"), "OrderItem": ("menuItemName", "menuItemCategoryName"), "RestaurantConfig": ("restaurantLogoUrl",)}
SHIFT_ADDITIONS = {"cashRefunds": "DECIMAL NOT NULL DEFAULT 0", "cardRefunds": "DECIMAL NOT NULL DEFAULT 0", "otherRefunds": "DECIMAL NOT NULL DEFAULT 0", "refundsSnapshot": "TEXT NOT NULL DEFAULT '[]'"}
PAYMENT_ADDITIONS = {"Order": {"tipAmount": "DECIMAL NOT NULL DEFAULT 0"}, "OrderItem": {"paidQuantity": "INTEGER NOT NULL DEFAULT 0"}, "Payment": {"tipAmount": "DECIMAL NOT NULL DEFAULT 0", "itemsJson": "TEXT"}, "Refund": {"tipAmount": "DECIMAL NOT NULL DEFAULT 0"}}
NEW_TABLES = '''
CREATE TABLE IF NOT EXISTS "Refund" (
  "id" TEXT NOT NULL PRIMARY KEY, "paymentId" TEXT NOT NULL,
  "cashShiftId" TEXT NOT NULL, "amount" DECIMAL NOT NULL, "tipAmount" DECIMAL NOT NULL DEFAULT 0,
  "paymentMethod" TEXT NOT NULL, "currency" TEXT NOT NULL,
  "reason" TEXT NOT NULL, "actorId" TEXT NOT NULL, "actorName" TEXT NOT NULL,
  "idempotencyKey" TEXT NOT NULL, "requestFingerprint" TEXT NOT NULL,
  "responseJson" TEXT NOT NULL, "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS "Refund_idempotencyKey_key" ON "Refund"("idempotencyKey");
CREATE INDEX IF NOT EXISTS "Refund_paymentId_createdAt_idx" ON "Refund"("paymentId", "createdAt");
CREATE INDEX IF NOT EXISTS "Refund_cashShiftId_idx" ON "Refund"("cashShiftId");
CREATE INDEX IF NOT EXISTS "Refund_createdAt_idx" ON "Refund"("createdAt");
CREATE TABLE IF NOT EXISTS "AuditEvent" (
  "id" TEXT NOT NULL PRIMARY KEY, "actorId" TEXT NOT NULL, "actorName" TEXT NOT NULL,
  "action" TEXT NOT NULL, "entityId" TEXT NOT NULL, "detailsJson" TEXT NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "AuditEvent_createdAt_id_idx" ON "AuditEvent"("createdAt", "id");
CREATE INDEX IF NOT EXISTS "AuditEvent_entityId_idx" ON "AuditEvent"("entityId");
CREATE TABLE IF NOT EXISTS "FloorPlanSection" (
  "section" TEXT NOT NULL PRIMARY KEY,
  "width" INTEGER NOT NULL DEFAULT 720,
  "height" INTEGER NOT NULL DEFAULT 450,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL
);
'''


def columns(connection, table):
    return {row[1] for row in connection.execute(f'PRAGMA table_info("{table}")')}


def needs_upgrade(database):
    if not database.is_file():
        raise FileNotFoundError(f"Database missing: {database}. Run SETUP.bat first.")
    with closing(sqlite3.connect(database.resolve().as_uri() + "?mode=ro", uri=True)) as connection:
        if not columns(connection, "Refund") or not columns(connection, "AuditEvent"):
            return True
        # Databases from before per-section floor plan dimensions lack this table.
        if not columns(connection, "FloorPlanSection"):
            return True
        shift_columns = columns(connection, "CashShift")
        for table, fields in PAYMENT_ADDITIONS.items():
            existing = columns(connection, table)
            if existing and not set(fields).issubset(existing):
                return True
        if shift_columns and not set(SHIFT_ADDITIONS).issubset(shift_columns):
            return True
        for table, fields in ADDITIONS.items():
            existing = columns(connection, table)
            if not existing:
                raise RuntimeError(f"Missing {table} table. Run SETUP.bat first.")
            if not set(fields).issubset(existing):
                return True
        if not any(row[1] == "Order_idempotencyKey_key" and row[2] for row in connection.execute('PRAGMA index_list("Order")')):
            return True
        return connection.execute('SELECT 1 FROM OrderItem WHERE menuItemName IS NULL OR menuItemCategoryName IS NULL LIMIT 1').fetchone() is not None


def upgrade(database, backup_directory):
    database = Path(database).resolve()
    if not needs_upgrade(database):
        return None
    spec = importlib.util.spec_from_file_location("sqlite_backup", Path(__file__).with_name("sqlite-backup.py"))
    backup_tool = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(backup_tool)
    backup = Path(backup_directory) / f"tepsy-upgrade-{dt.datetime.now().strftime('%Y%m%d-%H%M%S-%f')}.db"
    backup_tool.verified_backup(database, backup)
    with closing(sqlite3.connect(database, timeout=15)) as connection:
        connection.execute("PRAGMA foreign_keys = ON")
        connection.execute("BEGIN IMMEDIATE")
        try:
            for statement in NEW_TABLES.split(";"):
                if statement.strip():
                    connection.execute(statement)
            shift_columns = columns(connection, "CashShift")
            for table, fields in PAYMENT_ADDITIONS.items():
                existing = columns(connection, table)
                if existing:
                    for field, declaration in fields.items():
                        if field not in existing:
                            connection.execute(f'ALTER TABLE "{table}" ADD COLUMN "{field}" {declaration}')
            if shift_columns:
                for field, declaration in SHIFT_ADDITIONS.items():
                    if field not in shift_columns:
                        connection.execute(f'ALTER TABLE "CashShift" ADD COLUMN "{field}" {declaration}')
            for table, fields in ADDITIONS.items():
                existing = columns(connection, table)
                for field in fields:
                    if field not in existing:
                        connection.execute(f'ALTER TABLE "{table}" ADD COLUMN "{field}" TEXT')
            connection.execute('CREATE UNIQUE INDEX IF NOT EXISTS "Order_idempotencyKey_key" ON "Order"("idempotencyKey")')
            connection.execute('''UPDATE OrderItem SET menuItemName =
                COALESCE((SELECT name FROM MenuItem WHERE MenuItem.id = OrderItem.menuItemId), 'Unknown item')
                WHERE menuItemName IS NULL''')
            connection.execute('''UPDATE OrderItem SET menuItemCategoryName =
                COALESCE((SELECT Category.name FROM MenuItem
                          JOIN Category ON Category.id = MenuItem.categoryId
                          WHERE MenuItem.id = OrderItem.menuItemId), 'Diğer')
                WHERE menuItemCategoryName IS NULL''')
            if connection.execute("PRAGMA integrity_check").fetchone()[0] != "ok" or connection.execute("PRAGMA foreign_key_check").fetchall():
                raise RuntimeError("Upgrade integrity check failed; no changes committed.")
            connection.commit()
        except Exception:
            connection.rollback()
            raise
    return backup


def default_backup_dir() -> Path:
    return Path(".tepsy/backups")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--database", type=Path, default=Path("prisma/dev.db"))
    parser.add_argument("--backup-dir", type=Path, default=default_backup_dir())
    parser.add_argument("--check", action="store_true", help="Read-only check; exit 2 if upgrade is required")
    args = parser.parse_args()
    if args.check:
        required = needs_upgrade(args.database)
        print("UPDATE_REQUIRED" if required else "UP_TO_DATE")
        raise SystemExit(2 if required else 0)
    backup = upgrade(args.database, args.backup_dir)
    print(f"TEPSY database upgraded. Verified backup: {backup.resolve()}" if backup else "TEPSY database is up to date.")


if __name__ == "__main__":
    main()
