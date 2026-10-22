'use strict';
var dns = require('dns');
var counts = {};
dns._tizendpiOriginalLookup = dns.lookup;
dns.lookup = function (host, options, callback) {
    if (typeof options === 'function') { callback = options; options = {}; }
    if (host !== 'www.youtube.com' && host !== 'youtubei.googleapis.com' && host !== 'i.ytimg.com' && host !== 'cdn.jsdelivr.net') return dns._tizendpiOriginalLookup(host, options, callback);
    counts[host] = (counts[host] || 0) + 1;
    if (process.env.TIZENDPI_DNS_FIXTURE_MODE === 'race' && host === 'www.youtube.com' && counts[host] === 1) {
        return setTimeout(function () { callback(null, '93.184.216.34', 4); }, 250);
    }
    process.nextTick(function () {
        var error = new Error('test fixture DNS failure');
        error.code = 'ENOTFOUND';
        callback(error);
    });
};

