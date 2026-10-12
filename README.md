# Prezenty - Christmas Gift Management App

A Polish Christmas gift management application built with Node.js, Express, and MySQL.

## Features

- User registration and authentication
- Gift recipient management with profile pictures
- Gift idea tracking and reservation system
- User identification system
- Profile pictures stored in database
- Session management with MySQL

## Database Configuration

The app uses a MySQL database. All connection details are configured via environment variables — never commit actual values to the repository.

## Environment Variables

Set the following environment variables (e.g. in your hosting dashboard or a local `.env` file that is gitignored):

```
DB_HOST=your_database_host
DB_USER=your_database_user
DB_PASSWORD=your_database_password
DB_NAME=your_database_name
DB_PORT=3306
SESSION_SECRET=your_session_secret
NODE_ENV=production
```

Set your own `SESSION_SECRET` and `VAPID_*` values in production; the built-in fallbacks are public. See [Rotating secrets](DEPLOYMENT.md#rotating-secrets).

## Deployment on Render

1. Connect your GitHub repository to Render
2. Set the environment variables in Render dashboard:
   - `DB_PASSWORD` - Your MySQL database password
   - Other variables are already configured in render.yaml
3. Deploy the service

The app will:
- Install dependencies
- Start the server (database schema initialization is skipped)

**Important**: Database tables must exist before deployment. If needed, run database initialization manually:
```bash
npm run init-db
```

## Database Schema

The app creates the following tables:
- `users` - User authentication
- `recipients` - Gift recipients with profile pictures (stored as BLOB)
- `presents` - Gift ideas and reservations
- `sessions` - Express session storage

## Local Development

### Offline Mode (No Database Required)
1. Clone the repository
2. Install dependencies: `npm install`
3. Start in offline mode: `npm run offline` or `npm start`
4. App runs with sample data - no database needed

### Full Database Mode
1. Clone the repository
2. Install dependencies: `npm install`
3. Set up environment variables in `.env` file
4. Set `OFFLINE_MODE=false` and provide `DB_PASSWORD`
5. Run database initialization: `npm run init-db`
6. Start development server: `npm run dev`

### Testing
- `npm test` runs the end-to-end suite: it boots the real `server.js` in demo mode on a free port, drives the real pages in headless Edge, and asserts.
- `npm run test:e2e:headed` or `npm run test:e2e:ui` to debug a failure; `npm run test:e2e:report` opens the last HTML report.
- See [`tests/README.md`](tests/README.md) for how to add a test, where the demo fixtures live, and what the suite cannot verify (no database, so no SQL, migrations or MySQL behaviour).

## Project layout
- `server.js` - Express entry point: middleware, sessions, mounting routers, startup
- `routes/` - Express routers grouped by domain (system, pages, auth, recipients, presents, notifications, leaderboard, chat, formularz, archive)
- `lib/` - shared logic used by the routers (database pool, push, notifications, caches, demo data, cron jobs)
- `public/` - static front end (HTML, CSS, client JS, service worker)
- `tests/` - Playwright end-to-end suite (see [`tests/README.md`](tests/README.md))
- `scripts/` - database and diagnostic scripts (see [`scripts/README.md`](scripts/README.md)); `npm run init-db`, `test-db` and `optimize-db` point here
- `docs/archive/` - historical fix notes, kept for reference (see [`docs/archive/README.md`](docs/archive/README.md))
- `DEPLOYMENT.md`, `Dockerfile`, `render.yaml`, `vercel.json` - deployment guide and config
- `.agents/` - task plans, reviews and verification notes
## Profile Pictures

Profile pictures are stored directly in the MySQL database as BLOB data, eliminating the need for file system storage or external storage services.

## API Endpoints

- `POST /api/register` - User registration
- `POST /api/login` - User login
- `GET /api/recipients` - Get all recipients
- `POST /api/recipients` - Add new recipient
- `POST /api/recipients/:id/profile-picture` - Upload profile picture
- `GET /api/recipients/:id/profile-picture` - Get profile picture
- `GET /api/presents` - Get presents (filtered by user identification)
- `POST /api/presents` - Add new present
- `PUT /api/presents/:id` - Update present
- `DELETE /api/presents/:id` - Delete present
- `POST /api/presents/:id/reserve` - Reserve present
- `DELETE /api/presents/:id/reserve` - Cancel reservation

## License

MIT