# OncoEasy — Run Doc

Full-stack app: Express/Prisma backend (port 3000) + Vite/React frontend (port 5173).
This workspace IS the main checkout, so env files are already in place. For a fresh
worktree, reproduce the artifacts below before starting servers.

## 1. Reproduce the artifacts (fresh checkout only)

1. Copy env files from the main checkout (never commit real values):
   - `backend/.env` (DB URL, JWT secrets, CORS, storage config)
   - `frontend/.env.development` (contains `VITE_API_BASE_URL=http://localhost:3000`)
   - If unavailable, create from `backend/.env.example` / `frontend/.env.example`.
2. Install dependencies (npm; lockfiles are `package-lock.json`):
   - `cd backend && npm install`
   - `cd frontend && npm install`
3. Generate the Prisma client: `cd backend && npx prisma generate`
   (schema/migrations are committed; `npx prisma migrate status` should report up to date)

## 2. Run the servers

- Backend (port 3000): `cd backend && npm run dev` (`tsx watch src/server.ts`).
  Verify: `curl http://localhost:3000/health` → `{"status":"ok"}`.
- Frontend (port 5173): `cd frontend && npm run dev` (vite default port; `VITE_API_BASE_URL`
  in `.env.development` points at the backend).
- If 5173 is taken, vite picks the next free port — pass it to `register_preview` as-is.
- Frontend shows "Backend connection is healthy" once both are up.

## 3. Detached start (Windows, used for the Preview tab)

stdout and stderr MUST go to different files:

```
powershell -NoProfile -Command "(Start-Process -FilePath 'npm.cmd' -ArgumentList 'run','dev' -WorkingDirectory '<repo>\frontend' -RedirectStandardOutput '<repo>\.freebuff\<log>.log' -RedirectStandardError '<repo>\.freebuff\<log>.log.err' -WindowStyle Hidden -PassThru).Id"
```

The bash wrapper may report a timeout even though the server detached successfully —
verify with `netstat -ano | grep ":5173 "` (listening pid) and curl the URL before registering.

## Current state (this thread's preview)

- Backend: reused an already-listening healthy instance (pid 34212, port 3000) — not started here.
- Frontend: started detached for the preview — pid 34068, port 5173, log in
  `.freebuff/preview-50cce3a2-3d7c-4b02-8d05-72c34389176a.log(.err)`.
