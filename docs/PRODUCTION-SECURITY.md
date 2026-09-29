# Production Security & Secret Isolation Guidelines

This document outlines the security considerations and credential management practices required for operating Dogfood in public environments.

## Offline Demo Defaults vs. Production Credentials

`docker-compose.yml` provides stable, deterministic fallback values for local demonstration and judge evaluation:
- `VOTING_TOKEN_SECRET`
- `WEBHOOK_ENCRYPTION_KEY`
- `JUDGE_RECORD_SIGNING_KEY_SEED`

For live public deployments with real participants and confidential evaluation, each secret must be overridden via a non-committed `.env` file or host environment variables:

```bash
# Generate cryptographically secure random values
export VOTING_TOKEN_SECRET=$(openssl rand -hex 32)
export WEBHOOK_ENCRYPTION_KEY=$(openssl rand -hex 32)
export JUDGE_RECORD_SIGNING_KEY_SEED=$(openssl rand -hex 32)
```

## Security Enforcements

1. **Production Mode Guard**:
   When `NODE_ENV=production`, the application startup sequence validates that secrets are distinct from known demonstration seeds. If demo secrets are detected in production mode, startup halts immediately.

2. **Network Isolation**:
   The PostgreSQL database is bound strictly to `127.0.0.1:5432` on the host, inaccessible to public internet interfaces. All external communication is mediated through the application layer and reverse proxy.

3. **HTTP Header Hardening**:
   The reverse proxy strips internal server tokens and injects standard forwarding headers (`X-Real-IP`, `X-Forwarded-For`, `X-Forwarded-Proto`).
