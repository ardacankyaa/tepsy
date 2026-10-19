"""Verified restaurant recovery archives. Restore only into a new installation folder."""
import argparse
from contextlib import closing
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import shutil
import sqlite3
import tempfile
import zipfile


def sqlite_copy(source, destination):
    destination.parent.mkdir(parents=True, exist_ok=True)
    with closing(sqlite3.connect(Path(source).resolve().as_uri() + "?mode=ro", uri=True)) as original:
        with closing(sqlite3.connect(destination)) as target:
            original.backup(target)
            if target.execute("PRAGMA integrity_check").fetchone()[0] != "ok" or target.execute("PRAGMA foreign_key_check").fetchall():
                raise ValueError("Database verification failed")


def create(database, output, images=None, devices=None, revocations=None, transfers=None):
    output = Path(output)
    if output.exists():
        raise FileExistsError(output)
    output.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="tepsy-recovery-") as temporary:
        stage = Path(temporary)
        sqlite_copy(database, stage / "prisma/dev.db")
        for source, relative in [(revocations, ".tepsy/revoked-sessions.db"), (transfers, ".tepsy/terminal-transfers.db")]:
            if source and Path(source).is_file():
                sqlite_copy(source, stage / relative)
        if devices and Path(devices).is_file():
            if Path(devices).is_symlink():
                raise ValueError("Device file must not be a symlink")
            (stage / ".tepsy").mkdir(exist_ok=True)
            shutil.copyfile(devices, stage / ".tepsy/devices.json")
        if images and Path(images).is_dir():
            for image in Path(images).iterdir():
                if image.is_symlink():
                    raise ValueError("Image symlinks are forbidden")
                if image.is_file() and image.suffix == ".webp" and len(image.stem) == 64 and all(c in "0123456789abcdef" for c in image.stem):
                    dest = stage / ".tepsy/menu-images" / image.name
                    dest.parent.mkdir(parents=True, exist_ok=True)
                    shutil.copyfile(image, dest)
        files = {p.relative_to(stage).as_posix(): hashlib.sha256(p.read_bytes()).hexdigest() for p in stage.rglob("*") if p.is_file()}
        manifest = {"format": "tepsy-recovery", "version": 1, "files": files, "newSessionRequired": True}
        tempzip = output.with_name(output.name + ".pending")
        try:
            descriptor = os.open(tempzip, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
            with os.fdopen(descriptor, "wb") as binary:
                with zipfile.ZipFile(binary, "w", compression=zipfile.ZIP_DEFLATED) as archive:
                    archive.writestr("manifest.json", json.dumps(manifest))
                    for name in files:
                        archive.write(stage / name, name)
            verify(tempzip)
            os.rename(tempzip, output)
        finally:
            if tempzip.exists():
                tempzip.unlink()
    return manifest


def allowed_name(name):
    p = PurePosixPath(name)
    return (not p.is_absolute() and ".." not in p.parts and "\\" not in name and
            (name in {"prisma/dev.db", ".tepsy/devices.json", ".tepsy/revoked-sessions.db", ".tepsy/terminal-transfers.db"} or
             name.startswith(".tepsy/menu-images/") and len(p.parts) == 3 and len(p.stem) == 64 and
             all(c in "0123456789abcdef" for c in p.stem) and p.suffix == ".webp"))


def unpack(archive_path, stage):
    with zipfile.ZipFile(archive_path) as archive:
        infos = archive.infolist()
        names = [i.filename for i in infos]
        if len(names) > 20000 or len(set(names)) != len(names) or sum(i.file_size for i in infos) > 2_000_000_000:
            raise ValueError("Archive size, duplicates or entry limit exceeded")
        info = archive.getinfo("manifest.json")
        if info.file_size > 4_000_000:
            raise ValueError("Manifest too large")
        manifest = json.loads(archive.read(info))
        if manifest.get("format") != "tepsy-recovery" or manifest.get("version") != 1 or not isinstance(manifest.get("files"), dict):
            raise ValueError("Unsupported archive")
        files = manifest["files"]
        if "prisma/dev.db" not in files or set(names) != set(files) | {"manifest.json"}:
            raise ValueError("Archive inventory mismatch")
        for name, checksum in files.items():
            if not allowed_name(name):
                raise ValueError("Unsafe archive path")
            destination = stage / name
            destination.parent.mkdir(parents=True, exist_ok=True)
            with archive.open(name) as original, destination.open("xb") as target:
                shutil.copyfileobj(original, target)
            if hashlib.sha256(destination.read_bytes()).hexdigest() != checksum:
                raise ValueError("Archive checksum mismatch")
        for name in files:
            if name.endswith(".db"):
                with closing(sqlite3.connect((stage / name).resolve().as_uri() + "?mode=ro", uri=True)) as db:
                    if db.execute("PRAGMA integrity_check").fetchone()[0] != "ok" or db.execute("PRAGMA foreign_key_check").fetchall():
                        raise ValueError("Archived database failed verification")
        return manifest


def verify(archive):
    with tempfile.TemporaryDirectory(prefix="tepsy-verify-") as temporary:
        return unpack(archive, Path(temporary))


def restore(archive, target):
    target = Path(target).resolve()
    if target.exists():
        raise FileExistsError("Restore requires a NEW folder; existing installations are never overwritten")
    target.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="tepsy-restore-", dir=target.parent) as temporary:
        stage = Path(temporary) / "installation"
        stage.mkdir()
        manifest = unpack(archive, stage)
        # No signing secret is restored: sessions are renewed at the next launch.
        # Reserve the new target atomically; never replace an existing directory.
        target.mkdir(mode=0o700)
        try:
            for item in stage.iterdir():
                shutil.move(str(item), str(target / item.name))
        except Exception:
            # Preserve partially restored files for inspection, never overwrite a live folder.
            raise
        return manifest


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    make = commands.add_parser("create")
    for flag in ["database", "output", "images", "devices", "revocations", "transfers"]:
        make.add_argument("--" + flag, required=flag in {"database", "output"}, type=Path)
    for command in ["verify", "restore"]:
        sub = commands.add_parser(command)
        sub.add_argument("--archive", required=True, type=Path)
        if command == "restore":
            sub.add_argument("--target", required=True, type=Path)
    args = vars(parser.parse_args())
    command = args.pop("command")
    print(json.dumps({"verified": True, "manifest": {"create": create, "verify": verify, "restore": restore}[command](**args)}))


if __name__ == "__main__":
    main()
