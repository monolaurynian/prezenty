/*
 * GIF picker: a bottom sheet (centred card on desktop) to search or browse
 * GIFs and send one.
 *
 *   GifPicker.init(config)                  config = GET /api/wiadomosci/gif-config
 *   GifPicker.isEnabled()
 *   GifPicker.open({ onPick(gif), trigger })  gif = { provider, id, width, height }
 *
 * Providers are small adapters ({ search(query, offset, cfg) -> page }), so
 * another one (e.g. KLIPY) is one more entry in PROVIDERS. GIPHY must be
 * called from the browser (its terms), so this file talks to api.giphy.com
 * directly with the key the server handed over.
 *
 * Choosing is two steps on purpose: tapping a GIF previews it (animated)
 * and only "Wyślij GIF" sends it. Messages here are anonymous and cannot be
 * unsent, so a stray tap must not send.
 *
 * Privacy: the browser sends GIPHY the search text and a random per-browser
 * id (kept in localStorage, not linked to the account). Other chat users
 * learn nothing from a GIF beyond the picture.
 *
 * Every node is built with createElement / textContent: provider data (titles,
 * ids) is never parsed as HTML.
 */
(function (root) {
    'use strict';

    if (typeof document === 'undefined') return;

    const PAGE_SIZE = 24;
    const SEARCH_DELAY_MS = 450;
    const MAX_QUERY = 50; // GIPHY's limit

    const gifApi = root.GifMessage;
    let config = { enabled: false };
    let els = null;           // built lazily on first open
    let state = null;         // per-open state
    let focusBefore = null;

    // ------------------------------------------------------------------
    // Provider adapters
    // ------------------------------------------------------------------

    // Providers get a random per-browser id (GifMessage.customerId), so
    // results stay consistent without anyone learning who the user is.
    function ping(url) {
        if (!url) return;
        try {
            const u = new URL(url);
            u.searchParams.set('ts', String(Date.now()));
            u.searchParams.set('customer_id', gifApi.customerId());
            root.fetch(u.toString(), { mode: 'no-cors', keepalive: true }).catch(function () {});
        } catch (e) { /* analytics must never break sending */ }
    }

    const GIPHY_HOST = 'https://api.giphy.com/v1/gifs/';

    // Adapter contract:
    //   search(query, cursor, cfg) -> { items, hasMore, next }
    //     `cursor` starts at 0 and is whatever the adapter returned as `next`
    //     last time (an offset for GIPHY, a page number for KLIPY)
    //     item = { provider, id, width, height, title, analytics, urls? }
    //     `urls` = { still, animated } when the provider hands out exact URLs
    //     (KLIPY); otherwise they are built from the id (gif-message.js).
    //   onSent(item, query)  optional, after the user sends the GIF
    const PROVIDERS = {
        giphy: {
            label: 'GIPHY',
            attribution: 'Powered by GIPHY',
            placeholder: 'Szukaj GIF-ów...',
            async search(query, offset, cfg) {
                const params = new URLSearchParams({
                    api_key: cfg.apiKey,
                    limit: String(PAGE_SIZE),
                    offset: String(offset),
                    rating: cfg.rating || 'pg',
                    bundle: 'messaging_non_clips',
                    customer_id: gifApi.customerId()
                });
                if (query) {
                    params.set('q', query.slice(0, MAX_QUERY));
                    params.set('lang', 'pl');
                }
                const response = await root.fetch(GIPHY_HOST + (query ? 'search' : 'trending') + '?' + params.toString());
                if (response.status === 429) throw makeError('rate', 'Za dużo wyszukiwań. Spróbuj za chwilę.');
                if (response.status === 401 || response.status === 403) throw makeError('key', 'GIF-y są chwilowo niedostępne.');
                if (!response.ok) throw makeError('http', 'Nie udało się pobrać GIF-ów.');
                const json = await response.json();
                const items = (json.data || []).map(function (item) {
                    const image = item && item.images && (item.images.fixed_width || item.images.downsized);
                    const width = image ? Number(image.width) : NaN;
                    const height = image ? Number(image.height) : NaN;
                    if (!item || typeof item.id !== 'string' || !(width > 0) || !(height > 0)) return null;
                    return {
                        provider: 'giphy', id: item.id, width: Math.round(width), height: Math.round(height),
                        title: typeof item.title === 'string' ? item.title : '',
                        analytics: item.analytics || null
                    };
                }).filter(function (item) {
                    return item && gifApi.buildGifToken('giphy', item.id, item.width, item.height);
                });
                const total = json.pagination ? Number(json.pagination.total_count) : 0;
                const received = (json.data || []).length;
                return {
                    items: items,
                    hasMore: received === PAGE_SIZE && (!total || offset + received < total),
                    next: offset + received // raw count: dropped items must not shift the next page
                };
            }
        },

        // KLIPY: the work happens in gif-klipy.js (it also resolves slugs for
        // the chat). Terms: "Powered by KLIPY" in the search area and content.
        klipy: {
            label: 'KLIPY',
            attribution: 'Powered by KLIPY',
            // KLIPY REQUIRES exactly this placeholder in its search field
            // (docs.klipy.com/attribution). It stays English on purpose.
            placeholder: 'Search KLIPY',
            searchLabel: 'Szukaj w KLIPY',
            async search(query, page) {
                const result = await root.GifKlipy.search(query, page || 1);
                return result;
            },
            onSent(item, query) {
                root.GifKlipy.share(item.id, query);
            }
        },

        // Offline provider for demo mode and the e2e suite: local files.
        demo: {
            label: 'Demo',
            attribution: 'Demo GIFs',
            placeholder: 'Szukaj GIF-ów...',
            async search(query, offset) {
                const all = [
                    { id: 'brawo', title: 'Brawo', width: 200, height: 150, tags: 'brawo gratulacje clap' },
                    { id: 'hura', title: 'Hura', width: 200, height: 200, tags: 'hura radosc party' },
                    { id: 'dzieki', title: 'Dzięki', width: 200, height: 112, tags: 'dzieki dziekuje thanks' },
                    { id: 'swieta', title: 'Święta', width: 200, height: 260, tags: 'swieta boze narodzenie christmas' }
                ].map(function (item) { return Object.assign({ provider: 'demo', analytics: null }, item); });
                const q = String(query || '').toLowerCase();
                const found = q ? all.filter(function (item) { return (item.title + ' ' + item.tags).toLowerCase().indexOf(q) !== -1; }) : all;
                const items = found.slice(offset);
                return { items: items, hasMore: false, next: offset + items.length };
            }
        }
    };

    function makeError(kind, message) {
        const error = new Error(message);
        error.kind = kind;
        return error;
    }

    // ------------------------------------------------------------------
    // DOM
    // ------------------------------------------------------------------

    function node(tag, className, text) {
        const el = document.createElement(tag);
        if (className) el.className = className;
        if (text !== undefined) el.textContent = text;
        return el;
    }

    function build() {
        const overlay = node('div');
        overlay.id = 'gifSheetOverlay';

        const sheet = node('div');
        sheet.id = 'gifSheet';
        sheet.setAttribute('role', 'dialog');
        sheet.setAttribute('aria-modal', 'true');
        sheet.setAttribute('aria-labelledby', 'gifSheetTitle');
        sheet.setAttribute('aria-hidden', 'true');
        sheet.setAttribute('inert', '');

        // Header: [ spacer | chevron (expand / collapse) | close ]. The title
        // is for assistive tech only: the panel is self-explanatory by sight.
        const header = node('div', 'gif-sheet-header');
        const spacer = node('span', 'gif-sheet-spacer');
        spacer.setAttribute('aria-hidden', 'true');
        const title = node('h2', 'gif-sr-only', 'Wybierz GIF-a');
        title.id = 'gifSheetTitle';
        const expand = node('button', 'gif-sheet-expand');
        expand.type = 'button';
        expand.setAttribute('aria-expanded', 'false');
        expand.setAttribute('aria-label', 'Rozwiń listę GIF-ów');
        expand.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 14.5l6-6 6 6"/></svg>';
        const close = node('button', 'gif-sheet-close');
        close.type = 'button';
        close.setAttribute('aria-label', 'Zamknij');
        close.textContent = '\u00D7';
        header.appendChild(spacer);
        header.appendChild(expand);
        header.appendChild(close);

        // Search: a pill with a magnifier inside
        const searchbox = node('div', 'gif-sheet-searchbox');
        const search = node('input', 'gif-sheet-search');
        search.type = 'search';
        search.placeholder = 'Szukaj GIF-ów...';
        search.setAttribute('aria-label', 'Szukaj GIF-ów');
        search.setAttribute('autocomplete', 'off');
        search.setAttribute('autocorrect', 'off');
        search.setAttribute('autocapitalize', 'off');
        search.setAttribute('spellcheck', 'false');
        search.maxLength = MAX_QUERY;
        const magnifier = node('span', 'gif-sheet-magnifier');
        magnifier.setAttribute('aria-hidden', 'true');
        magnifier.innerHTML = '<svg viewBox="0 0 24 24"><circle cx="10.5" cy="10.5" r="6"/><path d="M15 15l5 5"/></svg>';
        searchbox.appendChild(magnifier);
        searchbox.appendChild(search);

        const status = node('p', 'gif-sheet-status');
        status.setAttribute('role', 'status');
        status.setAttribute('aria-live', 'polite');

        const results = node('div', 'gif-sheet-results');
        results.id = 'gifSheetResults';
        const colA = node('div', 'gif-sheet-col');
        const colB = node('div', 'gif-sheet-col');
        const grid = node('div', 'gif-sheet-grid');
        grid.appendChild(colA);
        grid.appendChild(colB);
        results.appendChild(grid);

        // "Pokaż więcej" is the last thing INSIDE the scrolling list, so it only
        // shows up once you have scrolled down to the end of what is loaded
        const more = node('button', 'gif-sheet-more', MORE_LABEL);
        more.type = 'button';
        more.hidden = true;
        results.appendChild(more);

        const preview = node('div', 'gif-sheet-preview');
        preview.hidden = true;
        const previewImg = node('img', 'gif-sheet-preview-img');
        previewImg.alt = '';
        const previewActions = node('div', 'gif-sheet-preview-actions');
        const send = node('button', 'gif-sheet-send', 'Wyślij GIF');
        send.type = 'button';
        const cancel = node('button', 'gif-sheet-cancel', 'Wybierz inny');
        cancel.type = 'button';
        previewActions.appendChild(send);
        previewActions.appendChild(cancel);
        preview.appendChild(previewImg);
        preview.appendChild(previewActions);

        const attribution = node('p', 'gif-sheet-attribution');

        sheet.appendChild(title);
        sheet.appendChild(header);
        sheet.appendChild(searchbox);
        sheet.appendChild(status);
        sheet.appendChild(results);
        sheet.appendChild(preview);
        sheet.appendChild(attribution);

        document.body.appendChild(overlay);
        document.body.appendChild(sheet);

        els = {
            overlay, sheet, title, close, expand, search, status, results, cols: [colA, colB],
            more, preview, previewImg, send, cancel, attribution
        };

        overlay.addEventListener('click', closeSheet);
        close.addEventListener('click', closeSheet);
        expand.addEventListener('click', function () {
            // Once the chevron has been used, scrolling no longer resizes the
            // panel (until it is opened again): the person decided
            if (state) state.userChose = true;
            setExpanded(!sheet.classList.contains('is-expanded'));
        });
        // Dragging / wheeling the list resizes the panel first (see resizeBy);
        // these must be non-passive so the list can be told to stay put
        results.addEventListener('touchstart', onResultsTouchStart, { passive: true });
        results.addEventListener('touchmove', onResultsTouchMove, { passive: false });
        results.addEventListener('touchend', onResultsTouchEnd, { passive: true });
        results.addEventListener('touchcancel', onResultsTouchEnd, { passive: true });
        results.addEventListener('wheel', onResultsWheel, { passive: false });
        cancel.addEventListener('click', clearSelection);
        send.addEventListener('click', sendSelected);
        more.addEventListener('click', function () { load(false); });
        search.addEventListener('input', function () {
            if (state.timer) clearTimeout(state.timer);
            state.timer = setTimeout(function () { load(true); }, SEARCH_DELAY_MS);
        });
        search.addEventListener('keydown', function (e) {
            if (e.key === 'Enter') {
                e.preventDefault();
                if (state.timer) clearTimeout(state.timer);
                load(true);
            }
        });
        results.addEventListener('click', function (e) {
            if (!(e.target instanceof Element)) return;
            const button = e.target.closest('.gif-sheet-item');
            if (!button) return;
            select(Number(button.getAttribute('data-index')), button);
        });
        sheet.addEventListener('keydown', function (e) {
            if (!state) return;
            if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeSheet(); return; }
            if (e.key !== 'Tab') return;
            const items = focusables();
            if (!items.length) return;
            const first = items[0];
            const last = items[items.length - 1];
            if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
            else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
        });
    }

    function focusables() {
        return Array.prototype.slice.call(els.sheet.querySelectorAll(
            "button:not([disabled]), input:not([disabled])"
        )).filter(function (el) { return !el.closest('[hidden]') && el.getAttribute('tabindex') !== '-1'; });
    }

    // ------------------------------------------------------------------
    // Loading and rendering
    // ------------------------------------------------------------------

    const MORE_LABEL = 'Pokaż więcej';

    function provider() {
        return PROVIDERS[config.provider] || null;
    }

    function setStatus(message) {
        els.status.textContent = message || '';
        els.status.hidden = !message;
    }

    function clearResults() {
        els.cols.forEach(function (col) { col.textContent = ''; });
        state.items = [];
        state.colHeights = [0, 0];
        clearSelection();
    }

    // Exact URLs from the provider (KLIPY) win; otherwise build from the id
    function urlsFor(item) {
        return item.urls || gifApi.gifUrls(item);
    }

    function addItem(item) {
        const urls = urlsFor(item);
        if (!urls) return;
        const index = state.items.length;
        state.items.push(item);

        // Shorter column first keeps the two columns balanced
        const col = state.colHeights[0] <= state.colHeights[1] ? 0 : 1;
        state.colHeights[col] += item.height / item.width;

        const button = node('button', 'gif-sheet-item');
        button.type = 'button';
        button.setAttribute('data-index', String(index));
        button.setAttribute('aria-label', 'GIF' + (item.title ? ': ' + item.title : ''));
        button.setAttribute('aria-pressed', 'false');
        const img = node('img');
        img.alt = '';
        img.loading = 'lazy';
        img.decoding = 'async';
        img.width = item.width;
        img.height = item.height;
        img.src = urls.still;   // still thumbnails: light on phones, calm to look at
        img.addEventListener('error', function () { button.remove(); });
        button.appendChild(img);
        els.cols[col].appendChild(button);
    }

    async function load(reset) {
        const adapter = provider();
        if (!adapter || !state) return;
        const query = els.search.value.trim().slice(0, MAX_QUERY);
        const ticket = ++state.ticket;
        if (reset) {
            state.cursor = 0;
            state.query = query;
            clearResults();
            els.more.hidden = true;
        }
        setStatus(reset ? 'Szukam...' : '');
        const firstNew = state.items.length;   // index of the first GIF this page adds
        els.more.disabled = true;
        if (!reset) els.more.textContent = 'Ładuję...';   // feedback on the button itself
        try {
            const cacheKey = state.query + '|' + state.cursor;
            let page = state.cache.get(cacheKey);
            if (!page) {
                page = await adapter.search(state.query, state.cursor, config);
                state.cache.set(cacheKey, page);
            }
            if (ticket !== state.ticket) return; // a newer search replaced this one
            page.items.forEach(addItem);
            state.cursor = page.next;
            els.more.hidden = !page.hasMore;
            if (!reset) revealFrom(firstNew);
            setStatus(state.items.length ? '' : (state.query ? 'Nic nie znaleziono. Spróbuj innego słowa.' : 'Brak GIF-ów.'));
        } catch (error) {
            if (ticket !== state.ticket) return;
            setStatus((error && error.kind && error.message) || 'Nie udało się pobrać GIF-ów. Sprawdź połączenie.');
        } finally {
            els.more.disabled = false;
            els.more.textContent = MORE_LABEL;
        }
    }

    // After "Pokaż więcej": bring the first new GIF into view, so it is
    // obvious that something was added below
    function revealFrom(index) {
        const first = els.results.querySelector('.gif-sheet-item[data-index="' + index + '"]');
        if (!first) return;
        const reduced = !!(root.matchMedia && root.matchMedia('(prefers-reduced-motion: reduce)').matches);
        const top = els.results.scrollTop + (first.getBoundingClientRect().top - els.results.getBoundingClientRect().top) - 8;
        els.results.scrollTo({ top: Math.max(0, top), behavior: reduced ? 'auto' : 'smooth' });
    }

    // ------------------------------------------------------------------
    // Choosing and sending
    // ------------------------------------------------------------------

    function clearSelection() {
        if (!els) return;
        if (state) state.selected = null;
        els.preview.hidden = true;
        els.previewImg.removeAttribute('src');
        els.results.querySelectorAll('.gif-sheet-item[aria-pressed="true"]').forEach(function (b) {
            b.setAttribute('aria-pressed', 'false');
        });
    }

    function select(index, button) {
        const item = state.items[index];
        if (!item) return;
        const urls = urlsFor(item);
        if (!urls) return;
        clearSelection();
        state.selected = item;
        button.setAttribute('aria-pressed', 'true');
        els.previewImg.alt = item.title ? 'Podgląd GIF-a: ' + item.title : 'Podgląd GIF-a';
        els.previewImg.width = item.width;
        els.previewImg.height = item.height;
        els.previewImg.src = urls.animated;
        els.preview.hidden = false;
        if (item.analytics && item.analytics.onclick) ping(item.analytics.onclick.url);
        els.send.focus();
    }

    function sendSelected() {
        const item = state && state.selected;
        if (!item) return;
        if (item.analytics && item.analytics.onsent) ping(item.analytics.onsent.url);
        const adapter = provider();
        if (adapter && typeof adapter.onSent === 'function') adapter.onSent(item, state.query);
        const pick = state.onPick;
        closeSheet(true);
        if (typeof pick === 'function') {
            pick({ provider: item.provider, id: item.id, width: item.width, height: item.height });
        }
    }

    function openSheet(options) {
        if (!config.enabled || !provider()) return;
        if (!els) build();
        focusBefore = (options && options.trigger) || document.activeElement;
        state = {
            onPick: options && options.onPick,
            onOpen: options && options.onOpen,
            onClose: options && options.onClose,
            ticket: 0, cursor: 0, query: '', items: [], colHeights: [0, 0],
            cache: new Map(), selected: null, timer: null
        };
        els.attribution.textContent = provider().attribution;
        els.search.placeholder = provider().placeholder || 'Szukaj GIF-ów...';
        els.search.setAttribute('aria-label', provider().searchLabel || els.search.placeholder.replace(/\.\.\.$/, ''));
        els.search.value = '';
        setExpanded(false);        // always opens compact
        els.sheet.removeAttribute('aria-hidden');
        els.sheet.removeAttribute('inert');
        els.overlay.classList.add('is-open');
        els.sheet.classList.add('is-open');
        clearResults();
        load(true);
        // On a phone, focusing the search would raise the keyboard over the
        // very list the user came to look at: start on the panel instead.
        const touch = !!(root.matchMedia && root.matchMedia('(pointer: coarse)').matches);
        (touch ? els.close : els.search).focus();
    }

    // Compact (about half the screen: the conversation stays in view) or
    // expanded (nearly full height) - toggled by the chevron.
    //
    // On a phone a drag (or wheel) on the GIF list also resizes the panel, and
    // while it is doing so the LIST stays put: the movement goes into the
    // panel's height first, so only one thing moves under the finger. Dragging
    // up grows the panel until it is expanded, then the list scrolls as usual.
    // Dragging down at the top of the list shrinks it back towards compact.
    // When the finger lifts (or the wheel pauses) the panel eases to whichever
    // end is nearer. The chevron overrides all of this for the current opening.
    const IDLE_MS = 160;               // a wheel pause this long ends the gesture

    function isDocked() {
        return !!(root.matchMedia && root.matchMedia('(max-width: 768px)').matches);
    }

    // The two heights the panel has on a phone (mirrors gif-picker.css)
    function panelHeights() {
        const h = root.innerHeight;
        return { compact: Math.min(h * 0.5, 440), full: Math.min(h * 0.86, 680) };
    }

    // Back to the CSS-controlled heights (no inline override)
    function clearLiveSize() {
        if (state && state.idleTimer) { clearTimeout(state.idleTimer); state.idleTimer = null; }
        if (state) state.liveH = null;
        if (els) { els.sheet.style.height = ''; els.sheet.style.transition = ''; }
    }

    // `move` > 0: the list wants to go further down (finger / wheel moving up);
    // `move` < 0: back up. Returns true when the panel took the movement, in
    // which case the list must not scroll with it.
    function resizeBy(move) {
        if (!state || !els || state.userChose || !isDocked() || !move) return false;
        const sizes = panelHeights();
        // where the panel is right now (it may still be easing from the last gesture)
        if (state.liveH == null) state.liveH = Math.round(els.sheet.getBoundingClientRect().height);
        const h = state.liveH;
        let next;
        if (move > 0 && h < sizes.full) next = Math.min(sizes.full, h + move);
        else if (move < 0 && els.results.scrollTop <= 0 && h > sizes.compact) next = Math.max(sizes.compact, h + move);
        else return false;
        state.liveH = next;
        els.sheet.style.transition = 'none';          // follow the finger exactly
        els.sheet.style.height = next.toFixed(1) + 'px';
        return true;
    }

    // The gesture ended: ease to compact or expanded, whichever is nearer
    function settleSize() {
        if (!state || !els) return;
        if (state.idleTimer) { clearTimeout(state.idleTimer); state.idleTimer = null; }
        if (state.liveH == null) return;
        const sizes = panelHeights();
        const expand = (state.liveH - sizes.compact) / (sizes.full - sizes.compact) >= 0.5;
        state.liveH = null;
        els.sheet.style.transition = '';                  // animate again
        void els.sheet.offsetHeight;                      // start from the inline height
        els.sheet.style.height = '';                      // hand over to the CSS heights
        setExpanded(expand);
    }

    function onResultsTouchStart(e) {
        if (!state || !e.touches || e.touches.length !== 1) return;
        state.touchY = e.touches[0].clientY;
    }

    function onResultsTouchMove(e) {
        if (!state || !e.touches || e.touches.length !== 1 || state.touchY == null) return;
        const y = e.touches[0].clientY;
        const move = state.touchY - y;              // finger up = positive
        state.touchY = y;
        if (resizeBy(move) && e.cancelable) e.preventDefault();   // the list stays put
    }

    function onResultsTouchEnd() {
        if (state) state.touchY = null;
        settleSize();
    }

    function onResultsWheel(e) {
        if (!state) return;
        const unit = e.deltaMode === 1 ? 16 : 1;    // lines -> px
        if (resizeBy(e.deltaY * unit)) {
            e.preventDefault();
            if (state.idleTimer) clearTimeout(state.idleTimer);
            state.idleTimer = setTimeout(settleSize, IDLE_MS);
        }
    }

    function setExpanded(on) {
        // a chevron tap (or opening) takes over from any in-progress scroll resize
        if (state && state.liveH != null) clearLiveSize();
        els.sheet.classList.toggle('is-expanded', on);
        els.expand.setAttribute('aria-expanded', on ? 'true' : 'false');
        els.expand.setAttribute('aria-label', on ? 'Zwiń listę GIF-ów' : 'Rozwiń listę GIF-ów');
        reserveSpace();
    }
    // On a phone the panel covers the bottom of the screen. Reserve that much
    // room at the bottom of the page (html.gif-panel-open pads <body>) and tell
    // the page how much is covered, so it can keep the newest messages in view.
    function reserveSpace() {
        if (!state) return;
        const docked = !!(root.matchMedia && root.matchMedia('(max-width: 768px)').matches);
        const root_ = document.documentElement;
        if (!docked) {
            root_.classList.remove('gif-panel-open');
            root_.style.removeProperty('--gif-panel-h');
        } else {
            // The panel's height is animated, so offsetHeight can still be the
            // OLD height right after the class changes. Read the final one.
            const height = finalHeight();
            root_.style.setProperty('--gif-panel-h', height + 'px');
            root_.classList.add('gif-panel-open');
        }
        const onOpen = state.onOpen;
        if (typeof onOpen === 'function') {
            root.requestAnimationFrame(function () {
                if (state) {
                    onOpen({
                        docked: docked,
                        expanded: els.sheet.classList.contains('is-expanded'),
                        top: root.innerHeight - (docked ? finalHeight() : 0)
                    });
                }
            });
        }
    }

    // The height the panel has (or is animating to) in its current state.
    function finalHeight() {
        const sheet = els.sheet;
        // On a phone the two heights are known, so there is nothing to measure.
        // (Measuring used to switch the transition off for a moment, which made
        // the panel jump to its final size instead of animating there.)
        if (isDocked()) {
            const sizes = panelHeights();
            return Math.round(sheet.classList.contains('is-expanded') ? sizes.full : sizes.compact);
        }
        const previous = sheet.style.transition;
        sheet.style.transition = 'none';          // measure without animating
        const height = Math.round(sheet.getBoundingClientRect().height);
        sheet.style.transition = previous;
        return height;
    }

    function closeSheet(skipFocus) {
        if (!els || !state) return;
        if (state.timer) clearTimeout(state.timer);
        clearLiveSize();
        state.ticket++;
        const onClose = state.onClose;
        state = null;
        document.documentElement.classList.remove('gif-panel-open');
        document.documentElement.style.removeProperty('--gif-panel-h');
        if (typeof onClose === 'function') onClose();
        els.overlay.classList.remove('is-open');
        els.sheet.classList.remove('is-open');
        els.sheet.setAttribute('aria-hidden', 'true');
        els.sheet.setAttribute('inert', '');
        els.preview.hidden = true;
        els.previewImg.removeAttribute('src');
        els.cols.forEach(function (col) { col.textContent = ''; }); // free the images
        const target = focusBefore;
        focusBefore = null;
        if (skipFocus !== true && target && document.contains(target) && typeof target.focus === 'function') {
            target.focus();
        }
    }

    root.GifPicker = {
        init: function (next) {
            config = next && next.enabled ? next : { enabled: false };
            // KLIPY also needs its key for showing GIFs already in the chat
            if (root.GifKlipy) root.GifKlipy.configure(next || {});
        },
        isEnabled: function () {
            if (!(config.enabled && provider() && gifApi)) return false;
            return config.provider !== 'klipy' || (!!root.GifKlipy && root.GifKlipy.hasKey());
        },
        open: openSheet,
        close: function () { closeSheet(); }
    };
})(window);
