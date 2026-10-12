'use strict';
/**
 * Every page pulls Bootstrap from cdn.jsdelivr.net and icon fonts from
 * cdnjs.cloudflare.com. Blocking them is not an option - it changes layout and
 * would invalidate every overflow / wrapping measurement. So the first run
 * fetches them and writes them through to tests/.cache/cdn/, and every later
 * run is served from disk: fast and offline.
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const CACHE_DIR = path.join(__dirname, '..', '.cache', 'cdn');
const CDN_HOSTS = ['cdn.jsdelivr.net', 'cdnjs.cloudflare.com'];

function keyFor(url) {
    return crypto.createHash('sha1').update(url).digest('hex');
}

function paths(url) {
    const k = keyFor(url);
    return {
        body: path.join(CACHE_DIR, k + '.bin'),
        meta: path.join(CACHE_DIR, k + '.json')
    };
}

function isCdnUrl(url) {
    try {
        return CDN_HOSTS.includes(new URL(url).hostname);
    } catch (e) {
        return false;
    }
}

/**
 * Install the read-through/write-through CDN cache on a context.
 * Returns a stats object: { hits, misses, failures: [url] }.
 */
async function installCdnCache(context) {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
    const stats = { hits: 0, misses: 0, failures: [] };

    await context.route(url => isCdnUrl(typeof url === 'string' ? url : url.toString()), async (route) => {
        const url = route.request().url();
        const p = paths(url);

        if (fs.existsSync(p.meta) && fs.existsSync(p.body)) {
            stats.hits++;
            const meta = JSON.parse(fs.readFileSync(p.meta, 'utf8'));
            return route.fulfill({
                status: meta.status,
                headers: meta.headers,
                body: fs.readFileSync(p.body)
            });
        }

        stats.misses++;
        let response;
        try {
            response = await route.fetch();
        } catch (err) {
            stats.failures.push(url);
            // Abort rather than hang; installCdnGuard turns this into a clear
            // "CDN unreachable and not cached" failure.
            return route.abort('failed');
        }

        const body = await response.body();
        const contentType = response.headers()['content-type'] || 'application/octet-stream';
        fs.writeFileSync(p.body, body);
        fs.writeFileSync(p.meta, JSON.stringify({
            url,
            status: response.status(),
            headers: { 'content-type': contentType, 'cache-control': 'no-store' }
        }, null, 2));
        return route.fulfill({
            status: response.status(),
            headers: { 'content-type': contentType },
            body
        });
    });

    return stats;
}

/**
 * Turn a dead CDN into an explicit, actionable error instead of a confusing
 * layout-assertion failure 20 lines later.
 */
function cdnGuardMessage(stats) {
    if (!stats.failures.length) return null;
    return 'CDN unreachable and not cached - run the suite once with internet access ' +
        'to populate tests/.cache/cdn/. Failed URLs:\n  ' + stats.failures.join('\n  ');
}

module.exports = { installCdnCache, cdnGuardMessage, isCdnUrl, CACHE_DIR, CDN_HOSTS };
