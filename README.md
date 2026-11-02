# Smart Digital Outpass Management System (SDOMS)

React + Vite + Tailwind | Node + Express | PostgreSQL + Prisma 6

## Run locally
Requirements: Node 20+, PostgreSQL 14+

```bash
# 1. database
createdb sdoms

# 2. backend
cd backend
cp .env.example .env          # edit DATABASE_URL, JWT_SECRET, QR_SIGNING_SECRET
npm install
npx prisma generate
npx prisma migrate dev --name init
npm run db:seed
npm run dev                   # http://localhost:5000

# 3. frontend (new terminal)
cd frontend
npm install
npm run dev                   # http://localhost:5173
```

In development `SMS_PROVIDER=dev`: SMS is printed in the backend console, e.g.
`.../g/<token>` - open that link in a browser to act as the guardian.

## Demo logins (change before deployment)
| Role | ID | Password |
|---|---|---|
| Admin | admin | Admin@123 |
| Mentor | mentor1 | Mentor@123 |
| Guard | guard1 | Guard@123 |
| Student | A12345 | Student@123 |

The seeded guardian "Demo Father" (9000000003) is already verified.

## Flow
Student login -> request (1-5 verified guardians) -> SMS link to all -> FIRST guardian answer is final
(other links expire) -> mentor approves -> backend creates pass + signed QR -> student downloads PDF ->
guard scans QR -> EXITED -> scans again -> RETURNED.

## Rules built in
- Guardian numbers must be verified by admin before they can approve (stops fake numbers).
- First answer wins, enforced by an atomic DB update (tested with simultaneous clicks).
- Approval links: random 256-bit token, only its SHA-256 hash is stored, expires (GUARDIAN_LINK_EXPIRY_HOURS), resend invalidates old links.
- QR holds only `verifyId.signature` (HMAC) - no personal data. Pass is created only by the backend after both approvals.
- Unique(outpass, EXIT/RETURN) in DB blocks duplicate exit/return.
- Pass valid from 1 hour before leaving time to 2 hours after return time. Returning is still allowed after expiry.
- One active request per student at a time.
- bcrypt passwords, JWT, role checks, rate limits, zod validation, audit log for every state change.

## Real SMS
Set `SMS_PROVIDER=msg91` or `twilio` plus keys in `.env`. In India, MSG91 needs a DLT-registered template.
Set `CLIENT_URL` to your public site URL (the SMS link uses it) - `localhost` links will not open on a parent's phone.

## Web-only approval and phone notifications
The approval flow uses a web page instead of WhatsApp. The normal workflow is:

1. Student submits an outpass for an admin-verified guardian.
2. The backend prints a private guardian web link in the terminal during local development. Open that link on the guardian's phone to see the request details and approve/reject it.
3. The first guardian response closes the other links and notifies the assigned mentor.
4. The mentor reviews the request in the mentor web dashboard and approves or rejects it.
5. Approval creates the signed QR pass; a guard verifies it from the guard web dashboard.

Generate Web Push keys with `npx web-push generate-vapid-keys`, then set `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, and `VAPID_SUBJECT`. Users can enable notifications from their dashboard. PWA push requires HTTPS in production; an Azure HTTPS URL is sufficient.

## Free-stack deployment
`render.yaml`, `backend/Dockerfile`, and `frontend/vercel.json` are included for a low-cost test deployment. Create a free PostgreSQL database on Neon, deploy `backend` to Render using the blueprint, then deploy `frontend` to Vercel with `VITE_API_URL=https://<render-backend>/api`. Set the backend `CLIENT_URL` to the Vercel URL. Free providers may sleep, impose quotas, or change pricing; do not use this setup for sensitive production data without a security review.

## Tests
With the server running on a fresh seeded DB: `node backend/test/e2e.mjs` (47 checks).

## Not included yet
- OTP/confirm step on guardian link (anyone who receives the SMS link can answer - add OTP for higher security)
- Departments are plain text fields, not a separate table
- Logo/seal URL is saved in settings but the pass uses a drawn seal
- Automatic EXPIRED status job (expiry is evaluated when a pass is scanned)
