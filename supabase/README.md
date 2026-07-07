# Supabase database migrations

Schema changes live in `migrations/` as ordered SQL files. Do not rely on the dashboard SQL editor for routine updates.

**Run all commands from the `Services/` directory** (parent of this folder).

## One-time setup

1. Install the CLI (or use `npx supabase` via npm scripts in `Services/package.json`).
2. Log in: `npx supabase@latest login`
3. Link this repo to your hosted project (from `Services/`):

   ```bash
   npm run db:link -- --project-ref <YOUR_PROJECT_REF>
   ```

   Project ref is the short id in the Supabase dashboard URL: `https://supabase.com/dashboard/project/<project-ref>`.

## Apply migrations to the linked remote database

```bash
npm run db:push
```

Preview without applying:

```bash
npm run db:push:dry
```

## Add a new migration

```bash
npm run db:migration:new -- your_change_name
```

Edit the new file under `migrations/`, then run `npm run db:push`.

## Local Postgres (optional)

To run a local stack for experimentation: `npx supabase@latest start` (requires Docker). This repo targets hosted Supabase by default.

## Note on `schema.sql`

If present, `schema.sql` is a pointer only. The source of truth for DDL is `migrations/`.
