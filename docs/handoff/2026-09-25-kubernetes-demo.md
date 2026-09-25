# Kubernetes demo installer and startup responsiveness

Based on main commit `08471ceb`. Run `scripts/deploy-demo-k8s.sh` inside a dedicated
Debian 13 VM. The [runbook](../runbooks/kubernetes-demo.md) covers the existing
Cloudflare → Nginx Proxy Manager → private VM topology for
`shiftline.kaizeninfinities.com`.

## Delivered

- One repository entrypoint installs single-node K3s and builds/imports production API and web
  images. PostgreSQL, API, worker, files storage, migrations, demo bootstrap, and HTTPS proxy
  are deployed together. It does not change the hypervisor, hostname, IP routing, DNS, or NPM.
- Separate migration/runtime database roles, protected audit rows, private services, encrypted
  Kubernetes secrets, root-only saved credentials, and a targeted cluster-port firewall guard.
- One demo tenant owner (`Demo@shiftline.com`) using a privately supplied password. The development
  seed is never run. Conflicting accounts/passwords are rejected. A separate random platform
  administrator is created by the normal API startup.
- Same-origin API/WebSockets, verified upstream TLS instructions, secure refresh cookies,
  persistence, pre-migration backups on updates, and readiness/worker heartbeat checks.
- Gzip for public frontend assets, immutable fingerprinted assets, fresh SPA HTML, reusable API
  connections, bounded Prisma pools, and no caching of authenticated API responses. Login no
  longer starts accounts prefetch before the tenant is known and repeats it afterward.
- API image ownership is set during COPY, avoiding the expensive recursive ownership layer.
  Shell files use LF even when cloned on Windows.

## Validation performed

The test environment was Docker Desktop on ARM64 with a temporary K3s `v1.34.1+k3s1`
container. It was not the user's Debian/Proxmox VM. Tests used generated disposable
credentials, not the requested demo password.

- Both production Docker images built on Linux with Node 22, including the final frontend change.
- Bash syntax, ShellCheck, targeted ESLint/Prettier, and `git diff --check` passed.
- Rendered Kubernetes resources passed server-side validation and were deployed to K3s.
- All PostgreSQL migrations and the compiled demo bootstrap succeeded. API, worker, web, and
  PostgreSQL became ready. Runtime was verified non-superuser, non-owner, and `NOBYPASSRLS`;
  queries without tenant context saw no user rows; runtime could not delete/truncate audit rows.
- The second bootstrap preserved the user ID and password hash and did not create extra users.
  A conflicting-password bootstrap failed without changing the account.
- TLS certificate verification, login, authenticated profile, secure/HttpOnly/SameSite=Lax cookie,
  session refresh, authenticated WebSocket connection, and wrong-password rejection passed through
  the actual nginx proxy. Worker heartbeat was healthy. Shared files remained after pod replacement.
- The main JavaScript response measured 600,947 bytes uncompressed versus approximately
  166,900 bytes with gzip (72% smaller). This measures transfer size, not user-visible latency.
- The generated nftables guard passed `nft --check` using Debian 13 tooling. Its interaction with
  the target VM's systemd, CNI, and existing firewall still requires target-side verification.

The tests caught and fixed two deployment-specific failures: pg-boss needs database CREATE
permission even with its schema provisioned, and the owner JWT exceeds nginx's default header
buffer. NPM needs the runbook's matching `large_client_header_buffers` directive too.

## Boundaries

No deployment, DNS change, or proxy/firewall configuration was performed on the user's servers.
The full Debian package/systemd bootstrap, Proxmox 9.2.1 network path, public TLS chain, external
integrations, capacity under load, and off-site restore procedure remain target-environment checks.
Email requires SMTP; image uploads require ImageKit credentials. This is a single-node demo,
with brief downtime on updates and no high-availability guarantee. Cluster/namespace identity
checks refuse replacing a different deployment, and reruns never deliberately delete volumes.
