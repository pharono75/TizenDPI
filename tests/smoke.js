'use strict';
var assert = require('assert');
var fs = require('fs');
var http = require('http');
var cp = require('child_process');
var path = require('path');
var vm = require('vm');
var root = path.join(__dirname, '..');
var apiPort = 18787;
var proxyPort = 18788;
var servicePath = path.join(root, 'service', 'index.js');
var fixturePath = path.join(root, 'tests', 'dns-fixture.js');
var service = fs.readFileSync(servicePath, 'utf8');
var html = fs.readFileSync(path.join(root, 'web', 'index.html'), 'utf8');
var ui = fs.readFileSync(path.join(root, 'web', 'app.js'), 'utf8');
var manifest = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
var readme = fs.readFileSync(path.join(root, 'README.md'), 'utf8');
var env = {};
var key;
for (key in process.env) if (Object.prototype.hasOwnProperty.call(process.env, key)) env[key] = process.env[key];
env.TIZENDPI_TEST_PORT = String(apiPort);
env.TIZENDPI_TEST_PROXY_PORT = String(proxyPort);
env.TIZENDPI_TEST_DNS_TIMEOUT_MS = '40';
env.TIZENDPI_DNS_FIXTURE_MODE = 'race';

assert.strictEqual(manifest.version, '0.3.0');
assert.strictEqual(manifest.packageType, 'app');
assert.strictEqual(manifest.appName, 'TizenDPI');
assert.strictEqual(manifest.appPath, 'web/index.html');
assert.strictEqual(manifest.serviceFile, 'service/index.js');
assert.ok(fs.existsSync(path.join(root, manifest.appPath)));
assert.ok(fs.existsSync(path.join(root, manifest.serviceFile)));
assert.ok(!manifest.dependencies);
assert.ok(!/require\s*\(\s*['"]\./.test(service), 'serviceFile must be self-contained');
assert.ok(!/\basync\b|=>|\?\./.test(service), 'service must use ES5 syntax');
assert.ok(!/\bfetch\b|Buffer\.(alloc|from)|Object\.assign|Promise\b/.test(service));
assert.ok(!/\basync\b|=>|\?\./.test(ui), 'UI must use ES5 syntax');
assert.ok(/apiVersion = '0\.3\.0'/.test(ui));
assert.ok(/API_VERSION = '0\.3\.0'/.test(service));
assert.ok(/data\.apiVersion !== apiVersion/.test(ui));
assert.ok(/DNS_TIMEOUT/.test(service));
assert.ok(/if \(done\) return; done = true/.test(service), 'late DNS callbacks must be ignored');
assert.ok(/apiServer\.listen\(API_PORT, BIND/.test(service));
assert.ok(/proxyServer\.listen\(PROXY_PORT, BIND/.test(service));
assert.ok(/var BIND = '127\.0\.0\.1'/.test(service));
assert.ok(/rejectUnauthorized: true/.test(service));
assert.ok(/ALLOWED_HOSTS/.test(service));
assert.ok(/Access-Control-Allow-Origin': UI_ORIGIN/.test(service));
assert.ok(!/0\.0\.0\.0/.test(service));
assert.ok(html.indexOf('script src="app.js"') >= 0);
assert.ok(html.indexOf("connect-src 'self' http://127.0.0.1:8787") >= 0);
assert.ok(!/setInterval/.test(ui), 'UI must not poll periodically');
assert.ok(ui.indexOf("clearResults('Running ' + mode") >= 0, 'old result rows must be cleared before a new test');
assert.ok(/www\.youtube\.com\/tv/.test(service));
assert.ok(/youtubei\.googleapis\.com/.test(service));
assert.ok(/i\.ytimg\.com/.test(service));
assert.ok(/cdn\.jsdelivr\.net/.test(service));
assert.ok(readme.indexOf('pharono75/TizenDPI') >= 0);

var ids = {};
var idMatches = html.match(/\bid="([^"]+)"/g) || [];
idMatches.forEach(function (entry) { ids[entry.slice(4, -1)] = true; });
var refs = ui.match(/getElementById\('([^']+)'\)/g) || [];
refs.forEach(function (entry) {
    var id = entry.slice("getElementById('".length, -2);
    assert.ok(ids[id], 'UI references missing DOM id: ' + id);
});
['node-version', 'proxy-state', 'message', 'results', 'errors', 'run-direct', 'enable-proxy', 'run-proxy', 'disable-proxy'].forEach(function (id) {
    assert.ok(ids[id], 'required UI element missing: ' + id);
});
['/api/status', '/api/test', '/api/proxy/enable', '/api/proxy/disable'].forEach(function (route) {
    assert.ok(service.indexOf(route) >= 0, 'server route missing: ' + route);
});

function checkUiButtons(callback) {
    var requests = [];
    var elements = {};
    Object.keys(ids).forEach(function (id) {
        elements[id] = { id: id, textContent: '', onclick: null, children: [], _innerHTML: '', set innerHTML(value) { this._innerHTML = value; if (value === '') this.children = []; }, get innerHTML() { return this._innerHTML; }, appendChild: function (child) { this.children.push(child); } };
    });
    var document = {
        getElementById: function (id) { assert.ok(elements[id], 'DOM lookup missing: ' + id); return elements[id]; },
        createElement: function (tag) { return { tagName: tag, textContent: '', children: [], appendChild: function (child) { this.children.push(child); } }; }
    };
    function FakeXHR() { this.readyState = 0; this.status = 0; }
    FakeXHR.prototype.open = function (method, url) { this.method = method; this.url = url; };
    FakeXHR.prototype.send = function () {
        var self = this, payload, route = this.url.slice('http://127.0.0.1:8787'.length);
        requests.push({ method: this.method, route: route });
        if (route === '/api/status') payload = { apiVersion: '0.3.0', service: { nodeVersion: 'v4.4.3', bindAddress: '127.0.0.1', port: 8787 }, proxy: { enabled: false, bindAddress: '127.0.0.1', port: 8788, splitWriteAttempts: 0 }, logs: [] };
        else if (route.indexOf('/api/test?mode=') === 0) payload = { apiVersion: '0.3.0', mode: route.slice(route.indexOf('=') + 1), results: [{ site: 'www.youtube.com', mode: 'direct', dns: { ok: true, ms: 1, error: null }, tcp: { ok: true, ms: 2, error: null }, tls: { ok: true, ms: 3, error: null }, http: { ok: true, ms: 4, status: 403, error: null }, durationMs: 10, error: null }], logs: [] };
        else payload = { apiVersion: '0.3.0', ok: true, proxy: { enabled: route.indexOf('enable') >= 0, bindAddress: '127.0.0.1', port: 8788, splitWriteAttempts: 0 }, error: null };
        setTimeout(function () { self.status = 200; self.readyState = 4; self.responseText = JSON.stringify(payload); self.onreadystatechange(); }, 0);
    };
    FakeXHR.prototype.abort = function () { if (this.onabort) this.onabort(); };
    var window = {};
    vm.runInNewContext(ui, { window: window, document: document, XMLHttpRequest: FakeXHR, setTimeout: setTimeout, clearTimeout: clearTimeout, JSON: JSON, Error: Error, String: String });
    window.onload();
    setTimeout(function () {
        try {
            assert.ok(requests.some(function (r) { return r.method === 'GET' && r.route === '/api/status'; }));
            elements.results.appendChild({ children: [{ textContent: 'stale DNS_TIMEOUT' }] });
            elements['run-direct'].onclick();
            assert.strictEqual(elements.results.children.length, 1, 'stale rows must be removed');
            assert.ok(elements.results.children[0].children[0].textContent.indexOf('Running direct') >= 0);
        } catch (err) { return callback(err); }
        setTimeout(function () {
            try {
                assert.ok(requests.some(function (r) { return r.method === 'POST' && r.route === '/api/test?mode=direct'; }));
                assert.ok(elements.results.children.length >= 1, 'test result row should render');
                assert.ok(elements.results.children[0].children[5].textContent.indexOf('403') >= 0, 'HTTP status should render');
                elements['enable-proxy'].onclick();
                elements['run-proxy'].onclick();
                elements['disable-proxy'].onclick();
                assert.ok(requests.some(function (r) { return r.route === '/api/proxy/enable'; }));
                assert.ok(requests.some(function (r) { return r.route === '/api/test?mode=proxy'; }));
                assert.ok(requests.some(function (r) { return r.route === '/api/proxy/disable'; }));
                callback(null);
            } catch (err2) { callback(err2); }
        }, 20);
    }, 20);
}

var child = cp.spawn(process.execPath, ['--require', fixturePath, servicePath], { env: env, stdio: ['ignore', 'pipe', 'pipe'] });
var output = '';
var ended = false;
child.stdout.on('data', function (data) { output += data.toString(); });
child.stderr.on('data', function (data) { output += data.toString(); });
function finish(error) {
    if (ended) return;
    ended = true;
    child.kill();
    if (error) { console.error(error.stack || error); console.error(output); process.exitCode = 1; }
    else console.log('PASS: DOM/API contract, UI controls/render, API version handshake, loopback proxy controls, DNS timeout race, Node 4 source audit');
}
function call(method, route, callback, origin) {
    var req = http.request({ host: '127.0.0.1', port: apiPort, path: route, method: method, headers: { Origin: origin || 'http://127.0.0.1:8081' } }, function (res) {
        var body = '';
        res.on('data', function (chunk) { body += chunk; });
        res.on('end', function () {
            var data = {};
            try { if (body) data = JSON.parse(body); } catch (err) { return callback(err); }
            callback(null, res.statusCode, data, res.headers);
        });
    });
    req.on('error', callback);
    req.end();
}
function startProxyAndTest() {
    call('POST', '/api/test?mode=proxy', function (err, status, data) {
        if (err) return finish(err);
        try { assert.strictEqual(status, 409); assert.strictEqual(data.apiVersion, '0.3.0'); }
        catch (e) { return finish(e); }
        call('POST', '/api/proxy/enable', function (enableErr, enableStatus, enabled) {
            if (enableErr) return finish(enableErr);
            try { assert.strictEqual(enableStatus, 200); assert.strictEqual(enabled.proxy.enabled, true); }
            catch (e2) { return finish(e2); }
            call('POST', '/api/test?mode=proxy', function (proxyErr, proxyStatus, proxyData) {
                if (proxyErr) return finish(proxyErr);
                try {
                    assert.strictEqual(proxyStatus, 200); assert.strictEqual(proxyData.apiVersion, '0.3.0');
                    assert.strictEqual(proxyData.mode, 'proxy'); assert.strictEqual(proxyData.results.length, 5);
                    assert.ok(proxyData.results.every(function (r) { return r.dns.error === 'ENOTFOUND'; }));
                } catch (e3) { return finish(e3); }
                call('POST', '/api/proxy/disable', function (foreignErr, foreignStatus) {
                    if (foreignErr) return finish(foreignErr);
                    try { assert.strictEqual(foreignStatus, 403); }
                    catch (e4) { return finish(e4); }
                    call('GET', '/api/status', function (statusErr, statusCode, afterForeign) {
                        if (statusErr) return finish(statusErr);
                        try { assert.strictEqual(afterForeign.proxy.enabled, true); }
                        catch (e5) { return finish(e5); }
                        deniedConnect();
                    });
                }, 'https://example.org');
            });
        });
    });
}
function deniedConnect() {
    var req = http.request({ host: '127.0.0.1', port: proxyPort, path: 'example.com:443', method: 'CONNECT' });
    req.once('connect', function (res, socket) {
        try { assert.strictEqual(res.statusCode, 403); socket.destroy(); }
        catch (err) { socket.destroy(); return finish(err); }
        call('POST', '/api/proxy/disable', function (err2, status, data) {
            if (err2) return finish(err2);
            try { assert.strictEqual(status, 200); assert.strictEqual(data.apiVersion, '0.3.0'); assert.strictEqual(data.proxy.enabled, false); finish(); }
            catch (e) { finish(e); }
        });
    });
    req.once('response', function (res) { res.resume(); if (res.statusCode !== 403) finish(new Error('expected CONNECT denial, got ' + res.statusCode)); });
    req.on('error', finish);
    req.end();
}
function testDnsAndControls(attempt) {
    call('GET', '/api/status', function (err, status, data, headers) {
        if (err) {
            if (attempt >= 60) return finish(new Error('service startup timeout: ' + err.message));
            return setTimeout(function () { testDnsAndControls(attempt + 1); }, 100);
        }
        try {
            assert.strictEqual(status, 200); assert.strictEqual(headers['access-control-allow-origin'], 'http://127.0.0.1:8081');
            assert.strictEqual(data.apiVersion, '0.3.0'); assert.strictEqual(data.service.nodeVersion, process.version);
            assert.strictEqual(data.service.bindAddress, '127.0.0.1'); assert.strictEqual(data.service.port, apiPort);
            assert.strictEqual(data.proxy.enabled, false);
        } catch (e) { return finish(e); }
        checkUiButtons(function (uiErr) {
            if (uiErr) return finish(uiErr);
            call('POST', '/api/test?mode=direct', function (firstErr, firstStatus, first) {
                if (firstErr) return finish(firstErr);
                try {
                    assert.strictEqual(firstStatus, 200); assert.strictEqual(first.apiVersion, '0.3.0');
                    assert.strictEqual(first.mode, 'direct'); assert.strictEqual(first.results.length, 5);
                    assert.strictEqual(first.results[0].dns.error, 'DNS_TIMEOUT');
                    first.results.forEach(function (row) {
                        assert.ok(row.site && row.mode); assert.ok(row.dns && row.tcp && row.tls && row.http);
                        assert.strictEqual(typeof row.durationMs, 'number');
                    });
                } catch (e2) { return finish(e2); }
                call('POST', '/api/test?mode=direct', function (secondErr, secondStatus, second) {
                    if (secondErr) return finish(secondErr);
                    try { assert.strictEqual(secondStatus, 200); assert.strictEqual(second.results[0].dns.error, 'ENOTFOUND'); }
                    catch (e3) { return finish(e3); }
                    setTimeout(function () {
                        try { assert.strictEqual(first.results[0].dns.error, 'DNS_TIMEOUT'); assert.strictEqual(second.results[0].dns.error, 'ENOTFOUND'); }
                        catch (e4) { return finish(e4); }
                        startProxyAndTest();
                    }, 300);
                });
            });
        });
    });
}
child.once('error', finish);
testDnsAndControls(0);
