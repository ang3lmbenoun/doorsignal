"""The never-main guard in ingest.api_sql (no database needed)."""
import pytest

from ingest.api_sql import target_url
from ingest.db import ConfigError

MAIN = "postgresql://owner:pw@ep-main-abc-pooler.c-9.us-east-2.aws.neon.tech/neondb?sslmode=require"
BRANCH = "postgresql://owner:pw@ep-branch-xyz.c-9.us-east-2.aws.neon.tech/neondb?sslmode=require"


@pytest.fixture(autouse=True)
def clean_env(monkeypatch):
    for k in ("DATABASE_URL", "MAIN_DATABASE_HOST", "GITHUB_ACTIONS", "BRANCH_URL"):
        monkeypatch.delenv(k, raising=False)
    monkeypatch.setattr("dotenv.load_dotenv", lambda *a, **k: None)


def test_branch_is_accepted(monkeypatch):
    monkeypatch.setenv("DATABASE_URL", MAIN)
    monkeypatch.setenv("BRANCH_URL", BRANCH)
    assert target_url("BRANCH_URL") == BRANCH


def test_same_host_is_refused_even_pooled_vs_direct(monkeypatch):
    monkeypatch.setenv("DATABASE_URL", MAIN)
    monkeypatch.setenv("BRANCH_URL", MAIN.replace("-pooler", ""))
    with pytest.raises(ConfigError, match="same host"):
        target_url("BRANCH_URL")


def test_main_host_variable_is_enough_without_the_main_url(monkeypatch):
    monkeypatch.setenv("MAIN_DATABASE_HOST", "ep-main-abc.c-9.us-east-2.aws.neon.tech")
    monkeypatch.setenv("BRANCH_URL", MAIN)
    with pytest.raises(ConfigError, match="same host"):
        target_url("BRANCH_URL")


def test_host_override_in_the_query_is_refused(monkeypatch):
    monkeypatch.setenv("DATABASE_URL", MAIN)
    monkeypatch.setenv("BRANCH_URL", BRANCH + "&host=ep-main-abc.c-9.us-east-2.aws.neon.tech")
    with pytest.raises(ConfigError, match="host or hostaddr"):
        target_url("BRANCH_URL")


def test_in_ci_an_unknown_main_host_fails_closed(monkeypatch):
    monkeypatch.setenv("GITHUB_ACTIONS", "true")
    monkeypatch.setenv("BRANCH_URL", BRANCH)
    with pytest.raises(ConfigError, match="main database host is unknown"):
        target_url("BRANCH_URL")


def test_missing_target_is_an_error(monkeypatch):
    monkeypatch.setenv("DATABASE_URL", MAIN)
    with pytest.raises(ConfigError, match="is not set"):
        target_url("BRANCH_URL")
