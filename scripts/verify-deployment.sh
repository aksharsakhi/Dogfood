#!/usr/bin/env bash
set -euo pipefail

# Dogfood Automated Post-Deployment Verification Script
# Verifies container health and public endpoint responsiveness

TARGET_HOST="${1:-http://localhost}"

echo "=========================================================="
echo " Running Dogfood Post-Deployment Verification"
echo " Target: ${TARGET_HOST}"
echo "=========================================================="

check_endpoint() {
    local endpoint="$1"
    local expected_code="$2"
    local url="${TARGET_HOST}${endpoint}"

    echo -n "Checking ${url} (expecting HTTP ${expected_code})... "
    local status_code
    status_code=$(curl -s -o /dev/null -w "%{http_code}" "${url}" || echo "000")

    if [ "${status_code}" -eq "${expected_code}" ]; then
        echo "PASS (HTTP ${status_code})"
    else
        echo "FAIL (Got HTTP ${status_code}, expected ${expected_code})"
        return 1
    fi
}

# 1. Verify Web Portal Homepage
check_endpoint "/" 200

# 2. Verify API Readiness Probe
check_endpoint "/ready" 200

# 3. Verify Swagger Documentation UI
check_endpoint "/docs" 200

# 4. Verify OpenAPI Specification
check_endpoint "/openapi.json" 200

# 5. Verify Seeded Events API
check_endpoint "/api/events" 200

echo "=========================================================="
echo " All deployment smoke tests passed successfully! 🚀"
echo "=========================================================="
