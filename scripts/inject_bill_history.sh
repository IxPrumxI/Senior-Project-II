#!/usr/bin/env bash
set -Eeuo pipefail

API_BASE_URL="${API_BASE_URL:-https://project.alaqeel.org}"
ACCOUNT_EMAIL="${ACCOUNT_EMAIL:-test@test.prum.me}"
ACCOUNT_PASSWORD="${ACCOUNT_PASSWORD:-}"
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
DATA_FILE="${DATA_FILE:-$SCRIPT_DIR/bill_history.json}"
MODE="${1:-}"

if [[ "$MODE" != "--execute" && "$MODE" != "--dry-run" && "$MODE" != "" ]]; then
  echo "Usage: $0 [--dry-run|--execute]" >&2
  exit 2
fi

if [[ -z "${CURL_BIN:-}" ]]; then
  if command -v curl >/dev/null; then
    CURL_BIN="$(command -v curl)"
  elif [[ -x /mnt/c/Windows/System32/curl.exe ]]; then
    CURL_BIN="/mnt/c/Windows/System32/curl.exe"
  fi
fi

if [[ -z "${PYTHON_BIN:-}" ]]; then
  for candidate in python python3 py; do
    if command -v "$candidate" >/dev/null; then
      PYTHON_BIN="$(command -v "$candidate")"
      break
    fi
  done
  if [[ -z "${PYTHON_BIN:-}" && -x /mnt/c/Windows/py.exe ]]; then
    PYTHON_BIN="/mnt/c/Windows/py.exe"
  fi
fi

if [[ -z "${CURL_BIN:-}" || -z "${PYTHON_BIN:-}" ]]; then
  echo "curl and python are required." >&2
  exit 1
fi

mapfile -t payloads < <("$PYTHON_BIN" - "$DATA_FILE" <<'PY'
import json
import sys
from datetime import date, datetime

with open(sys.argv[1], "r", encoding="utf-8") as source:
    response = json.load(source)

items = response["BillHistoryConsumptionData"]["BillHistoryConsumptionResults"]
for item in items:
    invoice_date = datetime.fromisoformat(item["InvDate"]).date()
    invoice_week = invoice_date.fromordinal(invoice_date.toordinal() - invoice_date.weekday())
    # Utility bill consumption covers a month; expand it into four weekly records.
    weekly_units = float(item["Consumption"]) / 4
    cycle_start = invoice_week if invoice_week == invoice_date else invoice_week.fromordinal(invoice_week.toordinal() + 7)
    for offset in range(4):
        week_start = cycle_start.fromordinal(cycle_start.toordinal() + offset * 7)
        payload = {
            "date": week_start.isoformat(),
            "units": weekly_units,
            "billAmount": float(item["Amount"]) if offset == 0 else None,
        }
        print(json.dumps(payload, separators=(",", ":")))
PY
)

if (( ${#payloads[@]} == 0 )); then
  echo "No bill-history records found." >&2
  exit 1
fi

echo "API: $API_BASE_URL"
echo "Account: $ACCOUNT_EMAIL"
echo "Records: ${#payloads[@]}"

if [[ "$MODE" != "--execute" ]]; then
  for payload in "${payloads[@]}"; do
    printf '%s\n' "$payload"
  done
  exit 0
fi

if [[ -z "$ACCOUNT_PASSWORD" ]]; then
  echo "Set ACCOUNT_PASSWORD before --execute." >&2
  exit 1
fi

login_body="$("$PYTHON_BIN" - "$ACCOUNT_EMAIL" "$ACCOUNT_PASSWORD" <<'PY'
import json
import sys
print(json.dumps({"email": sys.argv[1], "password": sys.argv[2]}, separators=(",", ":")))
PY
)"

login_result="$(
  "$CURL_BIN" --silent --show-error \
    --write-out $'\n%{http_code}' \
    --header 'Content-Type: application/json' \
    --data "$login_body" \
    "$API_BASE_URL/api/auth/login"
)"
login_status="${login_result##*$'\n'}"
login_response="${login_result%$'\n'*}"
if [[ "$login_status" != 200 ]]; then
  echo "Login failed with HTTP $login_status: $login_response" >&2
  exit 1
fi

token="$(printf '%s' "$login_response" | "$PYTHON_BIN" -c 'import json,sys; print(json.load(sys.stdin)["token"])')"

profile="$( "$CURL_BIN" --fail-with-body --silent --show-error \
  --header "Authorization: Bearer $token" \
  "$API_BASE_URL/api/me")"
profile_update_body="$(printf '%s' "$profile" | "$PYTHON_BIN" -c 'import json,sys; profile=json.load(sys.stdin); print(json.dumps({"fullName": profile["fullName"], "tariffMode": profile["tariffMode"], "invoiceDay": 28}, separators=(",", ":")))')"
profile_response="$("$CURL_BIN" --fail-with-body --silent --show-error \
  --request PATCH \
  --header 'Content-Type: application/json' \
  --header "Authorization: Bearer $token" \
  --data "$profile_update_body" \
  "$API_BASE_URL/api/me")"
printf 'Profile updated: %s\n' "$profile_response"

success=0
failure=0
for payload in "${payloads[@]}"; do
  response="$("$CURL_BIN" --fail-with-body --silent --show-error \
    --request POST \
    --header 'Content-Type: application/json' \
    --header "Authorization: Bearer $token" \
    --data "$payload" \
    "$API_BASE_URL/api/consumption" 2>&1)" && {
      ((success += 1))
      printf 'OK %s\n' "$payload"
    } || {
      ((failure += 1))
      printf 'FAILED %s: %s\n' "$payload" "$response" >&2
    }
done

echo "Success: $success"
echo "Failures: $failure"
(( failure == 0 ))
