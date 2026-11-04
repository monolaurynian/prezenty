// GIF support: which provider is on, and what the browser needs to use it.
//
// GIFs come from GIPHY. GIPHY requires search and trending requests to be
// made from the user's browser, so the server's whole job is to hand the
// signed-in user the (public-by-design) API key. Nothing is stored and the
// server never talks to GIPHY.
//
//   GIPHY_API_KEY   key from https://developers.giphy.com (a free "beta" key
//                   allows 100 calls an hour). Unset = GIFs are switched off
//                   and the GIF buttons stay hidden.
//   GIPHY_RATING    max content rating: g, pg, pg-13 or r (default pg).
//
// Demo mode (no database) serves a few local GIFs instead, with no key, so
// the feature can be run and tested offline.
const { DEMO_MODE } = require('./db');

const RATINGS = ['g', 'pg', 'pg-13', 'r'];

function gifConfig() {
    if (DEMO_MODE) {
        return { enabled: true, provider: 'demo', apiKey: null, rating: 'pg' };
    }
    const apiKey = String(process.env.GIPHY_API_KEY || '').trim();
    if (!apiKey) return { enabled: false, provider: null, apiKey: null, rating: null };
    const rating = String(process.env.GIPHY_RATING || 'pg').trim().toLowerCase();
    return {
        enabled: true,
        provider: 'giphy',
        apiKey,
        rating: RATINGS.indexOf(rating) === -1 ? 'pg' : rating
    };
}

function gifEnabled() {
    return gifConfig().enabled;
}

module.exports = { gifConfig, gifEnabled };
