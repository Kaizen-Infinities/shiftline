# Shiftline Kubernetes demo on Proxmox

This installs the demo on a dedicated Debian 13 **virtual machine** on Proxmox, not an LXC container or the Proxmox host. Recommended starting capacity is **4 vCPU, 8 GB RAM, and 60 GB SSD** for K3s, PostgreSQL, API, worker, and web app. This is an estimate, not a tested capacity guarantee. Do not change the server's existing OS hostname; the application hostname `shiftline.kaizeninfinities.com` is independent.

The installer builds production images on the VM and deploys a single-node K3s cluster. The web container listens on ports 80 and 443 **bound to the VM's private address**. PostgreSQL, API, and worker remain cluster-internal. The installer disables K3s Traefik and ServiceLB, enables Kubernetes Secret encryption, and installs a targeted nftables guard for K3s control and overlay ports. This guard does not set a general deny-by-default firewall policy.

## Before deployment

1. Give the VM a stable private RFC1918 address reachable from Nginx Proxy Manager (NPM), and ensure it has outbound internet access. Find the address on the VM itself. Do not infer it from `61.246.188.19/29`; that public address is an NPM origin only if your existing routing sends it to NPM.
2. Configure inbound filtering at the **Proxmox firewall or upstream network boundary** before running the installer. Since all public ports are currently open, set deny-by-default inbound rules; allow SSH only from your administrator source and TCP 443 only from NPM's VM-side source address. Port 80 can remain closed externally because NPM uses HTTPS. Deny public access to TCP 6443/6444, TCP 10250, TCP 2379/2380, UDP 8472/51820/51821, and Kubernetes NodePorts. Allow required outbound traffic. The installer adds its narrow nftables guard but does not change the general host or Proxmox firewall policy. K3s warns that UDP 8472 must not be exposed publicly in its [port requirements](https://docs.k3s.io/installation/requirements).
3. From the VM, identify the **exact source IP NPM uses to connect to this VM**. Pass that address as `--trusted-proxy`. It is the NPM-side source as seen by the VM, not a Cloudflare IP/range; Cloudflare connects to NPM, not directly to this VM. NPM must trust Cloudflare's published proxy ranges when restoring visitor IPs and pass the resulting client IP to this upstream.

## Deploy

From a trusted repository checkout on the VM, run:

```bash
sudo bash scripts/deploy-demo-k8s.sh --node-ip <VM-private-RFC1918-IP> --host shiftline.kaizeninfinities.com --trusted-proxy <NPM-source-IP-seen-by-VM>
```

The first run prompts privately for the `Demo@shiftline.com` password. Choose 12–72 characters, at most 72 UTF-8 bytes, with uppercase, lowercase, and a digit; avoid backslashes. Do not put the password in command arguments or shell history. The installer stores generated credentials under root-only `/etc/shiftline-demo/core.env`; subsequent runs reuse them without prompting. Keep that directory and the Kubernetes persistent volumes when updating. A rerun refuses to silently change the existing demo password and takes a pre-migration database dump under `/var/backups/shiftline-demo`.

The API also creates a separate random platform-admin account for the operator. Its credentials are in the root-only `core.env`; retrieve them locally as root and keep them private. Optional `--integration-env FILE` accepts a root-owned restrictive file with SMTP and ImageKit settings; it is saved as `/etc/shiftline-demo/integrations.env` and reused on reruns. `--password-file FILE` is an alternative to the first-run prompt. `--tls-cert FILE --tls-key FILE` supplies a custom certificate and matching root-owned private key. `--render DIR` renders non-secret templates without deploying. See `bash scripts/deploy-demo-k8s.sh --help` for the interface.

## Connect NPM and Cloudflare

After installation, the default VM server certificate and private CA are at `/etc/shiftline-demo/tls.crt` and `/etc/shiftline-demo/ca.crt`. Copy **only** `ca.crt` to NPM using a secure method; never copy `ca.key`. If using a custom certificate, obtain its issuer CA from your certificate administrator instead.

In NPM, create the proxy host for `shiftline.kaizeninfinities.com` with upstream scheme **HTTPS**, the VM private IP as host, and port `443`. Preserve the public Host header and enable WebSockets. Mount the issuer CA PEM read-only in the NPM container, then put this in the proxy host's Advanced configuration, substituting the in-container CA path:

```nginx
proxy_ssl_trusted_certificate /path/inside/npm/shiftline-upstream-ca.pem;
proxy_ssl_verify on;
proxy_ssl_verify_depth 2;
proxy_ssl_server_name on;
proxy_ssl_name shiftline.kaizeninfinities.com;
large_client_header_buffers 4 32k;
```

NGINX upstream certificate verification is off by default. These directives verify the VM certificate and send the expected SNI name. The larger client-header buffers are needed because the OWNER JWT can exceed NPM's default 8 KiB header buffer; otherwise login may succeed but the following `/auth/me` request can return 400. See [NGINX upstream TLS verification](https://nginx.org/en/docs/http/ngx_http_proxy_module.html#proxy_ssl_trusted_certificate) and [NPM custom configuration](https://nginxproxymanager.com/advanced-config/).

In Cloudflare, point the proxied DNS record at the existing NPM public origin only if routing confirms that origin reaches NPM. Set SSL/TLS to **Full (strict)** and ensure NPM presents a valid public certificate for the app hostname. This secures Cloudflare-to-NPM; the private CA above secures NPM-to-VM. Create a Cache Rule with **Bypass cache** for this host's `/api/*`, `/socket.io/*`, `/uploads/*`, `/health`, and `/ready` paths. Ensure those paths do not receive interactive Managed/JS challenges; if a security exception is required, scope it to these exact paths and skip only the challenge feature, retaining other blocking rules. Enable Cloudflare WebSockets. References: [Cloudflare Full (strict)](https://developers.cloudflare.com/ssl/origin-configuration/ssl-modes/full-strict/), [Cache Rules bypass](https://developers.cloudflare.com/cache/how-to/cache-rules/settings/), [WAF Skip action](https://developers.cloudflare.com/waf/custom-rules/skip/), and [WebSockets](https://developers.cloudflare.com/network/websockets/).

## Integrations, updates, and verification

The demo works without provider credentials, but related operations are unavailable. SMTP is needed to send invitations and password-reset messages. ImageKit is needed for durable uploaded images/files; uploads that rely on it fail until configured. The integration file accepts only SMTP and ImageKit settings; payment, AI, SMS, and other provider workflows are not provisioned by this installer.

NPM manages renewal of its public certificate. A generated VM leaf certificate lasts 825 days; the installer renews it on a rerun when it is within 30 days of expiry, retaining the private CA. Custom certificates do not auto-renew: provide the renewed pair with `--tls-cert` and `--tls-key` on a rerun. After certificate changes, check NPM's CA trust and reload/reapply the proxy host. Do not delete `/etc/shiftline-demo`, the database PVC, or the files PVC during updates. Persistent data survives reruns; keep independent backups as well.

Verify the rollout with `sudo k3s kubectl get nodes` and `sudo k3s kubectl -n shiftline-demo get pods`; the node and app pods should be `Ready`. The installer performs a local HTTPS smoke check. Then verify `https://shiftline.kaizeninfinities.com/health` and `/ready` through NPM/Cloudflare, sign in as `Demo@shiftline.com`, and confirm realtime connection. The web proxy routes `/health` and `/ready` to the API explicitly, so those endpoints report backend health/readiness rather than the SPA. Check that public access to K3s management/overlay ports and NodePorts is blocked while NPM can reach the private VM on TCP 443.

This runbook and local checks do not validate the target VM, Proxmox routing/firewall, Cloudflare, or NPM setup. Confirm those paths in the target environment.

Official deployment references: [K3s ports](https://docs.k3s.io/installation/requirements), [K3s configuration](https://docs.k3s.io/installation/configuration), [K3s packaged components](https://docs.k3s.io/installation/packaged-components), [K3s Secrets encryption](https://docs.k3s.io/security/secrets-encryption), [NPM advanced configuration](https://nginxproxymanager.com/advanced-config/).
