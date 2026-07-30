# docker-up (alias: docker), docker-down — the Docker-based production stack

Goal: bring up the actual production build — the multi-stage root
`Dockerfile` (`node:22-alpine` runtime, `NODE_ENV=production`, client
bundle baked in) — running inside a container via the root
`docker-compose.yml`. This is a THIRD, independent way to run the app,
distinct from `web-up`'s Vite HMR dev server and from the installed
desktop Electron app.

This project already wraps the raw Docker commands as npm scripts:
`npm run docker:up` → `docker compose up -d --build`,
`npm run docker:down` → `docker compose down`. This devops command wraps
those in the audit/plan/execute/verify discipline and adds a live check
that the response is actually coming from the container — not a host
process (e.g. `web-up`'s dev server or a bare `npm start`) that happens to
be answering on the same port.

## Solution this covers

| Solution | Underlying unit | Notes |
|---|---|---|
| `docker` (docker-up / docker-down) | `agent-monitor` container, root `docker-compose.yml` | Bind-mounts the SAME `~/.claude/agent-dashboard` data dir as web/desktop — not a separate database |

## Shared audit (Phase 1 for both actions)

```bash
zsh <skill-base-dir>/scripts/docker-check.sh
```

Reports: `docker` CLI present, daemon reachable, compose v2 plugin
present, and whether the `agent-monitor` container is currently running
(and on which host port). Read-only, exits 0 always.

If `docker-cli` / `docker-daemon` / `compose-plugin` are not `ok`, stop and
report exactly what's missing (e.g. "start Docker Desktop"). Do not try to
install Docker itself — that's a GUI installer Sara runs manually.

## docker-up (alias: `docker`)

**Plan:** state this runs `docker compose up -d --build` from the root
`docker-compose.yml` — rebuilds the image from current source (server +
client bundle, baked in per the multi-stage `Dockerfile`) and starts/
recreates the `agent-monitor` container, bound to
`127.0.0.1:${DASHBOARD_PORT:-4820}` on the host, bind-mounting the same
`~/.claude/agent-dashboard` data dir and read-only `~/.claude` that
`web-up`/`npm start` use on the host — so hook data is shared, not
duplicated. Non-destructive, no gate needed: same rationale as
`web-up`/`web-down` (no installed app touched, and the data volume exists
either way — the container is cheap to rebuild/replace).

If the audit already shows `docker-running`, note it's already up (with
its port and URL, labeled **(built-docker)**) but still proceed —
`up -d --build` is idempotent: Compose only recreates the container if the
built image actually changed, and no data is lost either way since state
lives in the bind-mounted volume, not the container itself.

Port note: if `web-up`'s dev server already holds the conventional 4820 on
the host loopback, bind to a free port instead of failing. Check with
`lsof` (a real LISTEN-state check), not a raw TCP connect probe — connect
probes can race a process that's mid-restart (e.g. `node --watch`) and
misreport "free":

**Execute:**
```bash
cd <project-root>
PORT="${DASHBOARD_PORT:-4820}"
while lsof -nP -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; do
  PORT=$((PORT + 1))
done
DASHBOARD_PORT="$PORT" docker compose up -d --build
```

**Verify — prove it is REALLY running in Docker**, not just that
something answers on the port. This matters concretely on macOS: Docker
Desktop's port-forwarding proxy and an unrelated host process can BOTH
show as `LISTEN` on the identical `127.0.0.1:<port>` at once (observed
directly during this command's own development — a host `npm run dev`
process and the container's published port coexisted on :4820). A curl
against the published port can silently be answered by the wrong one, so
that check alone is not proof of origin:

```bash
# 1. A container exists and Docker reports it Up
docker ps --filter "name=agent-monitor" --format '{{.Names}}: {{.Status}}'

# 2. The published port answers at all (sanity check only — see caveat
#    above; do not treat this alone as proof it's the container)
curl -sf "http://127.0.0.1:${PORT}/api/health"

# 3. THE proof: ask the container to hit ITS OWN internal server, inside
#    its own network namespace via `docker exec` -- this cannot be
#    answered by a host process no matter what the host port is doing.
docker exec agent-monitor node -e \
  "fetch('http://127.0.0.1:4820/api/health').then(r=>r.json()).then(j=>{console.log(JSON.stringify(j));process.exit(j.status==='ok'?0:1)}).catch(()=>process.exit(1))"
```

All three must succeed before reporting success, and (3) is the one that
actually settles it. If (1) shows no container, or (3) fails/exits
non-zero, something is wrong even if (2) happened to return `ok` — say so
plainly rather than reporting success.

Report the full URL plainly in the reply, e.g. `http://127.0.0.1:${PORT}`
— don't just say "it's up," give the clickable address, and label it
**(built-docker)** so it's never confused with `web-up`'s Vite HMR dev
server URL, which is labeled **(hot-reload)** (see `web-lifecycle.md`).
This matters concretely here since both can be live on adjacent ports at
once.

## docker-down

**Plan:** stop and remove the `agent-monitor` container
(`docker compose down`). Cheaply reversible — `docker-up` rebuilds/starts
a fresh one, fast when the image layer cache is warm. No data loss: the
bind-mounted `~/.claude/agent-dashboard` directory is untouched
(`docker-compose.yml` declares no named volume for it, just a host bind
mount). No gate needed.

If the audit shows `docker-running` as "not running", report there's
nothing to stop and stop here.

**Execute:**
```bash
cd <project-root>
docker compose down
```

**Verify:** re-run the shared audit — `docker-running` reads "not
running". Confirm `docker ps --filter "name=agent-monitor"` returns no
rows.

## Notes

- All three ways to run this app (`web-up`'s Vite dev server, the desktop
  Electron app, and this Docker container) can share the same
  `~/.claude/agent-dashboard` database at once if run on different ports —
  the server's own `peersSharingDataDir()` check warns and routes hook
  ingestion to the lowest live port to avoid double-counting (see
  `server/index.js`).
- `docker-compose.full.yml` (dashboard + Prometheus + Grafana,
  `npm run docker:full:up`/`down`) is a separate, heavier stack — out of
  scope for this command. Add a `docker-full-up`/`docker-full-down`
  command later if that stack needs the same audit/plan/verify treatment.
