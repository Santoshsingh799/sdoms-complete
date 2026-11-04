# SDOMS Project Guidelines

This file is the first source of context for any AI coding agent working in this
repository. Read it before inspecting or changing code. Do not start by
rewriting, scaffolding, or "improving" unrelated parts of the project.

## Project Purpose

SDOMS is a Smart Digital Outpass Management System for colleges.

The main workflow is:

1. A student logs in and submits one outpass request.
2. The request is sent to one to five admin-verified guardians.
3. The first guardian response wins; other pending approvals expire.
4. The assigned mentor approves or rejects the request.
5. Mentor approval creates a signed digital outpass and QR code.
6. A guard scans the QR code to record exit, then scans again to record return.
7. The student can view and download the generated PDF pass.

Roles are `STUDENT`, `GUARDIAN`, `MENTOR`, `GUARD`, and `ADMIN`.

## Architecture

This is a small monorepo with separate frontend and backend applications:

- `frontend/`: React 19 single-page application built with Vite and Tailwind CSS.
- `backend/`: Node.js ESM API built with Express.
- `backend/prisma/schema.prisma`: PostgreSQL schema and Prisma models.
- `backend/src/routes/`: role- and feature-specific API routes.
- `backend/src/middleware/`: JWT authentication, role checks, and Zod validation.
- `backend/src/utils/`: notifications, push notifications, audit logging, tokens,
  and shared formatting/helpers.
- `render.yaml`: Render backend deployment blueprint.
- `frontend/vercel.json`: Vercel SPA fallback configuration.

The frontend API client is in `frontend/src/lib.jsx`. It uses
`VITE_API_URL` when supplied and otherwise calls `/api`, with the Vite development
proxy forwarding `/api` to `http://localhost:5000`.

The backend health endpoint is `GET /api/health`. The frontend sends a lightweight
health request on startup and every 15 minutes while the page is open, including
after the browser comes back online. This keeps a sleeping free backend warm
when a user has the site open; it is not a guarantee of 24/7 uptime.

## Backend Rules

- Use Express route modules and existing `requireAuth`, `requireRole`, and
  `validate` middleware rather than duplicating authentication or validation.
- Use Prisma for database access. Do not write ad-hoc SQL unless the existing
  Prisma model cannot express the operation.
- Preserve atomic state transitions. Guardian and mentor decisions must keep
  their transaction/status guards so duplicate or simultaneous clicks cannot
  create duplicate approvals or passes.
- Preserve the one-active-request-per-student rule.
- Preserve the first-guardian-answer-wins behavior.
- Store only hashed guardian link tokens; never log raw approval URLs or secrets.
- Preserve HMAC-signed QR verification and the rule that QR data contains no
  personal information.
- Keep audit logging for state changes.
- Keep errors explicit. Do not replace real errors with successful-looking
  fallback responses.
- Notification failures must not break the core approval transaction. Notification
  records must use values allowed by the `NotificationStatus` Prisma enum:
  `QUEUED`, `SENT`, `FAILED`, or `SIMULATED`.
- `SMS_PROVIDER=dev` is for local simulation. Production rejects it. Production
  may use `web`, `msg91`, or `twilio`.
- Do not expose credentials, JWT secrets, database URLs, SMS keys, or VAPID
  private keys in source code, logs, commits, or responses.

## Frontend Rules

- Reuse the shared `api`, `errMsg`, `useFetch`, `useToast`, `Btn`, `Card`,
  `Input`, `Badge`, and `Spinner` helpers from `frontend/src/lib.jsx`.
- Keep API errors visible to the user through the existing toast pattern.
- Every network action that changes data must show an immediate busy/disabled
  state and prevent duplicate clicks.
- Do not remove `e.preventDefault()` from form submit handlers.
- Preserve role-based routing and the `Shell` navigation in `frontend/src/App.jsx`.
- Keep buttons accessible: retain visible focus styles, disabled styles, and
  meaningful labels. Do not use a clickable `div` when a `button` is appropriate.
- Avoid broad state or styling rewrites for a small bug fix. Preserve the current
  Tailwind-based visual language.
- Do not add a new state-management or UI library without a clear requirement.

## Data and Security Invariants

The following behaviors are intentional and must not be weakened:

- Guardian links expire and resending invalidates old links.
- Only admin-verified student-guardian links can be selected for requests.
- Passwords use bcrypt; sessions use JWT; routes enforce roles.
- Rate limiting, Helmet, CORS, Zod validation, and audit logs are enabled.
- Database uniqueness prevents duplicate exit and return logs.
- A pass is valid from one hour before leave time through two hours after return
  time; returning after pass expiry is still supported by the existing flow.
- Returning users must not be able to access another user's requests or passes.

## Local Development

Requirements: Node.js 20+ and PostgreSQL 14+.

From the repository root:

```text
cd backend
npm install
npm run db:generate
npx prisma migrate dev --name init
SEED_DEMO_DATA=true npm run db:seed
npm run dev
```

In another terminal:

```text
cd frontend
npm install
npm run dev
```

Backend default URL: `http://localhost:5000`

Frontend default URL: `http://localhost:5173`

The backend requires `DATABASE_URL`, `JWT_SECRET`, and `QR_SIGNING_SECRET`.
Use local environment files for these values; never commit them.

## Validation Commands

Run the smallest relevant validation after a change:

```text
cd frontend
npm run build
```

```text
cd backend
node --check src/app.js
```

When a fresh seeded database and running backend are available:

```text
node backend/test/e2e.mjs
```

Also run `git diff --check` before committing. A frontend build warning about a
large JavaScript chunk is currently informational; do not perform unrelated
bundling work while fixing another feature.

## Deployment

- Backend: Render using `render.yaml` and `backend/Dockerfile`.
- Frontend: Vercel using `frontend/vercel.json`.
- Set frontend `VITE_API_URL` to the public backend `/api` URL.
- Set backend `CLIENT_URL` to the public frontend URL.
- Use a managed PostgreSQL database such as Neon.
- `backend/start.js` applies the Prisma schema before starting the server. Treat
  schema changes as production-impacting and review them carefully.
- Free hosting can sleep, enforce quotas, or change pricing. The frontend
  keep-alive request only runs while a browser page is open.

## Known Project State

- The frontend and backend are already implemented; do not scaffold a new app.
- The approval buttons use busy states to prevent duplicate clicks.
- The production `web` notification provider maps to the valid `SIMULATED`
  database status so approval workflows do not fail on notification persistence.
- The repository has an existing README with deployment, demo-flow, and feature
  details. Read it when this file does not answer a project-level question.

## Agent Workflow

Before editing:

1. Read this file and the relevant README section.
2. Inspect the exact frontend handler, backend route, schema, and shared helper
   involved in the request.
3. Check `git status` and preserve unrelated user changes.
4. State the smallest intended change internally and avoid unrelated refactors.

While editing:

1. Follow existing naming, module, validation, and toast patterns.
2. Fix the root cause rather than masking the error.
3. Keep the change surgical and type/runtime safe.
4. Update this file only when a durable project convention or architecture fact
   changes.

After editing:

1. Run targeted syntax/build/tests.
2. Review the diff and check for secrets, unrelated edits, and whitespace errors.
3. Report exactly what changed and which validations passed or failed.
4. Do not commit or push unless the user explicitly asks.

## Do Not Do

- Do not recreate the project or replace the stack.
- Do not change database models, auth, approval rules, or deployment behavior
  without inspecting all affected routes and tests.
- Do not silently swallow exceptions or return `"Something went wrong"` without
  logging the underlying server error.
- Do not make speculative performance rewrites.
- Do not install dependencies unless a manifest changed or validation proves a
  dependency is missing.
- Do not delete, reset, or revert user work.
