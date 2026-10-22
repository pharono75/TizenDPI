(function () {
    'use strict';
    var api = 'http://127.0.0.1:8787';
    var busy = false;
    function request(method, path, callback, timeout) {
        var xhr = new XMLHttpRequest(), ended = false;
        var timer = setTimeout(function () { if (ended) return; ended = true; xhr.abort(); callback(new Error('REQUEST_TIMEOUT')); }, timeout || 10000);
        function finish(error, data) { if (ended) return; ended = true; clearTimeout(timer); callback(error, data); }
        xhr.open(method, api + path, true);
        xhr.onreadystatechange = function () {
            if (xhr.readyState !== 4) return;
            if (xhr.status < 200 || xhr.status >= 300) return finish(new Error('HTTP_' + xhr.status));
            try { finish(null, xhr.responseText ? JSON.parse(xhr.responseText) : {}); }
            catch (err) { finish(new Error('INVALID_JSON')); }
        };
        xhr.onerror = function () { finish(new Error('LOOPBACK_REQUEST_FAILED')); };
        xhr.onabort = function () { finish(new Error('REQUEST_ABORTED')); };
        try { xhr.send(null); } catch (err) { finish(new Error('REQUEST_START_FAILED')); }
    }
    function showError(error) { document.getElementById('message').textContent = 'Error: ' + (error && error.message ? error.message : 'UNKNOWN'); }
    function updateStatus() {
        request('GET', '/api/status', function (error, data) {
            if (error) return showError(error);
            document.getElementById('node-version').textContent = 'TV Node: ' + data.service.nodeVersion + ' | API ' + data.service.bindAddress + ':' + data.service.port;
            document.getElementById('proxy-state').textContent = 'Experimental proxy: ' + (data.proxy.enabled ? 'enabled at ' + data.proxy.bindAddress + ':' + data.proxy.port : 'disabled') + ' | split write attempts: ' + data.proxy.splitWriteAttempts;
            document.getElementById('errors').textContent = data.logs.length ? data.logs.join('\n') : 'No errors reported';
        });
    }
    function stage(value) {
        if (!value || value.ms === null) return '—';
        if (value.error) return value.error + ' (' + value.ms + ' ms)';
        if (typeof value.status === 'number') return value.status + ' (' + value.ms + ' ms)';
        return 'OK (' + value.ms + ' ms)';
    }
    function render(data) {
        var body = document.getElementById('results'), i, row, tr, values;
        body.innerHTML = '';
        for (i = 0; i < data.results.length; i++) {
            row = data.results[i]; tr = document.createElement('tr');
            values = [row.site, row.mode, stage(row.dns), stage(row.tcp), stage(row.tls), stage(row.http), String(row.durationMs), row.error || '—'];
            values.forEach(function (value) { var td = document.createElement('td'); td.textContent = value; tr.appendChild(td); });
            body.appendChild(tr);
        }
        document.getElementById('errors').textContent = data.logs && data.logs.length ? data.logs.join('\n') : 'No errors reported';
        updateStatus();
    }
    function run(mode) {
        if (busy) return; busy = true;
        document.getElementById('message').textContent = 'Running ' + mode + ' checks…';
        request('POST', '/api/test?mode=' + mode, function (error, data) {
            busy = false; if (error) return showError(error); render(data);
            document.getElementById('message').textContent = 'Completed ' + data.results.length + ' ' + mode + ' checks.';
        }, 120000);
    }
    function command(path, label) {
        request('POST', path, function (error) { if (error) return showError(error); document.getElementById('message').textContent = label; updateStatus(); });
    }
    window.onload = function () {
        document.getElementById('run-direct').onclick = function () { run('direct'); };
        document.getElementById('run-proxy').onclick = function () { run('proxy'); };
        document.getElementById('enable-proxy').onclick = function () { command('/api/proxy/enable', 'Proxy experiment enabled on loopback.'); };
        document.getElementById('disable-proxy').onclick = function () { command('/api/proxy/disable', 'Proxy disabled.'); };
        updateStatus();
    };
}());