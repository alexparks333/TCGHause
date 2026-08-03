"""DB migration runner — applies apps/cardvision/migrations/*.up.sql in
order, tracked in schema_migrations so re-running is a no-op. Mirrors
apps/api/cmd/migrate's own golang-migrate-style naming convention
(NNNN_name.up.sql), same shape in Python.
"""

import asyncio
import re
import sys
from pathlib import Path

import asyncpg
from dotenv import load_dotenv

load_dotenv()

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from cardvision.config import settings  # noqa: E402

MIGRATIONS_DIR = Path(__file__).resolve().parent.parent / "migrations"


async def main() -> None:
    conn = await asyncpg.connect(settings.database_url)
    try:
        await conn.execute(
            """
            create table if not exists schema_migrations (
                version text primary key,
                applied_at timestamptz not null default now()
            )
            """
        )

        applied = {r["version"] for r in await conn.fetch("select version from schema_migrations")}

        up_files = sorted(MIGRATIONS_DIR.glob("*.up.sql"))
        applied_count = 0
        for path in up_files:
            match = re.match(r"^(\d+)_", path.name)
            if not match:
                continue
            version = match.group(1)
            if version in applied:
                print(f"skip {path.stem} (already applied)")
                continue

            sql = path.read_text()
            async with conn.transaction():
                await conn.execute(sql)
                await conn.execute(
                    "insert into schema_migrations (version) values ($1)", version
                )
            print(f"applied {path.stem}")
            applied_count += 1

        print(f"done — {applied_count} migration(s) applied, {len(up_files) - applied_count} already up to date")
    finally:
        await conn.close()


if __name__ == "__main__":
    asyncio.run(main())
