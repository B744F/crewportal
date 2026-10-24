#!/usr/bin/env python3
"""Create private D1 import chunks from FlightManualAssistant's validated SQLite DB.

The generated SQL contains controlled manual text and must only be written to a
temporary directory outside the repository. It is never a GitHub Pages asset.
"""

from __future__ import annotations

import argparse
import sqlite3
from pathlib import Path


SHORT_TITLES = {
    "b744_fcom_r82": "FCOM",
    "b744_qrh_r82": "QRH",
    "b744_mel_r51": "MEL/CDL",
    "b744_fctm_r16": "FCTM",
    "fom_r52": "FOM",
}


def sql_text(value: object) -> str:
    if value is None:
        return "NULL"
    return "'" + str(value).replace("'", "''") + "'"


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("database", type=Path)
    parser.add_argument("output_dir", type=Path)
    parser.add_argument("--rows-per-file", type=int, default=180)
    args = parser.parse_args()

    if args.output_dir.resolve().is_relative_to(Path.cwd().resolve()):
        raise SystemExit("Refusing to write controlled manual text inside the repository")
    args.output_dir.mkdir(parents=True, exist_ok=True)

    connection = sqlite3.connect(args.database)
    connection.row_factory = sqlite3.Row
    try:
        quick_check = connection.execute("PRAGMA quick_check").fetchone()[0]
        if quick_check != "ok":
            raise SystemExit(f"Database quick_check failed: {quick_check}")

        manuals = list(
            connection.execute(
                """
                SELECT id, title, revision, effective_date, pdf_pages, sha256, imported_at
                FROM manuals ORDER BY id
                """
            )
        )
        ids = {row["id"] for row in manuals}
        if ids != set(SHORT_TITLES):
            raise SystemExit(f"Unexpected manual set: {sorted(ids)}")

        pages = list(
            connection.execute(
                """
                SELECT manual_id, pdf_page, printed_label, chapter,
                       source_text, normalized_text
                FROM pages ORDER BY manual_id, pdf_page
                """
            )
        )
    finally:
        connection.close()

    header = [
        "DELETE FROM b744ai_pages_fts;",
        "DELETE FROM b744ai_manuals;",
    ]
    for row in manuals:
        values = [
            row["id"], SHORT_TITLES[row["id"]], row["title"], row["revision"],
            row["effective_date"], row["pdf_pages"], row["sha256"], 1,
            row["imported_at"],
        ]
        header.append(
            "INSERT INTO b744ai_manuals "
            "(id, short_title, title, revision, effective_date, pdf_pages, sha256, active, imported_at) "
            f"VALUES ({','.join(sql_text(value) for value in values)});"
        )
    (args.output_dir / "000-manuals.sql").write_text("\n".join(header) + "\n", encoding="utf-8")

    for start in range(0, len(pages), args.rows_per_file):
        batch = pages[start : start + args.rows_per_file]
        statements = []
        for row in batch:
            values = [
                row["manual_id"], row["pdf_page"], row["printed_label"],
                row["chapter"], row["source_text"], row["normalized_text"],
            ]
            statements.append(
                "INSERT INTO b744ai_pages_fts "
                "(manual_id, pdf_page, printed_label, chapter, source_text, normalized_text) "
                f"VALUES ({','.join(sql_text(value) for value in values)});"
            )
        chunk = args.output_dir / f"{start // args.rows_per_file + 1:03d}-pages.sql"
        chunk.write_text("\n".join(statements) + "\n", encoding="utf-8")

    print(f"Prepared {len(manuals)} manuals and {len(pages)} pages in {args.output_dir}")


if __name__ == "__main__":
    main()
