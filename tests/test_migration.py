"""Exercise the additive TEPSY upgrade on disposable legacy databases."""
from contextlib import closing
from pathlib import Path
import sqlite3
import tempfile
import unittest
from test_backup import load_script


class MigrationTests(unittest.TestCase):
    def test_upgrade_preserves_history_and_is_repeatable(self):
        with tempfile.TemporaryDirectory(prefix="tepsy-migration-test-") as directory:
            root = Path(directory)
            database = root / "legacy #1.db"
            with closing(sqlite3.connect(database)) as connection:
                connection.executescript('''
                    CREATE TABLE "Order" (id TEXT PRIMARY KEY, status TEXT, totalPrice DECIMAL);
                    CREATE TABLE RestaurantConfig (id TEXT PRIMARY KEY, restaurantName TEXT);
                    CREATE TABLE CashShift (id TEXT PRIMARY KEY, openingCash DECIMAL);
                    INSERT INTO CashShift VALUES ('shift',100);
                    INSERT INTO RestaurantConfig VALUES ('config', 'Legacy Cafe');
                    CREATE TABLE Category (id TEXT PRIMARY KEY, name TEXT);
                    CREATE TABLE MenuItem (id TEXT PRIMARY KEY, name TEXT, categoryId TEXT);
                    CREATE TABLE OrderItem (id TEXT PRIMARY KEY, orderId TEXT, menuItemId TEXT, unitPrice DECIMAL);
                    INSERT INTO "Order" VALUES ('o1', 'PAID', 45.50);
                    INSERT INTO Category VALUES ('c1', 'İçecekler');
                    INSERT INTO MenuItem VALUES ('m1', 'Çay', 'c1');
                    INSERT INTO OrderItem VALUES ('i1', 'o1', 'm1', 45.50);
                ''')
            migration = load_script('migrate-tepsy')
            self.assertTrue(migration.needs_upgrade(database))
            backup = migration.upgrade(database, root / "backups")
            self.assertTrue(backup.is_file())
            self.assertFalse(migration.needs_upgrade(database))
            self.assertIsNone(migration.upgrade(database, root / "backups"))
            with closing(sqlite3.connect(database)) as connection:
                self.assertEqual(connection.execute('SELECT restaurantName, restaurantLogoUrl FROM RestaurantConfig').fetchone(), ('Legacy Cafe', None))
                self.assertEqual(connection.execute('SELECT openingCash,cashRefunds,cardRefunds,otherRefunds,refundsSnapshot FROM CashShift').fetchone(),(100,0,0,0,'[]'))
                self.assertEqual(connection.execute('SELECT COUNT(*) FROM Refund').fetchone()[0],0)
                self.assertEqual(connection.execute('SELECT COUNT(*) FROM AuditEvent').fetchone()[0],0)
                self.assertEqual(connection.execute('SELECT status, totalPrice FROM "Order"').fetchone(), ('PAID', 45.5))
                self.assertEqual(connection.execute('SELECT menuItemName, menuItemCategoryName, unitPrice FROM OrderItem').fetchone(), ('Çay', 'İçecekler', 45.5))
                connection.execute('UPDATE "Order" SET idempotencyKey = ?', ('request-1',))
                with self.assertRaises(sqlite3.IntegrityError):
                    connection.execute('INSERT INTO "Order" (id, idempotencyKey) VALUES (?, ?)', ('o2', 'request-1'))
            with closing(sqlite3.connect(backup)) as connection:
                self.assertNotIn('menuItemName', {row[1] for row in connection.execute('PRAGMA table_info(OrderItem)')})

    def test_existing_refund_rows_gain_zero_tip_portion_additively(self):
        with tempfile.TemporaryDirectory(prefix="tepsy-refund-tip-migration-") as directory:
            root = Path(directory)
            database = root / "legacy-refund.db"
            with closing(sqlite3.connect(database)) as connection:
                connection.executescript('''
                    CREATE TABLE "Order" (id TEXT PRIMARY KEY, status TEXT, totalPrice DECIMAL);
                    CREATE TABLE RestaurantConfig (id TEXT PRIMARY KEY, restaurantName TEXT);
                    CREATE TABLE Category (id TEXT PRIMARY KEY, name TEXT);
                    CREATE TABLE MenuItem (id TEXT PRIMARY KEY, name TEXT, categoryId TEXT);
                    CREATE TABLE OrderItem (id TEXT PRIMARY KEY, orderId TEXT, menuItemId TEXT,
                        unitPrice DECIMAL, menuItemName TEXT, menuItemCategoryName TEXT);
                    CREATE TABLE Refund (
                        id TEXT PRIMARY KEY, paymentId TEXT NOT NULL, cashShiftId TEXT NOT NULL,
                        amount DECIMAL NOT NULL, paymentMethod TEXT NOT NULL, currency TEXT NOT NULL,
                        reason TEXT NOT NULL, actorId TEXT NOT NULL, actorName TEXT NOT NULL,
                        idempotencyKey TEXT NOT NULL, requestFingerprint TEXT NOT NULL,
                        responseJson TEXT NOT NULL, createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
                    );
                    INSERT INTO "Order" VALUES ('o1', 'PAID', 45.50);
                    INSERT INTO RestaurantConfig VALUES ('config', 'Legacy Cafe');
                    INSERT INTO Refund (id,paymentId,cashShiftId,amount,paymentMethod,currency,reason,
                        actorId,actorName,idempotencyKey,requestFingerprint,responseJson)
                    VALUES ('r1','p1','s1',10,'CASH','₺','Correction','owner','Owner',
                        'refund-old-123','fingerprint','{}');
                ''')
            migration = load_script('migrate-tepsy')
            self.assertTrue(migration.needs_upgrade(database))
            migration.upgrade(database, root / "backups")
            self.assertFalse(migration.needs_upgrade(database))
            with closing(sqlite3.connect(database)) as connection:
                self.assertEqual(
                    connection.execute('SELECT id,amount,tipAmount FROM Refund').fetchone(),
                    ('r1', 10, 0),
                )
                self.assertIn(
                    'tipAmount',
                    {row[1] for row in connection.execute('PRAGMA table_info("Refund")')},
                )

    def test_new_refund_table_includes_tip_portion(self):
        with tempfile.TemporaryDirectory(prefix="tepsy-refund-table-migration-") as directory:
            root = Path(directory)
            database = root / "legacy-without-refunds.db"
            with closing(sqlite3.connect(database)) as connection:
                connection.executescript('''
                    CREATE TABLE "Order" (id TEXT PRIMARY KEY, status TEXT, totalPrice DECIMAL);
                    CREATE TABLE RestaurantConfig (id TEXT PRIMARY KEY, restaurantName TEXT);
                    CREATE TABLE Category (id TEXT PRIMARY KEY, name TEXT);
                    CREATE TABLE MenuItem (id TEXT PRIMARY KEY, name TEXT, categoryId TEXT);
                    CREATE TABLE OrderItem (id TEXT PRIMARY KEY, orderId TEXT, menuItemId TEXT,
                        unitPrice DECIMAL, menuItemName TEXT, menuItemCategoryName TEXT);
                    INSERT INTO "Order" VALUES ('o1', 'PAID', 45.50);
                    INSERT INTO RestaurantConfig VALUES ('config', 'Legacy Cafe');
                ''')
            migration = load_script('migrate-tepsy')
            self.assertTrue(migration.needs_upgrade(database))
            migration.upgrade(database, root / "backups")
            with closing(sqlite3.connect(database)) as connection:
                refund_columns = {
                    row[1]: row for row in connection.execute('PRAGMA table_info("Refund")')
                }
                self.assertIn("tipAmount", refund_columns)
                self.assertEqual(refund_columns["tipAmount"][4], "0")


if __name__ == '__main__':
    unittest.main()
