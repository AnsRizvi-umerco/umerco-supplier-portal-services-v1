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
npm run dev            # http://localhost:3001/api/v1 (uses src/dev-server.ts)
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
| `SUPABASE_URL` | Supabase project URL |
| `SUPABASE_ANON_KEY` | Supabase anon key |
| `SUPABASE_SERVICE_ROLE_KEY` | Service role key |
| `CORS_ORIGIN` | Allowed UI origins (comma-separated) |
| `IWHI_*` | Integration settings |

Legacy `NEXT_PUBLIC_SUPABASE_*` names are still accepted as fallbacks.

## Deploy (Vercel)

1. Connect the [WebForms-Backend](https://github.com/AnsRizvi-umerco/WebForms-Backend) repo to Vercel.
2. Set all variables from `.env.example` in the Vercel project settings.
3. Set `CORS_ORIGIN` to your frontend URL (e.g. `https://your-ui.vercel.app`).
4. Deploy — `npm run build` bundles the app with esbuild (resolves `@/` path aliases for serverless).

Health check: `GET /health` → `{ "ok": true, "version": "v1" }`
