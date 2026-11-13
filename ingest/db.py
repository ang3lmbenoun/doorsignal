"""Database config helpers. Reads DATABASE_URL from the environment or a gitignored .env file."""
import os
from pathlib import Path
from urllib.parse import parse_qs, unquote, urlparse

from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parent.parent


class ConfigError(RuntimeError):
    pass


def get_database_url() -> str:
    load_dotenv(ROOT / ".env")
    url = os.environ.get("DATABASE_URL", "").strip()
    if not url:
        raise ConfigError("DATABASE_URL is not set. Copy .env.example to .env and fill it in.")
    return url


def pg_env_from_url(url: str) -> dict[str, str]:
    """Split a Postgres URL into PG* variables (used by dbt's profiles.yml)."""
    parsed = urlparse(url)
    if parsed.scheme not in ("postgres", "postgresql") or not parsed.hostname:
        raise ConfigError("DATABASE_URL must look like postgresql://user:pass@host/dbname")
    query = parse_qs(parsed.query)
    return {
        "PGHOST": parsed.hostname,
        "PGPORT": str(parsed.port or 5432),
        "PGUSER": unquote(parsed.username or ""),
        "PGPASSWORD": unquote(parsed.password or ""),
        "PGDATABASE": parsed.path.lstrip("/"),
        "PGSSLMODE": query.get("sslmode", ["require"])[0],
    }


def connect():
    import psycopg

    return psycopg.connect(get_database_url(), connect_timeout=15)
