'use strict';
var assert = require('assert');
var fs = require('fs');
var http = require('http');
var cp = require('child_process');
var path = require('path');
var root = path.join(__dirname, '..');
var apiPort = 18787;
var proxyPort = 18788;
var servicePath = path.join(root, 'service', 'index.js');
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

assert.strictEqual(manifest.version, '0.3.0');
assert.strictEqual(manifest.packageType, 'app');
assert.strictEqual(manifest.appName, 'TizenDPI');
assert.strictEqual(manifest.appPath, 'web/index.html');
assert.strictEqual(manifest.serviceFile, 'service/index.js');
assert.ok(fs.existsSync(path.join(root, manifest.appPath)));
assert.ok(fs.existsSync(path.join(root, manifest.serviceFile)));
assert.ok(!manifest.dependencies);
assert.ok(!/require\s*\(\s*['"]\./.test(service), 'serviceFile must be standalone');
assert.ok(!/\basync\b|=>|\?\./.test(service), 'service must use ES5 syntax');
assert.ok(!/\bfetch\b|Buffer\.(alloc|from)|Object\.assign|Promise\b/.test(service));
assert.ok(/require\('tls'\)/.test(service));
assert.ok(/apiServer\.listen\(API_PORT, BIND/.test(service));
assert.ok(/proxyServer\.listen\(PROXY_PORT, BIND/.test(service));
assert.ok(/var BIND = '127\.0\.0\.1'/.test(service));
assert.ok(/MAX_PROXY_CONNECTIONS = 2/.test(service));
assert.ok(/rejectUnauthorized: true/.test(service));
assert.ok(/remote\.write\(hello\.slice\(0, at\)\)/.test(service));
assert.ok(/ALLOWED_HOSTS/.test(service));
assert.ok(!/Access-Control-Allow-Origin': '\*'/.test(service));
assert.ok(/isPublicAddress\(address\)/.test(service));
assert.ok(!/0\.0\.0\.0/.test(service));
assert.ok(!/console\.log\([^\n]*(?:token|authorization|responseText|body)/i.test(service));
assert.ok(html.indexOf("connect-src 'self' http://127.0.0.1:8787") >= 0);
assert.ok(html.indexOf('Run direct HTTPS checks') >= 0);
assert.ok(html.indexOf('Disable proxy') >= 0);
assert.ok(!/setInterval/.test(ui), 'no periodic polling');
assert.ok(/www\.youtube\.com\/tv/.test(service));
assert.ok(/youtubei\.googleapis\.com/.test(service));
assert.ok(/i\.ytimg\.com/.test(service));
assert.ok(/cdn\.jsdelivr\.net/.test(service));
assert.ok(ui.indexOf('process.version') < 0);
assert.ok(readme.indexOf('pharono75/TizenDPI') >= 0);

var child = cp.spawn(process.execPath, [servicePath], { env: env, stdio: ['ignore', 'pipe', 'pipe'] });
var output = '';
var ended = false;
child.stdout.on('data', function (data) { output += data.toString(); });
child.stderr.on('data', function (data) { output += data.toString(); });
function finish(error) {
    if (ended) return;
    ended = true;
    child.kill();
    if (error) { console.error(error.stack || error); console.error(output); process.exitCode = 1; }
    else console.log('PASS: v0.3.0 manifest/source audit; loopback API; proxy disabled by default; enable/disable; non-allowlisted CONNECT rejected; no background polling');
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
function waitForService(attempt) {
    call('GET', '/api/status', function (err, status, data, headers) {
        if (err) {
            if (attempt >= 60) return finish(new Error('service startup timeout: ' + err.message));
            return setTimeout(function () { waitForService(attempt + 1); }, 100);
        }
        try {
            assert.strictEqual(status, 200);
            assert.strictEqual(headers['access-control-allow-origin'], 'http://127.0.0.1:8081');
            assert.strictEqual(data.service.nodeVersion, process.version);
            assert.strictEqual(data.service.bindAddress, '127.0.0.1');
            assert.strictEqual(data.service.port, apiPort);
            assert.strictEqual(data.proxy.enabled, false);
            assert.strictEqual(data.proxy.bindAddress, '127.0.0.1');
            call('POST', '/api/test?mode=proxy', function (testErr, testStatus) {
                if (testErr) return finish(testErr);
                try { assert.strictEqual(testStatus, 409); } catch (assertErr) { return finish(assertErr); }
                call('POST', '/api/proxy/enable', function (enableErr, enableStatus, enabled) {
                    if (enableErr) return finish(enableErr);
                    try { assert.strictEqual(enableStatus, 200); assert.strictEqual(enabled.proxy.enabled, true); }
                    catch (assertErr2) { return finish(assertErr2); }
                    call('POST', '/api/proxy/disable', function (foreignErr, foreignStatus) {
                        if (foreignErr) return finish(foreignErr);
                        try { assert.strictEqual(foreignStatus, 403); } catch (foreignAssert) { return finish(foreignAssert); }
                        call('GET', '/api/status', function (statusErr, statusCode, afterForeign) {
                            if (statusErr) return finish(statusErr);
                            try { assert.strictEqual(afterForeign.proxy.enabled, true); } catch (stateAssert) { return finish(stateAssert); }
                            deniedConnect();
                        });
                    }, 'https://example.org');
                });
            });
        } catch (assertErr3) { finish(assertErr3); }
    });
}
function deniedConnect() {
    var req = http.request({ host: '127.0.0.1', port: proxyPort, path: 'example.com:443', method: 'CONNECT' });
    req.once('connect', function (res, socket) {
        try { assert.strictEqual(res.statusCode, 403); socket.destroy(); }
        catch (err) { socket.destroy(); return finish(err); }
        call('POST', '/api/proxy/disable', function (err2, status, data) {
            if (err2) return finish(err2);
            try { assert.strictEqual(status, 200); assert.strictEqual(data.proxy.enabled, false); finish(); }
            catch (assertErr) { finish(assertErr); }
        });
    });
    req.once('response', function (res) {
        res.resume();
        if (res.statusCode !== 403) finish(new Error('expected CONNECT denial, got ' + res.statusCode));
    });
    req.on('error', finish);
    req.end();
}
child.once('error', finish);
waitForService(0);