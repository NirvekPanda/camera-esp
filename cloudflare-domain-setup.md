Deploying a Next.js site: static export → nginx → Cloudflare Tunnel, driven by one start script

How it fits together

Browser → https://<sub>.<domain>  (Cloudflare edge handles HTTPS)
        → Cloudflare Tunnel (cloudflared daemon on the host, outbound connection only)
        → http://<host-LAN-IP>:<SITE_PORT>   (plain HTTP, nginx)
        → nginx serves static files from /var/www/<site-name>
          and sends /api/* to http://127.0.0.1:<API_PORT>/ (optional backend)
- Next.js does not run as a server. It builds to static files (output: "export"), and nginx serves them. No Node process runs in production.
- Cloudflare handles HTTPS. nginx only listens on plain HTTP on a high port. No certificates live on the host, and no router ports need opening for the site.
- One site = one hostname = one port = one web root = one nginx server block. A second site gets a new port (10000, 10001, …), a new /var/www/<name>, and a new tunnel hostname.

1. Next.js changes (in the app's next.config.ts)

const nextConfig = {
  output: "export",     // `next build` writes a static site to ./out
  trailingSlash: true,  // emits /page/index.html so nginx needs no rewrite rules
};
- The app can't use API route handlers, server actions, middleware or runtime SSR. Anything dynamic runs in the browser or calls a separate backend through /api/.
- In package.json, "build": "next build". If code has to be generated first, put it in "prebuild", which runs automatically before build.

2. nginx server block (kept in the repo, e.g. nginx-host.conf.example in the app folder)

The start script copies it to /etc/nginx/sites-available/<site-name> and symlinks it into /etc/nginx/sites-enabled/.
server {
    listen 10000 default_server;          # <-- SITE_PORT: must match the Cloudflare tunnel target
    listen [::]:10000 default_server;     # only ONE enabled block may be default_server per port
    server_name _;
    root /var/www/<site-name>;            # <-- where the start script rsyncs ./out
    index index.html;
    absolute_redirect off;                # stops redirects leaking :10000 to the public URL
    real_ip_header X-Forwarded-For;
    gzip on;
    gzip_types text/css application/j image/svg+xml;
    gzip_min_length 1024;

    location /api/ {                      # optional: backend reverse proxy
        proxy_pass http://127.0.0.1:9ailing slash strips /api
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $r
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-
    }
    location /_next/static/ {        e forever
        add_header Cache-Control "public, max-age=31536000, immutable" always;
        try_files $uri =404;
    }                                                                                  location / {                     date
        add_header Cache-Control "no-cache" always;                                        try_files $uri $uri/ =404;
    }                                                                                  error_page 404 /404.html;
    location = /404.html { internal; add_header Cache-Control "no-cache" always; } }
Optional: this repo also adds a map $http_origin $cors_origin {...} allowlist plus Access-Control-Allow-Origin $cors_oris nosniff and Referrer-Policysame-origin headers.                                                                                 
3. The start script (start.sh at the repo root, run on the host from inside a git clone)             
It uses set -euo pipefail, and each run does the following in order:                                  Flags: accepts --no-pull. Silences_AUDIT=false, NPM_CONFIG_FUND=false,NPM_CONFIG_UPDATE_NOTIFIER=false, NPM_CONFIG_LOGLEVEL=error and NODE_NO_WARNINGS=1. It cds to its  own directory.
2. Pull: runs git pull --ff-only. If that fails, it prints the likely causes (dirty tree, wrong       branch, diverged history) and exitstale code.
3. Re-exec if the script changed: it saves HEAD before and after the pull. If git diff --quiet BEFORE AFTER -- start.sh shows a change,  --no-pull "$@". Bash reads scriptslazily, so without this the old script would finish the run.
4. Backend (optional): rsyncs the bacth --delete (excluding caches, testsand the live data files), chowns it to the service user, runs systemctl restart <service>, then
   polls curl -sf http://localhost:<As, 1s apart.
5. Remove retired sites: deletes any old /etc/nginx/sites-{enabled,available}/<old-name> and its old
   /var/www/<old-name>. Two default_sail nginx -t, and that takes downevery site.
6. Build and publish each site: cd <a run build, then mkdir -p/var/www/<site-name>, then rsync -a --delete out/ /var/www/<site-name>/, then chmod -R a+rX on it.
   Use rsync --delete, not cp: cp leand piles up old_next/static/<buildId> folders.
7. Install the nginx config: if /etc/ts, copy the repo's conf there onevery run (git is the source of truth), then ln -sf it into sites-enabled.
8. Test, then reload: run nginx -t. Itest FAILED, previous config stilllive" and exit 1. If it passes and nginx is active, systemctl reload nginx, falling back to
   restart.
9. Health check: runs curl -sf http://localhost:<SITE_PORT>/ for each site port and prints OK or
   WARNING.

The script calls sudo through a run_ss it a password from an env var (echo"$SUDO_PASS" | sudo -S -p '' "$@"). In the new repo, use passwordless sudo for the deploy user, or read SUDO_PASS from the environment wcode the password in the script.

4. Where ports are set (keep all of t

┌───────────────┬──────────────────────────────────────────────────────┐
│     What      │                                     Where                                      │
├───────────────┼──────────────────────────────────────────────────────┤
│ Site port     │ nginx listen, the Cloudflare public hostname's service URL, and the start      │
│ (e.g. 10000)  │ script's health-che                                  │
├───────────────┼────────────────────────────────────────────────────────────────────────────────┤
│ API port      │ nginx proxy_pass unystemd unit / env var             │
│ (e.g. 9999)   │ (MESSAGE_SERVER_PORT here, default 9999), and the start script's API health    │
│               │ check                                                │
├───────────────┼────────────────────────────────────────────────────────────────────────────────┤
│ Web root      │ nginx root, and theet                                │
└───────────────┴────────────────────────────────────────────────────────────────────────────────┘

5. Cloudflare setup (one-time, in the dashboard)

1. The domain has to be on Cloudflare, using Cloudflare's nameservers.
2. On the host, install cloudflared.https://pkg.cloudflare.com/cloudflare-main.gpg into /usr/share/keyrings/, and the source deb
   [signed-by=...] https://pkg.cloudfname> main. Then apt-get installcloudflared. If apt fails, install the .deb from GitHub releases instead
   (cloudflared-linux-amd64.deb).
3. In Zero Trust, go to Networks → Tunnels → Create a tunnel (Cloudflared connector) and name it.
   Copy the token from the install coe host run:
   sudo cloudflared service install <TOKEN> && sudo systemctl enable --now cloudflared
   This runs cloudflared as its own srom nginx and the start script. Thestart script never touches it.
4. In the tunnel, open Public Hostnamdomain <domain>, service type HTTP,URL <host-LAN-IP>:<SITE_PORT> (or localhost:<SITE_PORT> if cloudflared runs on the same machine as
   nginx). Cloudflare creates the DNS
5. For another site on the same host, add another public hostname in the same tunnel pointing at the
   next port. A new tunnel isn't need
6. Once a hostname is mapped to a port, you can point it at a new app just by changing what nginx
   serves on that port (the web root hboard doesn't need to change.

Watch out for mixed content: the publrowser blocks any calls it makes to aplain http://IP:port API. Send them through nginx's /api/ on the same origin, or give the API its own
tunnel hostname.

6. First-time host setup, then routin

- Once: apt install nginx rsync git crepo, install cloudflared and thetunnel (step 5), and create the backend's systemd unit and service user if there is a backend.
- Every deploy: ./start.sh on the hos to redeploy the current checkout.
