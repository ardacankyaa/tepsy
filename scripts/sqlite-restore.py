"""Restore a verified backup into a new SQLite file; never overwrite live data."""

import argparse
from contextlib import closing
import pathlib
import sqlite3


def restore(backup: pathlib.Path, target: pathlib.Path) -> None:
    if not backup.is_file():
        raise FileNotFoundError(backup)
    if target.exists():
        raise FileExistsError(f"Target already exists: {target}")
    target.parent.mkdir(parents=True, exist_ok=True)
    with closing(sqlite3.connect(backup.resolve().as_uri() + "?mode=ro", uri=True)) as source:
        if source.execute("PRAGMA integrity_check").fetchone()[0] != "ok":
            raise RuntimeError("Backup failed integrity_check")
        if source.execute("PRAGMA foreign_key_check").fetchall():
            raise RuntimeError("Backup failed foreign_key_check")
        with closing(sqlite3.connect(target)) as destination:
            source.backup(destination)
            if destination.execute("PRAGMA integrity_check").fetchone()[0] != "ok":
                raise RuntimeError("Restored database failed integrity_check")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--backup", required=True, type=pathlib.Path)
    parser.add_argument("--target", required=True, type=pathlib.Path)
    args = parser.parse_args()
    restore(args.backup, args.target)
    print(args.target.resolve())


if __name__ == "__main__":
    main()
