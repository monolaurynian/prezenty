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
 * The URL is built here from the id, always on the provider's media host, so
 * a crafted message can only ever point at a GIPHY file (or, for the demo
 * provider, a file in /demo-gifs/). Anything that does not match the strict
 * pattern below is plain text and is shown as text.
 *
 * No database change is needed: the token is just a message body.
 */
(function (root) {
    'use strict';

    // provider : id : width x height. Ids are letters, digits, "_" and "-".
    const TOKEN = /^\[gif:(giphy|demo):([A-Za-z0-9_-]{3,40}):(\d{2,4})x(\d{2,4})\]$/;
    const PROVIDERS = ['giphy', 'demo'];
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
        if (gif.provider === 'demo') {
            const url = '/demo-gifs/' + gif.id + '.gif';
            return { animated: url, still: '/demo-gifs/' + gif.id + '-still.gif' };
        }
        const base = 'https://media.giphy.com/media/' + gif.id + '/';
        return { animated: base + '200w.gif', still: base + '200w_s.gif' };
    }

    /** Size to draw at: never wider than maxWidth, aspect ratio kept. */
    function displaySize(gif, maxWidth) {
        const cap = Number.isFinite(maxWidth) && maxWidth > 0 ? maxWidth : 220;
        const width = Math.min(cap, gif.width);
        return { width: Math.round(width), height: Math.max(1, Math.round(gif.height * width / gif.width)) };
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
        gifPreviewText: gifPreviewText,
        PREVIEW_LABEL: PREVIEW_LABEL
    };

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = api;
    }
    if (typeof window !== 'undefined') window.GifMessage = api;
})(typeof window !== 'undefined' ? window : globalThis);
