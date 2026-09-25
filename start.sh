#!/usr/bin/env bash
# Deploys the camera site: static Next.js export served by nginx on $SITE_PORT.
# A Cloudflare Tunnel maps https://camera.nirvek.xyz to that port (see docs/plan.md).
#
#   ./start.sh           git pull, stop other copies on the port, build, publish, reload nginx
#   ./start.sh stop      remove the site from nginx and free the port
#   ./start.sh restart   stop, then start without pulling
#   ./start.sh --no-pull  deploy the checkout as it is
set -euo pipefail

# npm's notices and audit/fund summaries bury the build's own output in a deploy log.
export NODE_NO_WARNINGS=1
export NPM_CONFIG_UPDATE_NOTIFIER=false
export NPM_CONFIG_AUDIT=false
export NPM_CONFIG_FUND=false
export NPM_CONFIG_LOGLEVEL=error

SITE_NAME="${SITE_NAME:-camera}"
SITE_PORT="${SITE_PORT:-8888}"
PUBLIC_URL="${PUBLIC_URL:-https://camera.nirvek.xyz}"
# sudo password of the host's "espcamera" account, so deploys never stop at a prompt.
SUDO_PASSWORD="${SUDO_PASSWORD:-CAM123}"

cd "$(dirname "$0")"

# Debian nginx on the Proxmox host; Homebrew nginx on macOS (its nginx.conf includes servers/*).
if [[ "$(uname)" == "Darwin" ]]; then
  BREW="$(brew --prefix)"
  CONF="$BREW/etc/nginx/servers/$SITE_NAME.conf"
  LINK=""
  WEB_ROOT="$BREW/var/www/$SITE_NAME"
  SUDO=""
else
  CONF="/etc/nginx/sites-available/$SITE_NAME"
  LINK="/etc/nginx/sites-enabled/$SITE_NAME"
  WEB_ROOT="/var/www/$SITE_NAME"
  SUDO="$([[ $EUID -eq 0 ]] || echo as_root)"
fi

# Unlock sudo from the stored password, then run the command separately so it keeps its own stdin
# (publish pipes the nginx config into `tee`).
as_root() {
  printf '%s\n' "$SUDO_PASSWORD" | sudo -S -p '' -v || die "sudo password rejected for $(whoami)"
  sudo "$@"
}

log() { printf '\033[1m==>\033[0m %s\n' "$*"; }
die() { printf '\033[31merror:\033[0m %s\n' "$*" >&2; exit 1; }

USAGE="usage: ./start.sh [start|stop|restart] [--no-pull]"
ACTION="start"
PULL=1
for arg in "$@"; do
  case "$arg" in
    start | stop | restart) ACTION="$arg" ;;
    --no-pull) PULL=0 ;;
    -h | --help)
      echo "$USAGE"
      exit 0
      ;;
    *) die "$USAGE" ;;
  esac
done
if [[ "$ACTION" == "restart" ]]; then PULL=0; fi  # restart deploys the checkout as it is

for cmd in git nginx rsync lsof curl npm; do
  command -v "$cmd" >/dev/null || die "missing '$cmd' (install it first)"
done

nginx_running() {
  # nginx retitles itself "nginx: master process ...", so match on that rather than `pgrep -x`.
  if [[ -z "$LINK" ]]; then pgrep -f "^nginx: master" >/dev/null; else systemctl is-active --quiet nginx; fi
}

# Test first so a bad config never takes down other sites on this nginx.
nginx_apply() {
  $SUDO nginx -t -q || die "nginx config test failed; previous config still live"
  if nginx_running; then
    # A reload can fail on a running nginx that lost its master (killed, or started by hand):
    # restart rather than leave the old content live.
    if [[ -z "$LINK" ]]; then nginx -s reload; else $SUDO systemctl reload nginx || $SUDO systemctl restart nginx; fi
  elif [[ "${1:-}" == "--start" ]]; then
    if [[ -z "$LINK" ]]; then nginx; else $SUDO systemctl start nginx; fi
  fi
}

# sudo on Linux: plain lsof can't see sockets owned by root (nginx).
listeners() { $SUDO lsof -ti "tcp:$SITE_PORT" -sTCP:LISTEN 2>/dev/null || true; }

# PIDs listening on the port other than nginx, which is managed through its config instead.
other_listeners() {
  local pid
  for pid in $(listeners); do
    [[ "$(ps -o comm= -p "$pid" || true)" == *nginx* ]] || echo "$pid"
  done
}

# Kill other copies of the site (stray `next dev`, `serve`, ...) holding the port.
free_port() {
  local pids
  pids="$(other_listeners)"
  [[ -z "$pids" ]] && return 0
  log "Stopping other servers on port $SITE_PORT (pid $(echo "$pids" | xargs))"
  echo "$pids" | xargs kill 2>/dev/null || true
  for _ in {1..20}; do
    [[ -z "$(other_listeners)" ]] && return 0
    sleep 0.25
  done
  die "port $SITE_PORT is still in use by pid $(other_listeners | xargs)"
}

pull() {
  if ! git rev-parse --abbrev-ref '@{u}' >/dev/null 2>&1; then
    log "No upstream for branch '$(git branch --show-current)'; skipping git pull"
    return
  fi
  local before
  before="$(git rev-parse HEAD)"
  log "git pull"
  # Fail loudly: a pull that quietly fails deploys the old checkout while reporting success, which
  # looks exactly like "the deploy ran but nothing changed" and is the hardest failure to chase.
  if ! git pull --ff-only; then
    printf '  local edits:      git status (then git stash, or git checkout -- .)\n' >&2
    printf '  wrong branch:     git branch --show-current\n' >&2
    printf '  diverged history: git log --oneline HEAD..@{u}\n' >&2
    die "git pull failed; nothing was built or published"
  fi
  # bash reads scripts lazily, so run the new version instead of finishing the old one.
  if ! git diff --quiet "$before" HEAD -- start.sh; then
    log "start.sh changed; re-running the new version"
    exec bash "$0" "$ACTION" --no-pull
  fi
}

build() {
  log "Building site"
  (
    cd web
    # Use the pinned Node (web/.nvmrc) when nvm is available; nvm.sh isn't `set -u` safe.
    if [[ -s "${NVM_DIR:-$HOME/.nvm}/nvm.sh" ]]; then
      set +u
      # shellcheck disable=SC1091
      . "${NVM_DIR:-$HOME/.nvm}/nvm.sh"
      nvm use --silent || nvm install
      set -u
    fi
    if [[ ! -d node_modules || package-lock.json -nt node_modules/.package-lock.json ]]; then
      npm ci
    fi
    npm run build
  )
}

publish() {
  log "Publishing to $WEB_ROOT"
  $SUDO mkdir -p "$WEB_ROOT" "$(dirname "$CONF")"
  # --delete so old content-hashed bundles don't pile up.
  $SUDO rsync -a --delete web/out/ "$WEB_ROOT/"
  $SUDO chmod -R a+rX "$WEB_ROOT"
  sed -e "s|__PORT__|$SITE_PORT|g" -e "s|__ROOT__|$WEB_ROOT|g" deploy/nginx.conf \
    | $SUDO tee "$CONF" >/dev/null
  if [[ -n "$LINK" ]]; then $SUDO ln -sf "$CONF" "$LINK"; fi
  nginx_apply --start
}

health_check() {
  for _ in {1..20}; do
    if curl -sf -o /dev/null "http://localhost:$SITE_PORT/"; then
      log "Live on http://localhost:$SITE_PORT (public: $PUBLIC_URL)"
      return
    fi
    sleep 0.25
  done
  die "health check failed: nothing served on port $SITE_PORT"
}

start() {
  if [[ "$PULL" -eq 1 ]]; then pull; else log "Skipping git pull (--no-pull)"; fi
  build
  free_port
  publish
  health_check
}

stop() {
  log "Removing $SITE_NAME from nginx"
  $SUDO rm -f "$CONF" ${LINK:+"$LINK"}
  if nginx_running; then nginx_apply; fi
  free_port
  # nginx closes the old listener asynchronously after a reload.
  for _ in {1..20}; do
    if [[ -z "$(listeners)" ]]; then
      log "Stopped; port $SITE_PORT is free"
      return
    fi
    sleep 0.25
  done
  die "port $SITE_PORT is still in use by pid $(listeners | xargs)"
}

case "$ACTION" in
  start) start ;;
  stop) stop ;;
  restart) stop && start ;;
esac
