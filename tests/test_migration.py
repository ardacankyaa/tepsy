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


if __name__ == '__main__':
    unittest.main()
