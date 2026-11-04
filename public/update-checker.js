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
            alt: typeof image.alt === 'string' ? image.alt : '',
            width: Math.round(width),
            height: Math.round(height)
        };
    }

    function prefersReducedMotion() {
        return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
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
        if (image) {
            const picture = document.createElement('img');
            // People who prefer reduced motion get the still version
            picture.src = prefersReducedMotion() && image.still ? image.still : image.src;
            picture.alt = image.alt;
            picture.width = image.width;
            picture.height = image.height;
            picture.style.cssText = 'display:block;width:100%;height:auto;max-width:' + image.width +
                'px;margin:0 auto 12px;border-radius:12px;background:#ffffff;';
            // A missing file must not leave a broken-image icon: show the text alone
            picture.addEventListener('error', function () { picture.remove(); });
            card.appendChild(picture);
        }

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
        check: checkForUpdates
    };

    // Start when DOM is ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
