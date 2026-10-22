'use strict';

var assert = require('assert');
var fs = require('fs');
var http = require('http');
var cp = require('child_process');
var path = require('path');

var root = path.join(__dirname, '..');
var port = 18787;
var servicePath = path.join(root, 'service', 'index.js');
var serviceSource = fs.readFileSync(servicePath, 'utf8');
var manifest = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
var html = fs.readFileSync(path.join(root, 'web', 'index.html'), 'utf8');
var appJs = fs.readFileSync(path.join(root, 'web', 'app.js'), 'utf8');
var allowedModules = ['http', 'net', 'dns', 'https'];

assert.strictEqual(manifest.packageType, 'app');
assert.strictEqual(manifest.appName, 'TizenDPI');
assert.strictEqual(manifest.appPath, 'web/index.html');
assert.strictEqual(manifest.serviceFile, 'service/index.js');
assert.ok(fs.existsSync(path.join(root, manifest.appPath)));
assert.ok(fs.existsSync(path.join(root, manifest.serviceFile)));
assert.deepStrictEqual(manifest.dependencies || {}, {});
assert.ok(!/require\s*\(\s*['"]\./.test(serviceSource), 'serviceFile must be self-contained');
assert.ok(!/\basync\b|=>|\?\./.test(serviceSource), 'serviceFile must use ES5 syntax');
assert.ok(!/\bfetch\b|Buffer\.(alloc|from)|Object\.assign|Promise\b/.test(serviceSource),
    'serviceFile must avoid APIs absent from or unsuitable for Node 4');
assert.ok(!/net\.createServer|\.on\(['"]connect['"]|SOCKS|CONNECT proxy/i.test(serviceSource),
    'proxy code must remain disabled');
var imports = serviceSource.match(/require\s*\(\s*['"][^'"]+['"]\s*\)/g) || [];
imports.forEach(function (entry) {
    var name = entry.match(/['"]([^'"]+)['"]/)[1];
    assert.ok(allowedModules.indexOf(name) >= 0, 'unexpected dependency: ' + name);
});
assert.ok(/server\.listen\(PORT,\s*BIND_ADDRESS/.test(serviceSource));
assert.ok(/var BIND_ADDRESS = ['"]127\.0\.0\.1['"]/.test(serviceSource));
assert.ok(html.indexOf('script src="app.js"') >= 0, 'UI script must be external for CSP');
assert.ok(html.indexOf("connect-src 'self' http://127.0.0.1:8787") >= 0);
assert.ok(!/<script>/.test(html), 'inline script should not be needed');
assert.ok(appJs.indexOf('process.version') < 0, 'UI must display version reported by service');

var child = cp.spawn(process.execPath, [servicePath], {
    env: Object.assign({}, process.env, { TIZENDPI_TEST_PORT: String(port) }),
    stdio: ['ignore', 'pipe', 'pipe']
});
var output = '';
var finished = false;
child.stdout.on('data', function (data) { output += data.toString(); });
child.stderr.on('data', function (data) { output += data.toString(); });

function finish(error) {
    if (finished) return;
    finished = true;
    child.kill();
    if (error) {
        console.error(error.stack || error);
        console.error(output);
        process.exitCode = 1;
    } else {
        console.log('PASS: manifest, self-contained Node 4 service, loopback bind, CSP/CORS, status API');
    }
}

function requestStatus(attempt) {
    var request = http.get({
        host: '127.0.0.1',
        port: port,
        path: '/api/status',
        headers: { Origin: 'http://127.0.0.1:8081' }
    }, function (response) {
        var body = '';
        response.on('data', function (chunk) { body += chunk; });
        response.on('end', function () {
            try {
                var data = JSON.parse(body);
                assert.strictEqual(response.statusCode, 200);
                assert.strictEqual(response.headers['access-control-allow-origin'], '*');
                assert.strictEqual(data.service.ok, true);
                assert.strictEqual(data.service.nodeVersion, process.version);
                assert.strictEqual(data.service.bindAddress, '127.0.0.1');
                assert.strictEqual(data.service.port, port);
                ['tcp', 'dns', 'https'].forEach(function (key) {
                    assert.strictEqual(typeof data[key].ok, 'boolean');
                    assert.ok(data[key].error === null || typeof data[key].error === 'string');
                });
                assert.ok(Array.isArray(data.logs));
                requestOptions();
            } catch (error) {
                finish(error);
            }
        });
    });
    request.on('error', function (error) {
        if (attempt >= 50) return finish(new Error('service startup timeout: ' + error.message));
        setTimeout(function () { requestStatus(attempt + 1); }, 100);
    });
}

function requestOptions() {
    var request = http.request({
        host: '127.0.0.1',
        port: port,
        path: '/api/status',
        method: 'OPTIONS',
        headers: { Origin: 'http://127.0.0.1:8081' }
    }, function (response) {
        response.resume();
        try {
            assert.strictEqual(response.statusCode, 204);
            assert.strictEqual(response.headers['access-control-allow-origin'], '*');
            finish();
        } catch (error) {
            finish(error);
        }
    });
    request.on('error', finish);
    request.end();
}

child.on('error', finish);
requestStatus(0);
