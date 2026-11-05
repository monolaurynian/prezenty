/*
 * GIF picker: a bottom sheet (centred card on desktop) to search or browse
 * GIFs and send one. With KLIPY it also has stickers and memes: three cards
 * side by side, swiped like the emoji picker's categories (native scroll
 * snapping), with tabs on top and a drawn page scrollbar underneath.
 *
 *   GifPicker.init(config)                  config = GET /api/wiadomosci/gif-config
 *   GifPicker.isEnabled()
 *   GifPicker.open({ onPick(gif), trigger })  gif = { provider, kind, id, width, height }
 *
 * Providers are small adapters ({ search(query, offset, cfg, kind) -> page }),
 * so another one is one more entry in PROVIDERS. GIPHY must be called from
 * the browser (its terms), so this file talks to api.giphy.com directly with
 * the key the server handed over.
 *
 * Choosing is two steps on purpose: tapping a picture previews it (animated)
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
    //   search(query, cursor, cfg, kind) -> { items, hasMore, next }
    //     `cursor` starts at 0 and is whatever the adapter returned as `next`
    //     last time (an offset for GIPHY, a page number for KLIPY)
    //     item = { provider, kind?, id, width, height, title, analytics, urls? }
    //     `urls` = { still, animated } when the provider hands out exact URLs
    //     (KLIPY); otherwise they are built from the id (gif-message.js).
    //   onSent(item, query)  optional, after the user sends the GIF
    //   kinds                optional: ['gif', 'sticker', 'meme'] = show one tab each
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
            // KLIPY has three kinds of pictures; the panel shows a card and a tab for each
            kinds: ['gif', 'sticker', 'meme'],
            async search(query, page, cfg, kind) {
                const result = await root.GifKlipy.search(query, page || 1, kind || 'gif');
                return result;
            },
            onSent(item, query) {
                root.GifKlipy.share(item.id, query, item.kind || 'gif');
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

    // Wording per kind (the tabs, the buttons, the empty states)
    const TAB_LABELS = { gif: 'GIF-y', sticker: 'Naklejki', meme: 'Memy' };
    const SEND_LABELS = { gif: 'Wyślij GIF', sticker: 'Wyślij naklejkę', meme: 'Wyślij mem' };
    const EMPTY_LABELS = { gif: 'Brak GIF-ów.', sticker: 'Brak naklejek.', meme: 'Brak memów.' };
    const ITEM_LABELS = { gif: 'GIF', sticker: 'Naklejka', meme: 'Mem' };
    const PREVIEW_LABELS = { gif: 'Podgląd GIF-a', sticker: 'Podgląd naklejki', meme: 'Podgląd memu' };
    const MORE_LABEL = 'Pokaż więcej';

    function provider() {
        return PROVIDERS[config.provider] || null;
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

    function reducedMotion() {
        return !!(root.matchMedia && root.matchMedia('(prefers-reduced-motion: reduce)').matches);
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

        // Tabs (only where the provider has more than GIFs: KLIPY). One search
        // field serves all of them: it searches the card you are on.
        const tabs = node('div', 'gif-sheet-tabs');
        tabs.setAttribute('role', 'tablist');
        tabs.setAttribute('aria-label', 'Rodzaj obrazka');
        tabs.hidden = true;
        const tabButtons = {};
        // the purple pill behind the selected tab; it follows the swipe
        const indicator = node('span', 'gif-sheet-tab-indicator');
        indicator.setAttribute('aria-hidden', 'true');
        tabs.appendChild(indicator);
        Object.keys(TAB_LABELS).forEach(function (kind) {
            const tab = node('button', 'gif-sheet-tab', TAB_LABELS[kind]);
            tab.type = 'button';
            tab.setAttribute('role', 'tab');
            tab.setAttribute('data-kind', kind);
            tab.setAttribute('aria-selected', 'false');
            tab.setAttribute('tabindex', '-1');
            tabs.appendChild(tab);
            tabButtons[kind] = tab;
        });

        // The cards (one per kind, filled in by openSheet) sit side by side in
        // a row that scrolls sideways and snaps to whole cards
        const pager = node('div', 'gif-sheet-pager');

        // Page scrollbar, drawn by us (a native one is unreliable on phones;
        // same idea as the emoji picker's): a track with a thumb one card wide
        const pagebar = node('div', 'gif-sheet-pagebar');
        pagebar.setAttribute('aria-hidden', 'true');
        pagebar.hidden = true;
        const thumb = node('div', 'gif-sheet-pagethumb');
        pagebar.appendChild(thumb);

        // The preview: a full-screen modal over everything (it lives on <body>,
        // not inside the sheet, so it can cover the whole screen) showing the
        // chosen picture large, with "Wyślij" and "Pomiń"
        const preview = node('div', 'gif-sheet-preview');
        preview.id = 'gifPreview';
        preview.setAttribute('role', 'dialog');
        preview.setAttribute('aria-modal', 'true');
        preview.setAttribute('aria-label', 'Podgląd');
        preview.hidden = true;
        const previewImg = node('img', 'gif-sheet-preview-img');
        previewImg.alt = '';
        const previewTitle = node('p', 'gif-sheet-preview-title');
        const previewActions = node('div', 'gif-sheet-preview-actions');
        const send = node('button', 'gif-sheet-send', 'Wyślij GIF');
        send.type = 'button';
        const cancel = node('button', 'gif-sheet-cancel', 'Pomiń');
        cancel.type = 'button';
        previewActions.appendChild(send);
        previewActions.appendChild(cancel);
        preview.appendChild(previewImg);
        preview.appendChild(previewTitle);
        preview.appendChild(previewActions);

        const attribution = node('p', 'gif-sheet-attribution');

        sheet.appendChild(title);
        sheet.appendChild(header);
        sheet.appendChild(searchbox);
        sheet.appendChild(tabs);
        sheet.appendChild(pager);
        sheet.appendChild(pagebar);
        sheet.appendChild(attribution);

        document.body.appendChild(overlay);
        document.body.appendChild(sheet);
        document.body.appendChild(preview);

        els = {
            overlay, sheet, title, close, expand, search, pager, pagebar, thumb,
            preview, previewImg, previewTitle, send, cancel, attribution, tabs, tabButtons, indicator
        };

        // Skip (button, Escape, or a tap on the dark area) goes back to the pictures
        preview.addEventListener('click', function (e) { if (e.target === preview) skipPreview(); });
        preview.addEventListener('keydown', function (e) {
            if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); skipPreview(); return; }
            if (e.key !== 'Tab') return;
            // Tab stays between the two buttons
            if (e.shiftKey && document.activeElement === send) { e.preventDefault(); cancel.focus(); }
            else if (!e.shiftKey && document.activeElement === cancel) { e.preventDefault(); send.focus(); }
        });

        // The indicator and the thumb are placed from measurements: redo them on resize
        root.addEventListener('resize', function () { if (state && state.kinds) paintPosition(); });

        tabs.addEventListener('click', function (e) {
            const tab = e.target instanceof Element && e.target.closest('.gif-sheet-tab');
            if (tab) goToTab(tab.getAttribute('data-kind'));
        });
        // Arrow keys move between tabs (Home / End jump), like any tab list
        tabs.addEventListener('keydown', function (e) {
            if (!state || !state.kinds) return;
            const at = state.kinds.indexOf(state.kind);
            let next = -1;
            if (e.key === 'ArrowRight') next = (at + 1) % state.kinds.length;
            else if (e.key === 'ArrowLeft') next = (at - 1 + state.kinds.length) % state.kinds.length;
            else if (e.key === 'Home') next = 0;
            else if (e.key === 'End') next = state.kinds.length - 1;
            if (next < 0) return;
            e.preventDefault();
            goToTab(state.kinds[next]);
            els.tabButtons[state.kinds[next]].focus();
        });

        overlay.addEventListener('click', closeSheet);
        close.addEventListener('click', closeSheet);
        expand.addEventListener('click', function () {
            // Once the chevron has been used, scrolling no longer resizes the
            // panel (until it is opened again): the person decided
            if (state) state.userChose = true;
            setExpanded(!sheet.classList.contains('is-expanded'));
        });
        // Dragging / wheeling a list resizes the panel first (see resizeBy);
        // these must be non-passive so the list can be told to stay put
        pager.addEventListener('touchstart', onResultsTouchStart, { passive: true });
        pager.addEventListener('touchmove', onResultsTouchMove, { passive: false });
        pager.addEventListener('touchend', onResultsTouchEnd, { passive: true });
        pager.addEventListener('touchcancel', onResultsTouchEnd, { passive: true });
        pager.addEventListener('wheel', onResultsWheel, { passive: false });
        pager.addEventListener('scroll', onPagerScroll, { passive: true });
        // A finger or wheel during a tab animation takes over from it
        ['touchstart', 'wheel', 'pointerdown'].forEach(function (type) {
            pager.addEventListener(type, function () { if (state) state.jump = null; }, { passive: true });
        });
        installPagebar();
        cancel.addEventListener('click', skipPreview);
        send.addEventListener('click', sendSelected);
        search.addEventListener('input', function () {
            if (state.timer) clearTimeout(state.timer);
            state.timer = setTimeout(function () { load(activeTab(), true); }, SEARCH_DELAY_MS);
        });
        search.addEventListener('keydown', function (e) {
            if (e.key === 'Enter') {
                e.preventDefault();
                if (state.timer) clearTimeout(state.timer);
                load(activeTab(), true);
            }
        });
        pager.addEventListener('click', function (e) {
            if (!(e.target instanceof Element)) return;
            const card = e.target.closest('.gif-sheet-card');
            if (!card) return;
            const kind = card.getAttribute('data-kind');
            if (e.target.closest('.gif-sheet-more')) { load(state.tabs[kind], false); return; }
            const button = e.target.closest('.gif-sheet-item');
            if (!button) return;
            select(kind, Number(button.getAttribute('data-index')), button);
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
    // Cards: one per kind, each with its own list, state and "Pokaż więcej"
    // ------------------------------------------------------------------

    function activeTab() {
        return state.tabs[state.kind];
    }

    function makeTab(kind) {
        const card = node('div', 'gif-sheet-card gif-sheet-results');
        card.setAttribute('data-kind', kind);
        card.setAttribute('role', 'tabpanel');
        const status = node('p', 'gif-sheet-status');
        status.setAttribute('role', 'status');
        status.setAttribute('aria-live', 'polite');
        status.hidden = true;
        const colA = node('div', 'gif-sheet-col');
        const colB = node('div', 'gif-sheet-col');
        const grid = node('div', 'gif-sheet-grid');
        grid.appendChild(colA);
        grid.appendChild(colB);
        // "Pokaż więcej" is the last thing INSIDE the scrolling card, so it only
        // shows up once you have scrolled down to the end of what is loaded
        const more = node('button', 'gif-sheet-more', MORE_LABEL);
        more.type = 'button';
        more.hidden = true;
        card.appendChild(status);
        card.appendChild(grid);
        card.appendChild(more);
        return {
            kind: kind, card: card, status: status, cols: [colA, colB], more: more,
            items: [], colHeights: [0, 0], cursor: 0, query: '', loaded: false, loading: false, ticket: 0
        };
    }

    function setStatus(tab, message) {
        tab.status.textContent = message || '';
        tab.status.hidden = !message;
    }

    function clearResults(tab) {
        tab.cols.forEach(function (col) { col.textContent = ''; });
        tab.items = [];
        tab.colHeights = [0, 0];
        clearSelection();
    }

    // Exact URLs from the provider (KLIPY) win; otherwise build from the id
    function urlsFor(item) {
        return item.urls || gifApi.gifUrls(item);
    }

    function addItem(tab, item) {
        const urls = urlsFor(item);
        if (!urls) return;
        const index = tab.items.length;
        tab.items.push(item);

        // Shorter column first keeps the two columns balanced
        const col = tab.colHeights[0] <= tab.colHeights[1] ? 0 : 1;
        tab.colHeights[col] += item.height / item.width;

        const button = node('button', 'gif-sheet-item');
        button.type = 'button';
        button.setAttribute('data-index', String(index));
        const kind = item.kind || 'gif';
        if (kind !== 'gif') button.classList.add('is-' + kind);   // stickers are transparent: needs a backdrop
        button.setAttribute('aria-label', ITEM_LABELS[kind] + (item.title ? ': ' + item.title : ''));
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
        tab.cols[col].appendChild(button);
    }

    // Loads a page into `tab`: reset = a new search (or first load), else the next page.
    // The words are whatever is in the search field.
    async function load(tab, reset) {
        const adapter = provider();
        if (!adapter || !state || !tab) return;
        const query = els.search.value.trim().slice(0, MAX_QUERY);
        const ticket = ++tab.ticket;
        const owner = state;
        if (reset) {
            tab.cursor = 0;
            tab.query = query;
            tab.loaded = false;
            tab.failed = false;
            clearResults(tab);
            tab.more.hidden = true;
        }
        tab.loading = true;
        setStatus(tab, reset ? 'Szukam...' : '');
        const firstNew = tab.items.length;   // index of the first picture this page adds
        tab.more.disabled = true;
        if (!reset) tab.more.textContent = 'Ładuję...';   // feedback on the button itself
        try {
            const cacheKey = tab.kind + '|' + tab.query + '|' + tab.cursor;
            let page = owner.cache.get(cacheKey);
            if (!page) {
                page = await adapter.search(tab.query, tab.cursor, config, tab.kind);
                owner.cache.set(cacheKey, page);
            }
            if (ticket !== tab.ticket || owner !== state) return; // a newer search replaced this one
            page.items.forEach(function (item) { addItem(tab, item); });
            tab.cursor = page.next;
            tab.loaded = true;
            tab.more.hidden = !page.hasMore;
            if (!reset) revealFrom(tab, firstNew);
            setStatus(tab, tab.items.length ? '' : (tab.query ? 'Nic nie znaleziono. Spróbuj innego słowa.' : EMPTY_LABELS[tab.kind]));
        } catch (error) {
            if (ticket !== tab.ticket || owner !== state) return;
            tab.failed = true;      // not retried by every scroll tick: only by a new search or tab tap
            setStatus(tab, (error && error.kind && error.message) || 'Nie udało się pobrać GIF-ów. Sprawdź połączenie.');
        } finally {
            tab.loading = false;
            tab.more.disabled = false;
            tab.more.textContent = MORE_LABEL;
        }
    }

    // After "Pokaż więcej": bring the first new picture into view, so it is
    // obvious that something was added below
    function revealFrom(tab, index) {
        const first = tab.card.querySelector('.gif-sheet-item[data-index="' + index + '"]');
        if (!first) return;
        const top = tab.card.scrollTop + (first.getBoundingClientRect().top - tab.card.getBoundingClientRect().top) - 8;
        tab.card.scrollTo({ top: Math.max(0, top), behavior: reducedMotion() ? 'auto' : 'smooth' });
    }

    // ------------------------------------------------------------------
    // Choosing and sending
    // ------------------------------------------------------------------

    function clearSelection() {
        if (!els) return;
        if (state) {
            state.selected = null;
            // the sheet was frozen behind the preview: wake it
            if (!els.preview.hidden && els.sheet.classList.contains('is-open')) els.sheet.removeAttribute('inert');
        }
        els.preview.hidden = true;
        els.previewImg.removeAttribute('src');
        els.pager.querySelectorAll('.gif-sheet-item[aria-pressed="true"]').forEach(function (b) {
            b.setAttribute('aria-pressed', 'false');
        });
    }

    // "Pomiń": close the preview, back to the pictures (focus returns to the one chosen)
    function skipPreview() {
        const back = state && state.selectedButton;
        clearSelection();
        if (back && document.contains(back) && typeof back.focus === 'function') back.focus();
    }

    function select(kind, index, button) {
        const tab = state.tabs[kind];
        const item = tab && tab.items[index];
        if (!item) return;
        const urls = urlsFor(item);
        if (!urls) return;
        clearSelection();
        state.selected = item;
        state.selectedQuery = tab.query;
        state.selectedButton = button;
        button.setAttribute('aria-pressed', 'true');
        const itemKind = item.kind || 'gif';
        els.previewImg.alt = item.title ? PREVIEW_LABELS[itemKind] + ': ' + item.title : PREVIEW_LABELS[itemKind];
        els.previewImg.classList.toggle('is-sticker', itemKind === 'sticker');
        els.previewTitle.textContent = item.title || '';
        els.previewTitle.hidden = !item.title;
        els.preview.setAttribute('aria-label', PREVIEW_LABELS[itemKind]);
        els.send.textContent = SEND_LABELS[itemKind];
        els.previewImg.width = item.width;
        els.previewImg.height = item.height;
        els.previewImg.src = urls.animated;
        els.sheet.setAttribute('inert', '');          // the preview is the only thing to use now
        els.preview.hidden = false;
        if (item.analytics && item.analytics.onclick) ping(item.analytics.onclick.url);
        els.send.focus();
    }

    function sendSelected() {
        const item = state && state.selected;
        if (!item) return;
        if (item.analytics && item.analytics.onsent) ping(item.analytics.onsent.url);
        const adapter = provider();
        if (adapter && typeof adapter.onSent === 'function') adapter.onSent(item, state.selectedQuery || '');
        const pick = state.onPick;
        closeSheet(true);
        if (typeof pick === 'function') {
            pick({ provider: item.provider, kind: item.kind || 'gif', id: item.id, width: item.width, height: item.height });
        }
    }

    // ------------------------------------------------------------------
    // Tabs and the sideways pager (KLIPY: GIFs, stickers, memes)
    // ------------------------------------------------------------------

    // Builds the cards for the kinds this provider has, and the tab bar
    function showTabs() {
        const kinds = state.kinds;
        const list = kinds || ['gif'];
        els.tabs.hidden = !kinds;
        els.pagebar.hidden = !kinds;
        els.pager.classList.toggle('is-single', !kinds);
        els.title.textContent = kinds ? 'Wybierz GIF-a, naklejkę lub mem' : 'Wybierz GIF-a';
        Object.keys(els.tabButtons).forEach(function (kind) {
            els.tabButtons[kind].hidden = !kinds || kinds.indexOf(kind) === -1;
        });
        els.pager.textContent = '';
        state.tabs = {};
        list.forEach(function (kind) {
            const tab = makeTab(kind);
            state.tabs[kind] = tab;
            els.pager.appendChild(tab.card);
        });
        els.pager.scrollLeft = 0;
        markTab();
        paintPosition();
    }

    // aria state and the roving tab stop
    function markTab() {
        Object.keys(els.tabButtons).forEach(function (kind) {
            const on = kind === state.kind;
            els.tabButtons[kind].setAttribute('aria-selected', on ? 'true' : 'false');
            els.tabButtons[kind].setAttribute('tabindex', on ? '0' : '-1');
        });
    }

    // Where the pager is, in cards (0 = first card, 1 = second ...), fractions in between
    function pagePosition() {
        const width = els.pager.clientWidth;
        return width ? els.pager.scrollLeft / width : 0;
    }

    // Puts the tab indicator behind the tab(s) the pager is over, and the
    // scrollbar thumb along its track, both following the swipe
    function paintPosition() {
        if (!state || !state.kinds) return;
        const pos = Math.max(0, Math.min(state.kinds.length - 1, pagePosition()));
        const low = Math.floor(pos);
        const high = Math.min(state.kinds.length - 1, low + 1);
        const frac = pos - low;
        const a = els.tabButtons[state.kinds[low]];
        const b = els.tabButtons[state.kinds[high]];
        if (a && b && !els.tabs.hidden) {
            const left = a.offsetLeft + (b.offsetLeft - a.offsetLeft) * frac;
            const width = a.offsetWidth + (b.offsetWidth - a.offsetWidth) * frac;
            els.indicator.style.width = width + 'px';
            els.indicator.style.transform = 'translateX(' + left + 'px)';
        }
        const track = els.pagebar.clientWidth;
        if (track) {
            const thumbWidth = Math.max(36, track / state.kinds.length);
            const range = track - thumbWidth;
            els.thumb.style.width = thumbWidth + 'px';
            els.thumb.style.transform = 'translateX(' + (state.kinds.length > 1 ? pos / (state.kinds.length - 1) * range : 0) + 'px)';
        }
    }

    // The pager moved (swipe, tab tap, thumb drag): follow it
    let paintQueued = false;
    function onPagerScroll() {
        if (!state || !state.kinds) return;
        if (!paintQueued) {
            paintQueued = true;
            root.requestAnimationFrame(function () { paintQueued = false; paintPosition(); });
        }
        if (state.jump) {
            // heading for a card chosen by tab / track tap: do not wake the ones on the way
            if (Math.abs(els.pager.scrollLeft - state.jump.left) < 2) state.jump = null;
            return;
        }
        const index = Math.max(0, Math.min(state.kinds.length - 1, Math.round(pagePosition())));
        activate(state.kinds[index]);
    }

    // `kind` is now the card in front: the tabs say so, and a card that has
    // not been loaded (or was loaded for other words) loads now
    function activate(kind) {
        if (!state || !state.tabs[kind]) return;
        if (kind !== state.kind) {
            state.kind = kind;
            markTab();
            clearSelection();                // a preview belongs to the card it came from
            clearLiveSize();
        }
        const tab = state.tabs[kind];
        const typed = els.search.value.trim().slice(0, MAX_QUERY);
        if (!tab.loading && !(tab.failed && tab.query === typed) && (!tab.loaded || tab.query !== typed)) load(tab, true);
    }

    // Tab tapped / key pressed: wake that card now and scroll to it
    function goToTab(kind) {
        if (!state || !state.kinds || state.kinds.indexOf(kind) === -1) return;
        if (state.timer) clearTimeout(state.timer);
        const left = state.kinds.indexOf(kind) * els.pager.clientWidth;
        state.jump = Math.abs(els.pager.scrollLeft - left) < 2 ? null : { left: left };
        if (state.jumpTimer) clearTimeout(state.jumpTimer);
        // (if the scroll never lands exactly, stop waiting for it after a second)
        state.jumpTimer = setTimeout(function () { if (state) state.jump = null; }, 1000);
        // tapping a tab also retries a card that failed to load
        if (state.tabs[kind]) state.tabs[kind].failed = false;
        activate(kind);
        els.pager.scrollTo({ left: left, behavior: reducedMotion() ? 'auto' : 'smooth' });
    }

    // The drawn scrollbar: drag the thumb, or tap the track to jump to that card
    function installPagebar() {
        const pagebar = els.pagebar;
        const thumb = els.thumb;
        let drag = null;

        function endDrag() {
            if (!drag) return;
            drag = null;
            els.pager.classList.remove('is-dragging');
            // let go between two cards: settle on the nearest one
            if (state && state.kinds) goToTab(state.kinds[Math.max(0, Math.min(state.kinds.length - 1, Math.round(pagePosition())))]);
        }

        thumb.addEventListener('pointerdown', function (e) {
            if (!state || !state.kinds) return;
            e.preventDefault();
            e.stopPropagation();
            if (typeof thumb.setPointerCapture === 'function') {
                try { thumb.setPointerCapture(e.pointerId); } catch (err) { /* pointer already gone */ }
            }
            state.jump = null;
            drag = { startX: e.clientX, startScroll: els.pager.scrollLeft };
            // snapping off while dragging, so the cards follow the thumb smoothly
            els.pager.classList.add('is-dragging');
        });
        thumb.addEventListener('pointermove', function (e) {
            if (!drag) return;
            const max = els.pager.scrollWidth - els.pager.clientWidth;
            const range = pagebar.clientWidth - thumb.offsetWidth;
            if (range <= 0 || max <= 0) return;
            els.pager.scrollLeft = drag.startScroll + (e.clientX - drag.startX) / range * max;
        });
        thumb.addEventListener('pointerup', endDrag);
        thumb.addEventListener('pointercancel', endDrag);
        thumb.addEventListener('lostpointercapture', endDrag);

        pagebar.addEventListener('pointerdown', function (e) {
            if (e.target !== pagebar || !state || !state.kinds) return;
            e.preventDefault();
            const box = pagebar.getBoundingClientRect();
            const ratio = box.width ? (e.clientX - box.left) / box.width : 0;
            const index = Math.max(0, Math.min(state.kinds.length - 1, Math.floor(ratio * state.kinds.length)));
            goToTab(state.kinds[index]);
        });
    }

    function openSheet(options) {
        if (!config.enabled || !provider()) return;
        if (!els) build();
        focusBefore = (options && options.trigger) || document.activeElement;
        state = {
            onPick: options && options.onPick,
            onOpen: options && options.onOpen,
            onClose: options && options.onClose,
            cache: new Map(), selected: null, timer: null,
            // the kinds this provider has (KLIPY: GIFs, stickers, memes) and the one in front
            kinds: provider().kinds || null, kind: 'gif', tabs: {}, jump: null
        };
        showTabs();
        els.attribution.textContent = provider().attribution;
        els.search.placeholder = provider().placeholder || 'Szukaj GIF-ów...';
        els.search.setAttribute('aria-label', provider().searchLabel || els.search.placeholder.replace(/\.\.\.$/, ''));
        els.search.value = '';
        setExpanded(false);        // always opens compact
        els.sheet.removeAttribute('aria-hidden');
        els.sheet.removeAttribute('inert');
        els.overlay.classList.add('is-open');
        els.sheet.classList.add('is-open');
        clearSelection();
        load(activeTab(), true);
        // On a phone, focusing the search would raise the keyboard over the
        // very list the user came to look at: start on the panel instead.
        const touch = !!(root.matchMedia && root.matchMedia('(pointer: coarse)').matches);
        (touch ? els.close : els.search).focus();
        paintPosition();
    }

    // Compact (about half the screen: the conversation stays in view) or
    // expanded (nearly full height) - toggled by the chevron.
    //
    // On a phone a drag (or wheel) on a list also resizes the panel, and
    // while it is doing so the LIST stays put: the movement goes into the
    // panel's height first, so only one thing moves under the finger. Dragging
    // up grows the panel until it is expanded, then the list scrolls as usual.
    // Dragging down at the top of the list shrinks it back towards compact.
    // When the finger lifts (or the wheel pauses) the panel eases to whichever
    // end is nearer. The chevron overrides all of this for the current opening.
    // A SIDEWAYS drag is the pager's: it is never touched here.
    const IDLE_MS = 160;               // a wheel pause this long ends the gesture
    const AXIS_SLOP = 3;               // px of movement before a drag is called sideways or vertical

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
        const h = state.liveH != null ? state.liveH : Math.round(els.sheet.getBoundingClientRect().height);
        let next;
        if (move > 0 && h < sizes.full) next = Math.min(sizes.full, h + move);
        else if (move < 0 && activeTab().card.scrollTop <= 0 && h > sizes.compact) next = Math.max(sizes.compact, h + move);
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
        state.touch = { x0: e.touches[0].clientX, y0: e.touches[0].clientY, y: e.touches[0].clientY, axis: null };
    }

    function onResultsTouchMove(e) {
        const touch = state && state.touch;
        if (!touch || !e.touches || e.touches.length !== 1) return;
        const x = e.touches[0].clientX;
        const y = e.touches[0].clientY;
        if (!touch.axis) {
            // The first movement decides: sideways belongs to the pager (it
            // scrolls natively and must not be interfered with), vertical to us
            const dx = Math.abs(x - touch.x0);
            const dy = Math.abs(y - touch.y0);
            if (Math.max(dx, dy) < AXIS_SLOP) return;
            touch.axis = dx > dy ? 'x' : 'y';
        }
        if (touch.axis !== 'y') return;
        const move = touch.y - y;                   // finger up = positive
        touch.y = y;
        if (resizeBy(move) && e.cancelable) e.preventDefault();   // the list stays put
    }

    function onResultsTouchEnd() {
        if (!state) return;
        state.touch = null;
        settleSize();
    }

    function onResultsWheel(e) {
        if (!state) return;
        if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;     // sideways: the pager's
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
        Object.keys(state.tabs).forEach(function (kind) { state.tabs[kind].ticket++; });
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
        els.pager.textContent = '';                  // free the images
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
