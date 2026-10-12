// Moved verbatim from server.js (Phase 2 split)

const linkPreviewCache = new Map(); // url -> { ts, data }
const LINK_PREVIEW_TTL = 24 * 60 * 60 * 1000;

function isSafePreviewUrl(parsed) {
    if (!['http:', 'https:'].includes(parsed.protocol)) return false;
    const host = parsed.hostname.toLowerCase();
    // SSRF guard: no localhost / private ranges / raw metadata endpoints
    if (host === 'localhost' || host === '0.0.0.0' || host === '[::1]') return false;
    if (/^127\.|^10\.|^192\.168\.|^169\.254\./.test(host)) return false;
    if (/^172\.(1[6-9]|2\d|3[01])\./.test(host)) return false;
    return true;
}

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

module.exports = { linkPreviewCache, LINK_PREVIEW_TTL, isSafePreviewUrl, extractMeta };
