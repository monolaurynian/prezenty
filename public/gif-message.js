/*
 * GIF messages: how a GIF is stored in a chat message and turned back into
 * a picture.
 *
 * One file, two consumers (same pattern as chat-reactions.js and
 * pluralize-pl.js): the server `require`s it for the preview text, the pages
 * load it as a <script> and get window.GifMessage.
 *
 * A GIF message is a message whose WHOLE body is one token:
 *
 *     [gif:giphy:xT4uQulxzV39haRFjG:200x150]
 *
 * Only the provider, the GIF's id and its size are stored - never a URL.
 * For GIPHY the URL is built here from the id, always on GIPHY's media host
 * (for the demo provider, a file in /demo-gifs/), so a crafted message can
 * only ever point at one of those. For KLIPY the id is a slug that
 * gif-klipy.js exchanges for the real URLs through KLIPY's API, and only
 * KLIPY hosts are accepted. Anything that does not match the strict pattern
 * below is plain text and is shown as text.
 *
 * No database change is needed: the token is just a message body.
 */
(function (root) {
    'use strict';

    // provider : id : width x height. Ids are letters, digits, "_" and "-"
    // (GIPHY ids are ~20 characters; KLIPY slugs are a title plus a number,
    // e.g. "hello-hi-662", so they can be longer).
    const TOKEN = /^\[gif:(giphy|klipy|demo):([A-Za-z0-9_-]{3,120}):(\d{2,4})x(\d{2,4})\]$/;
    const PROVIDERS = ['giphy', 'klipy', 'demo'];
    // Longest id each provider can really have. KLIPY slugs are a title plus
    // a number; GIPHY ids are short random strings. Keeping GIPHY and demo
    // ids tight means a token for them cannot be stretched to the KLIPY limit.
    const MAX_ID_LENGTH = { giphy: 40, demo: 40, klipy: 120 };
    const MIN_SIDE = 20;
    const MAX_SIDE = 2000;

    function inRange(n) {
        return Number.isInteger(n) && n >= MIN_SIDE && n <= MAX_SIDE;
    }

    /** { provider, id, width, height } for a GIF message body, else null. */
    function parseGif(body) {
        const text = String(body === null || body === undefined ? '' : body).trim();
        const match = TOKEN.exec(text);
        if (!match) return null;
        const width = Number(match[3]);
        const height = Number(match[4]);
        if (!inRange(width) || !inRange(height)) return null;
        if (match[2].length > MAX_ID_LENGTH[match[1]]) return null;
        return { provider: match[1], id: match[2], width: width, height: height };
    }

    /** The token to store for a picked GIF, or null if any part is invalid. */
    function buildGifToken(provider, id, width, height) {
        if (PROVIDERS.indexOf(provider) === -1) return null;
        const w = Math.round(Number(width));
        const h = Math.round(Number(height));
        if (!inRange(w) || !inRange(h)) return null;
        const token = '[gif:' + provider + ':' + id + ':' + w + 'x' + h + ']';
        return parseGif(token) ? token : null;
    }

    /**
     * Where to load the picture from. `animated` is the moving GIF, `still`
     * a small first-frame image (used for reduced motion and as a placeholder).
     * Built from the validated id only.
     */
    function gifUrls(gif) {
        if (!gif || !parseGif(buildGifToken(gif.provider, gif.id, gif.width, gif.height))) return null;
        // KLIPY requires its media URLs to be used exactly as its API returns
        // them (never rebuilt from an id), so there is nothing to compute
        // here: gif-klipy.js looks them up by slug.
        if (gif.provider === 'klipy') return null;
        // `zoom` is the larger picture shown in the zoom modal
        if (gif.provider === 'demo') {
            const url = '/demo-gifs/' + gif.id + '.gif';
            const still = '/demo-gifs/' + gif.id + '-still.gif';
            return { animated: url, still: still, zoom: { animated: url, still: still } };
        }
        const base = 'https://media.giphy.com/media/' + gif.id + '/';
        return {
            animated: base + '200w.gif',
            still: base + '200w_s.gif',
            zoom: { animated: base + 'giphy-downsized.gif', still: base + 'giphy_s.gif' }
        };
    }

    /** Size to draw at: never wider than maxWidth, aspect ratio kept. */
    function displaySize(gif, maxWidth) {
        const cap = Number.isFinite(maxWidth) && maxWidth > 0 ? maxWidth : 220;
        const width = Math.min(cap, gif.width);
        return { width: Math.round(width), height: Math.max(1, Math.round(gif.height * width / gif.width)) };
    }

    /**
     * A random id for THIS browser (kept in localStorage). GIF providers ask
     * for a stable per-user id to keep results consistent; this one is not
     * derived from, and cannot be linked to, the account. Browser only.
     */
    const CUSTOMER_KEY = 'prezenty-gif-customer';
    function customerId() {
        try {
            const storage = root.localStorage;
            let id = storage.getItem(CUSTOMER_KEY);
            if (!id) {
                const bytes = new Uint8Array(16);
                if (root.crypto && root.crypto.getRandomValues) {
                    root.crypto.getRandomValues(bytes);
                } else {
                    for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
                }
                id = Array.prototype.map.call(bytes, b => ('0' + b.toString(16)).slice(-2)).join('');
                storage.setItem(CUSTOMER_KEY, id);
            }
            return id;
        } catch (e) {
            return 'anonymous';
        }
    }

    /** One-line stand-in for conversation lists, notifications and excerpts. */
    const PREVIEW_LABEL = '\uD83C\uDF9E\uFE0F GIF';
    function gifPreviewText(body) {
        return parseGif(body) ? PREVIEW_LABEL : null;
    }

    const api = {
        parseGif: parseGif,
        buildGifToken: buildGifToken,
        gifUrls: gifUrls,
        displaySize: displaySize,
        customerId: customerId,
        gifPreviewText: gifPreviewText,
        PREVIEW_LABEL: PREVIEW_LABEL
    };

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = api;
    }
    if (typeof window !== 'undefined') window.GifMessage = api;
})(typeof window !== 'undefined' ? window : globalThis);
