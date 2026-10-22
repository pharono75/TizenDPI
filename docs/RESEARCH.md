# TizenDPI 0.3.0 research notes



## Confirmed environment



The user reports that TizenDPI 0.2.0 ran on UE49M6500 / Tizen 3.0 / T-KTSDEUC-1410.1 and confirmed Node v4.4.3, the loopback HTTP service, and TCP/DNS/HTTPS to example.com. This is prior device evidence; this change did not reconnect to the TV. The new YouTube checks, second listener, CORS/CSP behavior, and the local proxy are not yet device-confirmed.



## Direct and proxy checks



The service has fixed endpoint names and paths; API requests cannot select an arbitrary host. Each manual run records DNS, TCP, TLS with explicit SNI and certificate verification, HTTP status, per-stage time and total duration. It retains only the HTTP status line's code. HTTP 403 and 404 count as an HTTP response rather than a transport error. Tests are sequential and button-triggered; there is no polling timer.



The CONNECT listener binds to 127.0.0.1:8788 and starts only on an explicit UI command. It permits only CONNECT to port 443 for `www.youtube.com`, `youtubei.googleapis.com`, `i.ytimg.com`, and `cdn.jsdelivr.net`. It rejects common private, loopback, link-local, carrier-grade NAT and documentation DNS answers, limits concurrent tunnels to two, bounds initial TLS record buffering to 16,389 bytes, and has connect/idle timeouts. Disable closes tracked tunnel sockets. It relays encrypted data without terminating TLS. The optional ClientHello split is two ordered socket writes around parsed SNI, or a midpoint fallback. This is not proof of packet segmentation.



The service uses ES5 syntax and core Node modules (`http`, `net`, `dns`, `tls`) without third-party dependencies or newer Buffer APIs. The offline smoke test executes on Windows Node, audits syntax-sensitive constructs, tests the loopback status/API, verifies off-by-default, toggles the proxy, and checks rejection of a non-allowlisted CONNECT. Node 4 execution must still be confirmed by manually launching on the TV.



## TizenTube source findings



The current TizenTube manifest uses `packageType: mods`, `websiteURL` for YouTube TV, `main: dist/userScript.js`, and `serviceFile: dist/service.js`. The userscript entry imports app feature modules; its service source creates an Express/CORS dial API and launches TizenBrew modules with Tizen app-control. That service is not a generic CONNECT proxy. The project docs identify `TizenTubeOld.wgt` for Tizen 3/4/5/5.5. The `TizenTubeProxyAddress` variant is described for newer TizenTube Cobalt (Tizen 6+) and its separate proxy server. This does not set a system-wide proxy on the legacy WebView. A userscript/app integration would need to explicitly route supported requests; a CONNECT socket alone is not automatically used by XHR/fetch/media. CORS, authentication, API behavior and video range/streaming semantics would need application-specific treatment. No TizenTube source was changed.



## Remaining device evidence and limits



On the TV, still verify all five endpoint rows (four DNS hostnames, with `/` and `/tv` separate), HTTP status classification, new Node v4 code, CSP/CORS POST controls, permission to bind 127.0.0.1:8788, CONNECT tunnel behavior, SNI and TLS validation. Packet boundaries require capture at a controlled endpoint; separate writes cannot guarantee separate TCP segments. QUIC/UDP is outside this test. The proxy test does not redirect actual YouTube app traffic.



## References



- TizenTube manifest: https://github.com/reisxd/TizenTube/blob/main/package.json

- TizenTube old/Cobalt build and proxy-address notes: https://github.com/reisxd/TizenTube/blob/main/docs/README.md

- Zapret/tpws split and socket write caveats: https://github.com/bol-van/zapret/blob/master/docs/readme.en.md