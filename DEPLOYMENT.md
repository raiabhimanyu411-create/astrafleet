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

## Smoke tests

```bash
curl https://your-domain.com/api/health
curl -I https://your-domain.com/
curl -I https://your-domain.com/admin
```
