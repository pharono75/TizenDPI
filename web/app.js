(function () {
    'use strict';

    var endpoint = 'http://127.0.0.1:8787/api/status';
    var busy = false;
    var labels = {
        service: 'HTTP service',
        tcp: 'TCP 443',
        dns: 'DNS',
        https: 'Outgoing HTTPS'
    };

    function showUnavailable(message) {
        var rows = document.getElementById('checks').getElementsByTagName('li');
        var i;
        for (i = 0; i < rows.length; i++) {
            rows[i].textContent = labels[rows[i].getAttribute('data-check')] + ': unavailable';
        }
        document.getElementById('node-version').textContent = 'TV Node version: unavailable';
        document.getElementById('errors').textContent = message;
    }

    function render(data) {
        var rows = document.getElementById('checks').getElementsByTagName('li');
        var i;
        var key;
        var item;
        for (i = 0; i < rows.length; i++) {
            key = rows[i].getAttribute('data-check');
            item = data[key];
            rows[i].textContent = labels[key] + ': ' +
                (item && item.ok ? 'OK' : 'FAILED' +
                    (item && item.error ? ' (' + item.error + ')' : ''));
        }

        if (data.service && data.service.nodeVersion) {
            document.getElementById('node-version').textContent =
                'TV Node version: ' + data.service.nodeVersion +
                ' | bind: ' + data.service.bindAddress + ':' + data.service.port;
        } else {
            document.getElementById('node-version').textContent =
                'TV Node version: not reported';
        }

        document.getElementById('errors').textContent =
            data.logs && data.logs.length ? data.logs.join('\n') : 'No errors reported';
    }

    function refresh() {
        var xhr;
        var timer;
        if (busy) return;
        busy = true;
        xhr = new XMLHttpRequest();

        function finish() {
            if (timer) clearTimeout(timer);
            busy = false;
        }

        xhr.open('GET', endpoint, true);
        xhr.onreadystatechange = function () {
            if (xhr.readyState !== 4) return;
            finish();
            if (xhr.status < 200 || xhr.status >= 300) {
                showUnavailable('Status request failed with HTTP ' + xhr.status);
                return;
            }
            try {
                render(JSON.parse(xhr.responseText));
            } catch (err) {
                showUnavailable('Invalid service response');
            }
        };
        xhr.onerror = function () {
            finish();
            showUnavailable('Loopback request failed. Check service status, CSP and CORS.');
        };
        xhr.onabort = function () {
            finish();
            showUnavailable('Loopback request timed out');
        };
        timer = setTimeout(function () {
            if (xhr.readyState !== 4) xhr.abort();
        }, 7000);

        try {
            xhr.send(null);
        } catch (err) {
            finish();
            showUnavailable('Could not start loopback request');
        }
    }

    window.onload = function () {
        document.getElementById('refresh').onclick = refresh;
        refresh();
        window.setInterval(refresh, 10000);
    };
}());
