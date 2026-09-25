# Single-command Kubernetes demo

Deploy the current checkout into a dedicated Debian 13 virtual machine on Proxmox with one
repository script. The target public origin is `https://shiftline.kaizeninfinities.com`, served
through the existing Cloudflare and Nginx Proxy Manager installation. The Proxmox/network
hostname is independent of this application hostname.

The script installs a single-node K3s cluster, builds the repository's production images, imports
them locally, and deploys PostgreSQL 16, an API, a separate worker, and an HTTPS web proxy.
Migrations and a dedicated demo-account bootstrap complete before application rollout. Database
and generated files persist across reruns. Application credentials must not use PostgreSQL's
superuser; migration credentials are separate from application credentials.

The demo has one tenant owner (`Demo@shiftline.com`), with a password supplied privately during
installation. A separately generated platform-administrator credential is reserved for the
operator. The development seed and its shared fixture accounts are never run. Rerunning must
not erase data or silently change an existing demo password.

The deployment must provide HTTPS, secure refresh cookies, same-origin API and Socket.IO
routing, readiness checks, and explicit external-service configuration. SMTP, ImageKit, and
other provider accounts cannot be provisioned from repository code alone. DNS and the existing
Nginx Proxy Manager remain operator configuration; neither the host's IP addresses nor Proxmox
configuration are modified.

Validation covers Bash syntax, rendered Kubernetes objects, production image builds, migration
and bootstrap against PostgreSQL, account idempotency, and login/refresh through the web proxy.
Local tests do not establish that the user's Proxmox VM, firewall, DNS, or external proxy is
correctly configured; the runbook must state that boundary.
