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
| `SUPABASE_URL` | Supabase project URL |
| `SUPABASE_ANON_KEY` | Supabase anon key |
| `SUPABASE_SERVICE_ROLE_KEY` | Service role key |
| `CORS_ORIGIN` | Allowed UI origins (comma-separated) |
| `IWHI_*` | Integration settings |

Legacy `NEXT_PUBLIC_SUPABASE_*` names are still accepted as fallbacks.
