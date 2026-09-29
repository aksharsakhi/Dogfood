# Deployment Architecture & Network Topology

This document details the production network topology, request lifecycle, and container orchestration layout of the Dogfood platform.

## Architecture Diagram

```
+-------------------------------------------------------------+
|                      Public Internet                        |
+-------------------------------------------------------------+
                              |
                     Port 80 / 443 (HTTP/S)
                              v
+-------------------------------------------------------------+
|                Reverse Proxy (Nginx / Caddy)                |
|  - Terminate SSL / TLS                                      |
|  - /docs, /openapi.json, /ready  --> Raptors API (:4000)     |
|  - /                             --> Raptors Web (:3000)     |
+-------------------------------------------------------------+
           |                                       |
    HTTP :3000                              HTTP :4000
           v                                       v
+-----------------------+               +---------------------+
|      Raptors Web      |               |     Raptors API     |
|      (Next.js 16)     | --HTTP:4000-> |   (Fastify Backend) |
|   Container: port 3000|  (Internal)   | Container: port 4000|
+-----------------------+               +---------------------+
                                                   |
                                            Port 5432 (TCP)
                                                   v
                                        +---------------------+
                                        |      PostgreSQL     |
                                        |     (Postgres 16)   |
                                        | Container: port 5432|
                                        +---------------------+
                                                   |
                                                   v
                                        [Persistent Docker Vol]
                                            (postgres_data)
```

## Request Routing Mechanics

1. **Client Browsing**:
   Users accessing the platform via `http://<domain_or_ip>/` hit the reverse proxy, which forwards requests to the `web` container on port 3000.

2. **Server-Side Rendering (SSR)**:
   The Next.js web application renders pages on the server and fetches domain entities (events, tracks, projects, rubrics) directly over the internal Docker bridge network at `http://api:4000`.

3. **Client-Side API Proxy**:
   Browser client components make requests to `/api/[...path]`. Next.js routes these requests through `apps/web/app/api/[...path]/route.ts` directly to `http://api:4000`, preserving cookies and authorization headers without requiring CORS configuration.

4. **Database Operations**:
   The API container handles transactional database queries against `postgres:5432` with connection pooling managed by Prisma Client.
