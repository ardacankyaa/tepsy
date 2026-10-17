"""Create and verify a consistent SQLite backup, including databases in WAL mode."""

import argparse
from contextlib import closing
import datetime as dt
import pathlib
import sqlite3


def verified_backup(source: pathlib.Path, destination: pathlib.Path) -> pathlib.Path:
    if not source.is_file():
        raise FileNotFoundError(source)
    destination.parent.mkdir(parents=True, exist_ok=True)
    if destination.exists():
        raise FileExistsError(destination)
    with closing(sqlite3.connect(source.resolve().as_uri() + "?mode=ro", uri=True)) as original:
        with closing(sqlite3.connect(destination)) as backup:
            original.backup(backup)
            integrity = backup.execute("PRAGMA integrity_check").fetchone()[0]
            foreign_keys = backup.execute("PRAGMA foreign_key_check").fetchall()
            if integrity != "ok" or foreign_keys:
                raise RuntimeError(f"Backup verification failed: integrity={integrity}, foreign_keys={foreign_keys[:3]}")
    return destination


def default_dest_dir() -> pathlib.Path:
    return pathlib.Path(".tepsy/backups")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", type=pathlib.Path, default=pathlib.Path("prisma/dev.db"))
    parser.add_argument("--dest-dir", type=pathlib.Path, default=default_dest_dir())
    parser.add_argument("--keep", type=int, default=30)
    parser.add_argument("--prefix", choices=("tepsy", "tepsy-reset"), default="tepsy")
    args = parser.parse_args()
    if args.keep < 1:
        parser.error("--keep must be positive")
    destination = args.dest_dir / f"{args.prefix}-{dt.datetime.now().strftime('%Y%m%d-%H%M%S-%f')}.db"
    verified_backup(args.source, destination)
    if args.prefix == "tepsy":
        snapshots = sorted([*args.dest_dir.glob("restopos-*.db"), *[p for p in args.dest_dir.glob("tepsy-*.db") if not p.name.startswith(("tepsy-upgrade-", "tepsy-reset-"))]], key=lambda path: path.stat().st_mtime, reverse=True)
        for old in snapshots[args.keep:]:
            old.unlink()
    print(destination.resolve())


if __name__ == "__main__":
    main()
