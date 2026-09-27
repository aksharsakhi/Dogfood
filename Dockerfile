FROM node:22-bookworm-slim AS base
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/contracts/package.json packages/contracts/package.json
COPY packages/shared/package.json packages/shared/package.json
RUN npm ci
COPY . .
RUN npm run db:generate

FROM base AS api
RUN npm run build -w @dogfood/api
ENV NODE_ENV=production
USER node
EXPOSE 4000
CMD ["sh", "-c", "npm run db:deploy && npm run db:import:official && exec npm run start -w @dogfood/api"]

FROM base AS web
RUN npm run build -w @dogfood/web
ENV NODE_ENV=production
USER node
EXPOSE 3000
CMD ["npm", "run", "start", "-w", "@dogfood/web"]
