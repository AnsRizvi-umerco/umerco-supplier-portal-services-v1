# Services (Backend)

Express API with standard layered architecture.

## Structure

```
src/
├── config/           # Environment config
├── constants/        # API version, shared constants
├── controllers/v1/   # HTTP request handlers
├── middleware/       # Auth, CORS, error handling
├── routes/v1/        # Route definitions
├── services/         # Business logic
├── integrations/     # Supabase, IWHI, webhooks
├── schemas/          # Zod validation schemas
└── utils/            # Shared helpers
```

## Run

```bash
cp .env.example .env
npm install
npm run dev            # http://localhost:3001/api/v1
```

## API (v1)

Base path: `/api/v1`

| Method | Path | Auth |
|--------|------|------|
| GET | `/schedules` | Optional |
| GET | `/schedules/:id` | Optional |
| POST | `/submit` | Required |
| GET | `/submissions` | Optional |
| GET | `/dashboard` | Optional |
| GET | `/profile` | Optional |
| GET/PATCH | `/settings` | Required |
| GET | `/settings/integration-status` | Required |
| GET | `/settings/trading-partners` | Required |
| GET/POST | `/edifact` | GET: required, POST: public |
| POST | `/labels` | Required |
| POST | `/webhooks/iwhi` | Public (signature) |

## Database

Migrations in `supabase/migrations/`. Run from this folder:

```bash
npm run db:push
```

## Environment

| Variable | Purpose |
|----------|---------|
| `MASTER_DATABASE_URL` | Master Portal PostgreSQL URL (auth user lookups) |
| `MASTER_PORTAL_BASE_URL` | Master Portal API base (db-route for shared/dedicated connection strings) |
| `JWT_SECRET` | Must match Master Portal JWT signing secret |
| `CORS_ORIGIN` | Allowed UI origins (comma-separated) |
| `IWHI_*` | Integration settings |

## Deploy (Vercel — legacy builds/routes)

1. Connect the [WebForms-Backend](https://github.com/AnsRizvi-umerco/WebForms-Backend) repo to Vercel.
2. **Framework Preset:** Other.
3. **Build Command:** `npm run build` (bundles to `api/index.cjs`).
4. `vercel.json` uses legacy `builds` + `routes` — all traffic goes to the bundled handler, not raw `src/app.ts`.
5. Set all variables from `.env.example` in Vercel project settings.
6. Set `CORS_ORIGIN` to your frontend URL (e.g. `https://your-ui.vercel.app,http://localhost:5173`).

Health check: `GET /health` → `{ "ok": true, "version": "v1" }`
