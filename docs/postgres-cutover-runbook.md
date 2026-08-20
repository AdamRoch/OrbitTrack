# PostgreSQL cutover runbook

This runbook prepares the transfer of OrbitTrack's SQLite state into the later
PostgreSQL implementation. It does **not** make SQLite speak PostgreSQL. Do not
perform a production cutover until the PostgreSQL persistence ticket is complete.

## Safety rules

- Keep OrbitTrack in maintenance mode while making the final export. Do not let
  users or agents write tickets during the export and verification window.
- Store artifacts outside the repository and outside `data/`. They contain user
  emails and ticket content, even though they contain no usable bearer tokens.
- The import command refuses to overwrite an existing database file. This is
  intentional. A retry gets a new empty target, never a hopeful overwrite.
- Imported agent-token records are metadata only. Their original token hashes
  are excluded, so every agent needs a newly issued credential after cutover.

## 1. Preserve the rollback point

Stop writes, then make a retained SQLite backup using SQLite's consistent
snapshot mechanism:

```bash
mkdir -p ../orbittrack-cutover-evidence
npm run state:export -- --source data/tracker.db --out ../orbittrack-cutover-evidence/pre-cutover.json
```

Record the artifact's printed checksum and table counts. Keep this JSON file;
it is the source-of-truth rollback evidence for the migration.

## 2. Rehearse the artifact locally

Import into a brand-new local file, then compare it back to the source:

```bash
npm run state:import -- --source ../orbittrack-cutover-evidence/pre-cutover.json --destination ../orbittrack-cutover-evidence/rehearsal.db
npm run state:verify -- --source data/tracker.db --destination ../orbittrack-cutover-evidence/rehearsal.db --out ../orbittrack-cutover-evidence/rehearsal-verification.json
```

Both commands must exit successfully. Retain `rehearsal-verification.json` with
the export. Any mismatch is a stop condition, not something to hand-wave away.

## 3. PostgreSQL cutover, once supported

The PostgreSQL implementation must import this same versioned artifact and
produce the same canonical checksum. Before switching Railway traffic:

1. Put the hosted app into maintenance mode and stop agent writes.
2. Create a fresh final artifact with `state:export`.
3. Import it into an empty PostgreSQL database using the PostgreSQL importer.
4. Run the PostgreSQL verifier and retain its counts and checksum next to the
   final artifact.
5. Start the new service, sign in as the administrator, inspect each workspace,
   and issue replacement agent credentials.
6. Only then point `orbittrack.adamroch.com` at the new Railway service.

## Rollback

If import or verification fails, do not switch traffic. Keep the existing
SQLite-backed service running from its retained source database. If traffic was
already switched and a post-switch check fails, restore the previous Railway
service and domain route, then investigate from the retained artifact and
verification evidence. Never overwrite the original SQLite database during
investigation.
