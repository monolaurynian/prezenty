'use strict';
/**
 * "Any emoji" reactions in the anonymous chat - data and validation layer.
 *
 * The server accepts exactly the bundled dataset (public/emoji-data.js, Emoji
 * 15.0 without skin tones) plus the legacy six, by EXACT MEMBERSHIP rather than
 * a regex. These tests lock in both directions:
 *  - everything the picker can send (ZWJ, flag, keycap, tag sequences) is
 *    accepted, toggles on and off, and the response stays aggregate-only;
 *  - HTML, control characters, multi-emoji, empty, oversized and non-string
 *    input is rejected with 400 before it can reach the database;
 *  - the shared logic orders non-legacy chips deterministically (no NaN sort).
 * The picker UI itself (the "+" tile, full mode, keyboard, geometry, escaping)
 * is covered by the 'full emoji picker' tests at the end of this file.
 */
const { test, expect } = require('../fixtures');
const { openPage, setViewport } = require('../helpers/pages');
const { activeDescription, describeFocus } = require('../helpers/focus');
const { measureContrast, measureBorderContrast, requiredRatio } = require('../helpers/contrast');
const { collectOverflow } = require('../helpers/overflow');
const { reactionPreview } = require('../../public/notification-text');
const chatReactions = require('../../public/chat-reactions');
const EmojiData = require('../../public/emoji-data');

const THREAD = { path: '/wiadomosci?rozmowa=1', name: 'chat thread', ready: '.chat-bubble' };
const BARE_MESSAGE = 4; // seeded with no reactions (see chat-reactions.spec.js)

// Written as escapes so the file survives any editor / encoding round trip.
const PARTY = '\u{1F389}';
const PRAY = '\u{1F64F}';
const HEART = '\u2764\uFE0F';
const ZWJ_KISS = '\u{1F469}\u200D\u2764\uFE0F\u200D\u{1F48B}\u200D\u{1F468}';
const FLAG_PL = '\u{1F1F5}\u{1F1F1}';
const FLAG_ENGLAND = '\u{1F3F4}\u{E0067}\u{E0062}\u{E0065}\u{E006E}\u{E0067}\u{E007F}';
const KEYCAP_HASH = '#\uFE0F\u20E3';
const THUMBS_SKIN_TONE = '\u{1F44D}\u{1F3FD}';

/** POST a reaction from inside the page (same session cookie as the app). */
async function postReaction(page, messageId, body) {
    return page.evaluate(async ([id, payload]) => {
        const options = { method: 'POST' };
        if (payload !== undefined) {
            options.headers = { 'Content-Type': 'application/json' };
            options.body = JSON.stringify(payload);
        }
        const response = await fetch(`/api/wiadomosci/messages/${id}/reactions`, options);
        let json = null;
        try { json = await response.json(); } catch (error) { json = null; }
        return { status: response.status, json };
    }, [messageId, body]);
}

test.describe('any-emoji reactions: API', () => {
    const ACCEPTED = [
        ['party popper', PARTY],
        ['folded hands (no longer a quick tile)', PRAY],
        ['ZWJ sequence', ZWJ_KISS],
        ['flag', FLAG_PL],
        ['England flag tag sequence', FLAG_ENGLAND],
        ['keycap', KEYCAP_HASH]
    ];

    test('every picker emoji shape is accepted and toggles on, then off', async ({ page }) => {
        await openPage(page, THREAD);
        for (const [label, emoji] of ACCEPTED) {
            const added = await postReaction(page, BARE_MESSAGE, { emoji });
            expect(added.status, `${label}: add`).toBe(200);
            expect(added.json.action, `${label}: add action`).toBe('added');
            expect(added.json.reactions.map(r => r.emoji), `${label}: listed`).toContain(emoji);
            added.json.reactions.forEach(r => {
                expect(Object.keys(r).sort()).toEqual(['count', 'emoji', 'mine']);
            });
            const removed = await postReaction(page, BARE_MESSAGE, { emoji });
            expect(removed.status, `${label}: remove`).toBe(200);
            expect(removed.json.action, `${label}: remove action`).toBe('removed');
            expect(removed.json.reactions.map(r => r.emoji), `${label}: gone`).not.toContain(emoji);
            removed.json.reactions.forEach(r => {
                expect(Object.keys(r).sort()).toEqual(['count', 'emoji', 'mine']);
            });
        }
    });

    const REJECTED = [
        ['empty string', ''],
        ['plain letter', 'a'],
        ['HTML', '<img src=x onerror=alert(1)>'],
        ['double quote', '"'],
        ['two emoji', PARTY + PARTY],
        ['emoji plus newline', PARTY + '\n'],
        ['NUL character', '\u0000'],
        ['5000 characters', 'x'.repeat(5000)],
        ['skin-tone variant (outside the dataset)', THUMBS_SKIN_TONE],
        ['number', 5],
        ['array', [PARTY]],
        ['object', { a: PARTY }]
    ];

    test('junk is rejected with 400 and never stored', async ({ page }) => {
        await openPage(page, THREAD);
        for (const [label, emoji] of REJECTED) {
            const result = await postReaction(page, BARE_MESSAGE, { emoji });
            expect(result.status, label).toBe(400);
            expect(result.json.error, label).toBe('Nieprawidłowa reakcja');
        }
        const noBody = await postReaction(page, BARE_MESSAGE, undefined);
        expect(noBody.status, 'missing body').toBe(400);
        expect(noBody.json.error, 'missing body').toBe('Nieprawidłowa reakcja');
        const noEmoji = await postReaction(page, BARE_MESSAGE, {});
        expect(noEmoji.status, 'missing emoji').toBe(400);

        // Nothing leaked into the shared demo state
        const probe = await postReaction(page, BARE_MESSAGE, { emoji: PARTY });
        expect(probe.json.reactions.map(r => r.emoji)).toEqual([PARTY]);
        const restore = await postReaction(page, BARE_MESSAGE, { emoji: PARTY });
        expect(restore.json.reactions).toEqual([]);
    });
});

test.describe('any-emoji reactions: chip markup', () => {
    test('an unnamed emoji gets a readable label and every attribute is quote-safe', async ({ page }) => {
        await openPage(page, THREAD);
        const html = await page.evaluate(([party, junk]) => {
            window.ChatReactions.ingest([{ id: 99, reactions: [{ emoji: party, count: 2, mine: false }] }]);
            const chips = window.ChatReactions.strip({ id: 99 });
            // Junk never reaches state, so no chip (and no attribute) is built for it
            window.ChatReactions.ingest([{ id: 98, reactions: [{ emoji: junk, count: 1, mine: false }] }]);
            return { chips, junkChips: window.ChatReactions.strip({ id: 98 }) };
        }, [PARTY, '"><img src=x onerror=alert(1)>']);
        expect(html.chips).toContain(`data-emoji="${PARTY}"`);
        expect(html.chips).toContain(`aria-label="Reakcja ${PARTY}: 2`);
        expect(html.chips).not.toMatch(/Reakcja reakcja/i);
        expect(html.junkChips).not.toContain('<img');
        expect(html.junkChips).not.toContain('data-emoji');
    });
});

test.describe('any-emoji reactions: shared logic', () => {
    test('buildReactionList orders legacy first, then dataset order, and drops junk', () => {
        const rows = [
            { emoji: PARTY, cnt: 1, mine: 0 },
            { emoji: '<b>x</b>', cnt: 4, mine: 1 },
            { emoji: PRAY, cnt: 2, mine: 1 },
            { emoji: HEART, cnt: 3, mine: 0 },
            { emoji: THUMBS_SKIN_TONE, cnt: 1, mine: 0 }
        ];
        const expected = [HEART, PRAY, PARTY];
        expect(chatReactions.buildReactionList(rows).map(r => r.emoji)).toEqual(expected);
        // Deterministic regardless of the input order
        expect(chatReactions.buildReactionList(rows.slice().reverse()).map(r => r.emoji)).toEqual(expected);
        chatReactions.buildReactionList(rows).forEach(r => {
            expect(Object.keys(r).sort()).toEqual(['count', 'emoji', 'mine']);
        });
    });

    test('orderOf is a total order: legacy six keep 0-5, dataset emoji come after', () => {
        const legacy = chatReactions.CHAT_REACTION_EMOJI.map(chatReactions.orderOf);
        expect(legacy).toEqual([0, 1, 2, 3, 4, 5]);
        const sample = EmojiData.categories.flatMap(c => c.emoji.split(' ')).filter(e =>
            !chatReactions.CHAT_REACTION_EMOJI.includes(e));
        const orders = sample.map(chatReactions.orderOf);
        orders.forEach(order => expect(Number.isFinite(order) && order >= 100).toBe(true));
        expect(new Set(orders).size).toBe(orders.length);
    });

    test('quick reactions stay a prefix of the legacy set', () => {
        expect(chatReactions.CHAT_REACTIONS).toHaveLength(6);
        expect(chatReactions.CHAT_QUICK_REACTIONS).toEqual(chatReactions.CHAT_REACTIONS.slice(0, 5));
        expect(chatReactions.CHAT_QUICK_REACTIONS.map(r => r.emoji)).not.toContain(PRAY);
    });

    test('isAllowedReactionEmoji accepts the dataset and refuses everything else', () => {
        const allowed = chatReactions.isAllowedReactionEmoji;
        [PARTY, PRAY, HEART, ZWJ_KISS, FLAG_PL, FLAG_ENGLAND, KEYCAP_HASH].forEach(e =>
            expect(allowed(e), e).toBe(true));
        ['', 'a', '<img src=x>', '"', PARTY + PARTY, PARTY + '\n', '\u0000', 'x'.repeat(5000),
            THUMBS_SKIN_TONE, 5, null, undefined, [PARTY], { a: PARTY }].forEach(value =>
            expect(allowed(value), JSON.stringify(value)).toBe(false));
    });

    test('buildLastReaction accepts a dataset emoji and rejects junk', () => {
        const row = (emoji) => ({
            emoji, reacted_at: '2030-01-01T10:00:00Z', message_id: 7, body: 'hej'
        });
        const last = { id: 7, at: '2030-01-01T09:00:00Z' };
        const ok = chatReactions.buildLastReaction(row(PARTY), last);
        expect(ok).not.toBeNull();
        expect(ok.emoji).toBe(PARTY);
        expect(Object.keys(ok).sort()).toEqual(['at', 'emoji', 'excerpt', 'messageId']);
        expect(chatReactions.buildLastReaction(row('<b>'), last)).toBeNull();
        expect(chatReactions.buildLastReaction(row(THUMBS_SKIN_TONE), last)).toBeNull();
    });

    test('EmojiData: 9 categories, unique emoji, none with skin tones, each <= 16 code points', () => {
        expect(EmojiData.version).toBe('15.0');
        expect(EmojiData.categories.map(c => c.id)).toEqual([
            'smileys', 'people', 'animals', 'food', 'travel', 'activities', 'objects', 'symbols', 'flags'
        ]);
        const all = [];
        EmojiData.categories.forEach(category => {
            expect(category.label, category.id).toBeTruthy();
            expect(category.icon, category.id).toBeTruthy();
            const list = category.emoji.split(' ');
            expect(list.length, category.id).toBeGreaterThan(0);
            all.push(...list);
        });
        expect(new Set(all).size).toBe(all.length);
        all.forEach(emoji => {
            expect(Array.from(emoji).length, emoji).toBeLessThanOrEqual(16);
            expect(/[\u{1F3FB}-\u{1F3FF}]/u.test(emoji), emoji).toBe(false);
        });
        // Legacy six must all be reachable from the dataset too
        chatReactions.CHAT_REACTION_EMOJI.forEach(emoji => expect(all).toContain(emoji));
    });
});

// ===========================================================================
// Full emoji picker (UI)
// ===========================================================================

const SHEET = '#reactionSheet';
const QUICK_EMOJI = chatReactions.CHAT_QUICK_REACTIONS.map(r => r.emoji);
const strip = (page, id) => page.locator(`.chat-reactions[data-reactions-for="${id}"]`);
const chip = (page, id, emoji) => strip(page, id).locator(`.chat-reaction-chip[data-emoji="${emoji}"]`);
const addButton = (page, id) => strip(page, id).locator('.chat-reaction-add');
const tab = (page, categoryId) => page.locator(`#emojiPickerTab-${categoryId}`);
const emojiButton = (page, emoji) => page.locator(`#emojiPickerRoot .emoji-picker-btn[data-emoji="${emoji}"]`);

/** Opens the sheet from the message's add button (keyboard, so focus is remembered). */
async function openSheet(page, id) {
    await addButton(page, id).focus();
    await page.keyboard.press('Enter');
    await expect(page.locator(SHEET)).toHaveClass(/is-open/);
}

/** Opens the sheet and switches it to the full picker. */
async function openFull(page, id) {
    await openSheet(page, id);
    await page.locator(`${SHEET} .reaction-sheet-more`).click();
    await expect(page.locator(SHEET)).toHaveClass(/is-all/);
}

const reactionResponse = (page, id) => page.waitForResponse(r =>
    r.url().includes(`/api/wiadomosci/messages/${id}/reactions`) && r.request().method() === 'POST');

/** Index of the focused emoji button, -1 when focus is elsewhere. */
const focusedEmojiIndex = (page) => page.evaluate(() => {
    const buttons = Array.prototype.slice.call(document.querySelectorAll('#emojiPickerRoot .emoji-picker-btn'));
    return buttons.indexOf(document.activeElement);
});

test.describe('full emoji picker', () => {
    // The demo state is shared between tests: take back anything a test left
    // on the bare message (only reactions that are mine can be toggled off).
    test.afterEach(async ({ page }) => {
        if (!/^https?:/.test(page.url())) return;
        await page.unrouteAll({ behavior: 'ignoreErrors' });
        await page.evaluate(async (id) => {
            const thread = await fetch('/api/wiadomosci/threads/1').then(r => r.json());
            const message = thread.messages.find(m => m.id === id);
            const mine = message ? message.reactions.filter(r => r.mine) : [];
            for (const reaction of mine) {
                await fetch(`/api/wiadomosci/messages/${id}/reactions`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ emoji: reaction.emoji })
                });
            }
        }, BARE_MESSAGE);
    });

    test('quick view: five emoji and a "+" tile, no folded hands', async ({ page }) => {
        await openPage(page, THREAD);
        await setViewport(page, 375);
        await openSheet(page, BARE_MESSAGE);

        const tiles = page.locator('#reactionSheetGrid .reaction-sheet-btn');
        await expect(tiles).toHaveCount(6);
        const emoji = await tiles.evaluateAll(list => list.map(el => el.getAttribute('data-emoji')));
        expect(emoji.filter(Boolean)).toEqual(QUICK_EMOJI);
        const more = page.locator('#reactionSheetGrid .reaction-sheet-more');
        await expect(more).toHaveCount(1);
        await expect(more).toHaveAttribute('aria-label', 'Więcej emoji');
        await expect(page.locator(`#reactionSheetGrid [data-emoji="${PRAY}"]`)).toHaveCount(0);
        // Quick mode: no back button, no picker
        await expect(page.locator('#reactionSheetBack')).toBeHidden();
        await expect(page.locator('#emojiPickerRoot')).toBeHidden();
        await expect(page.locator('#reactionSheetTitle')).toHaveText('Wybierz reakcję');
    });

    test('last two quick slots rotate to the most recent picks; first three stay fixed', async ({ page }) => {
        await openPage(page, THREAD);
        await setViewport(page, 375);
        await page.evaluate(() => localStorage.removeItem('prezenty-recent-reactions'));
        await page.evaluate(() => localStorage.setItem('prezenty-recent-reactions', JSON.stringify(['🎉', '🔥'])));
        await openSheet(page, BARE_MESSAGE);

        const tiles = page.locator('#reactionSheetGrid .reaction-sheet-btn[data-emoji]');
        const emoji = await tiles.evaluateAll(list => list.map(el => el.getAttribute('data-emoji')));
        expect(emoji.slice(0, 3)).toEqual(QUICK_EMOJI.slice(0, 3));
        expect(emoji.slice(3)).toEqual(['🎉', '🔥']);
        await page.evaluate(() => localStorage.removeItem('prezenty-recent-reactions'));
    });

    test('"+" opens full mode with 9 tabs and focus inside the grid', async ({ page }) => {
        await openPage(page, THREAD);
        await setViewport(page, 375);
        await openFull(page, BARE_MESSAGE);

        await expect(page.locator('#reactionSheetBack')).toBeVisible();
        await expect(page.locator('#reactionSheetGrid')).toBeHidden();
        await expect(page.locator('#emojiPickerRoot')).toBeVisible();
        await expect(page.locator('#reactionSheetTitle')).toHaveText('Wszystkie emoji');
        await expect(page.locator('#emojiPickerRoot [role="tablist"]')).toHaveAttribute('aria-label', 'Kategorie emoji');

        const tabs = page.locator('#emojiPickerRoot [role="tab"]');
        await expect(tabs).toHaveCount(9);
        const labels = await tabs.evaluateAll(list => list.map(el => el.getAttribute('aria-label')));
        expect(labels).toEqual(EmojiData.categories.map(c => c.label));
        await expect(tabs.first()).toHaveAttribute('aria-selected', 'true');

        const panel = page.locator('#emojiPickerRoot [role="tabpanel"]');
        await expect(panel).toHaveAttribute('aria-labelledby', 'emojiPickerTab-smileys');
        expect(await focusedEmojiIndex(page), 'focus should be on the first emoji').toBe(0);
        // Only the active category is in the DOM
        await expect(page.locator('#emojiPickerRoot .emoji-picker-btn'))
            .toHaveCount(EmojiData.categories[0].emoji.split(' ').length);
        // No icon font anywhere in the picker or its back button
        await expect(page.locator('#emojiPickerRoot i, #reactionSheetBack i')).toHaveCount(0);
    });

    test('picking an emoji reacts, closes the sheet, returns focus and toggles off on a repeat', async ({ page }) => {
        await openPage(page, THREAD);
        await setViewport(page, 375);
        await openFull(page, BARE_MESSAGE);

        await tab(page, 'activities').click();
        await expect(tab(page, 'activities')).toHaveAttribute('aria-selected', 'true');
        const added = reactionResponse(page, BARE_MESSAGE);
        await emojiButton(page, PARTY).click();
        expect((await (await added).json()).action).toBe('added');

        const reaction = chip(page, BARE_MESSAGE, PARTY);
        await expect(reaction).toHaveAttribute('aria-pressed', 'true');
        await expect(reaction.locator('.chat-reaction-count')).toHaveText('1');
        // A real-DOM check of the unnamed-emoji label (never "Reakcja reakcja")
        await expect(reaction).toHaveAttribute('aria-label', new RegExp(`^Reakcja ${PARTY}: 1 osoba`));
        await expect(page.locator(SHEET)).toHaveAttribute('aria-hidden', 'true');
        const returned = await activeDescription(page);
        expect(returned.cls, describeFocus('focus after picking', returned)).toContain('chat-reaction-add');
        expect(returned.messageId).toBe(String(BARE_MESSAGE));

        // Reopening starts quick; the picked emoji is marked as pressed
        await openSheet(page, BARE_MESSAGE);
        await expect(page.locator(SHEET)).not.toHaveClass(/is-all/);
        await page.locator(`${SHEET} .reaction-sheet-more`).click();
        await tab(page, 'activities').click();
        await expect(emojiButton(page, PARTY)).toHaveAttribute('aria-pressed', 'true');
        const removed = reactionResponse(page, BARE_MESSAGE);
        await emojiButton(page, PARTY).click();
        expect((await (await removed).json()).action).toBe('removed');
        await expect(reaction).toHaveCount(0);
        await expect(page.locator(SHEET)).toHaveAttribute('aria-hidden', 'true');
    });

    test('folded hands are still reachable through the People tab', async ({ page }) => {
        await openPage(page, THREAD);
        await setViewport(page, 375);
        await openFull(page, BARE_MESSAGE);

        await tab(page, 'people').click();
        const added = reactionResponse(page, BARE_MESSAGE);
        await emojiButton(page, PRAY).click();
        expect((await (await added).json()).action).toBe('added');
        const reaction = chip(page, BARE_MESSAGE, PRAY);
        await expect(reaction).toHaveAttribute('aria-label', /^Reakcja podziękowanie: 1 osoba/);

        const removed = reactionResponse(page, BARE_MESSAGE);
        await reaction.click();
        expect((await (await removed).json()).action).toBe('removed');
        await expect(reaction).toHaveCount(0);
    });

    test('Escape, outside tap and the back button behave in both modes', async ({ page }) => {
        await openPage(page, THREAD);
        await setViewport(page, 375);
        const sheet = page.locator(SHEET);

        // Escape in quick mode
        await openSheet(page, BARE_MESSAGE);
        await page.keyboard.press('Escape');
        await expect(sheet).toHaveAttribute('aria-hidden', 'true');

        // Escape in full mode closes the WHOLE sheet and returns focus
        await openFull(page, BARE_MESSAGE);
        await page.keyboard.press('Escape');
        await expect(sheet).toHaveAttribute('aria-hidden', 'true');
        await expect(sheet).not.toHaveClass(/is-all/);
        const returned = await activeDescription(page);
        expect(returned.cls, describeFocus('focus after Escape', returned)).toContain('chat-reaction-add');
        expect(returned.messageId).toBe(String(BARE_MESSAGE));

        // Outside tap in full mode
        await openFull(page, BARE_MESSAGE);
        await page.locator('#reactionSheetOverlay').click({ position: { x: 5, y: 5 } });
        await expect(sheet).toHaveAttribute('aria-hidden', 'true');

        // Back button: quick mode again, focus on "+"
        await openFull(page, BARE_MESSAGE);
        await page.locator('#reactionSheetBack').click();
        await expect(sheet).toHaveClass(/is-open/);
        await expect(sheet).not.toHaveClass(/is-all/);
        await expect(page.locator('#reactionSheetGrid')).toBeVisible();
        await expect(page.locator('#emojiPickerRoot')).toBeHidden();
        await expect(page.locator('#reactionSheetBack')).toBeHidden();
        await expect(page.locator('#reactionSheetTitle')).toHaveText('Wybierz reakcję');
        const focused = await activeDescription(page);
        expect(focused.cls, describeFocus('focus after back', focused)).toContain('reaction-sheet-more');
        await page.keyboard.press('Escape');
        await expect(sheet).toHaveAttribute('aria-hidden', 'true');
    });

    test('keyboard: arrows move inside the grid, one tab stop, Tab never leaves the dialog', async ({ page }) => {
        await openPage(page, THREAD);
        await setViewport(page, 375);
        await openFull(page, BARE_MESSAGE);

        const total = EmojiData.categories[0].emoji.split(' ').length;
        const columns = await page.evaluate(() => {
            const buttons = document.querySelectorAll('#emojiPickerRoot .emoji-picker-btn');
            let count = 0;
            while (count < buttons.length && buttons[count].offsetTop === buttons[0].offsetTop) count++;
            return count;
        });
        expect(columns).toBeGreaterThan(1);

        // Exactly one grid button is a tab stop
        const stops = () => page.locator('#emojiPickerRoot .emoji-picker-btn:not([tabindex="-1"])').count();
        expect(await stops()).toBe(1);

        expect(await focusedEmojiIndex(page)).toBe(0);
        await page.keyboard.press('ArrowRight');
        expect(await focusedEmojiIndex(page)).toBe(1);
        await page.keyboard.press('ArrowLeft');
        expect(await focusedEmojiIndex(page)).toBe(0);
        await page.keyboard.press('ArrowDown');
        expect(await focusedEmojiIndex(page)).toBe(columns);
        await page.keyboard.press('ArrowUp');
        expect(await focusedEmojiIndex(page)).toBe(0);
        await page.keyboard.press('End');
        expect(await focusedEmojiIndex(page)).toBe(total - 1);
        await page.keyboard.press('Home');
        expect(await focusedEmojiIndex(page)).toBe(0);
        await page.keyboard.press('ArrowRight');
        expect(await stops(), 'roving tabindex must keep a single stop').toBe(1);
        await expect(page.locator('#emojiPickerRoot .emoji-picker-btn').nth(1)).toHaveAttribute('tabindex', '0');

        // Tab cycles within the dialog (back, close, selected tab, grid)
        for (let i = 0; i < 12; i++) {
            await page.keyboard.press('Tab');
            const inside = await page.evaluate(() =>
                document.getElementById('reactionSheet').contains(document.activeElement));
            expect(inside, `Tab #${i + 1} escaped the dialog`).toBe(true);
        }
        for (let i = 0; i < 4; i++) {
            await page.keyboard.press('Shift+Tab');
            const inside = await page.evaluate(() =>
                document.getElementById('reactionSheet').contains(document.activeElement));
            expect(inside, `Shift+Tab #${i + 1} escaped the dialog`).toBe(true);
        }

        // Left/Right/Home/End on the tabs switch category
        await tab(page, 'smileys').focus();
        await page.keyboard.press('ArrowRight');
        await expect(tab(page, 'people')).toHaveAttribute('aria-selected', 'true');
        await expect(tab(page, 'people')).toBeFocused();
        await page.keyboard.press('ArrowLeft');
        await expect(tab(page, 'smileys')).toHaveAttribute('aria-selected', 'true');
        await page.keyboard.press('End');
        await expect(tab(page, 'flags')).toHaveAttribute('aria-selected', 'true');
        await expect(page.locator('#emojiPickerRoot [role="tabpanel"]'))
            .toHaveAttribute('aria-labelledby', 'emojiPickerTab-flags');
        await page.keyboard.press('Home');
        await expect(tab(page, 'smileys')).toHaveAttribute('aria-selected', 'true');
        // Exactly one tab is a tab stop
        await expect(page.locator('#emojiPickerRoot [role="tab"]:not([tabindex="-1"])')).toHaveCount(1);
        await page.keyboard.press('Escape');
    });

    test('touch targets are at least 44x44 at 375px', async ({ page }) => {
        await openPage(page, THREAD);
        await setViewport(page, 375);
        await openFull(page, BARE_MESSAGE);

        const sizes = await page.evaluate(() => {
            const pick = (selector) => Array.prototype.slice.call(document.querySelectorAll(selector)).map(el => {
                const rect = el.getBoundingClientRect();
                return { what: selector + ' ' + (el.getAttribute('data-emoji') || el.getAttribute('aria-label') || ''),
                    width: rect.width, height: rect.height };
            });
            return [].concat(
                pick('#emojiPickerRoot .emoji-picker-tab'),
                pick('#emojiPickerRoot .emoji-picker-btn'),
                pick('#reactionSheetBack'),
                pick('#reactionSheetClose')
            );
        });
        expect(sizes.length).toBeGreaterThan(9 + EmojiData.categories[0].emoji.split(' ').length);
        const small = sizes.filter(s => s.width < 43.99 || s.height < 43.99);
        expect(small, 'targets under 44x44: ' + JSON.stringify(small.slice(0, 5))).toEqual([]);
    });

    for (const width of [320, 375, 768, 1024]) {
        test(`the open picker fits the ${width}px viewport with no horizontal overflow`, async ({ page }) => {
            await openPage(page, THREAD);
            await setViewport(page, width);
            await openFull(page, BARE_MESSAGE);
            await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));

            const rect = await page.locator(SHEET).evaluate(el => {
                const r = el.getBoundingClientRect();
                return { left: r.left, top: r.top, right: r.right, bottom: r.bottom,
                    width: window.innerWidth, height: window.innerHeight };
            });
            expect(rect.left, JSON.stringify(rect)).toBeGreaterThanOrEqual(-0.5);
            expect(rect.top, JSON.stringify(rect)).toBeGreaterThanOrEqual(-0.5);
            expect(rect.right, JSON.stringify(rect)).toBeLessThanOrEqual(rect.width + 0.5);
            expect(rect.bottom, JSON.stringify(rect)).toBeLessThanOrEqual(rect.height + 0.5);

            const report = await collectOverflow(page);
            expect(report.rootScroll.delta, JSON.stringify(report.rootScroll)).toBeLessThanOrEqual(0.5);
            expect(report.offenders, JSON.stringify(report.offenders)).toEqual([]);
            // The category tab row is the ONE intentional horizontal scroller
            const strays = report.scrollers.filter(s => !s.path.includes('emoji-picker-tabs'));
            expect(strays, JSON.stringify(strays)).toEqual([]);
        });
    }

    test('prefers-reduced-motion removes the transitions in full mode', async ({ page }) => {
        await page.emulateMedia({ reducedMotion: 'reduce' });
        await openPage(page, THREAD);
        await setViewport(page, 375);
        await openFull(page, BARE_MESSAGE);

        const durations = await page.evaluate(() => ({
            sheet: getComputedStyle(document.getElementById('reactionSheet')).transitionDuration,
            overlay: getComputedStyle(document.getElementById('reactionSheetOverlay')).transitionDuration,
            tab: getComputedStyle(document.querySelector('.emoji-picker-tab')).transitionDuration,
            button: getComputedStyle(document.querySelector('.emoji-picker-btn')).transitionDuration
        }));
        expect(durations).toEqual({ sheet: '0s', overlay: '0s', tab: '0s', button: '0s' });
    });

    test('title, pressed emoji and back arrow clear the contrast floors', async ({ page }) => {
        await openPage(page, THREAD);
        await setViewport(page, 375);
        // Make 🎉 "mine" through the API, then let the page ingest it
        await page.evaluate(async ([id, emoji]) => {
            await fetch(`/api/wiadomosci/messages/${id}/reactions`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ emoji })
            });
            await window.loadThreadMessages();
        }, [BARE_MESSAGE, PARTY]);
        await expect(chip(page, BARE_MESSAGE, PARTY)).toHaveAttribute('aria-pressed', 'true');
        await openFull(page, BARE_MESSAGE);
        await tab(page, 'activities').click();

        const title = await measureContrast(page.locator('#reactionSheetTitle'));
        expect(title.ratio, `title ${title.color} on ${title.background} = ${title.ratio}:1`)
            .toBeGreaterThanOrEqual(requiredRatio(title));
        const back = await measureContrast(page.locator('#reactionSheetBack'));
        expect(back.ratio, `back ${back.color} on ${back.background} = ${back.ratio}:1`)
            .toBeGreaterThanOrEqual(requiredRatio(back));
        const pressed = emojiButton(page, PARTY);
        await expect(pressed).toHaveAttribute('aria-pressed', 'true');
        const border = await measureBorderContrast(pressed);
        expect(border.ratio, `pressed border ${border.borderColor} on ${border.surface} = ${border.ratio}:1`)
            .toBeGreaterThanOrEqual(3);
    });

    test('hostile emoji strings in a server payload render nothing and run nothing', async ({ page }) => {
        const hostile = [
            '"><img src=x onerror="window.__xss=1">',
            "x' onmouseover='window.__xss=1",
            '<script>window.__xss=1</script>'
        ];
        await page.route(/\/api\/wiadomosci\/threads\/1(\?.*)?$/, async (route) => {
            const response = await route.fetch();
            const json = await response.json();
            const message = json.messages.find(m => m.id === BARE_MESSAGE);
            message.reactions = hostile.map(emoji => ({ emoji, count: 1, mine: false }))
                .concat([{ emoji: PARTY, count: 1, mine: false }]);
            await route.fulfill({ response, json });
        });
        await openPage(page, THREAD);
        await setViewport(page, 375);

        const chips = strip(page, BARE_MESSAGE).locator('.chat-reaction-chip');
        await expect(chips).toHaveCount(1);
        await expect(chips.first()).toHaveAttribute('data-emoji', PARTY);
        await expect(chips.first()).toHaveAttribute('aria-label', new RegExp(PARTY));
        expect(await strip(page, BARE_MESSAGE).locator('img, script').count()).toBe(0);
        // Give a poll / handler a moment to run anything that was smuggled in
        await page.evaluate(() => window.loadThreadMessages());
        await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
        expect(await page.evaluate(() => window.__xss)).toBeUndefined();
    });

    test('the page knows the dataset: preview text, last-reaction shape and allowlist', async ({ page }) => {
        expect(reactionPreview(PARTY, 'hej')).toContain(PARTY);
        const shaped = chatReactions.buildLastReaction(
            { emoji: PARTY, reacted_at: '2030-01-01T10:00:00Z', message_id: 7, body: 'hej' },
            { id: 7, at: '2030-01-01T09:00:00Z' });
        expect(shaped && shaped.emoji).toBe(PARTY);

        await openPage(page, THREAD);
        const inPage = await page.evaluate(([party, junk]) => ({
            party: window.ChatReactions.isAllowedReactionEmoji(party),
            junk: window.ChatReactions.isAllowedReactionEmoji(junk),
            picker: typeof window.EmojiPicker.create
        }), [PARTY, '<b>']);
        expect(inPage).toEqual({ party: true, junk: false, picker: 'function' });
    });

    test('sw.js and wiadomosci.html agree on the versioned URLs and cache name', async ({ request }) => {
        const sw = await (await request.get('/sw.js')).text();
        const html = await (await request.get('/wiadomosci.html')).text();
        expect(sw).toContain("'prezenty-v134'");
        ['/chat-reactions.css?v=4', '/chat-reactions.js?v=5', '/emoji-data.js?v=1', '/emoji-picker.js?v=1']
            .forEach(url => {
                expect(sw, `sw.js precache entry ${url}`).toContain(`'${url}'`);
                expect(html, `wiadomosci.html reference ${url}`).toContain(url.slice(1));
            });
        // The dataset must load before chat-reactions.js, the picker after it
        const order = ['emoji-data.js?v=1', 'chat-reactions.js?v=5', 'emoji-picker.js?v=1']
            .map(name => html.indexOf(`src="${name}"`));
        expect(order.every(i => i > -1), JSON.stringify(order)).toBe(true);
        expect(order).toEqual(order.slice().sort((a, b) => a - b));
    });
});