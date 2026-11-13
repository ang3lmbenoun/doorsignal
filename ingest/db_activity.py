"""List (and optionally end) other sessions on the database: python -m ingest.db_activity [--kill]

Use when a dbt run hangs. --kill ends every other session that is 'idle in transaction' or has
been running a query for more than 5 minutes. It never ends its own connection.
"""
from __future__ import annotations

import sys

from ingest.db import connect

QUERY = """
select pid, state, wait_event_type, wait_event,
       coalesce(now() - query_start, interval '0') as running_for,
       left(regexp_replace(query, '\\s+', ' ', 'g'), 90) as query
from pg_stat_activity
where datname = current_database() and pid <> pg_backend_pid()
order by query_start nulls last
"""


def main() -> int:
    kill = "--kill" in sys.argv
    with connect() as conn, conn.cursor() as cur:
        cur.execute(QUERY)
        rows = cur.fetchall()
        if not rows:
            print("No other sessions on this database.")
        for pid, state, wtype, wevent, age, query in rows:
            print(f"pid={pid} state={state} wait={wtype}/{wevent} for={str(age)[:12]} :: {query}")
            stuck = state == "idle in transaction" or (
                state == "active" and age.total_seconds() > 300
            )
            if kill and stuck:
                cur.execute("select pg_terminate_backend(%s)", (pid,))
                print(f"  -> terminated {pid}")
        conn.commit()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
