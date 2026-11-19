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

if ! command -v curl >/dev/null || ! command -v python3 >/dev/null; then
  echo "curl and python3 are required." >&2
  exit 1
fi

mapfile -t payloads < <(python3 - "$DATA_FILE" <<'PY'
import json
import sys
from datetime import date, datetime

with open(sys.argv[1], "r", encoding="utf-8") as source:
    response = json.load(source)

items = response["BillHistoryConsumptionData"]["BillHistoryConsumptionResults"]
for item in items:
    invoice_date = datetime.fromisoformat(item["InvDate"]).date()
    week_start = invoice_date.fromordinal(invoice_date.toordinal() - invoice_date.weekday())
    payload = {
        "date": week_start.isoformat(),
        "units": float(item["Consumption"]),
        "billAmount": float(item["Amount"]),
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

login_body="$(python3 - "$ACCOUNT_EMAIL" "$ACCOUNT_PASSWORD" <<'PY'
import json
import sys
print(json.dumps({"email": sys.argv[1], "password": sys.argv[2]}, separators=(",", ":")))
PY
)"

response_file="$(mktemp)"
trap 'rm -f "$response_file"' EXIT
login_status="$(
  curl --silent --show-error \
    --output "$response_file" \
    --write-out '%{http_code}' \
    --header 'Content-Type: application/json' \
    --data "$login_body" \
    "$API_BASE_URL/api/auth/login"
)"
login_response="$(cat "$response_file")"
if [[ "$login_status" != 200 ]]; then
  echo "Login failed with HTTP $login_status: $login_response" >&2
  exit 1
fi

token="$(printf '%s' "$login_response" | python3 -c 'import json,sys; print(json.load(sys.stdin)["token"])')"

profile_response="$(curl --fail-with-body --silent --show-error \
  --request PATCH \
  --header 'Content-Type: application/json' \
  --header "Authorization: Bearer $token" \
  --data '{"invoiceDay":28}' \
  "$API_BASE_URL/api/me")"
printf 'Profile updated: %s\n' "$profile_response"

success=0
failure=0
for payload in "${payloads[@]}"; do
  response="$(curl --fail-with-body --silent --show-error \
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
