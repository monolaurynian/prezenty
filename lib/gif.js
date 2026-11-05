// GIF support: which provider is on, and what the browser needs to use it.
//
// GIFs come from KLIPY or GIPHY. Both require search and trending requests to
// be made from the user's browser, so the server's whole job is to hand the
// signed-in user the (public-by-design) API key. Nothing is stored and the
// server never talks to either provider.
//
//   KLIPY_API_KEY         app key from https://partner.klipy.com
//   KLIPY_CONTENT_FILTER  off | low | medium | high   (default high)
//   GIPHY_API_KEY         key from https://developers.giphy.com
//   GIPHY_RATING          g | pg | pg-13 | r          (default pg)
//   GIF_PROVIDER          klipy | giphy - which one the picker uses when
//                         both keys are set (default klipy)
//
// No key = GIFs are switched off and the GIF buttons stay hidden.
//
// `klipyKey` is sent whenever it is set, even if GIPHY is the active picker:
// a KLIPY GIF already sent in the chat can only be shown by asking KLIPY for
// its picture, which needs the key. (GIPHY pictures need no key to display.)
//
// Demo mode (no database) serves a few local GIFs instead, with no key, so
// the feature can be run and tested offline.
const { DEMO_MODE } = require('./db');

const RATINGS = ['g', 'pg', 'pg-13', 'r'];
const FILTERS = ['off', 'low', 'medium', 'high'];

function clean(value) {
    return String(value || '').trim();
}

function gifConfig() {
    if (DEMO_MODE) {
        return {
            enabled: true, provider: 'demo', apiKey: null,
            rating: 'pg', contentFilter: 'high', klipyKey: null
        };
    }

    const klipyKey = clean(process.env.KLIPY_API_KEY);
    const giphyKey = clean(process.env.GIPHY_API_KEY);

    let provider = clean(process.env.GIF_PROVIDER).toLowerCase();
    if (provider !== 'klipy' && provider !== 'giphy') provider = null;
    // Honour the choice only if that provider has a key; otherwise fall back
    if (provider === 'klipy' && !klipyKey) provider = null;
    if (provider === 'giphy' && !giphyKey) provider = null;
    if (!provider) provider = klipyKey ? 'klipy' : (giphyKey ? 'giphy' : null);

    const rating = clean(process.env.GIPHY_RATING).toLowerCase();
    const filter = clean(process.env.KLIPY_CONTENT_FILTER).toLowerCase();

    return {
        enabled: !!provider,
        provider,
        apiKey: provider === 'klipy' ? klipyKey : (provider === 'giphy' ? giphyKey : null),
        rating: provider ? (RATINGS.indexOf(rating) === -1 ? 'pg' : rating) : null,
        contentFilter: provider ? (FILTERS.indexOf(filter) === -1 ? 'high' : filter) : null,
        klipyKey: klipyKey || null
    };
}

function gifEnabled() {
    return gifConfig().enabled;
}

// KLIPY is the provider in use (it is the one with stickers and memes)
function klipyEnabled() {
    return gifConfig().provider === 'klipy';
}

module.exports = { gifConfig, gifEnabled, klipyEnabled };
