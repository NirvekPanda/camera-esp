#!/usr/bin/env bash
# Deploys the camera site: static Next.js export served by nginx on $SITE_PORT.
# A Cloudflare Tunnel maps https://camera.nirvek.xyz to that port (see docs/plan.md).
#
#   ./start.sh           git pull, stop other copies on the port, build, publish, reload nginx
#   ./start.sh stop      remove the site from nginx and free the port
#   ./start.sh restart   stop, then start without pulling
#   ./start.sh --no-pull  deploy the checkout as it is
set -euo pipefail

# npm's own notices bury the build's output in a deploy log. Warnings and the audit stay: a peer
# range that blocks a dependency has to be recorded (docs/plan.md, Toolchain), and a deploy is
# exactly when a new advisory is worth seeing.
export NPM_CONFIG_UPDATE_NOTIFIER=false
export NPM_CONFIG_FUND=false

# nginx lives in /usr/sbin, which Debian leaves off a non-root user's PATH: without this the
# deploy stops at "missing 'nginx'" on a host where nginx is installed and running.
export PATH="$PATH:/usr/sbin:/sbin"

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
SAW_ACTION=0
for arg in "$@"; do
  case "$arg" in
    # Two actions is a typo, not a choice: "start stop" must never quietly stop a live site.
    start | stop | restart)
      [[ "$SAW_ACTION" -eq 0 ]] || die "$USAGE"
      ACTION="$arg"
      SAW_ACTION=1
      ;;
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
    if [[ -z "$LINK" ]]; then
      nginx -s reload
    elif ! $SUDO systemctl reload nginx; then
      # A reload can fail on a running nginx whose master systemd lost track of. Restarting only
      # when publishing: a stop that bounced nginx would drop the host's other sites for nothing.
      [[ "${1:-}" == "--start" ]] || die "nginx reload failed; $SITE_NAME is still in the config"
      $SUDO systemctl restart nginx
    fi
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
    # git's own stderr names the cause above; these are the three that need a command to diagnose.
    printf '\033[31merror:\033[0m %s\n' "git pull failed; nothing was built or published" >&2
    printf '  local edits:      git status (then git stash, or git checkout -- .)\n' >&2
    printf '  wrong branch:     git branch --show-current\n' >&2
    printf '  diverged history: git log --oneline HEAD..@{u}\n' >&2
    exit 1
  fi
  # bash reads scripts lazily, so run the new version instead of finishing the old one.
  if ! git diff --quiet "$before" HEAD -- start.sh; then
    log "start.sh changed; re-running the new version"
    # ./start.sh, not "$0": the cd above already moved to the script's directory, so a relative
    # "$0" like projects/camera-esp/start.sh no longer resolves (exit 127, mid-deploy).
    exec ./start.sh start --no-pull
  fi
}

# Under `sudo ./start.sh`, $HOME is root's and nvm sits in the invoking user's home instead.
find_nvm_dir() {
  if [[ -n "${NVM_DIR:-}" ]]; then
    printf '%s\n' "$NVM_DIR"
  elif [[ ! -s "$HOME/.nvm/nvm.sh" && -n "${SUDO_USER:-}" ]]; then
    local home
    home="$(getent passwd "$SUDO_USER" 2>/dev/null | cut -d: -f6 || true)"
    printf '%s\n' "${home:-$HOME}/.nvm"
  else
    printf '%s\n' "$HOME/.nvm"
  fi
}

build() {
  # npm run as root in someone else's checkout leaves root-owned node_modules and .next behind, and
  # the owner's next deploy then fails on EACCES with nothing to say why.
  local owner
  owner="$(stat -c %U . 2>/dev/null || stat -f %Su .)"
  if [[ $EUID -eq 0 && "$owner" != "root" ]]; then
    die "this checkout belongs to $owner: run ./start.sh as $owner (sudo steps use its password), not as root"
  fi
  log "Building site"
  (
    cd web
    # Use the pinned Node (web/.nvmrc) when nvm is available; nvm.sh isn't `set -u` safe.
    local nvm_dir
    nvm_dir="$(find_nvm_dir)"
    if [[ -s "$nvm_dir/nvm.sh" ]]; then
      set +u
      # shellcheck disable=SC1091
      . "$nvm_dir/nvm.sh"
      nvm use --silent || nvm install
      set -u
    fi
    # Without nvm (e.g. deploying as a user who doesn't have it) npm falls back to whatever node is
    # on PATH and `npm ci` dies on engine-strict with a message about the lockfile. Say which node.
    local want have
    want="$(cat .nvmrc)"
    have="$(node -v 2>/dev/null)" || die "no node on PATH; no nvm in $nvm_dir (set NVM_DIR, or install node $want)"
    if [[ "$(printf '%s\n%s\n' "$want" "${have#v}" | sort -V | head -1)" != "$want" ]]; then
      die "node $have is older than web/.nvmrc ($want); no nvm in $nvm_dir (set NVM_DIR, or put a newer node on PATH)"
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
  if [[ "$PULL" -eq 1 ]]; then
    pull
  elif [[ "$ACTION" == "restart" ]]; then
    log "Restart: deploying this checkout"
  else
    log "Skipping git pull (--no-pull)"
  fi
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
