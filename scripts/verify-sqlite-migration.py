"""Compare existing money rows with a schema-migrated SQLite copy."""

import argparse
from contextlib import closing
import sqlite3
from decimal import Decimal
from pathlib import Path


MONEY_COLUMNS = (
    ("MenuItem", "price"),
    ("Order", "totalPrice"),
    ("OrderItem", "unitPrice"),
    ("Payment", "amountPaid"),
)


def money_rows(connection, table, column):
    rows = connection.execute(f'SELECT id, "{column}" FROM "{table}"').fetchall()
    return {row_id: Decimal(str(amount)).quantize(Decimal("0.01")) for row_id, amount in rows}


def verify(source_path: Path, target_path: Path):
    with closing(sqlite3.connect(source_path.resolve().as_uri() + "?mode=ro", uri=True)) as source, closing(sqlite3.connect(target_path.resolve().as_uri() + "?mode=ro", uri=True)) as target:
        for table, column in MONEY_COLUMNS:
            before = money_rows(source, table, column)
            after = money_rows(target, table, column)
            if before != after:
                raise ValueError(f"{table}.{column} rows differ after migration")
            print(f"{table}.{column}: {len(after)} matching rows")
        if target.execute("PRAGMA integrity_check").fetchone()[0] != "ok":
            raise ValueError("Target failed integrity_check")
        if target.execute("PRAGMA foreign_key_check").fetchall():
            raise ValueError("Target failed foreign_key_check")
        print("integrity_check: ok; foreign_key_check: ok")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("source", type=Path)
    parser.add_argument("target", type=Path)
    args = parser.parse_args()
    verify(args.source, args.target)
