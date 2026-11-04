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
    const CUSTOMER_KEY = 'prezenty-gif-customer';

    const gifApi = root.GifMessage;
    let config = { enabled: false };
    let els = null;           // built lazily on first open
    let state = null;         // per-open state
    let focusBefore = null;

    // ------------------------------------------------------------------
    // Provider adapters
    // ------------------------------------------------------------------

    // A random id for this browser, so the provider can keep results
    // consistent without knowing who the user is.
    function customerId() {
        try {
            let id = root.localStorage.getItem(CUSTOMER_KEY);
            if (!id) {
                const bytes = new Uint8Array(16);
                (root.crypto || {}).getRandomValues ? root.crypto.getRandomValues(bytes) : bytes.forEach((_, i) => { bytes[i] = Math.floor(Math.random() * 256); });
                id = Array.prototype.map.call(bytes, b => ('0' + b.toString(16)).slice(-2)).join('');
                root.localStorage.setItem(CUSTOMER_KEY, id);
            }
            return id;
        } catch (e) { return 'anonymous'; }
    }

    function ping(url) {
        if (!url) return;
        try {
            const u = new URL(url);
            u.searchParams.set('ts', String(Date.now()));
            u.searchParams.set('customer_id', customerId());
            root.fetch(u.toString(), { mode: 'no-cors', keepalive: true }).catch(function () {});
        } catch (e) { /* analytics must never break sending */ }
    }

    const GIPHY_HOST = 'https://api.giphy.com/v1/gifs/';

    const PROVIDERS = {
        giphy: {
            label: 'GIPHY',
            attribution: 'Powered by GIPHY',
            async search(query, offset, cfg) {
                const params = new URLSearchParams({
                    api_key: cfg.apiKey,
                    limit: String(PAGE_SIZE),
                    offset: String(offset),
                    rating: cfg.rating || 'pg',
                    bundle: 'messaging_non_clips',
                    customer_id: customerId()
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
                return { items: items, hasMore: items.length === PAGE_SIZE && (!total || offset + items.length < total) };
            }
        },

        // Offline provider for demo mode and the e2e suite: local files.
        demo: {
            label: 'Demo',
            attribution: 'Demo GIFs',
            async search(query, offset) {
                const all = [
                    { id: 'brawo', title: 'Brawo', width: 200, height: 150, tags: 'brawo gratulacje clap' },
                    { id: 'hura', title: 'Hura', width: 200, height: 200, tags: 'hura radosc party' },
                    { id: 'dzieki', title: 'Dzięki', width: 200, height: 112, tags: 'dzieki dziekuje thanks' },
                    { id: 'swieta', title: 'Święta', width: 200, height: 260, tags: 'swieta boze narodzenie christmas' }
                ].map(function (item) { return Object.assign({ provider: 'demo', analytics: null }, item); });
                const q = String(query || '').toLowerCase();
                const found = q ? all.filter(function (item) { return (item.title + ' ' + item.tags).toLowerCase().indexOf(q) !== -1; }) : all;
                return { items: found.slice(offset), hasMore: false };
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

        const header = node('div', 'gif-sheet-header');
        const title = node('h2', '', 'Wybierz GIF-a');
        title.id = 'gifSheetTitle';
        const close = node('button', 'gif-sheet-close');
        close.type = 'button';
        close.setAttribute('aria-label', 'Zamknij');
        close.textContent = '\u00D7';
        header.appendChild(title);
        header.appendChild(close);

        const search = node('input', 'gif-sheet-search');
        search.type = 'search';
        search.placeholder = 'Szukaj GIF-ów...';
        search.setAttribute('aria-label', 'Szukaj GIF-ów');
        search.setAttribute('autocomplete', 'off');
        search.setAttribute('autocorrect', 'off');
        search.setAttribute('autocapitalize', 'off');
        search.setAttribute('spellcheck', 'false');
        search.maxLength = MAX_QUERY;

        const status = node('p', 'gif-sheet-status');
        status.setAttribute('role', 'status');
        status.setAttribute('aria-live', 'polite');

        const results = node('div', 'gif-sheet-results');
        results.id = 'gifSheetResults';
        const colA = node('div', 'gif-sheet-col');
        const colB = node('div', 'gif-sheet-col');
        results.appendChild(colA);
        results.appendChild(colB);

        const more = node('button', 'gif-sheet-more', 'Pokaż więcej');
        more.type = 'button';
        more.hidden = true;

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

        sheet.appendChild(header);
        sheet.appendChild(search);
        sheet.appendChild(status);
        sheet.appendChild(results);
        sheet.appendChild(more);
        sheet.appendChild(preview);
        sheet.appendChild(attribution);

        document.body.appendChild(overlay);
        document.body.appendChild(sheet);

        els = {
            overlay, sheet, title, close, search, status, results, cols: [colA, colB],
            more, preview, previewImg, send, cancel, attribution
        };

        overlay.addEventListener('click', closeSheet);
        close.addEventListener('click', closeSheet);
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

    function addItem(item) {
        const urls = gifApi.gifUrls(item);
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
            state.offset = 0;
            state.query = query;
            clearResults();
            els.more.hidden = true;
        }
        setStatus(reset ? 'Szukam...' : 'Ładuję więcej...');
        els.more.disabled = true;
        try {
            const cacheKey = state.query + '|' + state.offset;
            let page = state.cache.get(cacheKey);
            if (!page) {
                page = await adapter.search(state.query, state.offset, config);
                state.cache.set(cacheKey, page);
            }
            if (ticket !== state.ticket) return; // a newer search replaced this one
            page.items.forEach(addItem);
            state.offset += page.items.length;
            els.more.hidden = !page.hasMore;
            setStatus(state.items.length ? '' : (state.query ? 'Nic nie znaleziono. Spróbuj innego słowa.' : 'Brak GIF-ów.'));
        } catch (error) {
            if (ticket !== state.ticket) return;
            setStatus((error && error.kind && error.message) || 'Nie udało się pobrać GIF-ów. Sprawdź połączenie.');
        } finally {
            els.more.disabled = false;
        }
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
        const urls = gifApi.gifUrls(item);
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
            ticket: 0, offset: 0, query: '', items: [], colHeights: [0, 0],
            cache: new Map(), selected: null, timer: null
        };
        els.attribution.textContent = provider().attribution;
        els.search.value = '';
        els.sheet.removeAttribute('aria-hidden');
        els.sheet.removeAttribute('inert');
        els.overlay.classList.add('is-open');
        els.sheet.classList.add('is-open');
        clearResults();
        load(true);
        els.search.focus();
    }

    function closeSheet(skipFocus) {
        if (!els || !state) return;
        if (state.timer) clearTimeout(state.timer);
        state.ticket++;
        state = null;
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
        init: function (next) { config = next && next.enabled ? next : { enabled: false }; },
        isEnabled: function () { return !!(config.enabled && provider() && gifApi); },
        open: openSheet,
        close: function () { closeSheet(); }
    };
})(window);
