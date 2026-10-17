from contextlib import closing
"""Create a new, empty SQLite file before applying the Prisma schema."""
import argparse
import sqlite3
from pathlib import Path

def create_database(database):
    target = Path(database).resolve()
    target.parent.mkdir(parents=True, exist_ok=True)
    # Exclusive creation refuses existing files and symlink targets.
    with target.open("xb"):
        pass
    with closing(sqlite3.connect(str(target))) as connection:
        connection.execute("PRAGMA user_version = 0")
        connection.commit()
        if connection.execute("PRAGMA integrity_check").fetchone()[0] != "ok":
            raise RuntimeError("New SQLite database failed integrity verification.")
    return target

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--database", required=True)
    args = parser.parse_args()
    print(f"CREATED: {create_database(args.database)}")

if __name__ == "__main__":
    main()
