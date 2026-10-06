# AstraFleet Deployment Checklist

## Required environment

Backend variables:

```env
DB_HOST=your-db-host
DB_USER=your-db-user
DB_PASSWORD=your-db-password
DB_NAME=AstraFleet
PORT=5001
NODE_ENV=production
```

Optional when frontend and backend are on different domains:

```env
CORS_ORIGIN=https://your-frontend-domain.com
```

Frontend variable, only for separate frontend/backend deployments:

```env
VITE_API_BASE_URL=https://your-backend-domain.com
```

Leave `VITE_API_BASE_URL` empty when Express serves `client/dist` from the same domain.

## One-server deploy

```bash
npm install
npm run install:all
npm run build
NODE_ENV=production npm start
```

The backend serves the built React app from `client/dist` and API routes from `/api`.

## Database setup

Create the MySQL database, then run:

```bash
mysql -u "$DB_USER" -p "$DB_NAME" < backend/db/schema.sql
node backend/db/seed.js
```

## UK time

All times are UK time (GMT/BST), whatever timezone the server or MySQL host uses. The backend sets
`TZ=Europe/London` for Node and sets each MySQL session's `time_zone` (see `backend/db/connection.js`).

- Recommended: load MySQL's timezone tables once so sessions use `Europe/London` directly:
  `mysql_tzinfo_to_sql /usr/share/zoneinfo | mysql -u root -p mysql`
- Without them the backend logs a warning and uses the current UK offset (`+00:00` / `+01:00`), switching
  automatically at the BST change. Both work; the named zone also converts historical `TIMESTAMP` values
  across the clock change exactly.

### Old maintenance times (one-time, automatic)

On the first start of this version, before it accepts requests, the backend converts maintenance timestamps
that MySQL wrote in its old timezone (completed, resolved, verified, QA, reported times …) to UK time, then
records `uk_time_legacy_maintenance_v1` in `maintenance_data_migrations` so it never runs again.

1. Before deploying, check the server's MySQL clock:
   `SELECT @@global.time_zone, @@system_time_zone, TIMESTAMPDIFF(MINUTE, UTC_TIMESTAMP(), NOW());`
   - `SYSTEM / IST / 330` (India) or `SYSTEM / UTC / 0` → detected automatically.
   - `GMT`/`BST` → already UK time; nothing to convert.
   - Anything else → set `LEGACY_DB_TIME_ZONE` (e.g. `UTC`, `Asia/Kolkata`) in the deploy environment first.
2. Optional preview (writes nothing): `node backend/scripts/ukTimeMigration.js`
3. After deploy, the log shows `[UK time] Converted N old maintenance times …` or why it was skipped.

## Smoke tests

```bash
curl https://your-domain.com/api/health
curl -I https://your-domain.com/
curl -I https://your-domain.com/admin
```
