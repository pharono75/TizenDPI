# TizenDPI 0.3.0



Loopback-only diagnostics and an opt-in HTTP CONNECT experiment for Samsung Tizen. It does not change system routing, intercept TLS certificates, configure a VPN, or start a proxy automatically.



## Runtime behavior



`package.json` is a TizenBrew app module (`appPath: web/index.html`, `serviceFile: service/index.js`). The self-contained service starts when TizenBrew evaluates that file. It uses Node core modules only (`http`, `net`, `dns`, `tls`) and ES5 syntax intended for the UE49M6500's confirmed Node v4.4.3 runtime.



The UI and service enforce the same API contract version 0.3.0. A missing or different apiVersion is shown as API_VERSION_MISMATCH. Each manual run clears the prior result rows while a new check is pending, so an earlier DNS_TIMEOUT cannot remain visible as the current run.

The diagnostic API binds to `127.0.0.1:8787` and accepts browser-originated control requests only from the TizenBrew module origin `http://127.0.0.1:8081`; it does not enable wildcard CORS. The optional CONNECT proxy binds to `127.0.0.1:8788` only after the user presses Enable. It accepts CONNECT only to port 443 for these exact hostnames: `www.youtube.com`, `youtubei.googleapis.com`, `i.ytimg.com`, `cdn.jsdelivr.net`. The UI exposes no arbitrary destination field. It rejects private, loopback, link-local, carrier-grade NAT and documentation DNS answers. Concurrent tunnels are capped at two; CONNECT header accounting and initial TLS record buffering are bounded; timeouts are applied. Disable closes the listener and current tunnel sockets. The proxy is off after service restart.



Each manual Direct or Proxy run checks DNS, TCP, TLS with SNI and certificate verification enabled, then reads only the first HTTP status line. No response body or headers are stored. HTTP 403/404 is reported as an HTTP response, distinct from DNS/TCP/TLS errors. Checks run only on button press, one endpoint at a time. Logs contain phase names and error codes, not payloads, tokens, URLs, or headers.



The proxy buffers the first client TLS record (at most 16,389 bytes). If it parses as a TLS record, the relay writes two ordered pieces, preferring a split inside SNI. This is only an experiment: `socket.write()` calls are stream writes and do not guarantee separate TCP segments. TLS termination and certificate substitution are not performed. This proxy cannot affect YouTube traffic unless a client explicitly uses CONNECT; the system WebView proxy is not changed.



## Local checks



No npm dependencies are needed. From PowerShell:



```powershell

Set-Location C:\TizenDPI

node --check service\index.js

node --check web\app.js

node --check tests\smoke.js

node tests\smoke.js

```



The offline smoke test checks manifest wiring, source compatibility constraints, fixed loopback binds, allowlist and certificate verification; it starts the service locally, checks status/CORS, verifies proxy-off by default, toggles it on/off, and confirms a non-allowlisted CONNECT is rejected. It exercises all UI controls and result rendering against a fixture, including a delayed DNS callback after timeout. It does not emulate TV WebKit, make Internet probes, or prove TCP segmentation on the UE49M6500.



## Prepare/publish pharono75/TizenDPI manually



This is the existing repository `https://github.com/pharono75/TizenDPI`. No commit or push is performed in this change. Review the diff and tests, then commit/push only when authorized:



```powershell

Set-Location C:\TizenDPI

git status --short

git diff --check

git diff

# after review and your approval:

git add package.json service/index.js web/index.html web/app.js web/style.css tests/smoke.js README.md docs/RESEARCH.md

git commit -m "Add YouTube diagnostics and opt-in loopback CONNECT experiment"

git push origin main

```



After push, verify the following public jsDelivr URLs return the intended files before using TizenBrew:



- `https://cdn.jsdelivr.net/gh/pharono75/TizenDPI@main/package.json`

- `https://cdn.jsdelivr.net/gh/pharono75/TizenDPI@main/service/index.js`

- `https://cdn.jsdelivr.net/gh/pharono75/TizenDPI@main/web/index.html`

- `https://cdn.jsdelivr.net/gh/pharono75/TizenDPI@main/web/app.js`

- `https://cdn.jsdelivr.net/gh/pharono75/TizenDPI@main/web/style.css`



CDN cache may lag after push; verify exact contents and version before updating the TV.



## Manual TV update (not performed)



1. Confirm the five jsDelivr URLs above return the 0.3.0 files.

2. On the TV, open TizenBrew and refresh/update the existing `pharono75/TizenDPI` GitHub Module entry using its supported module manager, then launch TizenDPI. If no refresh action exists, remove and re-add only this module via the supported UI. No SDB or install command is used by this project.

3. Confirm Node v4.4.3 and `127.0.0.1:8787`; click **Run direct HTTPS checks**.

4. If you choose to evaluate the experiment, click **Enable local proxy experiment**, then **Run checks through proxy**. Click **Disable proxy** afterward. Restart also leaves it disabled.

5. Review per-stage outcomes. HTTP 403/404 means an HTTP response arrived; it does not alone prove blocking. Proxy success does not prove distinct TCP segments or affect YouTube's own app traffic.



## TizenTube integration research



Current TizenTube declares `packageType: mods`, targets YouTube TV, injects `dist/userScript.js`, and runs `dist/service.js`. The userscript entry imports app features; the service source runs an Express/CORS dial API and launches TizenBrew by app-control, rather than exposing a generic CONNECT proxy. Its docs designate `TizenTubeOld.wgt` for Tizen 3/4/5/5.5. The documented `TizenTubeProxyAddress` build belongs to newer TizenTube Cobalt (Tizen 6+), with a separate Cobalt proxy. Neither configures a device-wide HTTP proxy for the legacy YouTube TV WebView. The WebView will not automatically issue CONNECT through this listener. A real integration requires a TizenTube-specific change that explicitly routes selected application requests through a relay and handles CORS, credentials, API semantics, and media range/streaming. This project does not patch TizenTube.