#!/usr/bin/env bash
set -euo pipefail

# Dogfood Periodic Health Monitor
# Checks container health status and logs metrics

PROJECT_DIR="${1:-$HOME/Dogfood}"
cd "${PROJECT_DIR}"

TIMESTAMP=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
echo "[${TIMESTAMP}] Checking Dogfood container health..."

UNHEALTHY=0
for service in postgres api web; do
    STATUS=$(docker compose ps --format json "${service}" | grep -o '"Health":"[^"]*"' | cut -d'"' -f4 || echo "unknown")
    STATE=$(docker compose ps --format json "${service}" | grep -o '"State":"[^"]*"' | cut -d'"' -f4 || echo "unknown")

    if [ "${STATUS}" = "unhealthy" ] || [ "${STATE}" = "exited" ]; then
        echo "[${TIMESTAMP}] WARNING: Service '${service}' is in state: ${STATE} (health: ${STATUS})"
        UNHEALTHY=1
    else
        echo "[${TIMESTAMP}] Service '${service}': OK (state: ${STATE}, health: ${STATUS})"
    fi
done

if [ "${UNHEALTHY}" -eq 1 ]; then
    echo "[${TIMESTAMP}] Restarting degraded services..."
    docker compose up -d
fi
