import logging
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase

from app.config import settings

logger = logging.getLogger(__name__)

engine = create_async_engine(settings.database_url, echo=settings.debug)
async_session = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)


class Base(DeclarativeBase):
    pass


async def get_db():
    async with async_session() as session:
        try:
            yield session
        finally:
            await session.close()


async def migrate_schema():
    """Add missing columns to existing tables (lightweight migration for SQLite).

    SQLAlchemy's create_all only creates new tables — it won't add columns
    to tables that already exist. This function inspects each table and
    adds any columns that the models define but the database lacks.
    """
    async with engine.begin() as conn:
        # First, create any brand-new tables
        await conn.run_sync(Base.metadata.create_all)

        # Then add missing columns to existing tables
        for table in Base.metadata.sorted_tables:
            existing_cols = set()
            rows = await conn.execute(text(f"PRAGMA table_info('{table.name}')"))
            for row in rows:
                existing_cols.add(row[1])  # column name is at index 1

            for col in table.columns:
                if col.name not in existing_cols:
                    col_type = col.type.compile(dialect=engine.dialect)
                    # Determine default value for the ALTER TABLE statement
                    default_sql = ""
                    if col.default is not None and not callable(col.default.arg):
                        val = col.default.arg
                        if isinstance(val, bool):
                            default_sql = f" DEFAULT {1 if val else 0}"
                        elif isinstance(val, (int, float)):
                            default_sql = f" DEFAULT {val}"
                        elif isinstance(val, str):
                            default_sql = f" DEFAULT '{val}'"
                    # SQLite ALTER TABLE ADD COLUMN with NOT NULL requires a default.
                    # If the column isn't nullable and has no default, make it nullable
                    # to avoid failing on existing rows.
                    if col.nullable or default_sql:
                        nullable = "" if col.nullable else " NOT NULL"
                    else:
                        nullable = ""  # skip NOT NULL if no default available
                    stmt = f"ALTER TABLE {table.name} ADD COLUMN {col.name} {col_type}{nullable}{default_sql}"
                    logger.info("Adding missing column: %s.%s", table.name, col.name)
                    await conn.execute(text(stmt))
