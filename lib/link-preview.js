// Moved verbatim from server.js (Phase 2 split), then hardened against SSRF:
// DNS-aware address checks, per-hop redirect checks and address pinning.
const dns = require('dns');
const net = require('net');
const http = require('http');
const https = require('https');
const zlib = require('zlib');

const linkPreviewCache = new Map(); // url -> { ts, data }
const LINK_PREVIEW_TTL = 24 * 60 * 60 * 1000;

// Addresses a link preview must never connect to: loopback, private,
// link-local (cloud metadata), CGNAT, unspecified, multicast, reserved...
// Separate lists per family: node matches IPv4 addresses against IPv4-mapped
// IPv6 rules, which would otherwise block every IPv4 address.
const blockedV4 = new net.BlockList();
const blockedV6 = new net.BlockList();
[
    ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8],
    ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24],
    ['192.168.0.0', 16], ['198.18.0.0', 15], ['198.51.100.0', 24], ['203.0.113.0', 24],
    ['224.0.0.0', 4], ['240.0.0.0', 4]
].forEach(([addr, prefix]) => blockedV4.addSubnet(addr, prefix, 'ipv4'));
[
    ['::', 96], // unspecified, loopback and deprecated IPv4-compatible
    ['::ffff:0:0', 96], // IPv4-mapped: blocked wholesale
    ['64:ff9b::', 96],  // NAT64
    ['100::', 64], ['2001:db8::', 32],
    ['2002::', 16],     // 6to4
    ['fc00::', 7], ['fe80::', 10], ['ff00::', 8]
].forEach(([addr, prefix]) => blockedV6.addSubnet(addr, prefix, 'ipv6'));

// True when the address must not be contacted. Fails closed for anything
// that is not a valid IP address.
function isBlockedAddress(ip) {
    if (typeof ip !== 'string') return true;
    const addr = ip.split('%')[0]; // strip IPv6 zone id
    const family = net.isIP(addr);
    if (family === 0) return true;
    return family === 4 ? blockedV4.check(addr, 'ipv4') : blockedV6.check(addr, 'ipv6');
}

function isSafePreviewUrl(parsed, isBlocked = isBlockedAddress) {
    if (!['http:', 'https:'].includes(parsed.protocol)) return false;
    // new URL() already canonicalizes 0x7f.0.0.1 / 2130706433 / octal forms
    let host = parsed.hostname.toLowerCase();
    if (host.startsWith('[') && host.endsWith(']')) host = host.slice(1, -1);
    if (host.endsWith('.')) host = host.slice(0, -1);
    if (!host) return false;
    if (host === 'localhost' || host.endsWith('.localhost')) return false;
    if (!host.includes('.') && !host.includes(':')) return false; // single-label host
    if (net.isIP(host.split('%')[0]) !== 0) return !isBlocked(host);
    return true;
}

// dns.lookup replacement for http(s).request({ lookup }): resolves once,
// rejects when ANY address is blocked, and hands only validated addresses to
// the socket (so there is no gap between the check and the connect).
function createSafeLookup(dnsLookup, isBlocked = isBlockedAddress) {
    const resolve = dnsLookup || ((hostname, opts, cb) => dns.lookup(hostname, opts, cb));
    return function safeLookup(hostname, options, callback) {
        if (typeof options === 'function') { callback = options; options = {}; }
        if (typeof options === 'number') options = { family: options };
        options = options || {};
        resolve(hostname, { all: true, verbatim: true }, (err, addresses) => {
            if (err) return callback(err);
            const list = Array.isArray(addresses) ? addresses : (addresses ? [{ address: addresses, family: net.isIP(addresses) }] : []);
            if (list.length === 0 || list.some(a => isBlocked(a.address))) {
                const blocked = new Error('Blocked address for ' + hostname);
                blocked.code = 'ESSRF_BLOCKED';
                return callback(blocked);
            }
            let usable = list;
            if (options.family === 4 || options.family === 6) {
                usable = list.filter(a => a.family === options.family);
                if (usable.length === 0) {
                    const none = new Error('No address of requested family for ' + hostname);
                    none.code = 'ENOTFOUND';
                    return callback(none);
                }
            }
            if (options.all) return callback(null, usable.map(a => ({ address: a.address, family: a.family })));
            return callback(null, usable[0].address, usable[0].family);
        });
    };
}

const REDIRECT_STATUSES = [301, 302, 303, 307, 308];

function createPreviewFetcher({ lookup, isBlockedAddress: isBlocked = isBlockedAddress } = {}) {
    const safeLookup = lookup || createSafeLookup(undefined, isBlocked);

    return function fetchPreview(rawUrl, { timeoutMs = 6000, maxChars = 300000, maxRedirects = 3 } = {}) {
        return new Promise((resolve, reject) => {
            let settled = false;
            let currentReq = null;
            let timer = null;
            const cleanup = [];

            const finish = (err, value) => {
                if (settled) return;
                settled = true;
                clearTimeout(timer);
                cleanup.forEach(fn => { try { fn(); } catch (e) { /* ignore */ } });
                if (currentReq) currentReq.destroy();
                if (err) reject(err); else resolve(value);
            };

            // One overall timer: covers redirects and waiting for headers
            timer = setTimeout(() => finish(new Error('Link preview timed out')), timeoutMs);

            const requestHop = (url, redirects) => {
                if (!isSafePreviewUrl(url, isBlocked)) {
                    return finish(new Error('Unsupported preview URL'));
                }
                const mod = url.protocol === 'https:' ? https : http;
                const req = mod.request(url, {
                    method: 'GET',
                    agent: false, // no socket reuse: every hop re-resolves and re-validates
                    lookup: safeLookup,
                    headers: {
                        'User-Agent': 'Mozilla/5.0 (compatible; PrezentyBot/1.0; link preview)',
                        'Accept': 'text/html,application/xhtml+xml',
                        'Accept-Encoding': 'gzip, deflate, br'
                    }
                });
                currentReq = req;
                req.on('error', err => finish(err));
                req.on('response', res => {
                    // Covers IP-literal hosts, which skip the lookup hook
                    const sock = res.socket || req.socket;
                    if (!sock || isBlocked(sock.remoteAddress)) {
                        res.resume();
                        return finish(new Error('Blocked remote address'));
                    }

                    if (REDIRECT_STATUSES.includes(res.statusCode) && res.headers.location) {
                        res.resume();
                        if (redirects >= maxRedirects) return finish(new Error('Too many redirects'));
                        let next;
                        try { next = new URL(res.headers.location, url); } catch (e) { return finish(new Error('Invalid redirect URL')); }
                        return requestHop(next, redirects + 1);
                    }

                    clearTimeout(timer); // final headers arrived
                    const contentType = res.headers['content-type'] || '';
                    if (!contentType.includes('text/html')) {
                        res.destroy();
                        return finish(null, { finalUrl: url.href, contentType, html: '' });
                    }

                    let stream = res;
                    const encoding = String(res.headers['content-encoding'] || '').trim().toLowerCase();
                    if (encoding && encoding !== 'identity') {
                        const sync = { flush: zlib.constants.Z_SYNC_FLUSH, finishFlush: zlib.constants.Z_SYNC_FLUSH };
                        let decoder;
                        if (encoding === 'gzip' || encoding === 'x-gzip') decoder = zlib.createGunzip(sync);
                        else if (encoding === 'deflate') decoder = zlib.createInflate(sync);
                        else if (encoding === 'br') decoder = zlib.createBrotliDecompress();
                        else return finish(new Error('Unsupported content-encoding'));
                        decoder.on('error', err => finish(err));
                        cleanup.push(() => decoder.destroy());
                        res.pipe(decoder);
                        stream = decoder;
                    }
                    cleanup.push(() => res.destroy());

                    // Read at most ~maxChars - og tags live in <head>
                    const textDecoder = new TextDecoder();
                    let html = '';
                    const done = () => finish(null, { finalUrl: url.href, contentType, html });
                    res.on('error', err => finish(err));
                    stream.on('data', chunk => {
                        html += textDecoder.decode(chunk, { stream: true });
                        if (html.length >= maxChars) done();
                    });
                    stream.on('end', done);
                });
                req.end();
            };

            let first;
            try { first = new URL(rawUrl); } catch (e) { return finish(new Error('Invalid URL')); }
            requestHop(first, 0);
        });
    };
}

const fetchPreview = createPreviewFetcher();

function extractMeta(html, prop) {
    const patterns = [
        new RegExp(`<meta[^>]+(?:property|name)=["']${prop}["'][^>]*content=["']([^"']*)["']`, 'i'),
        new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]*(?:property|name)=["']${prop}["']`, 'i')
    ];
    for (const re of patterns) {
        const m = html.match(re);
        if (m && m[1]) return m[1].trim();
    }
    return null;
}

module.exports = {
    linkPreviewCache, LINK_PREVIEW_TTL, isSafePreviewUrl, extractMeta,
    isBlockedAddress, createSafeLookup, createPreviewFetcher, fetchPreview
};
