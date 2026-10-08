# Smart System for Analyzing and Predicting Electricity Consumption

Senior Project II – College of Computing & Informatics, Saudi Electronic University.

Users enter weekly electricity usage, see trends and week-over-week comparisons, get alerts when usage is
unusually high, and get a predicted next-month consumption and bill.

## Structure

| Folder | Stack | Purpose |
| --- | --- | --- |
| `web/migrations/` | TypeORM | Versioned MySQL migrations for users, consumption_records, prediction_results, and alerts |
| `ml-service/` | Python, FastAPI, scikit-learn | `POST /predict`: recent-mean / Random Forest model, predicts next 4 weeks with an error range |
| `web/` | TypeScript, Express 5 | REST API (`src/`), browser code (`client/`), static pages (`public/`) |

## Run locally

```bash
# 1. Database
cp .env.example .env        # configure DB_PASSWORD and JWT_SECRET
mysql -u root -p -e "CREATE DATABASE smart_electricity CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci"

# 2. Prediction service
cd ml-service
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
pytest
uvicorn app:app --port 8000

# 3. Web app (new terminal)
cd web
cp .env.example .env        # configure DB_* and JWT_SECRET for local services
npm install
npm run migration:run
npm run build
npm test
npm start                   # http://localhost:3000
```

## API

| Method | Path | Use case |
| --- | --- | --- |
| POST | `/api/auth/register`, `/api/auth/login` | UC-01, UC-02 |
| POST/GET | `/api/consumption` | UC-03 add / list weekly records |
| GET | `/api/dashboard` | UC-04, UC-06 history, comparison, alert, tips |
| POST | `/api/predict` | UC-05 next-month prediction |
| GET | `/api/alerts` | stored alerts |
| GET/PATCH | `/api/me` | account profile and per-kWh tariff |
| PUT/DELETE | `/api/consumption/:weekStart` | edit or remove an owned weekly record |
| GET | `/api/dashboard/monthly` | month totals grouped by the month containing Monday `week_start` |

## Design notes

- Records are keyed by the Monday of the week; entering the same week twice updates it.
- Monthly groups assign a week to the calendar month containing its `week_start`; groups with fewer than four records are partial.
- Alert rule: latest week more than 20% above the average of earlier weeks (needs 3+ earlier weeks).
- Prediction needs at least 4 weekly records and currently uses the mean of the latest four weeks at all supported history lengths, based on the fixed-seed synthetic backtest in `ml-service/results.md`. Per-month predictions update in place.
- Default progressive tariff charges the first 6,000 forecast kWh at 0.18 SAR/kWh and only excess units at 0.30 SAR/kWh. Users can select a flat-rate override in settings; that override replaces the tier schedule.
- `localStorage` stores the bearer token under `se_token`; injected scripts could read it, so avoid untrusted page scripts and deploy with a strict content-security policy before public use.
- Demo accounts created by `npm run seed`: `demo@example.com` and `new@example.com`, both with password `DemoPass123!`. Use only for local demonstrations.

## Evaluation and test execution

From `ml-service`, run `python evaluate.py` to reproduce `results.md`, and `python -m pytest -p no:cacheprovider test_model.py` for model/API tests. In `web`, `npm test` runs pure analytics tests and skips DB integration tests by default. To run the API suite, create a dedicated `smart_electricity_test` database, set its connection variables and `RUN_API_INTEGRATION=1`, then run `npm run migration:run` followed by `npm test`. Never point this suite at the demo or development database.

## Database migrations

TypeORM migrations are the only schema definition and upgrade path; schema synchronization is disabled. For a fresh database, provision an empty MySQL database, then run `cd web && npm run migration:run`. Existing installations should first back up the database and then run the same command to apply pending migrations. Use `npm run migration:show` to inspect pending changes and `npm run migration:revert` only when intentionally rolling back the latest migration.

For Docker Compose, copy the root `.env.example` to `.env`, replace `DB_PASSWORD` and `JWT_SECRET`, then run `docker compose up --build`. Compose creates the configured MySQL database and the web service applies TypeORM migrations at startup. For a local web app, copy `web/.env.example` to `web/.env` and configure its database connection and JWT secret.
