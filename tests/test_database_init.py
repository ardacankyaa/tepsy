from contextlib import closing
import importlib.util
import sqlite3
import tempfile
import unittest
from pathlib import Path

spec = importlib.util.spec_from_file_location("initialize_sqlite", Path(__file__).resolve().parents[1] / "scripts" / "initialize-sqlite.py")
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

class DatabaseInitializationTest(unittest.TestCase):
    def test_creates_valid_empty_database(self):
        with tempfile.TemporaryDirectory() as directory:
            target = Path(directory) / "new" / "test.db"
            self.assertEqual(module.create_database(target), target.resolve())
            with closing(sqlite3.connect(target)) as connection:
                self.assertEqual(connection.execute("PRAGMA integrity_check").fetchone()[0], "ok")
                self.assertEqual(connection.execute("SELECT COUNT(*) FROM sqlite_master WHERE type='table'").fetchone()[0], 0)

    def test_existing_restaurant_database_is_never_modified(self):
        with tempfile.TemporaryDirectory() as directory:
            target = Path(directory) / "restaurant.db"
            with closing(sqlite3.connect(target)) as connection:
                connection.execute("CREATE TABLE orders (id INTEGER PRIMARY KEY)")
                connection.execute("INSERT INTO orders VALUES (1)")
                connection.commit()
            before = target.read_bytes()
            with self.assertRaises(FileExistsError):
                module.create_database(target)
            self.assertEqual(target.read_bytes(), before)
