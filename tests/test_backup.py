"""Backup regression tests use temporary databases, never restaurant data."""
import importlib.util
from contextlib import closing
from pathlib import Path
import sqlite3
import tempfile
import unittest


def load_script(name):
    spec = importlib.util.spec_from_file_location(name, Path(__file__).resolve().parents[1] / 'scripts' / f'{name}.py')
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class BackupTests(unittest.TestCase):
    def test_special_characters_round_trip(self):
        with tempfile.TemporaryDirectory(prefix="tepsy-backup-test-") as directory:
            source = Path(directory) / 'restoran #1.db'
            backup = Path(directory) / 'yedek #1.db'
            target = Path(directory) / 'geri yükleme.db'
            with closing(sqlite3.connect(source)) as connection:
                connection.execute('CREATE TABLE example (value TEXT)')
                connection.execute('INSERT INTO example VALUES (?)', ('işletme',))
                connection.commit()
            load_script('sqlite-backup').verified_backup(source, backup)
            load_script('sqlite-restore').restore(backup, target)
            with closing(sqlite3.connect(target)) as connection:
                self.assertEqual(connection.execute('SELECT value FROM example').fetchone()[0], 'işletme')
            with self.assertRaises(FileExistsError):
                load_script('sqlite-restore').restore(backup, target)


if __name__ == '__main__':
    unittest.main()
