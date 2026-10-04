# Hosting Shiftline

How the live app at https://shiftline.apps.kaizeninfinities.com is hosted and operated. The facts
come from the hosting note recorded in [`docs/AS-BUILT.md`](../AS-BUILT.md); that page is the source
of truth. For local development see [`local-run.md`](local-run.md).

> **The deployed version may lag `main`.** Run the script's `status` verb to see which commit is
> live before assuming a merged change is deployed.

## Topology

```text
Internet ── Caddy (TLS, ports 80/443) ── 127.0.0.1:8090
                                              │
   Proxmox VE host ── Docker ── kind cluster `shiftline` (namespace `shiftline`)
                                              │
                    nginx gateway ── web
                                  └─ api ── Postgres 16 (StatefulSet)
                                  worker (exactly one)
```

- One Proxmox VE host, shared with other apps.
- Caddy terminates TLS with automatic certificates on ports 80 and 443 and proxies to
  127.0.0.1:8090.
- Shiftline runs in a private, single-node Kubernetes cluster (kind) named `shiftline`, inside one
  Docker container. The namespace is `shiftline`.
- Source is github.com/Kaizen-Infinities/shiftline, branch `main`.

### Resource caps

The cluster is capped at 3 GB RAM and 2 CPUs.

### Services

| Service       | Notes                                        |
| ------------- | -------------------------------------------- |
| nginx gateway | Entry point inside the cluster, behind Caddy |
| api           | Express API                                  |
| worker        | pg-boss jobs; run exactly one                |
| web           | The SPA                                      |
| Postgres 16   | StatefulSet                                  |
| migrate job   | Applies database migrations                  |
| demo-seed job | On demand only                               |

### Images

Images are built locally on the host. There is no registry.

## Operating with the control script

All operations go through `/root/shiftline/shiftline`. Run it with one verb:

| Verb      | Use it to                                                        |
| --------- | ---------------------------------------------------------------- |
| `status`  | Show the state of the deployment, including the deployed version |
| `update`  | Deploy the latest `main`                                         |
| `rebuild` | Rebuild the images                                               |
| `restart` | Restart the services                                             |
| `logs`    | Read service logs                                                |
| `backup`  | Take a manual database backup                                    |
| `restore` | Restore the database from a backup                               |

Typical flows:

- **Deploy.** Run `status` to note the current version, then `update`. An automatic backup is taken
  before each update. Run `status` again to confirm the new version.
- **Something is wrong.** Run `status`, then `logs`. Use `restart` if a service is stuck.
- **Before risky work.** Run `backup`.
- **Recovery.** Use `restore`, and treat it as destructive to current data.

The script's own usage output is authoritative for arguments. Do not assume flags beyond the verbs
above.

## Database

| Role                 | Used for                           |
| -------------------- | ---------------------------------- |
| `postgres`           | Backups only                       |
| `shiftline_migrator` | The api, the worker and migrations |
| `shiftline_app`      | Reserved, currently unused         |

## Backups

- Automatic before each update.
- Manual on demand, with the `backup` verb.
- The app's own scheduled dump, kept for 30 days.

All three are on the same disk as the database. There is no off-host copy.

## Known gaps

Track these as a checklist; each is open until struck through here and in
[`docs/STATUS.md`](../STATUS.md).

- [ ] Port 8090 is also reachable over plain HTTP from the internet. Bind it to 127.0.0.1.
- [ ] `COOKIE_SECURE=false` is still set. Set it to `true` once the plain-HTTP port is closed.
- [ ] The in-cluster gateway overwrites Caddy's forwarded protocol with `http`.
- [ ] SMTP is not configured, so outgoing mail is only logged.
- [ ] No off-host backups.
- [ ] No monitoring beyond Kubernetes probes.
- [ ] One node and one replica of everything, so no high availability.
- [ ] Keep an offline copy of `DATA_ENCRYPTION_KEY`. Without it, stored integration credentials
      cannot be decrypted.
- [ ] Deploy current `main`, which is ahead of the deployed version (see
      [`docs/STATUS.md`](../STATUS.md)).

Prioritised work on these gaps is in [`docs/ROADMAP.md`](../ROADMAP.md).
