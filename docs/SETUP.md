# Setup (Windows PowerShell)

1. `cd C:\Users\megan\projects\doorsignal`
2. `python -m venv .venv` then `.venv\Scripts\Activate.ps1`
3. `pip install -r requirements-dev.txt`
4. `copy .env.example .env` and paste your Neon connection string into DATABASE_URL (never commit .env)
5. `python -m ingest.check_connection`   (expects: OK: connected to ...)
6. `python -m ingest.init_db`            (creates raw, staging, intermediate, marts, signals, risk, ops, ground_truth)
7. `python -m ingest.run_dbt build`      (builds the ping model and runs its tests)
8. `pytest -q` and `ruff check .`

GitHub: add repository secret DATABASE_URL (Settings > Secrets and variables > Actions) so CI can reach Neon.
