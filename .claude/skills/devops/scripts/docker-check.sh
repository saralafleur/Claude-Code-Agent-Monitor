#!/bin/zsh
# @file Read-only audit of the Docker-based production stack (root
# Dockerfile + docker-compose.yml) -- shared by the docker-up and
# docker-down commands. Prints one "KEY | STATUS | DETAIL" line per check;
# exits 0 always. Safe to run any time -- changes nothing.
# @author Son Nguyen <hoangson091104@gmail.com>

setopt null_glob

PROJECT_ROOT="$(cd "$(dirname "$0")/../../../.." && pwd)"
cd "$PROJECT_ROOT" || exit 0

line() { printf '%-24s | %-8s | %s\n' "$1" "$2" "$3"; }

# --- Docker CLI / daemon / compose v2 plugin ---
if command -v docker >/dev/null 2>&1; then
  line "docker-cli" "ok" "$(docker --version 2>/dev/null)"
else
  line "docker-cli" "MISSING" "install Docker Desktop (or Docker Engine) first"
fi

if docker info >/dev/null 2>&1; then
  line "docker-daemon" "ok" "daemon reachable"
else
  line "docker-daemon" "MISSING" "daemon not running -- start Docker Desktop"
fi

if docker compose version >/dev/null 2>&1; then
  line "compose-plugin" "ok" "$(docker compose version 2>/dev/null | head -1)"
else
  line "compose-plugin" "MISSING" "docker compose (v2 plugin) not found"
fi

# --- Container state (the `agent-monitor` service from the root
# --- docker-compose.yml, started via /devops docker-up) ---
STATUS="$(docker inspect -f '{{.State.Status}}' agent-monitor 2>/dev/null)"
if [ "$STATUS" = "running" ]; then
  PORT="$(docker inspect -f '{{range $p, $conf := .NetworkSettings.Ports}}{{range $conf}}{{.HostPort}}{{end}}{{end}}' agent-monitor 2>/dev/null)"
  line "docker-running" "info" "container agent-monitor up${PORT:+, port $PORT}"
elif [ -n "$STATUS" ]; then
  line "docker-running" "info" "container agent-monitor exists but $STATUS"
else
  line "docker-running" "info" "not running"
fi

exit 0
