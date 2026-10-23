"""Exercise the additive TEPSY upgrade on disposable legacy databases."""
from contextlib import closing
from pathlib import Path
import json
import shutil
import sqlite3
import subprocess
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

    def test_database_without_floor_plan_sections_gains_the_table_the_app_queries(self):
        root_directory = Path(__file__).resolve().parents[1]
        fixture = root_directory / "tests" / "fixtures" / "tepsy-1.0.0-schema.sql"
        with tempfile.TemporaryDirectory(prefix="tepsy-floor-plan-migration-") as directory:
            root = Path(directory)
            database = root / "before-floor-plan-sections.db"
            with closing(sqlite3.connect(database)) as connection:
                # The 1.0.0 schema without the later per-section canvas table.
                connection.executescript(fixture.read_text(encoding="utf-8"))
                connection.executescript('''
                    DROP TABLE "FloorPlanSection";
                    INSERT INTO RestaurantConfig (id, restaurantName, updatedAt)
                    VALUES ('config', 'Legacy Cafe', 0);
                    INSERT INTO "Table" (id, tableNumber, section, qrToken, updatedAt)
                    VALUES ('t1', 'B1', 'Bahçe', 'token-1', 0);
                ''')
                connection.commit()
            migration = load_script('migrate-tepsy')
            self.assertTrue(migration.needs_upgrade(database))
            backup = migration.upgrade(database, root / "backups")
            self.assertTrue(backup.is_file())
            self.assertFalse(migration.needs_upgrade(database))
            self.assertIsNone(migration.upgrade(database, root / "backups"))
            with closing(sqlite3.connect(database)) as connection:
                section_columns = {
                    row[1]: (row[2], row[3], row[4], row[5])
                    for row in connection.execute('PRAGMA table_info("FloorPlanSection")')
                }
                self.assertEqual(section_columns, {
                    "section": ("TEXT", 1, None, 1),
                    "width": ("INTEGER", 1, "720", 0),
                    "height": ("INTEGER", 1, "450", 0),
                    "createdAt": ("DATETIME", 1, "CURRENT_TIMESTAMP", 0),
                    "updatedAt": ("DATETIME", 1, None, 0),
                })
                self.assertEqual(
                    connection.execute('SELECT tableNumber, section FROM "Table"').fetchone(),
                    ('B1', 'Bahçe'),
                )
            with closing(sqlite3.connect(backup)) as connection:
                self.assertIsNone(connection.execute(
                    "SELECT name FROM sqlite_master WHERE name = 'FloorPlanSection'"
                ).fetchone())

            node = shutil.which("node")
            if not node:
                self.skipTest("Node.js is required to run the application's Prisma queries")
            # The same Prisma calls the floor plan canvas API makes.
            script = '''
                const { createPrismaClient } = require(process.argv[1]);
                (async () => {
                  const db = createPrismaClient(process.argv[2]);
                  try {
                    const value = { section: "Bahçe", width: 960, height: 540 };
                    await db.floorPlanSection.upsert({
                      where: { section: value.section }, create: value,
                      update: { width: value.width, height: value.height },
                    });
                    await db.floorPlanSection.upsert({
                      where: { section: value.section }, create: value,
                      update: { width: 1000, height: 600 },
                    });
                    const rows = await db.floorPlanSection.findMany({ orderBy: { section: "asc" } });
                    const config = await db.restaurantConfig.findFirst();
                    console.log(JSON.stringify({
                      rows: rows.map((row) => [row.section, row.width, row.height]),
                      restaurantName: config.restaurantName,
                    }));
                  } finally {
                    await db.$disconnect();
                  }
                })().catch((error) => { console.error(error); process.exit(1); });
            '''
            result = subprocess.run(
                [node, "-e", script, str(root_directory / "src" / "lib" / "prisma-client.cjs"),
                 "file:" + str(database).replace("\\", "/")],
                cwd=root_directory, capture_output=True, text=True, encoding="utf-8", timeout=120,
            )
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual(json.loads(result.stdout.strip().splitlines()[-1]), {
                "rows": [["Bahçe", 1000, 600]],
                "restaurantName": "Legacy Cafe",
            })


if __name__ == '__main__':
    unittest.main()
