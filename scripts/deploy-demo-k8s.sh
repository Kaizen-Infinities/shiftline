#!/usr/bin/env bash
# Deploy the Shiftline demo on a dedicated Debian 13 VM. Run from a repository clone.
set +x
set -Eeuo pipefail
umask 077

readonly NAMESPACE=shiftline-demo
readonly STATE_DIR=/etc/shiftline-demo
readonly DEFAULT_HOST=shiftline.kaizeninfinities.com
readonly DEMO_EMAIL=Demo@shiftline.com
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
readonly REPO_ROOT

HOST="$DEFAULT_HOST"
NODE_IP=""
TLS_CERT=""
TLS_KEY=""
TRUSTED_PROXY=""
INTEGRATION_ENV=""
RENDER_DIR=""
PASSWORD_FILE=""

usage() {
  cat <<'EOF'
Usage: sudo bash scripts/deploy-demo-k8s.sh [options]

Deploys on a dedicated Debian 13 virtual machine. Requires outbound internet
and a DNS name that your existing reverse proxy forwards to this VM over HTTPS.

Options:
  --host NAME             Public DNS name (default: shiftline.kaizeninfinities.com)
  --node-ip IPV4          Required private IPv4 address assigned to this Debian VM
  --tls-cert FILE         PEM certificate/full chain for NAME (requires --tls-key)
  --tls-key FILE          Matching unencrypted PEM private key
  --trusted-proxy IP      Exact IP address of Nginx Proxy Manager
  --integration-env FILE  Root-owned 0600 file with optional SMTP/ImageKit settings
  --password-file FILE    Root-owned 0600 file with initial demo password
  --render DIR            Write non-secret Kubernetes/nginx templates and exit
  --help                  Show this help

On first deployment, the demo password is read without echo from a terminal
unless --password-file is supplied. Reruns reuse the persisted password and
database state. The initial demo login is Demo@shiftline.com.
EOF
}

die() { printf 'Error: %s\n' "$*" >&2; exit 1; }
info() { printf '==> %s\n' "$*"; }
require_cmd() { command -v "$1" >/dev/null 2>&1 || die "Missing command: $1"; }

while (($#)); do
  case "$1" in
    --host|--node-ip|--tls-cert|--tls-key|--trusted-proxy|--integration-env|--password-file|--render)
      (($# >= 2)) || die "Missing value for $1"
      case "$1" in
        --host) HOST="$2";;
        --node-ip) NODE_IP="$2";;
        --tls-cert) TLS_CERT="$2";;
        --tls-key) TLS_KEY="$2";;
        --trusted-proxy) TRUSTED_PROXY="$2";;
        --integration-env) INTEGRATION_ENV="$2";;
        --password-file) PASSWORD_FILE="$2";;
        --render) RENDER_DIR="$2";;
      esac
      shift 2;;
    --help|-h) usage; exit 0;;
    *) die "Unknown option: $1";;
  esac
done

[[ "$HOST" =~ ^[a-zA-Z0-9]([a-zA-Z0-9.-]*[a-zA-Z0-9])?$ && ${#HOST} -le 253 ]] || die "--host must be a DNS name"
[[ "$HOST" == *.* ]] || die "--host must be a fully qualified DNS name"
[[ "$HOST" != *..* ]] || die "--host contains an empty DNS label"
for label in ${HOST//./ }; do
  [[ "$label" =~ ^[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?$ ]] || die "Invalid DNS label: $label"
  ((${#label} <= 63)) || die "DNS label too long: $label"
done
if [[ -n "$TLS_CERT" || -n "$TLS_KEY" ]]; then
  [[ -n "$TLS_CERT" && -n "$TLS_KEY" ]] || die "Supply both --tls-cert and --tls-key"
fi
validate_proxy() {
  [[ -n "$TRUSTED_PROXY" ]] || return 0
  python3 - "$TRUSTED_PROXY" <<'PY' || die "--trusted-proxy must be one exact IP address"
import ipaddress, sys
ip = ipaddress.ip_address(sys.argv[1])
assert not ip.is_unspecified and not ip.is_multicast
PY
}

render_nginx() {
  local out="$1"
  mkdir -p "$out"
  cat >"$out/default.conf" <<EOF
# OWNER tokens include the permission catalogue and can exceed nginx's 8 KiB default.
large_client_header_buffers 4 32k;
map \$http_upgrade \$connection_upgrade {
  default upgrade;
  '' close;
}
upstream shiftline_backend {
  server shiftline-api:5000;
  keepalive 32;
}
server {
  listen 80;
  server_name $HOST;
  return 308 https://\$host\$request_uri;
}
server {
  listen 443 ssl;
  http2 on;
  server_name $HOST;
  ssl_certificate /etc/nginx/tls/tls.crt;
  ssl_certificate_key /etc/nginx/tls/tls.key;
  ssl_protocols TLSv1.2 TLSv1.3;
  ssl_session_tickets off;
  ssl_session_cache shared:TLS:10m;
  ssl_session_timeout 1d;
  client_max_body_size 20m;
  # Compress public static assets; do not compress authenticated JSON responses.
  gzip on;
  gzip_vary on;
  gzip_proxied any;
  gzip_comp_level 5;
  gzip_min_length 1024;
  gzip_types text/css application/javascript application/wasm image/svg+xml font/ttf;
  open_file_cache max=1000 inactive=30s;
  open_file_cache_valid 30s;
  root /usr/share/nginx/html;
  index index.html;
  add_header X-Content-Type-Options nosniff always;
  add_header X-Frame-Options DENY always;
  add_header Referrer-Policy strict-origin-when-cross-origin always;

  location /api/ {
    proxy_pass http://shiftline_backend;
    proxy_http_version 1.1;
    proxy_set_header Connection "";
    proxy_set_header Host \$host;
    proxy_set_header X-Real-IP \$remote_addr;
    proxy_set_header X-Forwarded-For \$remote_addr;
    proxy_set_header X-Forwarded-Proto https;
    proxy_read_timeout 90s;
    proxy_hide_header Cache-Control;
    add_header Cache-Control "no-store" always;
  }
  location /socket.io/ {
    proxy_pass http://shiftline_backend;
    proxy_http_version 1.1;
    proxy_set_header Upgrade \$http_upgrade;
    proxy_set_header Connection \$connection_upgrade;
    proxy_set_header Host \$host;
    proxy_set_header X-Real-IP \$remote_addr;
    proxy_set_header X-Forwarded-For \$remote_addr;
    proxy_set_header X-Forwarded-Proto https;
    proxy_read_timeout 3600s;
    add_header Cache-Control "no-store" always;
  }
  location /uploads/ {
    proxy_pass http://shiftline_backend;
    proxy_set_header Host \$host;
    proxy_set_header X-Forwarded-Proto https;
  }
  location ~ ^/(health|ready)$ {
    proxy_pass http://shiftline_backend;
    proxy_http_version 1.1;
    proxy_set_header Connection "";
    add_header Cache-Control "no-store" always;
  }
  location /assets/ {
    try_files \$uri =404;
    add_header Cache-Control "public, max-age=31536000, immutable";
  }
  location / {
    add_header Cache-Control "no-cache";
    try_files \$uri \$uri/ /index.html;
  }
}
EOF
  if [[ -n "$TRUSTED_PROXY" ]]; then
    # NPM must be the only sender from this address. Otherwise ignore incoming XFF.
    python3 - "$out/default.conf" "$TRUSTED_PROXY" <<'PY'
from pathlib import Path
import sys
p = Path(sys.argv[1])
s = p.read_text()
needle = "  ssl_certificate /etc/nginx/tls/tls.crt;"
s = s.replace(needle, f"  set_real_ip_from {sys.argv[2]};\n  real_ip_header X-Forwarded-For;\n  real_ip_recursive on;\n{needle}", 1)
p.write_text(s)
PY
  fi
}

render_manifests() {
  local out="$1" api_image="$2" web_image="$3" init_name="$4"
  mkdir -p "$out"
  cat >"$out/resources.yaml" <<EOF
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: shiftline-postgres
  namespace: $NAMESPACE
spec:
  accessModes: [ReadWriteOnce]
  storageClassName: local-path
  resources:
    requests:
      storage: 20Gi
---
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: shiftline-files
  namespace: $NAMESPACE
spec:
  accessModes: [ReadWriteOnce]
  storageClassName: local-path
  resources:
    requests:
      storage: 10Gi
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: shiftline-postgres
  namespace: $NAMESPACE
spec:
  replicas: 1
  strategy:
    type: Recreate
  selector:
    matchLabels: {app: shiftline-postgres}
  template:
    metadata:
      labels: {app: shiftline-postgres}
    spec:
      automountServiceAccountToken: false
      containers:
        - name: postgres
          image: postgres:16-alpine
          imagePullPolicy: IfNotPresent
          ports:
            - {name: postgres, containerPort: 5432}
          envFrom:
            - secretRef: {name: shiftline-postgres}
          env:
            - {name: POSTGRES_USER, value: shiftline_root}
            - {name: POSTGRES_DB, value: shiftline}
            - {name: PGDATA, value: /var/lib/postgresql/data/pgdata}
          volumeMounts:
            - {name: db, mountPath: /var/lib/postgresql/data}
            - {name: init, mountPath: /docker-entrypoint-initdb.d/10-roles.sh, subPath: 10-roles.sh, readOnly: true}
          readinessProbe:
            exec:
              command: [sh, -ec, 'pg_isready -h 127.0.0.1 -U shiftline_root -d shiftline']
            periodSeconds: 5
          resources:
            requests: {cpu: 100m, memory: 256Mi}
            limits: {memory: 2Gi}
      volumes:
        - name: db
          persistentVolumeClaim: {claimName: shiftline-postgres}
        - name: init
          configMap:
            name: shiftline-postgres-init
            defaultMode: 0755
---
apiVersion: v1
kind: Service
metadata:
  name: shiftline-postgres
  namespace: $NAMESPACE
spec:
  type: ClusterIP
  selector: {app: shiftline-postgres}
  ports:
    - {name: postgres, port: 5432, targetPort: 5432}
---
apiVersion: v1
kind: Service
metadata:
  name: shiftline-api
  namespace: $NAMESPACE
spec:
  type: ClusterIP
  selector: {app: shiftline-api}
  ports:
    - {name: http, port: 5000, targetPort: 5000}
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: shiftline-api
  namespace: $NAMESPACE
spec:
  replicas: 1
  strategy:
    type: Recreate
  selector:
    matchLabels: {app: shiftline-api}
  template:
    metadata:
      labels: {app: shiftline-api}
    spec:
      automountServiceAccountToken: false
      securityContext: {runAsUser: 10001, runAsGroup: 10001, fsGroup: 10001, fsGroupChangePolicy: OnRootMismatch}
      initContainers:
        - name: prepare-files
          image: busybox:1.36
          command: [sh, -ec, 'mkdir -p /data/archives /data/backups /data/exports /data/uploads && chown 10001:10001 /data /data/archives /data/backups /data/exports /data/uploads']
          securityContext: {runAsUser: 0}
          volumeMounts:
            - {name: files, mountPath: /data}
      containers:
        - name: api
          image: $api_image
          imagePullPolicy: Never
          envFrom:
            - secretRef: {name: shiftline-app}
          env:
            - {name: NODE_ENV, value: production}
            - {name: PORT, value: '5000'}
            - {name: EMBED_WORKER, value: 'false'}
            - {name: FRONTEND_URL, value: 'https://$HOST'}
            - {name: BACKEND_URL, value: 'https://$HOST'}
            - {name: COOKIE_SECURE, value: 'true'}
            - {name: REFRESH_COOKIE_SAMESITE, value: lax}
            - {name: ARCHIVE_DIR, value: /app/archives}
            - {name: BACKUP_DIR, value: /app/backups}
            - {name: EXPORT_DIR, value: /app/exports}
          ports:
            - {name: http, containerPort: 5000}
          volumeMounts:
            - {name: files, mountPath: /app/archives, subPath: archives}
            - {name: files, mountPath: /app/backups, subPath: backups}
            - {name: files, mountPath: /app/exports, subPath: exports}
            - {name: files, mountPath: /app/uploads, subPath: uploads}
            - {name: files, mountPath: /app/apps/api/uploads, subPath: uploads}
          readinessProbe:
            httpGet: {path: /ready, port: 5000}
            initialDelaySeconds: 5
            periodSeconds: 10
            timeoutSeconds: 5
          livenessProbe:
            httpGet: {path: /health, port: 5000}
            initialDelaySeconds: 30
            periodSeconds: 20
          resources:
            requests: {cpu: 100m, memory: 256Mi}
            limits: {memory: 2Gi}
      volumes:
        - name: files
          persistentVolumeClaim: {claimName: shiftline-files}
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: shiftline-worker
  namespace: $NAMESPACE
spec:
  replicas: 1
  strategy:
    type: Recreate
  selector:
    matchLabels: {app: shiftline-worker}
  template:
    metadata:
      labels: {app: shiftline-worker}
    spec:
      automountServiceAccountToken: false
      securityContext: {runAsUser: 10001, runAsGroup: 10001, fsGroup: 10001, fsGroupChangePolicy: OnRootMismatch}
      initContainers:
        - name: prepare-files
          image: busybox:1.36
          command: [sh, -ec, 'mkdir -p /data/archives /data/backups /data/exports /data/uploads && chown 10001:10001 /data /data/archives /data/backups /data/exports /data/uploads']
          securityContext: {runAsUser: 0}
          volumeMounts:
            - {name: files, mountPath: /data}
      containers:
        - name: worker
          image: $api_image
          imagePullPolicy: Never
          command: [node, apps/api/dist/worker.js]
          envFrom:
            - secretRef: {name: shiftline-app}
          env:
            - {name: NODE_ENV, value: production}
            - {name: FRONTEND_URL, value: 'https://$HOST'}
            - {name: BACKEND_URL, value: 'https://$HOST'}
            - {name: ARCHIVE_DIR, value: /app/archives}
            - {name: BACKUP_DIR, value: /app/backups}
            - {name: EXPORT_DIR, value: /app/exports}
          volumeMounts:
            - {name: files, mountPath: /app/archives, subPath: archives}
            - {name: files, mountPath: /app/backups, subPath: backups}
            - {name: files, mountPath: /app/exports, subPath: exports}
            - {name: files, mountPath: /app/uploads, subPath: uploads}
            - {name: files, mountPath: /app/apps/api/uploads, subPath: uploads}
          resources:
            requests: {cpu: 100m, memory: 256Mi}
            limits: {memory: 2Gi}
      volumes:
        - name: files
          persistentVolumeClaim: {claimName: shiftline-files}
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: shiftline-web
  namespace: $NAMESPACE
spec:
  replicas: 1
  strategy:
    type: Recreate
  selector:
    matchLabels: {app: shiftline-web}
  template:
    metadata:
      labels: {app: shiftline-web}
    spec:
      automountServiceAccountToken: false
      containers:
        - name: web
          image: $web_image
          imagePullPolicy: Never
          ports:
            - {name: http, containerPort: 80, hostPort: 80, hostIP: '$NODE_IP'}
            - {name: https, containerPort: 443, hostPort: 443, hostIP: '$NODE_IP'}
          volumeMounts:
            - {name: nginx, mountPath: /etc/nginx/conf.d/default.conf, subPath: default.conf, readOnly: true}
            - {name: tls, mountPath: /etc/nginx/tls, readOnly: true}
          readinessProbe:
            httpGet: {path: /, port: 443, scheme: HTTPS}
            periodSeconds: 10
          resources:
            requests: {cpu: 50m, memory: 64Mi}
            limits: {memory: 256Mi}
      volumes:
        - name: nginx
          configMap: {name: shiftline-nginx}
        - name: tls
          secret: {secretName: shiftline-tls}
EOF
  cat >"$out/init-job.yaml" <<EOF
apiVersion: batch/v1
kind: Job
metadata:
  name: $init_name
  namespace: $NAMESPACE
spec:
  backoffLimit: 1
  ttlSecondsAfterFinished: 86400
  template:
    spec:
      automountServiceAccountToken: false
      restartPolicy: Never
      securityContext: {runAsUser: 10001, runAsGroup: 10001}
      containers:
        - name: init
          image: $api_image
          imagePullPolicy: Never
          command: [sh, -ec]
          args:
            - |
              npx -w @shiftline/api prisma migrate deploy
              node apps/api/dist/demo-bootstrap.js
              psql "\$DATABASE_URL" -v ON_ERROR_STOP=1 <<'SQL'
              -- pg-boss issues CREATE SCHEMA IF NOT EXISTS even for its existing schema.
              GRANT CONNECT, CREATE ON DATABASE shiftline TO shiftline_app;
              GRANT USAGE ON SCHEMA public TO shiftline_app;
              GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO shiftline_app;
              GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA public TO shiftline_app;
              REVOKE UPDATE, DELETE, TRUNCATE ON audit_log FROM shiftline_app;
              ALTER DEFAULT PRIVILEGES FOR ROLE shiftline_migrator IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO shiftline_app;
              ALTER DEFAULT PRIVILEGES FOR ROLE shiftline_migrator IN SCHEMA public GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO shiftline_app;
              SQL
          envFrom:
            - secretRef: {name: shiftline-init}
          env:
            - {name: NODE_ENV, value: production}
            - {name: FRONTEND_URL, value: 'https://$HOST'}
            - {name: BACKEND_URL, value: 'https://$HOST'}
            - {name: DATABASE_URL, valueFrom: {secretKeyRef: {name: shiftline-init, key: MIGRATION_DATABASE_URL}}}
          resources:
            requests: {cpu: 100m, memory: 256Mi}
            limits: {memory: 2Gi}
EOF
}

render_init_sql() {
  local out="$1"
  cat >"$out/10-roles.sh" <<'EOF'
#!/bin/sh
set -eu
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" \
  -v migrator_password="$MIGRATOR_PASSWORD" -v app_password="$APP_DB_PASSWORD" <<'SQL'
SELECT format('CREATE ROLE shiftline_migrator LOGIN PASSWORD %L NOBYPASSRLS', :'migrator_password')
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'shiftline_migrator') \gexec
SELECT format('CREATE ROLE shiftline_app LOGIN PASSWORD %L NOBYPASSRLS', :'app_password')
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'shiftline_app') \gexec
ALTER DATABASE shiftline OWNER TO shiftline_migrator;
CREATE SCHEMA IF NOT EXISTS pgboss AUTHORIZATION shiftline_app;
GRANT CONNECT, CREATE ON DATABASE shiftline TO shiftline_app;
GRANT USAGE, CREATE ON SCHEMA public TO shiftline_migrator;
SQL
EOF
}

if [[ -n "$RENDER_DIR" ]]; then
  validate_proxy
  NODE_IP="${NODE_IP:-127.0.0.1}"
  render_nginx "$RENDER_DIR"
  render_manifests "$RENDER_DIR" localhost/shiftline-api:render localhost/shiftline-web:render shiftline-init-render
  render_init_sql "$RENDER_DIR"
  info "Rendered non-secret files in $RENDER_DIR"
  exit 0
fi

[[ $EUID -eq 0 ]] || die "Run as root on the Debian VM (sudo bash scripts/deploy-demo-k8s.sh)"
[[ -f /etc/os-release ]] || die "Cannot identify the operating system"
# shellcheck disable=SC1091
source /etc/os-release
[[ "${ID:-}" == debian && "${VERSION_ID:-}" == 13 ]] || die "This installer requires Debian 13 (found ${PRETTY_NAME:-unknown})"
if systemd-detect-virt --container --quiet; then die "Use a Debian VM, not a container"; fi
if [[ -d /etc/pve ]] || command -v pveversion >/dev/null 2>&1; then
  die "Run this on the Debian guest VM, not the Proxmox hypervisor"
fi
[[ -z "${K3S_URL:-}" ]] || die "This installer must run on a single-node k3s server, not an agent"
[[ "$REPO_ROOT" != /etc/shiftline-demo* ]] || die "Repository must remain separate from installer state"
if systemctl is-active --quiet k3s && [[ ! -e "$STATE_DIR/cluster.marker" ]]; then
  die "An unowned k3s service is already running; this script only reuses its own single-node cluster"
fi
if [[ -e "$STATE_DIR/cluster.marker" && ! -e "$STATE_DIR/core.env" ]]; then
  die "Saved deployment credentials are missing; restore core.env before proceeding"
fi
[[ -n "$NODE_IP" ]] || die "Provide --node-ip with the VM's private IPv4 address"
require_cmd apt-get
require_cmd systemctl
require_cmd flock
apt-get update
DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends ca-certificates curl openssl python3 iproute2 nftables
validate_proxy
python3 - "$NODE_IP" <<'PY' || die "--node-ip must be an RFC 1918 private IPv4 address"
import ipaddress, sys
ip = ipaddress.ip_address(sys.argv[1])
assert ip.version == 4 and any(ip in ipaddress.ip_network(c) for c in
    ('10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16'))
assert not any(ip in ipaddress.ip_network(c) for c in ('10.42.0.0/16', '10.43.0.0/16')), 'VM address overlaps K3s pod/service networks'
PY
require_cmd openssl
require_cmd python3
require_cmd ip
require_cmd nft
ip -o -4 addr show | grep -F " $NODE_IP/" >/dev/null || die "--node-ip is not assigned to a local network interface"

check_private_file() {
  local file="$1"
  [[ -f "$file" && ! -L "$file" ]] || die "Expected a regular, non-symlink file: $file"
  [[ "$(stat -c %u "$file")" == 0 ]] || die "File must be owned by root: $file"
  local mode
  mode="$(stat -c %a "$file")"
  (( (8#$mode & 077) == 0 )) || die "File must not be group/world readable: $file"
}

if [[ -n "$INTEGRATION_ENV" ]]; then check_private_file "$INTEGRATION_ENV"; fi
if [[ -n "$PASSWORD_FILE" ]]; then check_private_file "$PASSWORD_FILE"; fi
if [[ -n "$TLS_CERT" ]]; then
  [[ -r "$TLS_CERT" && -r "$TLS_KEY" ]] || die "TLS certificate/key unreadable"
  check_private_file "$TLS_KEY"
  openssl x509 -in "$TLS_CERT" -noout -checkend 86400 >/dev/null || die "TLS certificate expires within 24 hours"
  openssl x509 -in "$TLS_CERT" -noout -checkhost "$HOST" | grep -q 'does match' || die "TLS certificate does not cover $HOST"
  cert_pub="$(openssl x509 -in "$TLS_CERT" -pubkey -noout | openssl pkey -pubin -outform DER | openssl dgst -sha256)"
  key_pub="$(openssl pkey -in "$TLS_KEY" -pubout -outform DER | openssl dgst -sha256)"
  [[ "$cert_pub" == "$key_pub" ]] || die "TLS certificate and key do not match"
fi

mkdir -p "$STATE_DIR"
chmod 700 "$STATE_DIR"
exec 9>"$STATE_DIR/install.lock"
flock -n 9 || die "Another demo deployment is already running"
if [[ -n "$INTEGRATION_ENV" ]]; then
  if [[ "$(readlink -f "$INTEGRATION_ENV")" != "$STATE_DIR/integrations.env" ]]; then
    cp "$INTEGRATION_ENV" "$STATE_DIR/integrations.env"
    chmod 600 "$STATE_DIR/integrations.env"
  fi
fi
if [[ -f "$STATE_DIR/integrations.env" ]]; then
  INTEGRATION_ENV="$STATE_DIR/integrations.env"
  check_private_file "$INTEGRATION_ENV"
fi
if [[ -e "$STATE_DIR/core.env" ]]; then
  check_private_file "$STATE_DIR/core.env"
  [[ -z "$PASSWORD_FILE" ]] || die "Demo password already exists; omit --password-file on reruns"
else
  if [[ -n "$PASSWORD_FILE" ]]; then
    IFS= read -r demo_password < "$PASSWORD_FILE" || true
  else
    [[ -t 0 ]] || die "First install requires a terminal or --password-file"
    read -r -s -p "Password for $DEMO_EMAIL (12+ characters): " demo_password
    printf '\n'
    read -r -s -p "Confirm password: " confirm_password
    printf '\n'
    [[ "$demo_password" == "$confirm_password" ]] || die "Passwords do not match"
    unset confirm_password
  fi
  ((${#demo_password} >= 12)) || die "Demo password must be at least 12 characters"
  [[ "$demo_password" =~ [A-Z] && "$demo_password" =~ [a-z] && "$demo_password" =~ [0-9] ]] || die "Demo password needs upper and lower case letters plus a digit"
  password_bytes="$(LC_ALL=C; printf '%s' "$demo_password" | wc -c)"
  ((password_bytes <= 72)) || die "Demo password must be at most 72 UTF-8 bytes"
  [[ "$demo_password" != *$'\n'* && "$demo_password" != *$'\r'* ]] || die "Demo password must be one line"
  if [[ "$demo_password" == *\\* ]]; then die "Demo password cannot contain backslash (Kubernetes env-file parsing)"; fi
  postgres_password="$(openssl rand -hex 32)"
  migrator_password="$(openssl rand -hex 32)"
  app_password="$(openssl rand -hex 32)"
  admin_password="$(openssl rand -hex 32)"
  jwt_secret="$(openssl rand -hex 48)"
  encryption_key="$(openssl rand -hex 48)"
  webhook_secret="$(openssl rand -hex 32)"
  tmp_core="$(mktemp "$STATE_DIR/.core.XXXXXX")"
  chmod 600 "$tmp_core"
  {
    printf 'DEMO_EMAIL=%s\nDEMO_PASSWORD=%s\n' "$DEMO_EMAIL" "$demo_password"
    printf 'POSTGRES_PASSWORD=%s\nMIGRATOR_PASSWORD=%s\nAPP_DB_PASSWORD=%s\n' "$postgres_password" "$migrator_password" "$app_password"
    printf 'DATABASE_URL=postgresql://shiftline_app:%s@shiftline-postgres:5432/shiftline?connection_limit=10&pool_timeout=20\n' "$app_password"
    printf 'MIGRATION_DATABASE_URL=postgresql://shiftline_migrator:%s@shiftline-postgres:5432/shiftline\n' "$migrator_password"
    printf 'JWT_ACCESS_SECRET=%s\nDATA_ENCRYPTION_KEY=%s\n' "$jwt_secret" "$encryption_key"
    printf 'PLATFORM_GATEWAY_WEBHOOK_SECRET=%s\n' "$webhook_secret"
    printf 'ADMIN_EMAIL=platform@shiftline.local\nADMIN_USERNAME=platformadmin\nADMIN_PASSWORD=%s\n' "$admin_password"
  } >"$tmp_core"
  mv "$tmp_core" "$STATE_DIR/core.env"
  unset demo_password postgres_password migrator_password app_password admin_password jwt_secret encryption_key webhook_secret
fi

make_secrets() {
  local app_file="$STATE_DIR/app.env" db_file="$STATE_DIR/postgres.env" init_file="$STATE_DIR/init.env" key line
  grep -E '^(DATABASE_URL|JWT_ACCESS_SECRET|DATA_ENCRYPTION_KEY|PLATFORM_GATEWAY_WEBHOOK_SECRET|ADMIN_EMAIL|ADMIN_USERNAME|ADMIN_PASSWORD)=' "$STATE_DIR/core.env" >"$app_file"
  grep -E '^(DEMO_EMAIL|DEMO_PASSWORD|MIGRATION_DATABASE_URL|JWT_ACCESS_SECRET|DATA_ENCRYPTION_KEY|ADMIN_EMAIL|ADMIN_USERNAME|ADMIN_PASSWORD)=' "$STATE_DIR/core.env" >"$init_file"
  chmod 600 "$app_file" "$init_file"
  if [[ -n "$INTEGRATION_ENV" ]]; then
    while IFS= read -r line || [[ -n "$line" ]]; do
      [[ -z "$line" || "$line" == \#* ]] && continue
      [[ "$line" == *=* ]] || die "Invalid integration env line"
      key="${line%%=*}"
      case "$key" in
        SMTP_HOST|SMTP_PORT|SMTP_USER|SMTP_PASS|SMTP_FROM|SMTP_ENCRYPTION|FROM_NAME|IMAGEKIT_PUBLIC_KEY|IMAGEKIT_PRIVATE_KEY|IMAGEKIT_URL_ENDPOINT) ;;
        *) die "Unsupported integration key: $key";;
      esac
      [[ "$line" != *$'\r'* && "$line" != *$'\n'* ]] || die "Integration values must be one line"
      printf '%s\n' "$line" >>"$app_file"
    done <"$INTEGRATION_ENV"
  fi
  grep -E '^(POSTGRES_PASSWORD|MIGRATOR_PASSWORD|APP_DB_PASSWORD)=' "$STATE_DIR/core.env" >"$db_file"
  chmod 600 "$db_file"
}
make_secrets

if ! command -v docker >/dev/null 2>&1; then
  DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends docker.io docker-buildx
elif ! docker buildx version >/dev/null 2>&1; then
  die "Docker is installed without Buildx; install the Buildx package matching your Docker distribution"
fi
systemctl enable --now docker
require_cmd docker

# A dedicated early input chain denies management/overlay ports on any external
# interface. It never changes unrelated firewall policy or the web/SSH ports.
cat >"$STATE_DIR/k3s-guard.nft" <<'EOF'
table inet shiftline_demo_guard {
  chain input {
    type filter hook input priority -100; policy accept;
    iifname != { "lo", "cni0", "flannel.1" } tcp dport { 6443, 6444, 10250, 2379, 2380 } drop
    iifname != { "lo", "cni0", "flannel.1" } udp dport { 8472, 51820, 51821 } drop
  }
}
EOF
cat >/etc/systemd/system/shiftline-k3s-guard.service <<EOF
[Unit]
Description=Block external access to Shiftline single-node k3s control ports
Before=k3s.service

[Service]
Type=oneshot
RemainAfterExit=yes
ExecStartPre=-/usr/sbin/nft delete table inet shiftline_demo_guard
ExecStart=/usr/sbin/nft -f $STATE_DIR/k3s-guard.nft
ExecStop=/usr/sbin/nft delete table inet shiftline_demo_guard

[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable --now shiftline-k3s-guard.service

if systemctl is-active --quiet k3s; then
  info "Using the existing local k3s service"
else
  [[ ! -e /etc/rancher/k3s/k3s.yaml && ! -e /var/lib/rancher/k3s/server/node-token ]] || die "Found stopped or incomplete k3s state; inspect it before retrying"
  if [[ -e /etc/systemd/system/k3s.service || -e /etc/systemd/system/k3s-agent.service ]]; then
    die "Found an existing k3s service; start or inspect it before retrying"
  fi
  info "Installing single-node k3s with Traefik and ServiceLB disabled"
  curl -sfL https://get.k3s.io -o "$STATE_DIR/install-k3s.sh"
  chmod 700 "$STATE_DIR/install-k3s.sh"
  INSTALL_K3S_EXEC="server --disable=traefik --disable=servicelb --secrets-encryption --write-kubeconfig-mode=600 --node-ip=$NODE_IP --advertise-address=$NODE_IP --tls-san=$NODE_IP" sh "$STATE_DIR/install-k3s.sh"
  mkdir -p /etc/systemd/system/k3s.service.d
  cat >/etc/systemd/system/k3s.service.d/10-shiftline-guard.conf <<'EOF'
[Unit]
Requires=shiftline-k3s-guard.service
After=shiftline-k3s-guard.service
EOF
  systemctl daemon-reload
  touch "$STATE_DIR/cluster.marker"
  chmod 600 "$STATE_DIR/cluster.marker"
fi
require_cmd k3s
kubectl() { k3s kubectl --kubeconfig /etc/rancher/k3s/k3s.yaml "$@"; }
kubectl wait --for=condition=Ready node --all --timeout=180s
node_count="$(kubectl get nodes -o jsonpath='{.items[*].metadata.name}' | wc -w)"
[[ "$node_count" == 1 ]] || die "This installer only supports a single-node cluster"
kubectl get storageclass local-path >/dev/null || die "k3s local-path storage class is required"
[[ "$(kubectl get node -o jsonpath='{.items[0].status.addresses[?(@.type=="InternalIP")].address}')" == "$NODE_IP" ]] || die "Existing k3s node IP differs from --node-ip; refusing to use this cluster"
systemctl is-active --quiet shiftline-k3s-guard.service || die "Cluster firewall guard is not active"
nft list table inet shiftline_demo_guard >/dev/null || die "Cluster firewall rules are missing"
cluster_uid="$(kubectl get namespace kube-system -o jsonpath='{.metadata.uid}')"
if [[ -e "$STATE_DIR/cluster.uid" ]]; then
  [[ "$(cat "$STATE_DIR/cluster.uid")" == "$cluster_uid" ]] || die "k3s cluster identity changed; refusing to reuse saved database credentials"
else
  printf '%s\n' "$cluster_uid" >"$STATE_DIR/cluster.uid"
  chmod 600 "$STATE_DIR/cluster.uid"
fi
if kubectl -n kube-system get deploy traefik >/dev/null 2>&1; then
  die "Existing Traefik occupies 80/443; disable it manually before using this dedicated VM installer"
fi
if kubectl -n "$NAMESPACE" get deploy shiftline-postgres >/dev/null 2>&1 && [[ ! -e "$STATE_DIR/core.env" ]]; then
  die "Existing Shiftline deployment has no matching local state; refusing to replace its credentials"
fi
kubectl create namespace "$NAMESPACE" --dry-run=client -o yaml | kubectl apply --server-side -f - >/dev/null
namespace_uid="$(kubectl get namespace "$NAMESPACE" -o jsonpath='{.metadata.uid}')"
if [[ -e "$STATE_DIR/namespace.uid" ]]; then
  [[ "$(cat "$STATE_DIR/namespace.uid")" == "$namespace_uid" ]] || die "Shiftline namespace was replaced; refusing to create a new database with saved credentials"
else
  printf '%s\n' "$namespace_uid" >"$STATE_DIR/namespace.uid"
  chmod 600 "$STATE_DIR/namespace.uid"
fi

if [[ -n "$TLS_CERT" ]]; then
  [[ "$(readlink -f "$TLS_CERT")" == "$STATE_DIR/tls.crt" ]] || cp "$TLS_CERT" "$STATE_DIR/tls.crt"
  [[ "$(readlink -f "$TLS_KEY")" == "$STATE_DIR/tls.key" ]] || cp "$TLS_KEY" "$STATE_DIR/tls.key"
  printf 'custom\n' >"$STATE_DIR/tls.mode"
elif [[ -f "$STATE_DIR/tls.mode" ]] && [[ "$(cat "$STATE_DIR/tls.mode")" == custom ]]; then
  openssl x509 -in "$STATE_DIR/tls.crt" -noout -checkend 86400 >/dev/null || die "Renew the supplied TLS certificate with --tls-cert and --tls-key"
  openssl x509 -in "$STATE_DIR/tls.crt" -noout -checkhost "$HOST" | grep -q 'does match' || die "Supply a new certificate for the changed hostname"
else
  if [[ ! -e "$STATE_DIR/ca.crt" ]]; then
    openssl req -x509 -newkey rsa:3072 -sha256 -days 3650 -nodes \
      -subj '/CN=Shiftline demo local CA' \
      -addext 'basicConstraints=critical,CA:TRUE' \
      -keyout "$STATE_DIR/ca.key" -out "$STATE_DIR/ca.crt" >/dev/null 2>&1
  fi
  if [[ ! -e "$STATE_DIR/tls.crt" ]] || ! openssl x509 -in "$STATE_DIR/tls.crt" -noout -checkhost "$HOST" | grep -q 'does match' || ! openssl x509 -in "$STATE_DIR/tls.crt" -noout -checkend 2592000 >/dev/null; then
    openssl req -new -newkey rsa:3072 -nodes -subj "/CN=$HOST" \
      -keyout "$STATE_DIR/tls.key" -out "$STATE_DIR/tls.csr" >/dev/null 2>&1
    cat >"$STATE_DIR/tls.ext" <<EOF
basicConstraints=CA:FALSE
keyUsage=digitalSignature,keyEncipherment
extendedKeyUsage=serverAuth
subjectAltName=DNS:$HOST
EOF
    openssl x509 -req -in "$STATE_DIR/tls.csr" -CA "$STATE_DIR/ca.crt" -CAkey "$STATE_DIR/ca.key" \
      -CAcreateserial -out "$STATE_DIR/tls.crt" -days 825 -sha256 -extfile "$STATE_DIR/tls.ext" >/dev/null 2>&1
  fi
  printf 'generated\n' >"$STATE_DIR/tls.mode"
fi
chmod 600 "$STATE_DIR"/*.key "$STATE_DIR"/*.env

render_nginx "$STATE_DIR"
render_init_sql "$STATE_DIR"
kubectl -n "$NAMESPACE" create configmap shiftline-nginx --from-file="$STATE_DIR/default.conf" --dry-run=client -o yaml | kubectl apply --server-side -f - >/dev/null
kubectl -n "$NAMESPACE" create configmap shiftline-postgres-init --from-file="$STATE_DIR/10-roles.sh" --dry-run=client -o yaml | kubectl apply --server-side -f - >/dev/null
kubectl -n "$NAMESPACE" create secret generic shiftline-postgres --from-env-file="$STATE_DIR/postgres.env" --dry-run=client -o yaml | kubectl apply --server-side -f - >/dev/null
kubectl -n "$NAMESPACE" create secret generic shiftline-app --from-env-file="$STATE_DIR/app.env" --dry-run=client -o yaml | kubectl apply --server-side -f - >/dev/null
kubectl -n "$NAMESPACE" create secret generic shiftline-init --from-env-file="$STATE_DIR/init.env" --dry-run=client -o yaml | kubectl apply --server-side -f - >/dev/null
kubectl -n "$NAMESPACE" create secret tls shiftline-tls --cert="$STATE_DIR/tls.crt" --key="$STATE_DIR/tls.key" --dry-run=client -o yaml | kubectl apply --server-side -f - >/dev/null

tag="$(git -C "$REPO_ROOT" rev-parse --short=8 HEAD 2>/dev/null || printf source)-$(date -u +%Y%m%d%H%M%S)-$(openssl rand -hex 2)"
api_image="localhost/shiftline-api:$tag"
web_image="localhost/shiftline-web:$tag"
init_name="shiftline-init-$(date -u +%Y%m%d%H%M%S)-$(openssl rand -hex 2)"
render_manifests "$STATE_DIR" "$api_image" "$web_image" "$init_name"

info "Building production API and web images"
docker build --target runtime -f "$REPO_ROOT/apps/api/Dockerfile" -t "$api_image" "$REPO_ROOT"
docker build --target runtime -f "$REPO_ROOT/apps/web/Dockerfile" \
  --build-arg VITE_API_URL=/api --build-arg VITE_API_BASE_URL=/api --build-arg "VITE_IMAGE_URL=https://$HOST" \
  -t "$web_image" "$REPO_ROOT"
docker save "$api_image" | k3s ctr -n k8s.io images import -
docker save "$web_image" | k3s ctr -n k8s.io images import -

# Apply persistent storage and PostgreSQL first; the rest wait for migrations.
python3 - "$STATE_DIR/resources.yaml" "$STATE_DIR/postgres-only.yaml" <<'PY'
from pathlib import Path
import sys
docs = Path(sys.argv[1]).read_text().split('---\n')
Path(sys.argv[2]).write_text('---\n'.join(d for d in docs if 'name: shiftline-postgres\n' in d or 'name: shiftline-files\n' in d))
PY
kubectl apply --server-side -f "$STATE_DIR/postgres-only.yaml"
kubectl -n "$NAMESPACE" rollout status deployment/shiftline-postgres --timeout=300s

if [[ -e "$STATE_DIR/deployed.marker" ]]; then
  backup_dir=/var/backups/shiftline-demo
  mkdir -p "$backup_dir"
  chmod 700 "$backup_dir"
  backup_file="$backup_dir/shiftline-before-$(date -u +%Y%m%dT%H%M%SZ).dump"
  info "Saving a database backup before migrations: $backup_file"
  # Variables in this command are expanded inside the PostgreSQL container.
  # shellcheck disable=SC2016
  kubectl -n "$NAMESPACE" exec deployment/shiftline-postgres -- \
    sh -ec 'PGPASSWORD="$POSTGRES_PASSWORD" pg_dump -h 127.0.0.1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' \
    >"$backup_file"
  [[ -s "$backup_file" ]] || die "Pre-migration backup is empty"
  chmod 600 "$backup_file"
fi

info "Applying database migrations and demo account"
kubectl create -f "$STATE_DIR/init-job.yaml"
if ! kubectl -n "$NAMESPACE" wait --for=condition=complete "job/$init_name" --timeout=600s; then
  kubectl -n "$NAMESPACE" logs "job/$init_name" --all-containers=true --tail=150 >&2 || true
  die "Initialization failed; database volume was retained"
fi
kubectl -n "$NAMESPACE" logs "job/$init_name" --all-containers=true --tail=30

python3 - "$STATE_DIR/resources.yaml" "$STATE_DIR/application.yaml" <<'PY'
from pathlib import Path
import sys
docs = Path(sys.argv[1]).read_text().split('---\n')
Path(sys.argv[2]).write_text('---\n'.join(d for d in docs if 'name: shiftline-postgres\n' not in d and 'name: shiftline-files\n' not in d))
PY
kubectl apply --server-side -f "$STATE_DIR/application.yaml"
kubectl -n "$NAMESPACE" rollout status deployment/shiftline-api --timeout=300s
kubectl -n "$NAMESPACE" rollout status deployment/shiftline-worker --timeout=300s
kubectl -n "$NAMESPACE" rollout status deployment/shiftline-web --timeout=300s
if [[ "$(cat "$STATE_DIR/tls.mode")" == generated ]]; then
  check_ca="$STATE_DIR/ca.crt"
else
  check_ca="$STATE_DIR/tls.crt"
fi
curl -fsS --cacert "$check_ca" --resolve "$HOST:443:$NODE_IP" "https://$HOST/" -o /dev/null || die "Local HTTPS smoke check failed; supplied chain must be complete"
worker_ready=false
for _attempt in {1..20}; do
  if curl -fsS --cacert "$check_ca" --resolve "$HOST:443:$NODE_IP" "https://$HOST/ready" |
    python3 -c 'import json,sys; r=json.load(sys.stdin); sys.exit(0 if r.get("status")=="ready" and r.get("checks",{}).get("worker")=="ok" else 1)'; then
    worker_ready=true
    break
  fi
  sleep 3
done
[[ "$worker_ready" == true ]] || die "API or worker heartbeat check failed; inspect the retained pods and logs"
touch "$STATE_DIR/deployed.marker"
chmod 600 "$STATE_DIR/deployed.marker"

info "Deployment is ready: https://$HOST/"
if ! grep -q '^IMAGEKIT_PRIVATE_KEY=.' "$STATE_DIR/app.env"; then
  info "Image uploads need ImageKit credentials via --integration-env (see runbook)"
fi
printf 'Demo email: %s (password remains in root-only %s/core.env)\n' "$DEMO_EMAIL" "$STATE_DIR"
if [[ -e "$STATE_DIR/ca.crt" ]]; then
  printf 'Local CA certificate: %s/ca.crt; trust it in Nginx Proxy Manager or use your own certificate.\n' "$STATE_DIR"
fi
printf 'Nginx Proxy Manager: forward %s over HTTPS to this VM port 443, preserve Host, and enable WebSockets.\n' "$HOST"
printf 'Kubernetes status: sudo k3s kubectl -n %s get pods\n' "$NAMESPACE"
