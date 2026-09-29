# Production Deployment & Operations Guide

This guide describes how to operate and self-host the Dogfood platform in production on any standard Linux virtual machine or server.

## Overview

The Dogfood platform runs as a multi-container Docker Compose deployment:
- **`postgres`**: PostgreSQL 16 database with persistent storage.
- **`api`**: Fastify backend listening on port 4000. On container startup, it automatically executes database schema migrations (`npm run db:deploy`) and deterministic official fixture seeds (`npm run db:import:official`).
- **`web`**: Next.js server-rendered application listening on port 3000, communicating internally with `http://api:4000`.

## Quick Start (Fresh Server)

1. **Clone the repository**:
   ```bash
   git clone https://github.com/aksharsakhi/Dogfood.git
   cd Dogfood
   ```

2. **Initialize host dependencies**:
   ```bash
   chmod +x deploy/scripts/setup-production.sh
   ./deploy/scripts/setup-production.sh
   ```

3. **Launch the application stack**:
   ```bash
   docker compose up --build -d
   ```

4. **Verify container health**:
   ```bash
   docker compose ps
   ```
   All three containers (`dogfood-postgres-1`, `dogfood-api-1`, `dogfood-web-1`) should report `healthy` or `running`.

## Reverse Proxy Setup

Place Nginx or Caddy in front of the application to terminate SSL/TLS and route traffic on standard web ports (80 and 443):

### Option A: Nginx
Use the provided configuration at `deploy/nginx/dogfood.conf`:
```bash
sudo cp deploy/nginx/dogfood.conf /etc/nginx/sites-available/default
sudo nginx -t
sudo systemctl reload nginx
```

### Option B: Caddy
Use the provided `deploy/caddy/Caddyfile` for zero-configuration automatic SSL certificates:
```bash
caddy run --config deploy/caddy/Caddyfile
```

## Systemd Daemon Management

To ensure the application stack restarts automatically across host reboots:
```bash
sudo cp deploy/systemd/dogfood.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now dogfood
```
