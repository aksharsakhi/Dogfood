# Live Deployment Registry

The Dogfood hackathon platform has been deployed and is running 24/7 on AWS EC2.

## Live Endpoints

- **Web Portal**: [http://13.51.169.132](http://13.51.169.132)
- **API Swagger Documentation**: [http://13.51.169.132/docs](http://13.51.169.132/docs)
- **OpenAPI Schema**: [http://13.51.169.132/openapi.json](http://13.51.169.132/openapi.json)
- **Readiness Probe**: [http://13.51.169.132/ready](http://13.51.169.132/ready)
- **Public Events Endpoint**: [http://13.51.169.132/api/events](http://13.51.169.132/api/events)

## Server Details

- **Host Provider**: Amazon Web Services (AWS)
- **Region**: `eu-north-1` (Stockholm)
- **Public IP**: `13.51.169.132`
- **Reverse Proxy**: Nginx 1.28 (terminating port 80/443, proxying to ports 3000 & 4000)
- **Container Engine**: Docker Engine 29.1.3 + Docker Compose v2.40.3

## Deterministic Test Credentials

Derived deterministically by `prisma/import-official-fixtures.ts` and configured in `.dogfood.toml`:

- **Organizer Cookie**: `Cookie: dogfood_session=F4cGHeFb_bF6wI7d9OtESUklftWQol24Lqx5zouMaKs`
- **Judge A Cookie**: `Cookie: dogfood_session=XANDQPDzh7HwQ9wNSezPggafDi5ZPf7MKltGAqJE2Ig`
- **Judge B Cookie**: `Cookie: dogfood_session=xN65tCho-mvfrJSTRte5Xl8YcIdEIdPRad4Y20QbU4o`
- **Participant Cookie**: `Cookie: dogfood_session=tjKvlbtE9x-9wJkp_t-LVqt2p0GfHpc_60fdN7EJhf8`
