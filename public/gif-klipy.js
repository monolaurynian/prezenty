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
    let learnedVariant = 0;    // which way of asking "items" last found a GIF the first way missed

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

        // The ways of asking the "items" endpoint, the documented one first.
        // The others are only used for a GIF the first answer left out, in
        // case the extra parameters of the first one were what hid it.
        const VARIANTS = [
            function (list) { return { slugs: list.join(','), customer_id: gifApi.customerId(), format_filter: FORMATS }; },
            function (list) { return { slugs: list.join(',') }; },
            function (list) { return { slugs: list.join(','), customer_id: gifApi.customerId(), locale: 'pl' }; },
            // Slugs such as "merry-christmas-trump--krgkjE0X7" carry a mixed-case
            // id; in one real chat every GIF with such a slug was "not found"
            // while the all-lowercase ones were found. Try lowercase last.
            function (list) { return { slugs: list.map(function (s) { return s.toLowerCase(); }).join(','), customer_id: gifApi.customerId(), format_filter: FORMATS }; },
            // Last resort: only the id after "--" (the part that tells two
            // GIFs with the same title apart)
            function (list) { return { slugs: list.map(idPart).join(','), customer_id: gifApi.customerId(), format_filter: FORMATS }; }
        ];

        // "merry-christmas-trump--krgkjE0X7" -> "krgkjE0X7" ("" when there is no "--")
        function idPart(slug) {
            const at = slug.lastIndexOf('--');
            return at > 0 && slug.length - at - 2 >= 6 ? slug.slice(at + 2) : '';
        }
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
                list.forEach(function (item) {
                    const entry = normalize(item);
                    if (entry) entries.push(entry);
                    else rejected.push((item && item.slug) + ': ' + whyNot(item));
                });
                // Match what came back to what was asked for. The slug KLIPY
                // returns may differ from ours in letter case, so fall back to
                // a case-insensitive match - stored under OUR slug, the one in the message.
                slugList.forEach(function (slug) {
                    const id = idPart(slug).toLowerCase();
                    const entry = entries.find(function (e) { return e.id === slug; }) ||
                        entries.find(function (e) { return e.id.toLowerCase() === slug.toLowerCase(); }) ||
                        (id ? entries.find(function (e) { return e.id.toLowerCase().endsWith('--' + id); }) : null);
                    if (!entry) return;
                    cache.set(slug, { urls: entry.urls, width: entry.width, height: entry.height });
                    found.add(slug);
                });
                const missing = slugList.filter(function (slug) { return !found.has(slug); });
                const unmatched = entries.filter(function (e) {
                    return !slugList.some(function (slug) { return slug.toLowerCase() === e.id.toLowerCase(); });
                });
                if (missing.length && unmatched.length) {
                    rejected.push('answered with other slugs: ' + unmatched.map(function (e) { return e.id; }).join(', '));
                }
                return { missing: missing, rejected: rejected };
            });
        }

        // A GIF left out of the first answer is asked for on its own, in the
        // other ways, before it counts as gone. Resolves to true when found.
        function askAgain(slug, notes) {
            // the way that worked last time goes first, to spare the request budget
            const order = [];
            if (learnedVariant > 0) order.push(learnedVariant);
            for (let v = 1; v < VARIANTS.length; v++) if (v !== learnedVariant) order.push(v);
            return order.reduce(function (chain, variant) {
                return chain.then(function (done) {
                    if (done) return true;
                    // the lowercase way is pointless for a slug that is already lowercase
                    if (variant === 3 && slug === slug.toLowerCase()) return false;
                    // ...and the id-only way needs an id
                    if (variant === 4 && !idPart(slug)) return false;
                    return lookup([slug], variant).then(function (result) {
                        result.rejected.forEach(function (note) { notes.push(note); });
                        if (result.missing.length === 0) { learnedVariant = variant; return true; }
                        return false;
                    });
                });
            }, Promise.resolve(false));
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
