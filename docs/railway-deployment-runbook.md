# Railway deployment runbook

OrbitTrack runs on one Railway service and one persistent volume while it still
uses SQLite. This is a single-replica design: do not scale it horizontally or
attach the same SQLite file to more than one running service. PostgreSQL remains
the future multi-replica database migration.

## Railway service configuration

Create the volume at `/data`, then configure these Railway service variables as
secrets, never in a committed file:

```text
TRACKER_DB_PATH=/data/tracker.db
ORBITTRACK_ADMIN_EMAIL=<administrator email>
ORBITTRACK_AGENT_TOKEN=<new hosted bootstrap agent token>
NEXTAUTH_SECRET=<new random production secret>
NEXTAUTH_URL=https://orbittrack.adamroch.com
GOOGLE_CLIENT_ID=<Google OAuth web client id>
GOOGLE_CLIENT_SECRET=<Google OAuth web client secret>
RESEND_API_KEY=<Resend API key>
RESEND_FROM=OrbitTrack <notifications@orbittrack.adamroch.com>
```

`railway.json` builds with `npm run build`, starts with `npm run start`, and
waits for `GET /api/health`. Railway's `PORT` variable is supplied by Railway
and Next reads it automatically.

## Transfer the current state

Stop local writes while generating the transfer artifact. Use the portable
export/import commands, never copy `tracker.db` while its WAL is active:

```bash
mkdir -p ../orbittrack-railway-evidence
npm run state:export -- --source data/tracker.db --out ../orbittrack-railway-evidence/final-export.json
npm run state:import -- --source ../orbittrack-railway-evidence/final-export.json --destination ../orbittrack-railway-evidence/tracker.db
npm run state:verify -- --source data/tracker.db --destination ../orbittrack-railway-evidence/tracker.db --out ../orbittrack-railway-evidence/verification.json
```

After the Railway volume is attached, upload the generated `tracker.db` into
the volume at `/data/tracker.db` before enabling public traffic. Retain the
export JSON and verification JSON outside the repository.

## DNS and Google OAuth

1. Add `orbittrack.adamroch.com` as a custom Railway domain on port 3000.
2. Add the Railway-provided DNS record in Cloudflare and wait for Railway to
   verify HTTPS.
3. In Google Cloud, add this exact redirect URI to the existing web OAuth
   client:

   ```text
   https://orbittrack.adamroch.com/api/auth/callback/google
   ```

4. Keep the existing localhost redirect URI for local development.

Resend is already verified for this subdomain. Do not enable the Resend key in
Railway until the custom domain is verified and HTTPS is healthy.

## Acceptance check and rollback

Before cutover, retain evidence of all of the following:

1. `https://orbittrack.adamroch.com/api/health` returns HTTP 200 and
   `{ "status": "ready" }`.
2. Google sign-in works for the administrator.
3. An agent using a new hosted workspace token can call its normal API routes,
   while a token from another workspace cannot read that workspace's tickets.
4. A test ticket survives `railway restart` with the same identifier and state.
5. A controlled new non-admin registration produces one delivered Resend admin
   notification, visible at `/admin/notifications`.

If a check fails, remove public traffic or point the domain back to the prior
service. Keep the volume and retained export artifact intact for diagnosis; do
not overwrite the local source database. PostgreSQL is explicitly out of scope
for this deployment.
