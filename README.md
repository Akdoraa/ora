# ORA

Monorepo: pnpm workspaces, NestJS API, Next.js web, shared packages. See `docs/` for product and architecture.

## Prerequisites

- Node.js >= 20
- pnpm 9+
- Docker and Docker Compose (for Postgres + Redis)

## Local setup

**1. Install dependencies**

```bash
pnpm install
```

**2. Start Postgres and Redis**

```bash
docker compose up -d
```

**3. Environment**

```bash
cp .env.example .env
# Edit .env if needed (defaults: postgres ora:ora@localhost:5432/ora, redis localhost:6379)
```

**4. Generate Prisma client and run migrations**

```bash
pnpm db:generate
pnpm db:migrate
```

**5. Run the API (health only)**

```bash
pnpm dev:api
```

API: http://localhost:3001. Health: http://localhost:3001/health

**6. Run the web app (separate terminal)**

```bash
pnpm dev:web
```

Web: http://localhost:3000

## Commands (from repo root)

| Command | Description |
|--------|-------------|
| `pnpm install` | Install all workspace dependencies |
| `pnpm build` | Build all apps and packages |
| `pnpm lint` | Lint all workspaces |
| `pnpm typecheck` | Typecheck all workspaces |
| `pnpm test` | Run tests in all workspaces |
| `pnpm dev:api` | Start API in watch mode (port 3001) |
| `pnpm dev:web` | Start Next.js in watch mode (port 3000) |
| `pnpm db:generate` | Generate Prisma client |
| `pnpm db:migrate` | Run Prisma migrations |
| `pnpm db:push` | Push Prisma schema (dev only) |

## Workspaces

- **apps/api** — NestJS API; `/health` only.
- **apps/web** — Next.js app; placeholder pages.
- **packages/shared** — Shared types.
- **packages/db** — Prisma schema and migrations.
- **packages/ledger** — Ledger domain (skeleton + test setup).

No product logic yet; skeleton only.
