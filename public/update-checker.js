// "Nowa wersja" banner: tells signed-in users what is new, once.
//
// The banner only appears when the server has release notes worth showing
// (lib/release-notes.js, delivered through /api/version as `release`).
// Releases without notes still reach everyone - the service worker refreshes
// its caches in the background - they just do not interrupt anybody.
(function() {
    'use strict';

    const UPDATE_CHECK_INTERVAL = 5 * 60 * 1000; // Check every 5 minutes
    const STORAGE_KEY = 'app_version';      // last version/cache generation seen
    const SEEN_KEY = 'app_release_seen';    // id of the last announcement shown
    const BANNER_ID = 'updateBanner';

    async function checkForUpdates() {
        try {
            const response = await fetch('/api/version', {
                cache: 'no-cache',
                headers: {
                    'Cache-Control': 'no-cache',
                    'Pragma': 'no-cache'
                }
            });

            if (!response.ok) return;

            const data = await response.json();
            // package version + the service worker's cache generation
            const serverVersion = data.version + '|' + (data.cacheVersion || '');

            // Installed PWAs only look for a new service worker on
            // navigation; ask for it now so the fresh caches are ready by
            // the time the user taps the button
            if ('serviceWorker' in navigator) {
                navigator.serviceWorker.getRegistration()
                    .then(function (registration) { if (registration) return registration.update(); })
                    .catch(function () { /* offline or no SW: nothing to do */ });
            }

            const knownBefore = localStorage.getItem(STORAGE_KEY);
            localStorage.setItem(STORAGE_KEY, serverVersion);

            const release = data.release;
            if (!release || !release.id) return;           // nothing worth announcing
            const seen = localStorage.getItem(SEEN_KEY);
            if (seen === release.id) return;               // already told them

            // A brand-new visitor has nothing to compare with: "what's new"
            // would only confuse them, so just remember this release.
            if (!seen && !knownBefore) {
                localStorage.setItem(SEEN_KEY, release.id);
                return;
            }

            showUpdateNotification(release);
            localStorage.setItem(SEEN_KEY, release.id);
        } catch (error) {
            console.error('Error checking for updates:', error);
        }
    }

    // Small DOM helper: text only, never innerHTML (notes are plain text)
    function el(tag, styles, text) {
        const node = document.createElement(tag);
        if (styles) node.style.cssText = styles;
        if (text !== undefined) node.textContent = text;
        return node;
    }

    function safeInternalUrl(url) {
        // Only same-site paths: "/wiadomosci?rozmowa=group", never other origins
        return typeof url === 'string' && /^\/(?!\/)/.test(url) ? url : null;
    }

    // A banner picture is one of our own files: a plain same-site path to an
    // image, with no query string, no "..", nothing that could point elsewhere.
    const IMAGE_PATH = /^\/(?!\/)[A-Za-z0-9_\-\/.]+\.(?:gif|png|jpe?g|webp)$/;

    function safeImagePath(path) {
        return typeof path === 'string' && IMAGE_PATH.test(path) && path.indexOf('..') === -1 ? path : null;
    }

    function safeImage(image) {
        if (!image || typeof image !== 'object') return null;
        const src = safeImagePath(image.src);
        const width = Number(image.width);
        const height = Number(image.height);
        if (!src || !(width >= 20 && width <= 2000) || !(height >= 20 && height <= 2000)) return null;
        return {
            src: src,
            still: safeImagePath(image.still),
            // optional: a KLIPY GIF (by slug) looked up live; src/still stay
            // as the picture to use when KLIPY is not available
            klipy: typeof image.klipy === 'string' && KLIPY_SLUG.test(image.klipy) ? image.klipy : null,
            alt: typeof image.alt === 'string' ? image.alt : '',
            klipyAlt: typeof image.klipyAlt === 'string' ? image.klipyAlt : '',
            remote: safeRemote(image.remote),
            width: Math.round(width),
            height: Math.round(height)
        };
    }

    // An exact KLIPY file: https, a host under klipy.com, a plain path to an image,
    // no query string, no ".." (checked below). Loaded by the browser straight from KLIPY.
    const REMOTE_IMAGE = /^https:\/\/(?:[a-z0-9-]+\.)+klipy\.com\/[A-Za-z0-9_\-\/.]+\.(?:gif|png|jpe?g|webp)$/;

    function safeRemote(remote) {
        if (!remote || typeof remote !== 'object') return null;
        const src = remote.src;
        const width = Number(remote.width);
        const height = Number(remote.height);
        if (typeof src !== 'string' || !REMOTE_IMAGE.test(src) || src.indexOf('..') !== -1) return null;
        if (!(width >= 20 && width <= 2000) || !(height >= 20 && height <= 2000)) return null;
        return { src: src, alt: typeof remote.alt === 'string' ? remote.alt : '', width: Math.round(width), height: Math.round(height) };
    }

    const KLIPY_SLUG = /^[A-Za-z0-9_-]{1,120}$/;
    const KLIPY_WAIT_MS = 4000;   // after this the drawn picture is used instead

    function loadScriptOnce(src, isLoaded) {
        return new Promise(function (resolve, reject) {
            if (isLoaded()) { resolve(); return; }
            const script = document.createElement('script');
            script.src = src;
            script.onload = function () { isLoaded() ? resolve() : reject(new Error('not loaded')); };
            script.onerror = function () { reject(new Error('failed to load ' + src)); };
            document.head.appendChild(script);
        });
    }

    // Looks the GIF up on KLIPY from the browser (their rules: the browser
    // asks, and the URLs are used exactly as returned). Resolves to
    // { animated, still, width, height } or null for ANY problem (no key,
    // offline, rate limit, the GIF gone), so the caller can fall back.
    function lookupKlipy(slug) {
        const work = fetch('/api/wiadomosci/gif-config', { credentials: 'same-origin' })
            .then(function (response) { return response.ok ? response.json() : null; })
            .then(function (config) {
                if (!config || !config.enabled || !config.klipyKey) return null;
                return loadScriptOnce('/gif-message.js?v=5', function () { return !!window.GifMessage; })
                    .then(function () { return loadScriptOnce('/gif-klipy.js?v=7', function () { return !!window.GifKlipy; }); })
                    .then(function () {
                        window.GifKlipy.configure(config);
                        return window.GifKlipy.resolve([slug]);
                    })
                    .then(function () {
                        const entry = window.GifKlipy.cached(slug);
                        if (!entry || !entry.urls) return null;
                        const zoom = entry.urls.zoom || {};
                        return {
                            animated: zoom.animated || entry.urls.animated,
                            still: zoom.still || entry.urls.still,
                            width: entry.width,
                            height: entry.height
                        };
                    });
            })
            .catch(function () { return null; });
        const timeout = new Promise(function (resolve) { setTimeout(function () { resolve(null); }, KLIPY_WAIT_MS); });
        return Promise.race([work, timeout]);
    }

    function prefersReducedMotion() {
        return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
    }

    // The picture of an announcement, as an <img> that fills itself in:
    //   1. image.remote  - an exact KLIPY file, loaded straight from KLIPY by
    //      the browser (nothing is stored or copied by us); not for people who
    //      prefer reduced motion, since it has no still version;
    //   2. image.klipy   - a KLIPY GIF looked up by slug through their API;
    //   3. our own file  - always the fallback, and the still for reduced motion.
    // Any failure ends at our own file, and if that is missing too the picture
    // removes itself (no broken-image icon).
    function buildPicture(image) {
        const picture = document.createElement('img');
        const still = prefersReducedMotion();
        const ownSrc = still && image.still ? image.still : image.src;
        const remote = image.remote && !still ? image.remote : null;
        const sizeFrom = remote || image;
        picture.alt = (image.klipy || remote) ? '' : image.alt;   // no alt text flashing while it loads
        picture.width = sizeFrom.width;
        picture.height = sizeFrom.height;
        const fit = 'display:block;margin:0 auto 12px;border-radius:12px;background:#ffffff;object-fit:contain;max-height:min(300px,24vh);';   // (a tall picture must leave room for the buttons)
        // a remote picture may be tall: let the box match it instead of filling a wide white box
        picture.style.cssText = remote
            ? fit + 'width:auto;height:auto;max-width:100%;'
            : fit + 'width:100%;height:auto;max-width:' + image.width + 'px;';
        const useOwn = function () {
            picture.alt = image.alt;
            picture.width = image.width;
            picture.height = image.height;
            picture.style.width = '100%';
            picture.style.maxWidth = image.width + 'px';
            picture.onerror = function () { picture.remove(); };
            picture.src = ownSrc;
        };

        if (remote) {
            picture.alt = remote.alt || image.alt;
            picture.onerror = useOwn;       // KLIPY's file will not load: our own picture
            picture.src = remote.src;
        } else if (image.klipy) {
            // The space is held (width/height above) while KLIPY is asked
            lookupKlipy(image.klipy).then(function (found) {
                if (!picture.isConnected) return;   // closed meanwhile
                if (!found) { useOwn(); return; }
                picture.width = 340;
                picture.height = Math.round(340 * found.height / found.width);
                picture.style.maxWidth = '340px';
                picture.alt = image.klipyAlt || image.alt;
                // if KLIPY's file will not load, fall back to our own picture
                picture.onerror = useOwn;
                picture.src = still ? found.still : found.animated;
            });
        } else {
            useOwn();
        }
        return picture;
    }

    function showUpdateNotification(release) {
        if (document.getElementById(BANNER_ID)) return;

        const banner = el('div',
            'position:fixed;top:0;left:0;right:0;z-index:10000;padding:12px;' +
            'display:flex;justify-content:center;pointer-events:none;' +
            'animation:updateBannerSlide 0.3s ease-out;');
        banner.id = BANNER_ID;
        banner.setAttribute('role', 'status');

        const card = el('div',
            'pointer-events:auto;width:100%;max-width:520px;max-height:80vh;overflow-y:auto;' +
            'box-sizing:border-box;padding:16px 18px;border-radius:18px;color:#ffffff;' +
            'background:linear-gradient(135deg,#43a047,#2e7d32);' +
            'box-shadow:0 8px 28px rgba(0,0,0,0.35);text-align:left;');

        const image = safeImage(release.image);
        if (image) card.appendChild(buildPicture(image));

        card.appendChild(el('div', 'font-size:18px;font-weight:700;margin-bottom:4px;', release.title || 'Nowa wersja'));
        if (release.intro) {
            card.appendChild(el('div', 'font-size:14px;opacity:0.95;margin-bottom:10px;', release.intro));
        }

        const items = Array.isArray(release.items) ? release.items : [];
        if (items.length) {
            const list = el('ul', 'list-style:none;margin:0 0 14px;padding:0;');
            items.forEach(function (item) {
                const row = el('li', 'display:flex;gap:10px;align-items:flex-start;font-size:14px;line-height:1.4;margin-bottom:8px;');
                row.appendChild(el('span', 'flex:none;font-size:18px;line-height:1.3;', item.icon || '•'));
                row.appendChild(el('span', '', item.text || ''));
                list.appendChild(row);
            });
            card.appendChild(list);
        }

        const target = release.action ? safeInternalUrl(release.action.url) : null;
        const buttons = el('div', 'display:flex;gap:10px;flex-wrap:wrap;');

        const go = el('button',
            'background:#ffffff;color:#2e7d32;border:none;padding:10px 18px;border-radius:12px;' +
            'font-weight:700;font-size:14px;cursor:pointer;min-height:44px;',
            (release.action && release.action.label) || 'Odśwież teraz');
        go.type = 'button';
        go.addEventListener('click', function () { reloadPage(target); });

        const later = el('button',
            'background:rgba(255,255,255,0.2);color:#ffffff;border:1px solid #ffffff;padding:10px 18px;' +
            'border-radius:12px;font-size:14px;cursor:pointer;min-height:44px;',
            'Później');
        later.type = 'button';
        later.addEventListener('click', dismissNotification);

        buttons.appendChild(go);
        buttons.appendChild(later);
        card.appendChild(buttons);

        // Earlier announcements live on the "Nowości" page
        const all = el('a',
            'display:inline-flex;align-items:center;min-height:44px;margin-top:2px;color:#ffffff;' +
            'font-size:13px;text-decoration:underline;opacity:0.95;',
            'Wszystkie nowości');
        all.href = '/nowosci';
        card.appendChild(all);
        banner.appendChild(card);

        if (!document.getElementById('updateBannerStyle')) {
            const style = document.createElement('style');
            style.id = 'updateBannerStyle';
            style.textContent =
                '@keyframes updateBannerSlide{from{transform:translateY(-100%);opacity:0}to{transform:translateY(0);opacity:1}}' +
                '@media (prefers-reduced-motion: reduce){#' + BANNER_ID + '{animation:none !important}}';
            document.head.appendChild(style);
        }

        document.body.insertBefore(banner, document.body.firstChild);
    }

    // Refresh with the caches cleared, then (optionally) open `url`
    function reloadPage(url) {
        const done = function () {
            if (url) {
                window.location.assign(url);
            } else {
                window.location.reload();
            }
        };
        if ('caches' in window) {
            caches.keys().then(function (cacheNames) {
                return Promise.all(cacheNames.map(function (cacheName) {
                    return caches.delete(cacheName);
                }));
            }).then(done, done);
        } else {
            done();
        }
    }

    function dismissNotification() {
        const banner = document.getElementById(BANNER_ID);
        if (banner) banner.remove();
    }

    function init() {
        // Check immediately
        checkForUpdates();

        // Check periodically
        setInterval(checkForUpdates, UPDATE_CHECK_INTERVAL);

        // Check when page becomes visible
        document.addEventListener('visibilitychange', function() {
            if (!document.hidden) {
                checkForUpdates();
            }
        });

        // Check when online
        window.addEventListener('online', checkForUpdates);
    }

    // Expose public API
    window.updateChecker = {
        reload: reloadPage,
        dismiss: dismissNotification,
        check: checkForUpdates,
        // for the "Nowości" page, which shows the same cards with the same safety rules
        buildPicture: buildPicture,
        safeImage: safeImage,
        safeInternalUrl: safeInternalUrl
    };

    // Start when DOM is ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
