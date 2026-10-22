(function () {
    'use strict';

    var http = require('http');
    var net = require('net');
    var dns = require('dns');
    var https = require('https');

    var BIND_ADDRESS = '127.0.0.1';
    var PORT = Number(process.env.TIZENDPI_TEST_PORT || 8787);
    var PROBE_HOST = 'example.com';
    var PROBE_URL = 'https://example.com/';
    var TIMEOUT_MS = 5000;
    var logs = [];
    var startedAt = new Date().toISOString();

    function errorCode(err) {
        if (!err) return 'UNKNOWN';
        return err.code || err.name || 'ERROR';
    }

    function logFailure(scope, err) {
        var code = errorCode(err);
        var line = new Date().toISOString() + ' ' + scope + ' failed (' + code + ')';
        logs.push(line);
        if (logs.length > 20) logs.shift();
        console.log('[TizenDPI] ' + line);
    }

    function logInfo(message) {
        var line = new Date().toISOString() + ' ' + message;
        logs.push(line);
        if (logs.length > 20) logs.shift();
        console.log('[TizenDPI] ' + line);
    }

    function probeTcp(callback) {
        var done = false;
        var socket;
        var timer = setTimeout(function () {
            finish(new Error('TCP_TIMEOUT'));
        }, TIMEOUT_MS);

        function finish(err) {
            if (done) return;
            done = true;
            clearTimeout(timer);
            if (socket) socket.destroy();
            callback(err ? errorCode(err) : null);
        }

        try {
            socket = net.connect(443, PROBE_HOST);
            socket.once('connect', function () { finish(null); });
            socket.once('error', finish);
        } catch (err) {
            finish(err);
        }
    }

    function probeDns(callback) {
        var done = false;
        var timer = setTimeout(function () {
            if (done) return;
            done = true;
            callback('DNS_TIMEOUT');
        }, TIMEOUT_MS);

        try {
            dns.lookup(PROBE_HOST, function (err, address) {
                if (done) return;
                done = true;
                clearTimeout(timer);
                if (err) return callback(errorCode(err));
                callback(address ? null : 'DNS_EMPTY_RESULT');
            });
        } catch (err) {
            if (done) return;
            done = true;
            clearTimeout(timer);
            callback(errorCode(err));
        }
    }

    function probeHttps(callback) {
        var done = false;
        var request;
        var timer = setTimeout(function () {
            finish('HTTPS_TIMEOUT');
        }, TIMEOUT_MS);

        function finish(err) {
            if (done) return;
            done = true;
            clearTimeout(timer);
            if (err && request) request.abort();
            callback(err || null);
        }

        try {
            request = https.get(PROBE_URL, function (response) {
                response.resume();
                finish(null);
            });
            request.once('error', function (err) {
                finish(errorCode(err));
            });
        } catch (err) {
            finish(errorCode(err));
        }
    }

    function runStatus(callback) {
        var result = {
            service: {
                ok: true,
                nodeVersion: process.version || 'unknown',
                bindAddress: BIND_ADDRESS,
                port: PORT,
                startedAt: startedAt
            },
            tcp: null,
            dns: null,
            https: null,
            logs: []
        };
        var pending = 3;

        function complete(name, error) {
            result[name] = { ok: !error, error: error || null };
            if (error) logFailure(name.toUpperCase(), { code: error });
            pending--;
            if (!pending) {
                result.logs = logs.slice(-20);
                callback(result);
            }
        }

        probeTcp(function (error) { complete('tcp', error); });
        probeDns(function (error) { complete('dns', error); });
        probeHttps(function (error) { complete('https', error); });
    }

    function writeResponse(response, statusCode, body) {
        response.writeHead(statusCode, {
            'Content-Type': 'application/json; charset=utf-8',
            'Cache-Control': 'no-store',
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type',
            'X-Content-Type-Options': 'nosniff'
        });
        response.end(body);
    }

    var server = http.createServer(function (request, response) {
        if (request.method === 'OPTIONS') {
            return writeResponse(response, 204, '');
        }

        if (request.method !== 'GET') {
            return writeResponse(response, 405, JSON.stringify({ error: 'METHOD_NOT_ALLOWED' }));
        }

        if (request.url !== '/api/status') {
            return writeResponse(response, 404, JSON.stringify({ error: 'NOT_FOUND' }));
        }

        runStatus(function (status) {
            writeResponse(response, 200, JSON.stringify(status));
        });
    });

    server.on('clientError', function (err, socket) {
        var code = errorCode(err);
        logFailure('HTTP_CLIENT', { code: code });
        if (socket && socket.writable) {
            socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n');
        }
    });

    server.on('error', function (err) {
        logFailure('HTTP_SERVER', err);
    });

    server.listen(PORT, BIND_ADDRESS, function () {
        logInfo('diagnostic HTTP service listening at ' + BIND_ADDRESS + ':' + PORT +
            ' with Node ' + (process.version || 'unknown'));
    });

    module.exports = {};
}());
