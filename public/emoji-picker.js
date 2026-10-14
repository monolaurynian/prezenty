/*
 * Full emoji picker (category tabs + scrollable grid).
 *
 * Knows nothing about reactions: the caller passes
 *   EmojiPicker.create(container, { onSelect(emoji), isSelected(emoji) })
 * and gets { show, refreshSelected, focusFirst, reset } back.
 *
 * Data comes from window.EmojiData (emoji-data.js, bundled, same origin), so
 * the picker works offline and with every CDN blocked. Only the ACTIVE
 * category is in the DOM (at most a few hundred buttons).
 *
 * Accessibility: tab row = role=tablist with roving tabindex and automatic
 * activation (Left/Right/Home/End); the grid = role=tabpanel labelled by the
 * active tab, native <button>s (the glyph is the button's text, so the screen
 * reader announces it in the user's own language), exactly ONE tab stop with
 * Arrow/Home/End navigation inside. Every node is built with createElement /
 * textContent / setAttribute - no innerHTML, no regex over emoji.
 */
(function (root) {
    'use strict';

    if (typeof document === 'undefined') return;

    const PANEL_ID = 'emojiPickerPanel';
    const EDGE = 12; // px of breathing room when a tab is scrolled into view

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

        let active = 0;        // index of the active category (kept in memory)
        let rove = 0;          // index of the grid button that holds tabindex=0
        let buttons = [];      // emoji buttons of the active category
        const tabEls = [];

        const tablist = document.createElement('div');
        tablist.className = 'emoji-picker-tabs';
        tablist.setAttribute('role', 'tablist');
        tablist.setAttribute('aria-label', 'Kategorie emoji');

        const grid = document.createElement('div');
        grid.className = 'emoji-picker-grid';
        grid.id = PANEL_ID;
        grid.setAttribute('role', 'tabpanel');

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

        container.textContent = '';
        container.appendChild(tablist);
        container.appendChild(grid);

        function paintTabs() {
            tabEls.forEach((tab, index) => {
                const on = index === active;
                tab.setAttribute('aria-selected', on ? 'true' : 'false');
                tab.tabIndex = on ? 0 : -1;
            });
        }

        // Scrolls the tab row by hand: scrollIntoView() could also scroll
        // the clipped sheet around it.
        function revealTab(tab) {
            const left = tab.offsetLeft;
            const right = left + tab.offsetWidth;
            if (left < tablist.scrollLeft) {
                tablist.scrollLeft = Math.max(0, left - EDGE);
            } else if (right > tablist.scrollLeft + tablist.clientWidth) {
                tablist.scrollLeft = right - tablist.clientWidth + EDGE;
            }
        }

        function paintGrid() {
            grid.setAttribute('aria-labelledby', tabEls[active].id);
            const fragment = document.createDocumentFragment();
            lists[active].forEach((emoji, index) => {
                const button = document.createElement('button');
                button.type = 'button';
                button.className = 'emoji-picker-btn';
                button.setAttribute('data-emoji', emoji);
                button.setAttribute('aria-pressed', isSelected(emoji) ? 'true' : 'false');
                button.tabIndex = index === rove ? 0 : -1;
                button.textContent = emoji;
                fragment.appendChild(button);
            });
            grid.textContent = '';
            grid.appendChild(fragment);
            grid.scrollTop = 0;
            buttons = Array.prototype.slice.call(grid.children);
        }

        function selectCategory(index, moveFocus) {
            active = index;
            rove = 0;
            paintTabs();
            paintGrid();
            revealTab(tabEls[index]);
            if (moveFocus) tabEls[index].focus();
        }

        function moveTo(index) {
            if (buttons.length === 0) return;
            const next = Math.max(0, Math.min(buttons.length - 1, index));
            if (buttons[rove]) buttons[rove].tabIndex = -1;
            rove = next;
            buttons[next].tabIndex = 0;
            buttons[next].focus();
        }

        // Buttons that share the first button's offsetTop sit in one row.
        function columns() {
            if (buttons.length === 0) return 1;
            const top = buttons[0].offsetTop;
            let count = 0;
            while (count < buttons.length && buttons[count].offsetTop === top) count++;
            return Math.max(1, count);
        }

        tablist.addEventListener('click', (e) => {
            if (!(e.target instanceof Element)) return;
            const tab = e.target.closest('.emoji-picker-tab');
            if (!tab) return;
            const index = Number(tab.getAttribute('data-index'));
            if (index !== active) selectCategory(index, false);
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
            selectCategory(next, true);
        });

        grid.addEventListener('click', (e) => {
            if (!(e.target instanceof Element)) return;
            const button = e.target.closest('.emoji-picker-btn');
            if (!button) return;
            onSelect(button.getAttribute('data-emoji'));
        });

        grid.addEventListener('keydown', (e) => {
            if (e.altKey || e.ctrlKey || e.metaKey) return;
            const current = buttons.indexOf(document.activeElement);
            if (current === -1) return;
            const last = buttons.length - 1;
            let next = -1;
            if (e.key === 'ArrowRight') next = current + 1;
            else if (e.key === 'ArrowLeft') next = current - 1;
            else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                const cols = columns();
                if (e.key === 'ArrowDown') {
                    next = current + cols;
                    // A shorter last row: land on its last cell instead of nowhere
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

        paintTabs();
        paintGrid();

        return {
            // Makes sure tabs and grid reflect the current selection state.
            show: function () {
                paintTabs();
                if (buttons.length === 0) paintGrid();
                this.refreshSelected();
                revealTab(tabEls[active]);
            },
            // Only flips aria-pressed - never rebuilds nodes or moves focus,
            // so a poll-driven repaint cannot steal the user's place.
            refreshSelected: function () {
                buttons.forEach(button => {
                    button.setAttribute('aria-pressed',
                        isSelected(button.getAttribute('data-emoji')) ? 'true' : 'false');
                });
            },
            // Focus lands on the first emoji of the active category.
            focusFirst: function () {
                moveTo(0);
            },
            // Back to the first category, scrolled to the top.
            reset: function () {
                selectCategory(0, false);
                tablist.scrollLeft = 0;
            }
        };
    }

    root.EmojiPicker = { create: create };
})(typeof window !== 'undefined' ? window : globalThis);
