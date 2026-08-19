# ADR 0001: Capped multi-tenant access and agent service credentials

## Status

Accepted

## Context

OrbitTrack is moving from a local, unauthenticated tracker to a hosted service.
It must support a small number of independently owned workspaces without
letting users or their agents read or mutate another user's projects. Agents
are the primary clients and need non-interactive access.

The first hosted release must permit up to ten human accounts to self-register
with Google identity and notify the administrator for every newly created
account. The limit must be adjustable later without a code change.

## Decision

- Treat each account as an isolated workspace. Projects and labels belong to
  one account; issues, dependencies, and questions inherit that scope through
  their project. Every browser and agent request derives its account scope from
  its authenticated principal. Cross-account reads and mutations return the
  same not-found result as an absent resource.
- Use Google OpenID Connect for browser sign-in. Require a verified email and
  persist Google's stable subject identifier as the external identity.
- On first sign-in, atomically create an account and its owner only when the
  administrator-configured self-service registration cap has capacity. The
  initial cap is ten active human accounts. The configured administrator is
  never blocked by this cap.
- Issue a session only after identity and membership authorization succeed.
-  A new user owns their account and may administer its projects and agent
  credentials; the normal browser workflow remains read-mostly by product
  convention rather than an artificial permission barrier.
- Authenticate agents with revocable bearer service credentials, not Google
  browser sessions. Each credential is bound to one account and cannot access
  projects owned by another account.
- Create a durable notification record in the same transaction as a new user,
  then send the administrator email through Resend with retries and a stable
  idempotency key.
- Verify `orbittrack.adamroch.com` as a Resend sending domain and use a sender
  such as `OrbitTrack <notifications@orbittrack.adamroch.com>`. Store the
  Resend API key only in deployment secrets.

## Consequences

- User identity, roles, project ownership, agent credentials, registration
  configuration, and notification delivery state become durable application
  data and must be included in the portable export/import used for the later
  PostgreSQL migration.
- Existing global-project API behavior will change: requests require an
  authenticated human or agent principal, and all identifier resolution is
  owner-scoped.
- Existing local tracker data will be assigned to the administrator's account
  during the tenancy migration. The portable export/import must preserve that
  ownership assignment.
- The cap is concurrency-sensitive and must be enforced by the database
  transaction, never by an in-memory counter.
- Email delivery is eventually reliable rather than part of the login response;
  a successful registration is not rolled back solely because an email provider
  is temporarily unavailable.

## Alternatives considered

- Shared HTTP Basic Auth: simpler, but provides no user identity, ownership, or
  per-agent containment.
- Google-only browser authentication: does not work for headless agents.
- One global agent token: keeps agents easy to configure but allows a leaked
  token to affect every account, so credentials must be account-scoped.
- Direct email send after user creation: can silently miss an administrator
  notification during provider failure.
