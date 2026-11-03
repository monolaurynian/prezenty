/*
 * Full emoji picker (category tabs + continuous vertical scroll).
 *
 * Knows nothing about reactions: the caller passes
 *   EmojiPicker.create(container, { onSelect(emoji), isSelected(emoji) })
 * and gets { show, refreshSelected, focusFirst, reset } back.
 *
 * Data comes from window.EmojiData (emoji-data.js, bundled, same origin), so
 * the picker works offline and with every CDN blocked.
 *
 * Layout: all categories are rendered at once, each preceded by a sticky
 * section heading. The tab row acts as jump navigation (smooth scroll to
 * section). An IntersectionObserver updates the active tab as the user
 * scrolls. During search the continuous view is replaced by a flat filtered
 * list (no headings). Clearing search restores the scrollable view.
 *
 * Accessibility: tab row = role=tablist with roving tabindex and automatic
 * activation (Left/Right/Home/End); the grid = role=tabpanel labelled by the
 * active tab. Every node is built with createElement / textContent /
 * setAttribute - no innerHTML, no regex over emoji.
 */
(function (root) {
    'use strict';

    if (typeof document === 'undefined') return;

    const PANEL_ID = 'emojiPickerPanel';
    const EDGE = 12; // px of breathing room when a tab is scrolled into view

    /* ---------------------------------------------------------------
       Keyword map for search. Keys are emoji glyphs, values are
       space-separated Polish/English keywords.
    --------------------------------------------------------------- */
    const EMOJI_KEYWORDS = {
      '😀':'happy smile laugh',  '😂':'laugh cry funny', '🥰':'love heart',
      '😍':'love eyes heart',    '😭':'cry sad tears',   '😡':'angry mad',
      '😎':'cool sunglasses',    '🤔':'think hmm',       '👍':'ok good yes thumbs',
      '👎':'bad no thumbs',      '❤️':'heart love red',  '🔥':'fire hot',
      '💯':'100 perfect ok',     '🎉':'party celebrate', '🎁':'gift present',
      '🎄':'christmas tree',     '🎅':'santa christmas', '⭐':'star',
      '🌟':'star sparkle',       '💪':'strong muscle',   '🙏':'thanks pray',
      '👏':'clap bravo',         '🤝':'handshake deal',  '😴':'sleep tired',
      '🤢':'sick nausea',        '😷':'sick mask',       '💀':'skull dead',
      '👻':'ghost halloween',    '🐶':'dog pies',        '🐱':'cat kot',
      '🐻':'bear miś',           '🦊':'fox lis',         '🐼':'panda',
      '🍕':'pizza',              '🍔':'burger',          '🍺':'beer piwo',
      '🍷':'wine wino',          '☕':'coffee kawa',     '🎂':'cake urodziny',
      '🍰':'cake ciasto',        '🚗':'car auto',        '✈️':'plane lot',
      '🏠':'house dom',          '💰':'money pieniądze', '💎':'diamond',
      '📱':'phone telefon',      '💻':'laptop computer', '📷':'camera foto',
      '🎮':'game gra',           '⚽':'football piłka',  '🏀':'basketball',
      '🎵':'music muzyka',       '🎸':'guitar gitara',   '🌈':'rainbow tęcza',
      '☀️':'sun słońce',         '🌙':'moon księżyc',    '❄️':'snow śnieg',
      '🌊':'wave ocean morze',   '🌸':'flower kwiat',    '🌹':'rose róża',
      '💐':'flowers kwiaty',     '🦋':'butterfly motyl', '🐝':'bee pszczoła',
      '💩':'poop',               '🤡':'clown',           '👑':'crown korona',
      '🎯':'target cel',         '🔑':'key klucz',       '💡':'idea light',
      '📚':'books książki',      '✏️':'pen pencil',      '🏆':'trophy nagroda',
      '🥇':'gold medal',         '🎨':'art sztuka',      '🌍':'earth world świat',
      '🇵🇱':'poland polska',    '🙈':'monkey see',      '💬':'chat message',
      '📣':'megaphone',          '🔔':'bell dzwonek',    '⏰':'alarm clock',
      '💊':'pill tablet',        '🩺':'doctor lekarz',   '🧹':'broom',
      '🎃':'halloween pumpkin',  '🎆':'fireworks fajerwerki',
    };

    function create(container, options) {
        const opts = options || {};
        const data = root.EmojiData;
        if (!container || !data || !Array.isArray(data.categories) || data.categories.length === 0) {
            return null;
        }
        const categories = data.categories;
        const onSelect = typeof opts.onSelect === 'function' ? opts.onSelect : function () {};
        const isSelected = typeof opts.isSelected === 'function' ? opts.isSelected : function () { return false; };
        const lists = categories.map(category =>
            String(category.emoji || '').split(' ').filter(Boolean));

        // Flat list of all emoji across all categories (for search)
        const allEmoji = lists.reduce(function(acc, list) { return acc.concat(list); }, []);

        let active = 0;        // index of the currently-highlighted tab
        let rove = 0;          // index of the grid button that holds tabindex=0
        let searchQuery = '';  // current search string
        let buttons = [];      // emoji buttons currently in DOM
        const tabEls = [];
        // heading elements (one per category) for scroll-spy
        const headingEls = [];

        const prefersReducedMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

        /* ---- Tab row ---- */
        const tablist = document.createElement('div');
        tablist.className = 'emoji-picker-tabs';
        tablist.setAttribute('role', 'tablist');
        tablist.setAttribute('aria-label', 'Kategorie emoji');

        /* ---- Scrollable grid (holds all categories) ---- */
        const grid = document.createElement('div');
        grid.className = 'emoji-picker-grid';
        grid.id = PANEL_ID;
        grid.setAttribute('role', 'tabpanel');

        /* ---- Search input ---- */
        const searchInput = document.createElement('input');
        searchInput.type = 'search';
        searchInput.className = 'emoji-picker-search';
        searchInput.placeholder = 'Szukaj emoji...';
        searchInput.setAttribute('aria-label', 'Szukaj emoji');
        searchInput.setAttribute('autocomplete', 'off');
        searchInput.setAttribute('autocorrect', 'off');
        searchInput.setAttribute('autocapitalize', 'off');
        searchInput.setAttribute('spellcheck', 'false');

        /* ---- "no results" message node ---- */
        const noResults = document.createElement('p');
        noResults.style.cssText = 'margin:16px 4px;color:#718096;font-size:14px;grid-column:1/-1;';
        noResults.hidden = true;

        /* ---- Build tabs ---- */
        categories.forEach((category, index) => {
            const tab = document.createElement('button');
            tab.type = 'button';
            tab.className = 'emoji-picker-tab';
            tab.id = 'emojiPickerTab-' + String(category.id);
            tab.setAttribute('role', 'tab');
            tab.setAttribute('aria-label', String(category.label));
            tab.setAttribute('aria-controls', PANEL_ID);
            tab.setAttribute('data-index', String(index));
            tab.textContent = String(category.icon);
            tabEls.push(tab);
            tablist.appendChild(tab);
        });

        /* ---- Build the full continuous grid (rendered once) ---- */
        function buildFullGrid() {
            grid.textContent = '';
            headingEls.length = 0;
            buttons = [];

            categories.forEach((category, catIndex) => {
                // Sticky section heading
                const heading = document.createElement('div');
                heading.className = 'emoji-picker-section-heading';
                heading.textContent = String(category.label);
                heading.setAttribute('data-category-index', String(catIndex));
                headingEls.push(heading);
                grid.appendChild(heading);

                // Emoji buttons for this category
                lists[catIndex].forEach((emoji, emojiIndex) => {
                    const button = document.createElement('button');
                    button.type = 'button';
                    button.className = 'emoji-picker-btn';
                    button.setAttribute('data-emoji', emoji);
                    button.setAttribute('data-cat-index', String(catIndex));
                    button.setAttribute('aria-pressed', isSelected(emoji) ? 'true' : 'false');
                    button.tabIndex = (catIndex === 0 && emojiIndex === 0) ? 0 : -1;
                    button.textContent = emoji;
                    buttons.push(button);
                    grid.appendChild(button);
                });
            });

            rove = 0;
            grid.appendChild(noResults);
        }

        /* ---- IntersectionObserver: update active tab as sections scroll ---- */
        let observer = null;
        let scrollJumping = false; // suppress observer during programmatic scroll

        function setupObserver() {
            if (observer) observer.disconnect();
            // Observe each heading; when a heading enters the top portion of
            // the grid viewport, mark its category as active.
            observer = new IntersectionObserver(function (entries) {
                if (scrollJumping) return;
                // Find the topmost visible heading
                let topmost = null;
                entries.forEach(function (entry) {
                    if (entry.isIntersecting) {
                        if (topmost === null ||
                            entry.boundingClientRect.top < topmost.boundingClientRect.top) {
                            topmost = entry;
                        }
                    }
                });
                if (topmost) {
                    const idx = Number(topmost.target.getAttribute('data-category-index'));
                    if (idx !== active) {
                        active = idx;
                        paintTabs();
                        revealTab(tabEls[active]);
                    }
                }
            }, {
                root: grid,
                // Fire when heading is within the top 20% of the grid container
                rootMargin: '0px 0px -80% 0px',
                threshold: 0
            });

            headingEls.forEach(function (h) { observer.observe(h); });
        }

        /* ---- Assemble container ---- */
        container.textContent = '';
        container.appendChild(searchInput);
        container.appendChild(tablist);
        container.appendChild(grid);

        /* ---- Paint helpers ---- */
        function paintTabs() {
            tabEls.forEach((tab, index) => {
                const on = index === active;
                tab.setAttribute('aria-selected', on ? 'true' : 'false');
                tab.tabIndex = on ? 0 : -1;
            });
        }

        function revealTab(tab) {
            const left = tab.offsetLeft;
            const right = left + tab.offsetWidth;
            if (left < tablist.scrollLeft) {
                tablist.scrollLeft = Math.max(0, left - EDGE);
            } else if (right > tablist.scrollLeft + tablist.clientWidth) {
                tablist.scrollLeft = right - tablist.clientWidth + EDGE;
            }
        }

        /* ---- Search: show flat filtered results ---- */
        function paintSearchResults(query) {
            // Hide section headings during search
            headingEls.forEach(h => { h.hidden = true; });
            noResults.hidden = true;

            const filtered = allEmoji.filter(function (emoji) {
                const kw = EMOJI_KEYWORDS[emoji];
                if (kw && kw.includes(query)) return true;
                // Also try category label
                const catIdx = categories.findIndex(function (_, ci) {
                    return lists[ci].indexOf(emoji) !== -1;
                });
                if (catIdx !== -1 && categories[catIdx].label.toLowerCase().includes(query)) return true;
                // Direct emoji character match (user pasted an emoji)
                if (emoji === query) return true;
                return false;
            });

            // Hide all buttons
            buttons.forEach(b => { b.hidden = true; });

            if (filtered.length === 0) {
                noResults.textContent = 'Brak wyników dla \'' + query + '\'';
                noResults.hidden = false;
                return;
            }

            // Show only matched buttons (reuse existing nodes to avoid rebuild)
            const emojiToButton = {};
            buttons.forEach(function (b) {
                const emoji = b.getAttribute('data-emoji');
                // There could be duplicates; keep first occurrence
                if (!emojiToButton[emoji]) emojiToButton[emoji] = b;
            });

            rove = -1;
            filtered.forEach(function (emoji, i) {
                const btn = emojiToButton[emoji];
                if (!btn) return;
                btn.hidden = false;
                btn.tabIndex = (i === 0) ? 0 : -1;
                if (i === 0) rove = buttons.indexOf(btn);
            });
        }

        /* ---- Restore full continuous view ---- */
        function paintFullView() {
            headingEls.forEach(h => { h.hidden = false; });
            buttons.forEach((b, i) => {
                b.hidden = false;
                b.tabIndex = (i === 0) ? 0 : -1;
            });
            noResults.hidden = true;
            rove = 0;
            grid.setAttribute('aria-labelledby', tabEls[active].id);
            grid.removeAttribute('aria-label');
            grid.removeAttribute('data-search-active');
            grid.scrollTop = 0;
        }

        /* ---- Jump to category section (tab click) ---- */
        function jumpToCategory(index) {
            active = index;
            paintTabs();
            revealTab(tabEls[index]);

            const heading = headingEls[index];
            if (!heading) return;

            scrollJumping = true;
            heading.scrollIntoView({ behavior: prefersReducedMotion ? 'auto' : 'smooth', block: 'start' });
            // Re-enable observer after scroll settles (~500 ms)
            setTimeout(function () { scrollJumping = false; }, 600);
        }

        function moveTo(index) {
            const visibleButtons = buttons.filter(b => !b.hidden);
            if (visibleButtons.length === 0) return;
            const next = Math.max(0, Math.min(visibleButtons.length - 1, index));
            if (rove >= 0 && buttons[rove]) buttons[rove].tabIndex = -1;
            const targetBtn = visibleButtons[next];
            const targetIdx = buttons.indexOf(targetBtn);
            rove = targetIdx;
            targetBtn.tabIndex = 0;
            targetBtn.focus();
        }

        function columns() {
            const visibleButtons = buttons.filter(b => !b.hidden);
            if (visibleButtons.length === 0) return 1;
            const top = visibleButtons[0].offsetTop;
            let count = 0;
            while (count < visibleButtons.length && visibleButtons[count].offsetTop === top) count++;
            return Math.max(1, count);
        }

        /* ---- Event listeners ---- */
        tablist.addEventListener('click', (e) => {
            if (!(e.target instanceof Element)) return;
            const tab = e.target.closest('.emoji-picker-tab');
            if (!tab) return;
            const index = Number(tab.getAttribute('data-index'));
            if (searchQuery.length > 0) {
                // Clear search first, then jump
                searchQuery = '';
                searchInput.value = '';
                paintFullView();
                setupObserver();
            }
            jumpToCategory(index);
        });

        tablist.addEventListener('keydown', (e) => {
            if (e.altKey || e.ctrlKey || e.metaKey) return;
            const current = tabEls.indexOf(document.activeElement);
            if (current === -1) return;
            let next = -1;
            if (e.key === 'ArrowRight') next = (current + 1) % tabEls.length;
            else if (e.key === 'ArrowLeft') next = (current - 1 + tabEls.length) % tabEls.length;
            else if (e.key === 'Home') next = 0;
            else if (e.key === 'End') next = tabEls.length - 1;
            if (next === -1) return;
            e.preventDefault();
            if (searchQuery.length > 0) {
                searchQuery = '';
                searchInput.value = '';
                paintFullView();
                setupObserver();
            }
            jumpToCategory(next);
            tabEls[next].focus();
        });

        grid.addEventListener('click', (e) => {
            if (!(e.target instanceof Element)) return;
            const button = e.target.closest('.emoji-picker-btn');
            if (!button) return;
            onSelect(button.getAttribute('data-emoji'));
        });

        grid.addEventListener('keydown', (e) => {
            if (e.altKey || e.ctrlKey || e.metaKey) return;
            const visibleButtons = buttons.filter(b => !b.hidden);
            const current = visibleButtons.indexOf(document.activeElement);
            if (current === -1) return;
            const last = visibleButtons.length - 1;
            let next = -1;
            if (e.key === 'ArrowRight') next = current + 1;
            else if (e.key === 'ArrowLeft') next = current - 1;
            else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                const cols = columns();
                if (e.key === 'ArrowDown') {
                    next = current + cols;
                    if (next > last) next = Math.floor(current / cols) < Math.floor(last / cols) ? last : current;
                } else {
                    next = current - cols;
                    if (next < 0) next = current;
                }
            } else if (e.key === 'Home') next = 0;
            else if (e.key === 'End') next = last;
            if (next === -1) return;
            e.preventDefault();
            moveTo(next);
        });

        searchInput.addEventListener('input', function () {
            searchQuery = searchInput.value.toLowerCase().trim();
            rove = 0;
            if (searchQuery.length > 0) {
                // Disconnect observer during search; it only applies to full view
                if (observer) observer.disconnect();
                tablist.hidden = true;
                grid.removeAttribute('aria-labelledby');
                grid.setAttribute('aria-label', 'Wyniki wyszukiwania');
                grid.setAttribute('data-search-active', 'true');
                paintSearchResults(searchQuery);
                grid.scrollTop = 0;
            } else {
                tablist.hidden = false;
                paintFullView();
                setupObserver();
            }
        });

        /* ---- Initial render ---- */
        buildFullGrid();
        paintTabs();

        // Set up observer after a microtask so the grid is in the DOM
        setTimeout(setupObserver, 0);

        return {
            // Makes sure tabs and grid reflect the current selection state.
            show: function () {
                paintTabs();
                this.refreshSelected();
                revealTab(tabEls[active]);
                searchInput.focus();
                // Re-attach observer (sheet may have been hidden + re-shown)
                setTimeout(setupObserver, 0);
            },
            // Only flips aria-pressed - never rebuilds nodes or moves focus,
            // so a poll-driven repaint cannot steal the user's place.
            refreshSelected: function () {
                buttons.forEach(button => {
                    button.setAttribute('aria-pressed',
                        isSelected(button.getAttribute('data-emoji')) ? 'true' : 'false');
                });
            },
            // Focus lands on the first visible emoji button.
            focusFirst: function () {
                moveTo(0);
            },
            // Back to the first category, scrolled to the top.
            reset: function () {
                searchQuery = '';
                searchInput.value = '';
                tablist.hidden = false;
                paintFullView();
                active = 0;
                paintTabs();
                tablist.scrollLeft = 0;
                grid.scrollTop = 0;
                setTimeout(setupObserver, 0);
            }
        };
    }

    root.EmojiPicker = { create: create };
})(typeof window !== 'undefined' ? window : globalThis);
