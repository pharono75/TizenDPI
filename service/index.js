(function () {
    'use strict';
    var http = require('http');
    var net = require('net');
    var dns = require('dns');
    var tls = require('tls');
    var BIND = '127.0.0.1';
    var UI_ORIGIN = 'http://127.0.0.1:8081';
    var API_VERSION = '0.3.0';
    var API_PORT = Number(process.env.TIZENDPI_TEST_PORT || 8787);
    var PROXY_PORT = Number(process.env.TIZENDPI_TEST_PROXY_PORT || 8788);
    var TIMEOUT = 5000;
    var DNS_TIMEOUT = Number(process.env.TIZENDPI_TEST_DNS_TIMEOUT_MS || TIMEOUT);
    var TLS_TIMEOUT = 8000;
    var MAX_PROXY_CONNECTIONS = 2;
    var MAX_CONNECT_HEADER = 4096;
    var MAX_HELLO = 16389;
    var TARGETS = [
        { site: 'www.youtube.com', host: 'www.youtube.com', path: '/' },
        { site: 'www.youtube.com/tv', host: 'www.youtube.com', path: '/tv' },
        { site: 'youtubei.googleapis.com', host: 'youtubei.googleapis.com', path: '/' },
        { site: 'i.ytimg.com', host: 'i.ytimg.com', path: '/favicon.ico' },
        { site: 'cdn.jsdelivr.net', host: 'cdn.jsdelivr.net', path: '/npm/' }
    ];
    var ALLOWED_HOSTS = ['www.youtube.com', 'youtubei.googleapis.com', 'i.ytimg.com', 'cdn.jsdelivr.net'];
    var logs = [];
    var apiServer;
    var proxyServer = null;
    var proxyConnections = [];
    var activeProxyTunnels = 0;
    var proxyEnabled = false;
    var splitWriteAttempts = 0;
    var testBusy = false;
    var startedAt = new Date().toISOString();

    function codeOf(err, fallback) { return err ? (err.code || err.name || fallback || 'ERROR') : (fallback || 'UNKNOWN'); }
    function logEvent(scope, code) {
        var line = new Date().toISOString() + ' ' + scope + ' ' + code;
        logs.push(line);
        if (logs.length > 30) logs.shift();
        console.log('[TizenDPI] ' + line);
    }
    function elapsed(start) { return Math.max(0, new Date().getTime() - start); }
    function allowedHost(host) { return ALLOWED_HOSTS.indexOf(String(host || '').toLowerCase()) >= 0; }
    function parseAuthority(authority) {
        var match = /^([a-z0-9.-]+):([0-9]+)$/i.exec(String(authority || ''));
        if (!match || Number(match[2]) !== 443 || !allowedHost(match[1])) return null;
        return match[1].toLowerCase();
    }
    function isPublicAddress(address) {
        var family = net.isIP(address);
        var parts;
        var a;
        var b;
        if (family === 4) {
            parts = address.split('.'); a = Number(parts[0]); b = Number(parts[1]);
            if (a === 0 || a === 10 || a === 127 || a >= 224) return false;
            if (a === 169 && b === 254) return false;
            if (a === 172 && b >= 16 && b <= 31) return false;
            if (a === 192 && b === 168) return false;
            if (a === 100 && b >= 64 && b <= 127) return false;
            return true;
        }
        if (family === 6) {
            var lower = address.toLowerCase();
            if (lower === '::1' || lower === '::' || lower.indexOf('fc') === 0 || lower.indexOf('fd') === 0 ||
                    lower.indexOf('fe8') === 0 || lower.indexOf('fe9') === 0 || lower.indexOf('fea') === 0 ||
                    lower.indexOf('feb') === 0 || lower.indexOf('::ffff:') === 0) return false;
            return true;
        }
        return false;
    }
    function findSniSplit(buffer) {
        var p = 9, end = buffer.length, sessionLength, cipherLength, compressionLength;
        var extensionsLength, extEnd, extType, extLength, listLength, nameType, nameLength, nameStart;
        if (!buffer || buffer.length < 9 || buffer[0] !== 22 || buffer[1] !== 3 || buffer[5] !== 1) return -1;
        p += 2 + 32;
        if (p >= end) return -1;
        sessionLength = buffer[p++]; p += sessionLength;
        if (p + 2 > end) return -1;
        cipherLength = buffer.readUInt16BE(p); p += 2 + cipherLength;
        if (p >= end) return -1;
        compressionLength = buffer[p++]; p += compressionLength;
        if (p + 2 > end) return -1;
        extensionsLength = buffer.readUInt16BE(p); p += 2;
        extEnd = Math.min(end, p + extensionsLength);
        while (p + 4 <= extEnd) {
            extType = buffer.readUInt16BE(p); extLength = buffer.readUInt16BE(p + 2); p += 4;
            if (p + extLength > extEnd) return -1;
            if (extType === 0 && extLength >= 5) {
                listLength = buffer.readUInt16BE(p); nameType = buffer[p + 2];
                nameLength = buffer.readUInt16BE(p + 3); nameStart = p + 5;
                if (listLength >= 3 && nameType === 0 && nameLength > 1 && nameStart + nameLength <= p + extLength)
                    return nameStart + Math.floor(nameLength / 2);
            }
            p += extLength;
        }
        return -1;
    }
    function splitPoint(buffer, recordLength) {
        var found = findSniSplit(buffer);
        return found > 0 && found < recordLength ? found : Math.max(1, Math.floor(recordLength / 2));
    }
    function makeRow(target, mode) {
        return { site: target.site, mode: mode,
            dns: { ok: false, ms: null, error: null }, tcp: { ok: false, ms: null, error: null },
            tls: { ok: false, ms: null, error: null }, http: { ok: false, ms: null, status: null, error: null },
            durationMs: 0, error: null };
    }
    function runDns(row, host, callback) {
        var start = new Date().getTime(), done = false;
        var timer = setTimeout(function () {
            if (done) return; done = true; row.dns.ms = elapsed(start); row.dns.error = 'DNS_TIMEOUT';
            row.error = 'DNS_TIMEOUT'; callback(null, 'DNS_TIMEOUT');
        }, DNS_TIMEOUT);
        try {
            dns.lookup(host, function (err, address) {
                if (done) return; done = true; clearTimeout(timer); row.dns.ms = elapsed(start);
                if (err || !address) { row.dns.error = codeOf(err, 'DNS_NO_ADDRESS'); row.error = row.dns.error; return callback(null, row.dns.error); }
                row.dns.ok = true; callback(address, null);
            });
        } catch (err) {
            if (done) return; done = true; clearTimeout(timer); row.dns.ms = elapsed(start);
            row.dns.error = codeOf(err, 'DNS_ERROR'); row.error = row.dns.error; callback(null, row.dns.error);
        }
    }
    function readHttpStatus(socket, target, row, callback) {
        var start = new Date().getTime(), line = '', done = false;
        var timer = setTimeout(function () { finish('HTTP_TIMEOUT', null); }, TIMEOUT);
        function finish(error, status) {
            if (done) return; done = true; clearTimeout(timer); row.http.ms = elapsed(start);
            if (status) { row.http.ok = true; row.http.status = status; }
            else { row.http.error = error || 'HTTP_NO_STATUS'; row.error = row.error || row.http.error; }
            callback(error || null);
        }
        socket.on('data', function (chunk) {
            var text = chunk.toString('binary'), end = text.indexOf('\r\n'), match;
            if (end >= 0) line += text.slice(0, end);
            else if (line.length < 64) line += text.slice(0, 64 - line.length);
            if (line.length > 64) line = line.slice(0, 64);
            match = /^HTTP\/1\.[01] ([0-9]{3})(?: |$)/.exec(line);
            if (match) finish(null, Number(match[1]));
            else if (end >= 0) finish('HTTP_BAD_STATUS_LINE', null);
        });
        socket.once('error', function (err) { finish(codeOf(err, 'HTTP_SOCKET_ERROR'), null); });
        socket.once('close', function () { if (!done) finish('HTTP_CLOSED_BEFORE_STATUS', null); });
        socket.write('GET ' + target.path + ' HTTP/1.1\r\nHost: ' + target.host + '\r\nConnection: close\r\n\r\n');
    }
    function requestOverTls(socket, target, row, callback) {
        var start = new Date().getTime(), done = false, secure;
        var timer = setTimeout(function () { finish('TLS_TIMEOUT'); }, TLS_TIMEOUT);
        function finish(error) {
            if (done) return; done = true; clearTimeout(timer);
            if (error) {
                row.tls.ms = elapsed(start); row.tls.error = error; row.error = row.error || 'TLS_' + error;
                logEvent('TLS', error); if (secure) secure.destroy(); else if (socket) socket.destroy();
                row.durationMs = elapsed(row._started); return callback(error);
            }
            row.tls.ok = true; row.tls.ms = elapsed(start);
            readHttpStatus(secure, target, row, function () {
                row.durationMs = elapsed(row._started);
                if (row.http.error) logEvent('HTTP', row.http.error);
                callback(null); secure.destroy();
            });
        }
        try {
            secure = tls.connect({ socket: socket, servername: target.host, rejectUnauthorized: true }, function () { finish(null); });
            secure.setTimeout(TLS_TIMEOUT, function () { finish('TLS_TIMEOUT'); });
            secure.once('error', function (err) { finish(codeOf(err, 'TLS_ERROR')); });
        } catch (err) { finish(codeOf(err, 'TLS_ERROR')); }
    }
    function runDirect(target, callback) {
        var row = makeRow(target, 'direct'); row._started = new Date().getTime();
        runDns(row, target.host, function (address, dnsError) {
            var start, socket, timer, finished = false;
            if (dnsError) { row.durationMs = elapsed(row._started); return callback(row); }
            if (!isPublicAddress(address)) { row.dns.ok = false; row.dns.error = 'DNS_ADDRESS_REJECTED'; row.error = row.dns.error; row.durationMs = elapsed(row._started); return callback(row); }
            start = new Date().getTime();
            function tcpFail(code) {
                if (finished) return; finished = true; if (timer) clearTimeout(timer);
                row.tcp.ms = elapsed(start); row.tcp.error = code; row.error = 'TCP_' + code;
                row.durationMs = elapsed(row._started); callback(row);
            }
            timer = setTimeout(function () { if (socket) socket.destroy(); tcpFail('TCP_TIMEOUT'); }, TIMEOUT);
            try {
                socket = net.connect({ host: address, port: 443 });
                socket.setTimeout(TIMEOUT, function () { socket.destroy(); tcpFail('TCP_TIMEOUT'); });
                socket.once('connect', function () {
                    if (finished) return; finished = true; clearTimeout(timer); timer = null;
                    row.tcp.ok = true; row.tcp.ms = elapsed(start); socket.setTimeout(0);
                    requestOverTls(socket, target, row, function () { callback(row); });
                });
                socket.once('error', function (err) { tcpFail(codeOf(err, 'TCP_ERROR')); });
            } catch (err) { tcpFail(codeOf(err, 'TCP_ERROR')); }
        });
    }
    function runViaProxy(target, callback) {
        var row = makeRow(target, 'proxy'); row._started = new Date().getTime();
        runDns(row, target.host, function (unused, dnsError) {
            var start, request, timer, finished = false;
            if (dnsError) { row.durationMs = elapsed(row._started); return callback(row); }
            if (!isPublicAddress(unused)) { row.dns.ok = false; row.dns.error = 'DNS_ADDRESS_REJECTED'; row.error = row.dns.error; row.durationMs = elapsed(row._started); return callback(row); }
            if (!proxyEnabled || !proxyServer) { row.tcp.error = 'PROXY_DISABLED'; row.error = 'PROXY_DISABLED'; row.durationMs = elapsed(row._started); return callback(row); }
            start = new Date().getTime();
            function fail(code) {
                if (finished) return; finished = true; if (timer) clearTimeout(timer);
                row.tcp.ms = elapsed(start); row.tcp.error = code; row.error = code;
                row.durationMs = elapsed(row._started); if (request) request.abort(); callback(row);
            }
            timer = setTimeout(function () { fail('TCP_TIMEOUT'); }, TIMEOUT);
            try {
                request = http.request({ host: BIND, port: PROXY_PORT, path: target.host + ':443', method: 'CONNECT' });
                request.once('connect', function (response, tunnel) {
                    if (timer) clearTimeout(timer); timer = null;
                    if (response.statusCode !== 200) {
                        row.tcp.ms = elapsed(start); row.tcp.error = 'PROXY_HTTP_' + response.statusCode;
                        row.error = row.tcp.error; row.durationMs = elapsed(row._started); tunnel.destroy();
                        if (!finished) { finished = true; callback(row); } return;
                    }
                    finished = true; row.tcp.ok = true; row.tcp.ms = elapsed(start);
                    requestOverTls(tunnel, target, row, function () { callback(row); });
                });
                request.once('error', function (err) { fail(codeOf(err, 'PROXY_CONNECT_ERROR')); });
                request.end();
            } catch (err) { fail(codeOf(err, 'PROXY_CONNECT_ERROR')); }
        });
    }
    function runSeries(mode, callback) {
        var results = [], index = 0;
        function next() {
            if (index >= TARGETS.length) return callback(results);
            var target = TARGETS[index++], done = false;
            var timer = setTimeout(function () {
                if (done) return; done = true; var row = makeRow(target, mode);
                row.error = 'CHECK_TIMEOUT'; row.durationMs = TIMEOUT * 3 + TLS_TIMEOUT; results.push(row); next();
            }, TIMEOUT * 3 + TLS_TIMEOUT + 1000);
            function complete(row) { if (done) return; done = true; clearTimeout(timer); results.push(row); next(); }
            if (mode === 'direct') runDirect(target, complete); else runViaProxy(target, complete);
        }
        next();
    }
    function sendJson(response, status, data) {
        if (data && typeof data === 'object') data.apiVersion = API_VERSION;
        response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store',
            'Access-Control-Allow-Origin': UI_ORIGIN, 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type', 'X-Content-Type-Options': 'nosniff' });
        response.end(JSON.stringify(data));
    }
    function disableProxy(callback) {
        var i; proxyEnabled = false;
        for (i = 0; i < proxyConnections.length; i++) if (proxyConnections[i] && !proxyConnections[i].destroyed) proxyConnections[i].destroy();
        proxyConnections = [];
        if (!proxyServer) return callback(null);
        var old = proxyServer; proxyServer = null; old.close(function (err) { callback(err || null); });
    }
    function trackSocket(socket) {
        proxyConnections.push(socket);
        socket.once('close', function () { var i = proxyConnections.indexOf(socket); if (i >= 0) proxyConnections.splice(i, 1); });
    }
    function rejectConnect(client, status, message) {
        if (!client.destroyed) client.end('HTTP/1.1 ' + status + ' ' + message + '\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');
    }
    function startProxy(callback) {
        if (proxyEnabled && proxyServer) return callback(null);
        proxyServer = http.createServer(function (request, response) {
            response.writeHead(405, { 'Content-Length': '0', 'Connection': 'close' }); response.end();
        });
        proxyServer.maxConnections = MAX_PROXY_CONNECTIONS;
        proxyServer.maxHeadersCount = 16;
        proxyServer.on('connect', function (request, client, head) {
            var host = parseAuthority(request.url), remote, closed = false, splitDone = false;
            var firstBytes = [], firstLength = 0, recordSize = 0, clientTimer, released = false;
            var rawSize = String(request.url || '').length, ri;
            if (request.rawHeaders) for (ri = 0; ri < request.rawHeaders.length; ri++) rawSize += String(request.rawHeaders[ri]).length;
            if (rawSize > MAX_CONNECT_HEADER) return rejectConnect(client, '431', 'Headers Too Large');
            if (!host) return rejectConnect(client, '403', 'Forbidden');
            if (activeProxyTunnels >= MAX_PROXY_CONNECTIONS) return rejectConnect(client, '503', 'Connection Limit');
            activeProxyTunnels++; trackSocket(client);
            client.once('close', function release() { if (!released) { released = true; activeProxyTunnels--; } });
            clientTimer = setTimeout(function () { if (!closed) client.destroy(); }, TIMEOUT);
            client.setTimeout(TIMEOUT, function () { client.destroy(); });
            dns.lookup(host, function (dnsError, address) {
                if (closed || client.destroyed) return;
                if (dnsError || !address || !isPublicAddress(address)) {
                    clearTimeout(clientTimer); logEvent('PROXY_DNS', codeOf(dnsError, 'ADDRESS_REJECTED'));
                    return rejectConnect(client, '502', 'Bad Gateway');
                }
                try { remote = net.connect({ host: address, port: 443 }); }
                catch (err) {
                    clearTimeout(clientTimer); logEvent('PROXY_CONNECT', codeOf(err, 'CONNECT_ERROR'));
                    return rejectConnect(client, '502', 'Bad Gateway');
                }
                trackSocket(remote); remote.setTimeout(TIMEOUT, function () { remote.destroy(); });
                remote.once('error', function (err) {
                    logEvent('PROXY_CONNECT', codeOf(err, 'CONNECT_ERROR'));
                    if (!closed && !client.destroyed) rejectConnect(client, '502', 'Bad Gateway');
                });
                remote.once('connect', function () {
                    if (closed || client.destroyed) return remote.destroy();
                    clearTimeout(clientTimer); client.setTimeout(30000, function () { client.destroy(); });
                    remote.setTimeout(30000, function () { remote.destroy(); });
                    remote.setNoDelay(true); client.setNoDelay(true);
                    client.write('HTTP/1.1 200 Connection Established\r\n\r\n');
                    if (head && head.length) onClientData(head);
                    client.on('data', onClientData);
                    remote.on('data', function (data) { if (!client.destroyed) client.write(data); });
                    client.once('end', function () { if (!remote.destroyed) remote.end(); });
                    remote.once('end', function () { if (!client.destroyed) client.end(); });
                    client.once('error', closePair); remote.once('error', closePair);
                    client.once('close', closePair); remote.once('close', closePair);
                });
            });
            function closePair() {
                if (closed) return; closed = true; clearTimeout(clientTimer);
                if (client && !client.destroyed) client.destroy(); if (remote && !remote.destroyed) remote.destroy();
            }
            function writeFirst(data) {
                var buffer = Buffer.isBuffer(data) ? data : new Buffer(data), h, hello, rest, at;
                firstBytes.push(buffer); firstLength += buffer.length;
                if (firstLength > MAX_HELLO) return false;
                if (firstLength >= 5 && !recordSize) {
                    h = Buffer.concat(firstBytes, firstLength);
                    if (h[0] !== 22 || h[1] !== 3) {
                        remote.write(h); splitDone = true; firstBytes = []; firstLength = 0; return true;
                    }
                    recordSize = h.readUInt16BE(3) + 5;
                    if (recordSize > MAX_HELLO) return false;
                }
                if (recordSize && firstLength >= recordSize) {
                    h = Buffer.concat(firstBytes, firstLength); hello = h.slice(0, recordSize); rest = h.slice(recordSize);
                    at = splitPoint(hello, recordSize);
                    if (at > 0 && at < hello.length) { remote.write(hello.slice(0, at)); remote.write(hello.slice(at)); splitWriteAttempts++; }
                    else remote.write(hello);
                    if (rest.length) remote.write(rest);
                    firstBytes = []; firstLength = 0; splitDone = true;
                }
                return true;
            }
            function onClientData(data) {
                if (closed || !remote || remote.destroyed) return;
                if (splitDone) return remote.write(data);
                if (!writeFirst(data)) {
                    logEvent('PROXY_SPLIT', 'BUFFER_LIMIT');
                    remote.write(Buffer.concat(firstBytes, firstLength)); firstBytes = []; firstLength = 0; splitDone = true;
                }
            }
        });
        proxyServer.on('error', function (err) {
            proxyEnabled = false; logEvent('PROXY_LISTEN', codeOf(err, 'LISTEN_ERROR'));
            if (callback) callback(err);
        });
        proxyServer.listen(PROXY_PORT, BIND, function () {
            proxyEnabled = true; logEvent('PROXY', 'ENABLED_LOOPBACK_ONLY');
            if (callback) callback(null); callback = null;
        });
    }
    function statusData() {
        return { service: { ok: true, nodeVersion: process.version || 'unknown', bindAddress: BIND, port: API_PORT, startedAt: startedAt },
            proxy: { enabled: !!(proxyEnabled && proxyServer), bindAddress: BIND, port: PROXY_PORT,
                maxConnections: MAX_PROXY_CONNECTIONS, splitWriteAttempts: splitWriteAttempts },
            targets: TARGETS.map(function (target) { return target.site; }), logs: logs.slice(-30) };
    }
    apiServer = http.createServer(function (request, response) {
        var pathname = String(request.url || '').split('?')[0], mode;
        if (request.headers.origin && request.headers.origin !== UI_ORIGIN) return sendJson(response, 403, { error: 'ORIGIN_DENIED' });
        if (request.method === 'OPTIONS') return sendJson(response, 204, {});
        if (request.method === 'GET' && pathname === '/api/status') return sendJson(response, 200, statusData());
        if (request.method === 'POST' && pathname === '/api/proxy/enable') return startProxy(function (err) {
            if (err) return sendJson(response, 500, { ok: false, error: codeOf(err, 'PROXY_START_FAILED') });
            sendJson(response, 200, { ok: true, proxy: statusData().proxy });
        });
        if (request.method === 'POST' && pathname === '/api/proxy/disable') return disableProxy(function (err) {
            sendJson(response, err ? 500 : 200, { ok: !err, proxy: statusData().proxy, error: err ? codeOf(err, 'PROXY_STOP_FAILED') : null });
        });
        if (request.method === 'POST' && pathname === '/api/test') {
            mode = String(request.url || '').split('mode=')[1] || ''; mode = mode.split('&')[0];
            if (mode !== 'direct' && mode !== 'proxy') return sendJson(response, 400, { error: 'INVALID_MODE' });
            if (testBusy) return sendJson(response, 409, { error: 'TEST_ALREADY_RUNNING' });
            if (mode === 'proxy' && !proxyEnabled) return sendJson(response, 409, { error: 'PROXY_DISABLED' });
            testBusy = true; response.setTimeout(120000, function () { response.destroy(); });
            return runSeries(mode, function (results) {
                testBusy = false; sendJson(response, 200, { mode: mode, results: results, logs: logs.slice(-30) });
            });
        }
        sendJson(response, 404, { error: 'NOT_FOUND' });
    });
    apiServer.on('clientError', function (err, socket) {
        logEvent('HTTP_CLIENT', codeOf(err, 'CLIENT_ERROR'));
        if (socket && socket.writable) socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n');
    });
    apiServer.on('error', function (err) { logEvent('HTTP_SERVER', codeOf(err, 'SERVER_ERROR')); });
    apiServer.listen(API_PORT, BIND, function () { logEvent('SERVICE', 'LISTENING_NODE_' + (process.version || 'unknown')); });
    module.exports = {};
}());