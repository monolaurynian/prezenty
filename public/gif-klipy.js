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
    const MEDIA_HOST = /^https:\/\/static[12]?\.klipy\.com\//;
    const PER_PAGE = 24;          // KLIPY allows 8-50
    const ITEMS_CHUNK = 20;       // slugs per "items" request
    const FORMATS = 'webp,gif,jpg'; // skip mp4/webm: smaller responses
    const FILTERS = ['off', 'low', 'medium', 'high'];

    const gifApi = root.GifMessage;
    let appKey = null;
    let contentFilter = 'high';

    const cache = new Map();   // slug -> { urls, width, height } | null (not found)
    const inFlight = new Map(); // slug -> Promise of the request that fetches it

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
        return API + encodeURIComponent(appKey) + '/' + path + '?' + query.toString();
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
        const batches = [];
        for (let i = 0; i < wanted.length; i += ITEMS_CHUNK) batches.push(wanted.slice(i, i + ITEMS_CHUNK));

        batches.forEach(function (batch) {
            const promise = request('gifs/items', {
                slugs: batch.join(','),
                customer_id: gifApi.customerId(),
                format_filter: FORMATS
            }).then(function (json) {
                const data = json.data || {};
                const found = new Set();
                (Array.isArray(data.data) ? data.data : []).forEach(function (item) {
                    const entry = normalize(item);
                    if (entry) {
                        cache.set(entry.id, { urls: entry.urls, width: entry.width, height: entry.height });
                        found.add(entry.id);
                    }
                });
                // Asked for but not returned: gone from KLIPY (remember that)
                batch.forEach(function (slug) { if (!found.has(slug)) cache.set(slug, null); });
            }).catch(function () {
                /* network / rate limit: leave uncached so the next refresh retries */
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
        share: share,
        normalize: normalize,
        MEDIA_HOST: MEDIA_HOST
    };
})(window);
