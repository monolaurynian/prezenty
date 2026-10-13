/*
 * Emoji reactions for the anonymous chat.
 *
 * One file, two consumers - same pattern as pluralize-pl.js and
 * notification-text.js:
 *   - server.js does `require('./public/chat-reactions')` and gets ONLY the
 *     pure logic (allowlist, id parsing, aggregate shaping, toggle action),
 *     so that logic is unit-testable without a browser or a database.
 *   - wiadomosci.html loads it as a <script> and additionally gets the UI
 *     (chips, bottom-sheet picker, optimistic toggle) as window.ChatReactions.
 *
 * Privacy: the only reaction shapes that ever cross the wire are
 * { emoji, count, mine } (aggregates) and { emoji, at, messageId, excerpt }
 * (the conversation-list preview of the OTHER side's newest reaction). There
 * is no user id, username or per-user list anywhere in here - `mine` is
 * computed server side from the session.
 *
 * Reactions deliberately generate NO notifications: nothing in this file
 * touches push, the activity feed or unread counts. (The list-preview
 * WORDING lives in notification-text.js, but it is only text for a row that
 * already exists - it creates no notification.)
 */
(function (root) {
    'use strict';

    // ===============================================================
    // Pure logic (shared with server.js)
    // ===============================================================

    // Fixed reaction set. The ORDER here is the render order for chips and
    // for the picker, so chip order is stable across clients. Nothing
    // outside this list can ever be stored - server.js validates against
    // it and answers 400 for anything else.
    // Names are the gender-neutral Polish labels used in aria-labels.
    const CHAT_REACTIONS = [
        { emoji: '❤️', name: 'serce' },
        { emoji: '😂', name: 'śmiech' },
        { emoji: '👍', name: 'łapka w górę' },
        { emoji: '🎁', name: 'prezent' },
        { emoji: '😮', name: 'zdziwienie' },
        { emoji: '🙏', name: 'podziękowanie' }
    ];
    const CHAT_REACTION_EMOJI = CHAT_REACTIONS.map(r => r.emoji);
    const EMOJI_ORDER = new Map(CHAT_REACTIONS.map((r, i) => [r.emoji, i]));
    const EMOJI_NAME = new Map(CHAT_REACTIONS.map(r => [r.emoji, r.name]));

    function isAllowedReactionEmoji(emoji) {
        return typeof emoji === 'string' && EMOJI_ORDER.has(emoji);
    }

    // Strict: only a plain positive integer passes, so "7abc" or "-1"
    // can never reach a query. Returns null when the input is not usable.
    function parseMessageId(raw) {
        const text = String(raw === null || raw === undefined ? '' : raw).trim();
        if (!/^[0-9]+$/.test(text)) return null;
        const id = Number.parseInt(text, 10);
        return Number.isSafeInteger(id) && id > 0 ? id : null;
    }

    function sortByAllowlist(list) {
        return list.slice().sort((a, b) => EMOJI_ORDER.get(a.emoji) - EMOJI_ORDER.get(b.emoji));
    }

    // Shapes the API response from grouped DB rows
    // (`SELECT emoji, COUNT(*) AS cnt, MAX(user_id = ?) AS mine ...`).
    // Drops anything off the allowlist so a legacy row can never render,
    // drops empty buckets, and keeps aggregate fields only.
    function buildReactionList(rows) {
        const out = [];
        (rows || []).forEach(row => {
            if (!row || !isAllowedReactionEmoji(row.emoji)) return;
            const count = Number(row.cnt);
            if (!Number.isFinite(count) || count < 1) return;
            out.push({
                emoji: row.emoji,
                count: Math.round(count),
                mine: Number(row.mine) === 1
            });
        });
        return sortByAllowlist(out);
    }

    // One GROUP BY query returns the whole thread; this fans the flat rows
    // out into messageId -> [{ emoji, count, mine }] (no N+1 queries).
    function groupReactionsByMessage(rows) {
        const buckets = new Map();
        (rows || []).forEach(row => {
            if (!row) return;
            const id = parseMessageId(row.message_id);
            if (id === null) return;
            if (!buckets.has(id)) buckets.set(id, []);
            buckets.get(id).push(row);
        });
        const byMessage = new Map();
        buckets.forEach((rowsForMessage, id) => {
            const list = buildReactionList(rowsForMessage);
            if (list.length) byMessage.set(id, list);
        });
        return byMessage;
    }

    // The toggle is DELETE-then-INSERT: a deleted row means the reaction
    // was already there, so the tap removed it.
    function toggleAction(deletedRowCount) {
        return Number(deletedRowCount) > 0 ? 'removed' : 'added';
    }

    // Fixed-window counter behind the server-side throttle on the toggle
    // endpoint (client debouncing only protects a well-behaved client).
    // Pure on purpose: the caller owns the bucket store, so this is
    // testable without a server. Returns the next bucket plus the verdict.
    function reactionThrottleStep(bucket, now, maxHits, windowMs) {
        const fresh = !bucket
            || !Number.isFinite(Number(bucket.start))
            || now - Number(bucket.start) >= windowMs;
        if (fresh) return { start: now, hits: 1, allowed: true };
        const hits = Number(bucket.hits || 0) + 1;
        return { start: Number(bucket.start), hits: hits, allowed: hits <= maxHits };
    }

    // One-line excerpt of a message body for the conversation-list preview.
    // Whitespace/newline runs collapse to a single space; longer text is cut
    // by CODE POINTS (so an emoji is never split) and ends with an ellipsis.
    function reactionExcerpt(body, max) {
        const limit = Number.isFinite(max) && max > 1 ? Math.floor(max) : 50;
        const text = String(body === null || body === undefined ? '' : body)
            .replace(/\s+/g, ' ')
            .trim();
        const chars = Array.from(text);
        if (chars.length <= limit) return text;
        return chars.slice(0, limit - 1).join('').trimEnd() + '\u2026';
    }
    // The other side's newest reaction becomes the list preview ONLY when it
    // is newer than the thread's last message (or targets that message
    // itself, which removes the 1-second TIMESTAMP tie). `row` is the SQL /
    // demo row { emoji, reacted_at, message_id, body } of the OTHER side's
    // newest reaction (the query already excluded the viewer's own);
    // `last` is { id, at }. Returns null (normal preview) or the wire shape
    // { emoji, at, messageId, excerpt } - no user id, name or role.
    function buildLastReaction(row, last) {
        if (!row || !last || !isAllowedReactionEmoji(row.emoji)) return null;
        const messageId = parseMessageId(row.message_id);
        if (messageId === null) return null;
        const reactedAt = new Date(row.reacted_at).getTime();
        const lastAt = new Date(last.at).getTime();
        const onLastMessage = parseMessageId(last.id) === messageId;
        if (!onLastMessage && !(reactedAt > lastAt)) return null; // NaN fails too
        return {
            emoji: row.emoji,
            at: row.reacted_at,
            messageId: messageId,
            excerpt: reactionExcerpt(row.body)
        };
    }
    const core = {
        CHAT_REACTIONS: CHAT_REACTIONS,
        CHAT_REACTION_EMOJI: CHAT_REACTION_EMOJI,
        isAllowedReactionEmoji: isAllowedReactionEmoji,
        parseMessageId: parseMessageId,
        buildReactionList: buildReactionList,
        groupReactionsByMessage: groupReactionsByMessage,
        toggleAction: toggleAction,
        reactionThrottleStep: reactionThrottleStep,
        reactionExcerpt: reactionExcerpt,
        buildLastReaction: buildLastReaction
    };

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = core;
    }

    // Server side (require from server.js) stops here - no DOM to wire up.
    if (typeof document === 'undefined') return;

    // ===============================================================
    // Browser UI
    // ===============================================================

    const state = new Map();     // messageId -> [{ emoji, count, mine }]
    const inFlight = new Set();  // 'messageId|emoji' - debounces rapid taps
    let boxBound = false;
    let sheetBound = false;
    let sheetMessageId = null;
    let focusBeforeSheet = null;

    // The chat page already has these; local fallbacks keep the strip
    // rendering even if a stale cache serves this file on its own.
    function esc(value) {
        if (typeof root.escapeHtml === 'function') return root.escapeHtml(value);
        const div = document.createElement('div');
        div.textContent = value === null || value === undefined ? '' : String(value);
        return div.innerHTML;
    }

    function toastError(message) {
        if (typeof root.showToast === 'function') root.showToast(message, 'error');
    }

    function peopleLabel(count) {
        return typeof root.plCount === 'function'
            ? root.plCount(count, 'osoba', 'osoby', 'osób')
            : String(count);
    }

    function chipLabel(item) {
        const name = EMOJI_NAME.get(item.emoji) || 'reakcja';
        return 'Reakcja ' + name + ': ' + peopleLabel(item.count) + '. '
            + (item.mine ? 'Usuń swoją reakcję' : 'Dodaj swoją reakcję');
    }

    function chipHtml(messageId, item) {
        return '<button type="button" class="chat-reaction-chip"'
            + ' data-message-id="' + esc(messageId) + '"'
            + ' data-emoji="' + esc(item.emoji) + '"'
            + ' aria-pressed="' + (item.mine ? 'true' : 'false') + '"'
            + ' aria-label="' + esc(chipLabel(item)) + '">'
            + '<span class="chat-reaction-emoji" aria-hidden="true">' + esc(item.emoji) + '</span>'
            + '<span class="chat-reaction-count">' + esc(item.count) + '</span>'
            + '</button>';
    }

    function addButtonHtml(messageId) {
        return '<button type="button" class="chat-reaction-add"'
            + ' data-message-id="' + esc(messageId) + '"'
            + ' aria-label="Dodaj reakcję do wiadomości">'
            + '<i class="ri-emotion-line" aria-hidden="true"></i>'
            + '</button>';
    }

    // DOM twins of the two *Html builders above. The string versions feed
    // the initial render (the message list is built as one innerHTML
    // string); these build the same markup as nodes, which is what the
    // in-place repaint needs - see syncStrip().
    function fromHtml(html) {
        const holder = document.createElement('div');
        holder.innerHTML = html;
        return holder.firstElementChild;
    }

    function chipEl(messageId, item) {
        return fromHtml(chipHtml(messageId, item));
    }

    function addButtonEl(messageId) {
        return fromHtml(addButtonHtml(messageId));
    }

    // Updates a chip that is ALREADY in the document. Mutating the live
    // button (instead of replacing it) keeps focus where the user put it
    // and lets a screen reader announce the aria-pressed flip on the very
    // control that was activated.
    function applyChip(button, item) {
        button.setAttribute('aria-pressed', item.mine ? 'true' : 'false');
        button.setAttribute('aria-label', chipLabel(item));
        const count = button.querySelector('.chat-reaction-count');
        if (count) count.textContent = String(item.count);
    }

    // Re-validates what the server sent before it is trusted for rendering.
    function normalizeIncoming(list) {
        return buildReactionList((list || []).map(r => ({
            emoji: r && r.emoji,
            cnt: r && r.count,
            mine: r && r.mine ? 1 : 0
        })));
    }

    function hasPendingToggle(messageId) {
        const prefix = messageId + '|';
        let pending = false;
        inFlight.forEach(key => { if (key.indexOf(prefix) === 0) pending = true; });
        return pending;
    }

    // Fingerprint of what is currently DISPLAYED, so the page can detect a
    // reaction-only change and repaint the strips without rebuilding the
    // message list (which would scroll-jump).
    function fingerprint(messages) {
        return (messages || []).map(m => {
            const id = parseMessageId(m && m.id);
            if (id === null) return '';
            const list = state.get(id) || [];
            return id + ':' + list.map(r => r.emoji + r.count + (r.mine ? 'm' : '')).join(',');
        }).join('|');
    }

    // Stores the server aggregate for every message, skipping messages with
    // an in-flight optimistic toggle (their local state is newer).
    function ingest(messages) {
        (messages || []).forEach(m => {
            const id = parseMessageId(m && m.id);
            if (id === null) return;
            if (hasPendingToggle(id)) return;
            state.set(id, normalizeIncoming(m.reactions));
        });
        return fingerprint(messages);
    }

    function strip(message) {
        const id = parseMessageId(message && message.id);
        if (id === null) return '';
        const list = state.get(id) || [];
        return list.map(item => chipHtml(id, item)).join('') + addButtonHtml(id);
    }

    // First chip in the strip that sorts AFTER `emoji`, so a new chip can
    // be inserted in allowlist order without moving any existing chip.
    function nextChipAfter(container, emoji) {
        const order = EMOJI_ORDER.get(emoji);
        const chips = container.querySelectorAll('.chat-reaction-chip');
        for (let i = 0; i < chips.length; i++) {
            const other = EMOJI_ORDER.get(chips[i].getAttribute('data-emoji'));
            if (typeof other === 'number' && other > order) return chips[i];
        }
        return null;
    }

    // Reconciles one strip against `state` WITHOUT replacing innerHTML.
    // Buttons that stay are mutated in place and never moved: re-inserting
    // a node drops its focus, which would throw a keyboard user back to
    // the top of the page on every repaint (and silence the state change).
    function syncStrip(container, id) {
        const list = state.get(id) || [];
        const missing = new Map(list.map(item => [item.emoji, item]));

        // Update the chips that are already there, drop the stale ones
        Array.prototype.slice.call(container.querySelectorAll('.chat-reaction-chip'))
            .forEach(button => {
                const emoji = button.getAttribute('data-emoji');
                const item = missing.get(emoji);
                if (item) {
                    applyChip(button, item);
                    missing.delete(emoji); // what is left needs creating
                } else {
                    button.remove();
                }
            });

        // The add button is created once and then kept forever, so focus
        // on it survives any number of repaints
        let add = container.querySelector('.chat-reaction-add');
        if (!add) {
            add = addButtonEl(id);
            container.appendChild(add);
        }

        // `missing` is still in allowlist order (it was built from the
        // sorted list), so inserting in iteration order keeps chip order
        missing.forEach(item => {
            container.insertBefore(chipEl(id, item), nextChipAfter(container, item.emoji) || add);
        });
    }

    // Repaints the chip strips in place - no message re-render, so the
    // scroll position and link previews survive.
    function refreshStrips() {
        const active = document.activeElement;
        const activeChip = active && active.closest
            ? active.closest('.chat-reaction-chip')
            : null;
        const activeStrip = activeChip ? activeChip.closest('[data-reactions-for]') : null;

        document.querySelectorAll('[data-reactions-for]').forEach(container => {
            const id = parseMessageId(container.getAttribute('data-reactions-for'));
            if (id === null) return;
            syncStrip(container, id);
        });

        // The only chip that can disappear under the user is the one they
        // just un-reacted from (count hit zero). There is no equivalent
        // chip to return to, so focus moves to the add button of the same
        // message rather than falling back to <body>.
        if (activeChip && !document.contains(activeChip) && activeStrip && document.contains(activeStrip)) {
            const fallback = activeStrip.querySelector('.chat-reaction-add');
            if (fallback && typeof fallback.focus === 'function') fallback.focus();
        }

        if (sheetMessageId !== null) paintSheet();
    }

    function applyOptimistic(messageId, emoji) {
        const list = (state.get(messageId) || []).map(r => ({
            emoji: r.emoji, count: r.count, mine: r.mine
        }));
        const idx = list.findIndex(r => r.emoji === emoji);
        if (idx === -1) {
            list.push({ emoji: emoji, count: 1, mine: true });
        } else if (list[idx].mine) {
            list[idx].count -= 1;
            list[idx].mine = false;
            if (list[idx].count < 1) list.splice(idx, 1);
        } else {
            list[idx].count += 1;
            list[idx].mine = true;
        }
        state.set(messageId, sortByAllowlist(list));
    }

    function toggle(messageId, emoji) {
        const id = parseMessageId(messageId);
        if (id === null || !isAllowedReactionEmoji(emoji)) return;
        const key = id + '|' + emoji;
        if (inFlight.has(key)) return; // rapid taps on the same chip collapse
        inFlight.add(key);

        const snapshot = (state.get(id) || []).map(r => ({
            emoji: r.emoji, count: r.count, mine: r.mine
        }));
        applyOptimistic(id, emoji);
        refreshStrips();

        fetch('/api/wiadomosci/messages/' + id + '/reactions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ emoji: emoji })
        })
            .then(r => r.json().then(data => ({ ok: r.ok, data: data })))
            .then(result => {
                if (!result.ok || !result.data || !result.data.success) {
                    const rejected = new Error('reaction rejected');
                    // e.g. the 429 from tapping far too fast - show what
                    // the server said instead of the generic message
                    rejected.serverMessage = result.data && typeof result.data.error === 'string'
                        ? result.data.error
                        : null;
                    throw rejected;
                }
                state.set(id, normalizeIncoming(result.data.reactions));
            })
            .catch((err) => {
                state.set(id, snapshot); // rollback
                toastError((err && err.serverMessage) || 'Nie udało się zapisać reakcji');
            })
            .then(() => {
                inFlight.delete(key);
                refreshStrips();
            });
    }

    // ---- Bottom-sheet / popover picker ----

    function sheetEls() {
        return {
            overlay: document.getElementById('reactionSheetOverlay'),
            sheet: document.getElementById('reactionSheet'),
            grid: document.getElementById('reactionSheetGrid')
        };
    }

    // The picker shows a fixed set of buttons, so they are built once and
    // afterwards only their aria-pressed state is updated. A poll-driven
    // repaint while the sheet is open therefore cannot steal focus from
    // the button the user is sitting on.
    function paintSheet() {
        const grid = sheetEls().grid;
        if (!grid || sheetMessageId === null) return;
        const list = state.get(sheetMessageId) || [];
        if (grid.childElementCount !== CHAT_REACTIONS.length) {
            grid.innerHTML = CHAT_REACTIONS.map(r =>
                '<button type="button" class="reaction-sheet-btn"'
                + ' data-emoji="' + esc(r.emoji) + '"'
                + ' aria-pressed="false"'
                + ' aria-label="' + esc('Reakcja ' + r.name) + '">'
                + '<span aria-hidden="true">' + esc(r.emoji) + '</span>'
                + '</button>'
            ).join('');
        }
        grid.querySelectorAll('.reaction-sheet-btn').forEach(button => {
            const item = list.find(x => x.emoji === button.getAttribute('data-emoji'));
            button.setAttribute('aria-pressed', item && item.mine ? 'true' : 'false');
        });
    }

    function focusables() {
        const sheet = sheetEls().sheet;
        if (!sheet) return [];
        return Array.prototype.slice.call(
            sheet.querySelectorAll('button:not([disabled])')
        );
    }

    function openSheet(messageId) {
        const id = parseMessageId(messageId);
        const els = sheetEls();
        if (id === null || !els.sheet || !els.overlay) return;
        sheetMessageId = id;
        focusBeforeSheet = document.activeElement;
        paintSheet();
        els.sheet.removeAttribute('aria-hidden');
        els.sheet.removeAttribute('inert');
        els.overlay.classList.add('is-open');
        els.sheet.classList.add('is-open');
        // Land on the first emoji, not on "Zamknij", so a keyboard or
        // switch user starts on the thing they came here to pick
        const first = els.sheet.querySelector('.reaction-sheet-btn') || focusables()[0];
        if (first) first.focus();
    }

    function closeSheet() {
        const els = sheetEls();
        const previousId = sheetMessageId;
        sheetMessageId = null;
        if (els.overlay) els.overlay.classList.remove('is-open');
        if (els.sheet) {
            els.sheet.classList.remove('is-open');
            els.sheet.setAttribute('aria-hidden', 'true');
            els.sheet.setAttribute('inert', '');
        }
        // The add button may have been re-rendered while the sheet was
        // open, so fall back to looking it up by message id.
        let target = focusBeforeSheet;
        if (!target || !document.contains(target)) {
            target = previousId === null ? null : document.querySelector(
                '[data-reactions-for="' + previousId + '"] .chat-reaction-add'
            );
        }
        focusBeforeSheet = null;
        if (target && typeof target.focus === 'function') target.focus();
    }

    function reset() {
        state.clear();
        inFlight.clear();
        if (sheetMessageId !== null) closeSheet();
    }

    function bindMessagesBox() {
        if (boxBound) return;
        const box = document.getElementById('chatMessages');
        if (!box) return;
        box.addEventListener('click', (e) => {
            if (!(e.target instanceof Element)) return;
            const chip = e.target.closest('.chat-reaction-chip');
            if (chip) {
                toggle(chip.getAttribute('data-message-id'), chip.getAttribute('data-emoji'));
                return;
            }
            const add = e.target.closest('.chat-reaction-add');
            if (add) openSheet(add.getAttribute('data-message-id'));
        });
        boxBound = true;
    }

    function bindSheet() {
        if (sheetBound) return;
        const els = sheetEls();
        if (!els.sheet || !els.overlay || !els.grid) return;

        els.overlay.addEventListener('click', () => closeSheet());

        els.grid.addEventListener('click', (e) => {
            if (!(e.target instanceof Element)) return;
            const btn = e.target.closest('.reaction-sheet-btn');
            if (!btn || sheetMessageId === null) return;
            toggle(sheetMessageId, btn.getAttribute('data-emoji'));
            closeSheet();
        });

        const closeBtn = document.getElementById('reactionSheetClose');
        if (closeBtn) closeBtn.addEventListener('click', () => closeSheet());

        // Escape closes; Tab is trapped inside the sheet while it is open.
        els.sheet.addEventListener('keydown', (e) => {
            if (sheetMessageId === null) return;
            if (e.key === 'Escape') { e.preventDefault(); closeSheet(); return; }
            if (e.key !== 'Tab') return;
            const items = focusables();
            if (items.length === 0) return;
            const first = items[0];
            const last = items[items.length - 1];
            if (e.shiftKey && document.activeElement === first) {
                e.preventDefault();
                last.focus();
            } else if (!e.shiftKey && document.activeElement === last) {
                e.preventDefault();
                first.focus();
            }
        });

        document.addEventListener('keydown', (e) => {
            if (sheetMessageId !== null && e.key === 'Escape') closeSheet();
        });

        sheetBound = true;
    }

    function init() {
        bindMessagesBox();
        bindSheet();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

    root.ChatReactions = {
        EMOJI: CHAT_REACTIONS,
        CHAT_REACTIONS: CHAT_REACTIONS,
        CHAT_REACTION_EMOJI: CHAT_REACTION_EMOJI,
        isAllowedReactionEmoji: isAllowedReactionEmoji,
        parseMessageId: parseMessageId,
        buildReactionList: buildReactionList,
        groupReactionsByMessage: groupReactionsByMessage,
        toggleAction: toggleAction,
        reactionThrottleStep: reactionThrottleStep,
        reactionExcerpt: reactionExcerpt,
        buildLastReaction: buildLastReaction,
        ingest: ingest,
        strip: strip,
        refreshStrips: refreshStrips,
        toggle: toggle,
        openSheet: openSheet,
        closeSheet: closeSheet,
        reset: reset,
        init: init
    };
})(typeof window !== 'undefined' ? window : globalThis);
