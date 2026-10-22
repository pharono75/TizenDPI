# TizenDPI diagnostic module

This project is a TizenBrew GitHub Module for diagnostics only. It has no proxy,
SOCKS, traffic interception, route changes, or certificate handling.

## TizenBrew compatibility

The module manifest uses packageType=app, appName=TizenDPI,
appPath=web/index.html, and serviceFile=service/index.js. TizenBrew fetches the
manifest and the service file through jsDelivr. The service file is a single
self-contained ES5 script: it imports only Node core modules http, net, dns and
https, and does not use relative requires or external packages. It starts at
script evaluation, matching serviceLauncher.js calling vm.runInContext.

The service binds to the literal address 127.0.0.1. The port override
TIZENDPI_TEST_PORT exists only for local tests; no environment variable can
change the bind address. The TV default is TCP 8787. Errors are logged as
probe names and error codes only. Request URLs, headers, bodies, credentials,
and network contents are never logged.

The UI uses an external ES5 script and stylesheet. Its CSP allows only same
origin assets and the loopback status endpoint. The UI sends a simple GET with
no credentials; the service answers with Access-Control-Allow-Origin: * and
supports OPTIONS. Samsung lists CORS and CSP Level 1 support for the 2017
Tizen 3.0 web engine, but this particular app/module origin and loopback
combination still must be checked on the TV.

## Local tests

Requires Node.js on the PC and no npm dependencies.

From PowerShell:
  Set-Location C:\TizenDPI
  node --check service\index.js
  node --check web\app.js
  node --check tests\smoke.js
  node tests\smoke.js

The status endpoint runs independent TCP, DNS and HTTPS probes to example.com.
The PC test verifies the manifest and paths, built-in-only imports, ES5-oriented
source, fixed loopback bind, CSP/CORS headers, Node version reporting and the
status response shape. It does not require outbound internet probes to pass.

## Manual GitHub Module publication

No GitHub repository is configured or published by this project. After choosing
a public repository, put these files at its root and use its default branch:
  package.json
  service/index.js
  web/index.html
  web/app.js
  web/style.css

For a repository owner/repository and branch main, verify these URLs in a
browser before registering the module:
  https://cdn.jsdelivr.net/gh/OWNER/REPOSITORY@main/package.json
  https://cdn.jsdelivr.net/gh/OWNER/REPOSITORY@main/service/index.js
  https://cdn.jsdelivr.net/gh/OWNER/REPOSITORY@main/web/index.html
  https://cdn.jsdelivr.net/gh/OWNER/REPOSITORY@main/web/app.js
  https://cdn.jsdelivr.net/gh/OWNER/REPOSITORY@main/web/style.css

The first URL must return the module manifest and the second the standalone
service source. TizenBrew's supported GitHub Module field takes OWNER/REPOSITORY;
its loader then uses jsDelivr. A local path, private repository, uncommitted
files, or a repository name alone cannot produce working jsDelivr URLs.

## Device test after publication

No TV installation is performed by these steps automatically.

1. Confirm the five jsDelivr URLs return HTTP 200 and inspect their contents.
2. In TizenBrew, add the public OWNER/REPOSITORY with its GitHub Module control
   and launch TizenDPI.
3. The page should report the TV's actual process.version, bind address
   127.0.0.1 and port 8787, then show TCP, DNS and HTTPS results.
4. If the page says the loopback request failed, use TizenBrew's service status
   and the TV Web Inspector console to distinguish service startup, CSP and
   CORS errors. This exact cross-port request has not yet been run on the TV.
5. Do not consider the network probes evidence of YouTube proxying; the proxy
   has intentionally been removed.

TizenBrew's service source has a compatibility branch for process.version
v4.4.3 on Tizen 3. The TV's actual Node version remains unknown until the
diagnostic module is manually published and launched. This service uses syntax
and core APIs available in Node 4.4.3, but the local runtime test uses the
installed PC Node version.
