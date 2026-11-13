from pathlib import Path

import pytest

from ingest import db

ROOT = Path(__file__).resolve().parent.parent


def test_missing_url_raises(monkeypatch):
    monkeypatch.delenv("DATABASE_URL", raising=False)
    monkeypatch.setattr(db, "load_dotenv", lambda *a, **k: None)
    with pytest.raises(db.ConfigError):
        db.get_database_url()


def test_pg_env_from_url_splits_fields():
    env = db.pg_env_from_url("postgresql://u:p%40ss@host.neon.tech:5432/mydb?sslmode=require")
    assert env["PGHOST"] == "host.neon.tech"
    assert env["PGUSER"] == "u"
    assert env["PGPASSWORD"] == "p@ss"
    assert env["PGDATABASE"] == "mydb"
    assert env["PGSSLMODE"] == "require"


def test_bad_url_rejected():
    with pytest.raises(db.ConfigError):
        db.pg_env_from_url("not-a-url")


def test_schema_sql_defines_all_layers():
    sql = (ROOT / "ingest" / "sql" / "00_schemas.sql").read_text()
    layers = ["raw", "staging", "intermediate", "marts", "signals", "risk", "ops",
              "ground_truth"]
    for name in layers:
        assert f"create schema if not exists {name};" in sql


def test_env_example_has_no_real_secrets():
    text = (ROOT / ".env.example").read_text()
    assert "USER:PASSWORD@HOST" in text
