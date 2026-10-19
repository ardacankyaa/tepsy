from contextlib import closing
from pathlib import Path
import json
import sqlite3
import tempfile
import unittest
import zipfile
from test_backup import load_script


class RecoveryTests(unittest.TestCase):
    def test_full_archive_restores_ledger_images_devices_and_preserves_existing_installations(self):
        tool = load_script('recovery-bundle')
        with tempfile.TemporaryDirectory(prefix='tepsy-recovery-test-') as temporary:
            root = Path(temporary)
            database = root / 'restaurant.db'
            with closing(sqlite3.connect(database)) as db:
                db.executescript('CREATE TABLE Ledger (id TEXT PRIMARY KEY, amount DECIMAL); INSERT INTO Ledger VALUES ("receipt", 125.50);')
            images = root / 'images'
            images.mkdir()
            image = 'a' * 64 + '.webp'
            (images / image).write_bytes(b'restaurant-photo')
            devices = root / 'devices.json'
            devices.write_text('{"version":1}', encoding='utf-8')
            archive = root / 'backup.zip'
            tool.create(database, archive, images=images, devices=devices)
            self.assertTrue(tool.verify(archive)['newSessionRequired'])
            target = root / 'new-installation'
            tool.restore(archive, target)
            with closing(sqlite3.connect(target / 'prisma/dev.db')) as db:
                self.assertEqual(db.execute('SELECT amount FROM Ledger WHERE id="receipt"').fetchone()[0], 125.5)
            self.assertEqual((target / '.tepsy/menu-images' / image).read_bytes(), b'restaurant-photo')
            self.assertEqual((target / '.tepsy/devices.json').read_text(), '{"version":1}')
            self.assertFalse((target / '.tepsy/session-secret').exists())
            with self.assertRaises(FileExistsError):
                tool.restore(archive, target)
            with self.assertRaises(FileExistsError):
                tool.create(database, archive)

    def test_corrupt_or_traversing_archive_is_rejected_before_publishing_restore(self):
        tool = load_script('recovery-bundle')
        with tempfile.TemporaryDirectory(prefix='tepsy-unsafe-recovery-') as temporary:
            root = Path(temporary)
            for name, files, payload in [
                ('tampered.zip', {'prisma/dev.db': '0'*64}, {'prisma/dev.db': b'not-a-database'}),
                ('escape.zip', {'prisma/dev.db': '0'*64, '../outside': '0'*64}, {'prisma/dev.db': b'', '../outside': b'bad'}),
            ]:
                archive = root / name
                with zipfile.ZipFile(archive, 'w') as z:
                    z.writestr('manifest.json', json.dumps({'format':'tepsy-recovery','version':1,'files':files}))
                    for entry, content in payload.items():
                        z.writestr(entry, content)
                target = root / (name + '-restore')
                with self.assertRaises(ValueError):
                    tool.restore(archive, target)
                self.assertFalse(target.exists())
                self.assertFalse((root / 'outside').exists())
