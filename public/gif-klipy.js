/*
 * KLIPY client: search / trending for the picker, and turning a stored slug
 * back into the real picture URLs for the chat.
 *
 *   GifKlipy.configure(config)     config = GET /api/wiadomosci/gif-config
 *   GifKlipy.hasKey()
 *   GifKlipy.search(query, page)   -> { items, hasMore, next }   (picker)
 *   GifKlipy.resolve(slugs)        -> Promise; fills the cache  (chat)
 *   GifKlipy.cached(slug)          -> { urls, width, height } | null | undefined
 *   GifKlipy.share(slug, query)    tells KLIPY a GIF was sent
 *
 * KLIPY's integration rules shape this file (docs.klipy.com, "Integration
 * Requirements"):
 *   - requests come from the user's browser, never through our server;
 *   - media URLs are used exactly as the API returned them. They are never
 *     rebuilt from an id, which is why a message stores only the slug and the
 *     page asks KLIPY's "items" endpoint for the URLs when it shows it;
 *   - results are shown in the order KLIPY sent them, unfiltered by us
 *     (filtering is the `content_filter` setting, below);
 *   - ads are opt-in per API key; if one ever arrives (type "ad") it is not
 *     a GIF and is skipped, so keep ads switched off for this key.
 *
 * An invalid key answers HTTP 404 (not 401) with
 * { result: false, errors: { message: [...] } }.
 *
 * Every URL is also checked against KLIPY's own media hosts before it can
 * reach an <img>, so a tampered response cannot point the page elsewhere.
 */
(function (root) {
    'use strict';

    if (typeof document === 'undefined') return;

    const API = 'https://api.klipy.com/api/v1/';
    // Any host under klipy.com (static.klipy.com, static1..., a CDN name...):
    // KLIPY's own domain only, https only
    const MEDIA_HOST = /^https:\/\/(?:[a-z0-9-]+\.)+klipy\.com\//;
    const PER_PAGE = 24;          // KLIPY allows 8-50
    const ITEMS_CHUNK = 20;       // slugs per "items" request
    const FORMATS = 'webp,gif,jpg'; // skip mp4/webm: smaller responses
    const FILTERS = ['off', 'low', 'medium', 'high'];

    const gifApi = root.GifMessage;
    let appKey = null;
    let contentFilter = 'high';

    const cache = new Map();   // slug -> { urls, width, height } | null (not found)
    const inFlight = new Map(); // slug -> Promise of the request that fetches it
    // Slugs whose last lookup FAILED (network, rate limit, bad key) - which
    // is different from KLIPY saying it no longer has the GIF (cache = null).
    // A failure is temporary, so it is never remembered as "gone".
    const failed = new Map();  // slug -> error kind ('rate' | 'key' | 'http' | 'network')

    function configure(config) {
        appKey = config && config.klipyKey ? String(config.klipyKey) : null;
        const level = config && config.contentFilter;
        contentFilter = FILTERS.indexOf(level) === -1 ? 'high' : level;
    }

    function hasKey() {
        return !!appKey;
    }

    function makeError(kind, message) {
        const error = new Error(message);
        error.kind = kind;
        return error;
    }

    function url(path, params) {
        const query = new URLSearchParams(params);
        // A comma is legal in a query string and is how the "items" endpoint
        // separates slugs (slugs=a,b), so send it as written, not as %2C
        return API + encodeURIComponent(appKey) + '/' + path + '?' + query.toString().replace(/%2C/gi, ',');
    }

    // The renditions to use: ~220px wide ("sm") is right for a chat bubble
    // and a thumbnail; fall back to bigger ones only if it is missing. The
    // zoom modal prefers the next size up ("md", ~340px), then "hd".
    const SIZES = ['sm', 'md', 'xs', 'hd'];
    const ZOOM_SIZES = ['md', 'hd', 'sm'];

    function pickMedia(file, kinds, sizes) {
        const order = sizes || SIZES;
        for (let i = 0; i < order.length; i++) {
            const size = file && file[order[i]];
            if (!size) continue;
            for (let k = 0; k < kinds.length; k++) {
                const media = size[kinds[k]];
                if (media && typeof media.url === 'string' && MEDIA_HOST.test(media.url)) {
                    return { url: media.url, width: Number(media.width), height: Number(media.height) };
                }
            }
        }
        return null;
    }

    /** One API item -> what the picker and the chat need, or null if unusable. */
    function normalize(item) {
        if (!item || (item.type && item.type !== 'gif')) return null; // ads etc.
        const slug = item.slug;
        if (typeof slug !== 'string') return null;
        // animated WebP is far lighter than the GIF of the same picture
        const animated = pickMedia(item.file, ['webp', 'gif']);
        if (!animated || !(animated.width > 0) || !(animated.height > 0)) return null;
        const still = pickMedia(item.file, ['jpg']) || animated;
        const width = Math.round(animated.width);
        const height = Math.round(animated.height);
        if (!gifApi.buildGifToken('klipy', slug, width, height)) return null;
        // The bigger picture for the zoom modal: also a URL KLIPY returned,
        // untouched (never rebuilt); falls back to the chat-size one
        const zoomAnimated = pickMedia(item.file, ['webp', 'gif'], ZOOM_SIZES) || animated;
        const zoomStill = pickMedia(item.file, ['jpg'], ZOOM_SIZES) || still;
        return {
            provider: 'klipy', id: slug, width: width, height: height,
            title: typeof item.title === 'string' ? item.title : '',
            urls: {
                animated: animated.url, still: still.url,
                zoom: { animated: zoomAnimated.url, still: zoomStill.url }
            },
            analytics: null
        };
    }

    /** Why normalize() would refuse this item, for the console (diagnosis only). */
    function whyNot(item) {
        if (!item || typeof item !== 'object') return 'not an object';
        if (item.type && item.type !== 'gif') return 'type is "' + item.type + '", not gif';
        if (typeof item.slug !== 'string') return 'no slug';
        const animated = pickMedia(item.file, ['webp', 'gif']);
        if (!animated) {
            const sample = [];
            Object.keys(item.file || {}).forEach(function (size) {
                Object.keys(item.file[size] || {}).forEach(function (kind) {
                    const media = item.file[size][kind];
                    if (media && typeof media.url === 'string' && sample.length < 3) sample.push(size + '.' + kind + '=' + media.url.slice(0, 60));
                });
            });
            return 'no usable webp/gif on a klipy.com host (' + (sample.join(' ') || 'item has no files') + ')';
        }
        if (!(animated.width > 0) || !(animated.height > 0)) return 'no width/height';
        if (!gifApi.buildGifToken('klipy', item.slug, Math.round(animated.width), Math.round(animated.height))) {
            return 'slug or size not allowed in a message (' + item.slug.length + ' chars, ' + animated.width + 'x' + animated.height + ')';
        }
        return 'unknown';
    }

    async function request(path, params, options) {
        const response = await root.fetch(url(path, params), options);
        if (response.status === 429) throw makeError('rate', 'Za dużo wyszukiwań. Spróbuj za chwilę.');
        // KLIPY answers an invalid key with 404, not 401
        if (response.status === 404 || response.status === 401 || response.status === 403) {
            throw makeError('key', 'GIF-y są chwilowo niedostępne.');
        }
        if (!response.ok) throw makeError('http', 'Nie udało się pobrać GIF-ów.');
        const json = await response.json();
        if (!json || json.result === false) throw makeError('http', 'Nie udało się pobrać GIF-ów.');
        return json;
    }

    /** Trending (no query) or search. `page` starts at 1. */
    async function search(query, page) {
        if (!appKey) throw makeError('key', 'GIF-y są chwilowo niedostępne.');
        const params = {
            page: String(page || 1),
            per_page: String(PER_PAGE),
            customer_id: gifApi.customerId(),
            locale: 'pl',
            content_filter: contentFilter,
            format_filter: FORMATS
        };
        if (query) params.q = query;
        const json = await request(query ? 'gifs/search' : 'gifs/trending', params);
        const data = json.data || {};
        const raw = Array.isArray(data.data) ? data.data : [];
        const items = raw.map(normalize).filter(Boolean);
        // Prime the chat's cache: these GIFs may be sent a moment from now
        items.forEach(item => cache.set(item.id, { urls: item.urls, width: item.width, height: item.height }));
        return { items: items, hasMore: !!data.has_next, next: (page || 1) + 1 };
    }

    /** Fetches the real URLs for slugs not seen yet (batched, deduplicated). */
    function resolve(slugs) {
        const wanted = Array.from(new Set(slugs)).filter(slug => !cache.has(slug) && !inFlight.has(slug));
        wanted.forEach(function (slug) { failed.delete(slug); }); // asking again
        const batches = [];
        for (let i = 0; i < wanted.length; i += ITEMS_CHUNK) batches.push(wanted.slice(i, i + ITEMS_CHUNK));

        // Searched GIFs have slugs like "merry-christmas-trump--krgkjE0X7": the
        // title plus "--" and an id. Asked for by that slug, KLIPY's "items"
        // endpoint answers with the item under the title alone
        // ("merry-christmas-trump"), as seen in a real chat. Two such GIFs can
        // share a title ("love-you-3775"), so a title can only be trusted for a
        // slug when it is unambiguous: one slug asked, one item answered.
        function titleOf(slug) {
            const at = slug.lastIndexOf('--');
            return at > 0 ? slug.slice(0, at) : '';
        }

        // The documented request first; a GIF it leaves out is asked for alone
        // (so there is nothing to confuse), without the extra parameters.
        const VARIANTS = [
            function (list) { return { slugs: list.join(','), customer_id: gifApi.customerId(), format_filter: FORMATS }; },
            function (list) { return { slugs: list.join(',') }; }
        ];
        const MAX_SECOND_TRIES = 8;   // protects the hourly request budget

        // One "items" request. Fills the cache with what came back and
        // resolves to { missing: slugs not usable, rejected: why, for the console }
        function lookup(slugList, variant) {
            return request('gifs/items', VARIANTS[variant](slugList)).then(function (json) {
                const data = json.data || {};
                const list = Array.isArray(data.data) ? data.data : [];
                const found = new Set();
                const rejected = [];
                const entries = [];
                const used = new Set();
                list.forEach(function (item) {
                    const entry = normalize(item);
                    if (entry) entries.push(entry);
                    else rejected.push((item && item.slug) + ': ' + whyNot(item));
                });
                // Match what came back to what was asked for: the same slug, the
                // same slug in other letter case, or - when unambiguous - the
                // title of a "title--id" slug. Always stored under OUR slug, the
                // one in the message.
                slugList.forEach(function (slug) {
                    const lower = slug.toLowerCase();
                    const title = titleOf(lower);
                    let entry = entries.find(function (e) { return e.id === slug; }) ||
                        entries.find(function (e) { return e.id.toLowerCase() === lower; });
                    if (!entry && title) {
                        const askedWithTitle = slugList.filter(function (s) { return titleOf(s.toLowerCase()) === title || s.toLowerCase() === title; });
                        const answeredWithTitle = entries.filter(function (e) { return e.id.toLowerCase() === title; });
                        if (askedWithTitle.length === 1 && answeredWithTitle.length === 1) entry = answeredWithTitle[0];
                    }
                    if (!entry) return;
                    used.add(entry);
                    cache.set(slug, { urls: entry.urls, width: entry.width, height: entry.height });
                    found.add(slug);
                });
                const missing = slugList.filter(function (slug) { return !found.has(slug); });
                const unmatched = entries.filter(function (e) { return !used.has(e); });
                if (missing.length && unmatched.length) {
                    rejected.push('answered with other slugs: ' + unmatched.map(function (e) { return e.id; }).join(', '));
                }
                return { missing: missing, rejected: rejected };
            });
        }

        // A GIF left out of the first answer is asked for on its own before it
        // counts as gone. Resolves to true when found.
        function askAgain(slug, notes) {
            return lookup([slug], 1).then(function (result) {
                result.rejected.forEach(function (note) { notes.push(note); });
                return result.missing.length === 0;
            });
        }

        batches.forEach(function (batch) {
            const notes = [];
            const promise = lookup(batch, 0).then(function (first) {
                first.rejected.forEach(function (note) { notes.push(note); });
                const tries = first.missing.slice(0, MAX_SECOND_TRIES);
                const untried = first.missing.slice(MAX_SECOND_TRIES);
                return tries.reduce(function (chain, slug) {
                    return chain.then(function (gone) {
                        return askAgain(slug, notes).then(function (found) { return found ? gone : gone.concat(slug); });
                    });
                }, Promise.resolve([])).then(function (gone) { return gone.concat(untried); });
            }).then(function (gone) {
                // Still not usable after every way of asking: gone from KLIPY (remember that)
                gone.forEach(function (slug) { cache.set(slug, null); });
                if (gone.length && root.console && root.console.warn) {
                    root.console.warn('[GIF] KLIPY has no usable GIF for: ' + gone.join(', ') +
                        (notes.length ? ' | KLIPY sent but we could not use: ' + notes.join(' ; ') : ' | KLIPY did not send them at all'));
                }
            }).catch(function (error) {
                // Network / rate limit / key: NOT "the GIF is gone". Leave it
                // uncached (so a retry asks again) but remember why it failed.
                const kind = (error && error.kind) || 'network';
                batch.forEach(function (slug) { failed.set(slug, kind); });
                if (root.console && root.console.warn) {
                    root.console.warn('[GIF] KLIPY lookup failed (' + kind + ') for ' + batch.length + ' GIF(s)' +
                        (kind === 'rate' ? ' - the test key allows 100 requests per hour' : ''));
                }
            }).then(function () {
                batch.forEach(function (slug) { inFlight.delete(slug); });
            });
            batch.forEach(function (slug) { inFlight.set(slug, promise); });
        });

        return Promise.all(slugs.map(function (slug) { return inFlight.get(slug); }).filter(Boolean));
    }

    function cached(slug) {
        return cache.get(slug);
    }

    /** Why the last lookup of this slug failed, or null if it did not. */
    function failure(slug) {
        return failed.get(slug) || null;
    }

    /** Drops everything known about a slug, so the next resolve() asks KLIPY again. */
    function forget(slug) {
        cache.delete(slug);
        failed.delete(slug);
    }

    /** Fire-and-forget: "this GIF was shared" (improves their ranking). */
    function share(slug, query) {
        if (!appKey) return;
        try {
            root.fetch(url('gifs/share/' + encodeURIComponent(slug), {}), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ customer_id: gifApi.customerId(), q: query || '' }),
                keepalive: true
            }).catch(function () {});
        } catch (e) { /* analytics must never break sending */ }
    }

    root.GifKlipy = {
        configure: configure,
        hasKey: hasKey,
        search: search,
        resolve: resolve,
        cached: cached,
        failure: failure,
        forget: forget,
        share: share,
        normalize: normalize,
        MEDIA_HOST: MEDIA_HOST
    };
})(window);
