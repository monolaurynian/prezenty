'use strict';
/**
 * Group chat ("Czat grupowy") and the emoji picker's page/tab alignment.
 *
 * Group chat decisions locked in here:
 *  - it is NOT pinned: an ordinary row in the conversation list, ordered by
 *    its last message, drawn as a solid (non-transparent) card with the
 *    purple strip on its left side;
 *  - it is a choice in the "Do kogo?" dropdown; sending from there posts to
 *    the shared room and does NOT create a private thread;
 *  - its messages take emoji reactions with the same privacy contract as the
 *    private threads (aggregate only: { emoji, count, mine }).
 *
 * The demo group room is shared, in-memory state: tests only add their own
 * reactions and take them back, and compare counts relative to a baseline.
 */
const { test, expect } = require('../fixtures');
const { openPage, setViewport } = require('../helpers/pages');
const { activeDescription, describeFocus } = require('../helpers/focus');

const LIST = { path: '/wiadomosci', name: 'chat list', ready: '.thread-row' };
const GROUP = { path: '/wiadomosci?rozmowa=group', name: 'group chat', ready: '.chat-bubble' };
const THREAD = { path: '/wiadomosci?rozmowa=1', name: 'chat thread', ready: '.chat-bubble' };

// Group message 3 is seeded without reactions (see demoGroup in lib/demo-data.js)
const BARE_GROUP_MESSAGE = 3;
const HEART = '\u2764\uFE0F';
const PARTY = '\u{1F389}';

const strip = (page, id) => page.locator(`.chat-reactions[data-reactions-for="${id}"]`);
const chip = (page, id, emoji) => strip(page, id).locator(`.chat-reaction-chip[data-emoji="${emoji}"]`);

/** POST a group reaction from inside the page (same session cookie as the app). */
async function postGroupReaction(page, messageId, body) {
    return page.evaluate(async ([id, payload]) => {
        const options = { method: 'POST' };
        if (payload !== undefined) {
            options.headers = { 'Content-Type': 'application/json' };
            options.body = JSON.stringify(payload);
        }
        const response = await fetch(`/api/wiadomosci/group/messages/${id}/reactions`, options);
        let json = null;
        try { json = await response.json(); } catch (error) { json = null; }
        return { status: response.status, json };
    }, [messageId, body]);
}

test.describe('group chat: list row', () => {
    test('is a normal row: not pinned, solid background, purple strip on the left', async ({ page }) => {
        await openPage(page, LIST);
        const row = page.locator('.thread-row', { hasText: 'Czat grupowy' });
        await expect(row).toHaveCount(1);

        await expect(page.locator('.thread-pin-badge')).toHaveCount(0);
        await expect(page.locator('.thread-row--pinned')).toHaveCount(0);
        await expect(row).not.toContainText('Przypięty');

        const style = await row.evaluate(el => {
            const css = getComputedStyle(el);
            return { background: css.backgroundColor, left: css.borderLeftWidth, leftColor: css.borderLeftColor };
        });
        // Fully opaque: rgb(...) has no alpha channel, rgba(..., <1) would be see-through
        expect(style.background, JSON.stringify(style)).toMatch(/^rgb\(\d+, \d+, \d+\)$/);
        expect(style.left).toBe('3px');
        expect(style.leftColor).toBe('rgb(123, 31, 162)');
    });

    test('is ordered by its last activity like every other conversation', async ({ page }) => {
        await openPage(page, LIST);
        const order = await page.evaluate(async () => {
            const { threads } = await fetch('/api/wiadomosci/threads').then(r => r.json());
            return threads.map(t => ({ id: t.id, at: new Date(t.lastAt).getTime(), pinned: !!t.pinned }));
        });
        expect(order.some(t => t.id === 'group')).toBe(true);
        expect(order.some(t => t.pinned)).toBe(false);
        const times = order.map(t => t.at);
        expect(times).toEqual(times.slice().sort((a, b) => b - a));
    });
});

test.describe('group chat: compose dropdown', () => {
    test('offers "Czat grupowy" and sends into the shared room without creating a thread', async ({ page }) => {
        await openPage(page, LIST);
        const select = page.locator('#targetSelect');
        await expect(select.locator('option[value="group"]')).toHaveText('👥 Czat grupowy');

        const hint = page.locator('#composeGroupHint');
        await expect(hint).toBeHidden();
        await select.selectOption('group');
        await expect(hint).toBeVisible();

        const threadsBefore = await page.evaluate(async () =>
            (await fetch('/api/wiadomosci/threads').then(r => r.json())).threads.filter(t => t.id !== 'group').length);

        const text = 'Wiadomość z listy rozwijanej ' + Date.now();
        await page.locator('#composeBody').fill(text);
        await page.locator('#composeBtn').click();

        // The group conversation opens with the message in it
        await expect(page.locator('#chatView')).toBeVisible();
        await expect(page.locator('#chatTitle')).toContainText('Czat grupowy');
        await expect(page.locator('.chat-bubble.from-me', { hasText: text })).toBeVisible();
        await expect(page).toHaveURL(/rozmowa=group/);

        // ...and no private thread was created by it
        const threadsAfter = await page.evaluate(async () =>
            (await fetch('/api/wiadomosci/threads').then(r => r.json())).threads.filter(t => t.id !== 'group').length);
        expect(threadsAfter).toBe(threadsBefore);
    });

    test('choosing a person still creates a normal thread request (group option does not leak)', async ({ page }) => {
        await openPage(page, LIST);
        await page.locator('#targetSelect').selectOption({ index: 2 });
        await expect(page.locator('#composeGroupHint')).toBeHidden();
    });
});

test.describe('group chat: reactions', () => {
    test.afterEach(async ({ page }) => {
        if (!/^https?:/.test(page.url())) return;
        await page.unrouteAll({ behavior: 'ignoreErrors' });
        // Take back anything this test left on the bare message
        await page.evaluate(async (id) => {
            const { messages } = await fetch('/api/wiadomosci/group').then(r => r.json());
            const message = messages.find(m => m.id === id);
            for (const reaction of (message ? message.reactions.filter(r => r.mine) : [])) {
                await fetch(`/api/wiadomosci/group/messages/${id}/reactions`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ emoji: reaction.emoji })
                });
            }
        }, BARE_GROUP_MESSAGE);
    });

    test('every group message has a reaction strip, and seeded reactions render', async ({ page }) => {
        await openPage(page, GROUP);
        const bubbles = await page.locator('.chat-bubble').count();
        await expect(page.locator('.chat-reactions')).toHaveCount(bubbles);
        // Seeded: message 2 carries two emoji
        await expect(strip(page, 2).locator('.chat-reaction-chip')).toHaveCount(2);
        await expect(chip(page, 2, '\u{1F602}').locator('.chat-reaction-count')).toHaveText('2');
        await expect(chip(page, 2, '\u{1F602}')).toHaveAttribute('aria-pressed', 'true');
    });

    test('tap a quick emoji to react, tap the chip to take it back', async ({ page }) => {
        await openPage(page, GROUP);
        await setViewport(page, 375);

        await strip(page, BARE_GROUP_MESSAGE).locator('.chat-reaction-add').focus();
        await page.keyboard.press('Enter');
        await expect(page.locator('#reactionSheet')).toHaveClass(/is-open/);

        const added = page.waitForResponse(r =>
            r.url().includes(`/api/wiadomosci/group/messages/${BARE_GROUP_MESSAGE}/reactions`) && r.request().method() === 'POST');
        await page.locator(`#reactionSheetGrid .reaction-sheet-btn[data-emoji="${HEART}"]`).click();
        const addedJson = await (await added).json();
        expect(addedJson.action).toBe('added');
        addedJson.reactions.forEach(r => expect(Object.keys(r).sort()).toEqual(['count', 'emoji', 'mine']));

        const reaction = chip(page, BARE_GROUP_MESSAGE, HEART);
        await expect(reaction).toHaveAttribute('aria-pressed', 'true');
        await expect(reaction.locator('.chat-reaction-count')).toHaveText('1');
        const returned = await activeDescription(page);
        expect(returned.cls, describeFocus('focus after reacting', returned)).toContain('chat-reaction-add');

        // Survives the page's own refresh (server round trip)
        await page.evaluate(() => window.loadThreadMessages());
        await expect(reaction).toHaveAttribute('aria-pressed', 'true');

        const removed = page.waitForResponse(r =>
            r.url().includes(`/api/wiadomosci/group/messages/${BARE_GROUP_MESSAGE}/reactions`) && r.request().method() === 'POST');
        await reaction.click();
        expect((await (await removed).json()).action).toBe('removed');
        await expect(reaction).toHaveCount(0);
    });

    test('any emoji from the full picker works in the group chat too', async ({ page }) => {
        await openPage(page, GROUP);
        await setViewport(page, 375);
        await strip(page, BARE_GROUP_MESSAGE).locator('.chat-reaction-add').focus();
        await page.keyboard.press('Enter');
        await page.locator('#reactionSheet .reaction-sheet-more').click();
        await page.locator('#emojiPickerTab-activities').click();
        const added = page.waitForResponse(r =>
            r.url().includes(`/api/wiadomosci/group/messages/${BARE_GROUP_MESSAGE}/reactions`) && r.request().method() === 'POST');
        await page.locator(`#emojiPickerRoot .emoji-picker-btn[data-emoji="${PARTY}"]`).click();
        expect((await (await added).json()).action).toBe('added');
        await expect(chip(page, BARE_GROUP_MESSAGE, PARTY)).toHaveAttribute('aria-pressed', 'true');
    });

    test('API: junk is rejected, unknown message is 404, response carries no identity', async ({ page }) => {
        await openPage(page, GROUP);
        for (const emoji of ['', 'a', '<img src=x onerror=alert(1)>', PARTY + PARTY, 5, null]) {
            const result = await postGroupReaction(page, BARE_GROUP_MESSAGE, { emoji });
            expect(result.status, JSON.stringify(emoji)).toBe(400);
            expect(result.json.error).toBe('Nieprawidłowa reakcja');
        }
        expect((await postGroupReaction(page, 'abc', { emoji: HEART })).status).toBe(400);
        expect((await postGroupReaction(page, 9999, { emoji: HEART })).status).toBe(404);

        const ok = await postGroupReaction(page, BARE_GROUP_MESSAGE, { emoji: HEART });
        expect(ok.status).toBe(200);
        expect(Object.keys(ok.json).sort()).toEqual(['action', 'emoji', 'messageId', 'reactions', 'success']);
        const listed = await page.evaluate(async () => (await fetch('/api/wiadomosci/group').then(r => r.json())));
        expect(JSON.stringify(listed)).not.toMatch(/user|sender/i);
    });

    test('group and private message ids do not mix: a group reaction never shows up in a thread', async ({ page }) => {
        await openPage(page, GROUP);
        // Group message 3 and private message 3 share the number but not the room
        const result = await postGroupReaction(page, BARE_GROUP_MESSAGE, { emoji: PARTY });
        expect(result.json.action).toBe('added');
        const thread = await page.evaluate(async () => (await fetch('/api/wiadomosci/threads/1').then(r => r.json())));
        const privateMessage = thread.messages.find(m => m.id === BARE_GROUP_MESSAGE);
        expect(privateMessage.reactions.map(r => r.emoji)).not.toContain(PARTY);
    });

    test('opening a private thread after the group chat reacts against the private endpoint', async ({ page }) => {
        await openPage(page, GROUP);
        await page.evaluate(() => window.openThread(1));
        await expect(page.locator('#chatTitle')).not.toContainText('Czat grupowy');
        await expect(strip(page, 4).locator('.chat-reaction-add')).toBeVisible();
        const answered = page.waitForResponse(r => /\/api\/wiadomosci\/messages\/4\/reactions$/.test(r.url()) && r.request().method() === 'POST');
        await page.evaluate(() => window.ChatReactions.toggle(4, '\u2764\uFE0F'));
        await answered;
        await expect(chip(page, 4, HEART)).toHaveAttribute('aria-pressed', 'true');
        // take it back (a second tap while the first is still in flight is
        // ignored on purpose, so wait for the answer above first)
        const removed = page.waitForResponse(r => /\/api\/wiadomosci\/messages\/4\/reactions$/.test(r.url()) && r.request().method() === 'POST');
        await page.evaluate(() => window.ChatReactions.toggle(4, '\u2764\uFE0F'));
        await removed;
        await expect(chip(page, 4, HEART)).toHaveCount(0);
    });
});

test.describe('group chat: unread and refresh', () => {
    test('service worker precaches the assets the page references', async ({ request }) => {
        const sw = await (await request.get('/sw.js')).text();
        const version = await (await request.get('/api/version')).json();
        const cacheName = sw.match(/const CACHE_NAME = '([^']+)'/)[1];
        // /api/version names the SW's cache generation, so a bump of CACHE_NAME
        // is enough to make open clients show the "new version" banner
        expect(version.cacheVersion).toBe(cacheName);
    });
});

// ===========================================================================
// Emoji picker: tab highlight, cards and scrollbar agree
// ===========================================================================

const SHEET = '#reactionSheet';
const tabEl = (page, id) => page.locator(`#emojiPickerTab-${id}`);

async function openFullPicker(page) {
    await page.locator('.chat-reactions .chat-reaction-add').first().focus();
    await page.keyboard.press('Enter');
    await expect(page.locator(SHEET)).toHaveClass(/is-open/);
    await page.locator(`${SHEET} .reaction-sheet-more`).click();
    await expect(page.locator(SHEET)).toHaveClass(/is-all/);
}

/**
 * What the user actually sees: the page index the grid is scrolled to, the
 * index of the highlighted tab, and how far the visible card's left edge is
 * from the grid's left edge (0 = card sits exactly in the frame).
 */
function pickerState(page) {
    return page.evaluate(() => {
        const grid = document.getElementById('emojiPickerPanel');
        const tabs = Array.prototype.slice.call(document.querySelectorAll('#emojiPickerRoot [role="tab"]'));
        const sections = Array.prototype.slice.call(grid.querySelectorAll('.emoji-picker-section'));
        const gridLeft = grid.getBoundingClientRect().left;
        const visible = sections.map((s, i) => ({ i, off: Math.abs(s.getBoundingClientRect().left - gridLeft) }))
            .sort((a, b) => a.off - b.off)[0];
        return {
            selectedTab: tabs.findIndex(t => t.getAttribute('aria-selected') === 'true'),
            visiblePage: visible.i,
            cardOffset: Math.round(visible.off),
            scrollLeft: Math.round(grid.scrollLeft),
            width: grid.clientWidth,
            labelledBy: grid.getAttribute('aria-labelledby')
        };
    });
}

/** Where the page scrollbar (track + thumb) is, in page coordinates. */
function pagerGeometry(page) {
    return page.evaluate(() => {
        const track = document.querySelector('#emojiPickerRoot .emoji-picker-pager');
        const thumb = track.querySelector('.emoji-picker-pager-thumb');
        const grid = document.getElementById('emojiPickerPanel');
        const trackBox = track.getBoundingClientRect();
        const thumbBox = thumb.getBoundingClientRect();
        return {
            trackWidth: trackBox.width,
            trackHeight: trackBox.height,
            trackTop: trackBox.top,
            trackLeftPage: trackBox.left,
            thumbWidth: thumbBox.width,
            thumbLeft: thumbBox.left - trackBox.left,
            width: grid.clientWidth,
            barHeight: getComputedStyle(track, '::before').height,
            thumbColor: getComputedStyle(thumb, '::after').backgroundColor
        };
    });
}

/** Waits until the grid stopped scrolling (snap + smooth scroll finished). */
async function settled(page) {
    // Three identical readings 250ms apart: a snap animation can pause for
    // a moment after the finger lifts, so one equal pair is not enough.
    let last = -1;
    let equal = 0;
    await expect.poll(async () => {
        const now = (await pickerState(page)).scrollLeft;
        equal = now === last ? equal + 1 : 0;
        last = now;
        return equal >= 3;
    }, { timeout: 8000, intervals: [250] }).toBe(true);
}

test.describe('emoji picker: highlighted tab and card are the same page', () => {
    // Some tests walk all nine cards and wait for each snap to settle
    // (three identical readings, 250ms apart), which can exceed the 30s default
    test.describe.configure({ timeout: 90000 });

    test.beforeEach(async ({ page }) => {
        await openPage(page, THREAD);
        await setViewport(page, 375);
    });

    test('tapping each tab shows exactly that card, snapped flush, with the tab highlighted', async ({ page }) => {
        await openFullPicker(page);
        const ids = await page.locator('#emojiPickerRoot [role="tab"]').evaluateAll(list =>
            list.map(t => t.id.replace('emojiPickerTab-', '')));
        for (let index = 0; index < ids.length; index++) {
            await tabEl(page, ids[index]).click();
            await settled(page);
            const state = await pickerState(page);
            expect(state.selectedTab, `tab ${ids[index]}: ${JSON.stringify(state)}`).toBe(index);
            expect(state.visiblePage, `tab ${ids[index]}: ${JSON.stringify(state)}`).toBe(index);
            // Flush with the frame (the old bug left it a padding off)
            expect(state.cardOffset, `tab ${ids[index]}: ${JSON.stringify(state)}`).toBeLessThanOrEqual(1);
            expect(state.labelledBy).toBe(`emojiPickerTab-${ids[index]}`);
        }
    });

    test('swiping (scrolling) the cards moves the highlight to the card in view', async ({ page }) => {
        await openFullPicker(page);
        for (const target of [3, 1, 6, 0, 8]) {
            await page.evaluate(i => {
                const grid = document.getElementById('emojiPickerPanel');
                grid.scrollTo({ left: i * grid.clientWidth, behavior: 'auto' });
            }, target);
            await settled(page);
            const state = await pickerState(page);
            expect(state.selectedTab, JSON.stringify(state)).toBe(target);
            expect(state.visiblePage, JSON.stringify(state)).toBe(target);
        }
    });

    test('a half-way drag snaps to a whole card and the highlight follows', async ({ page }) => {
        await openFullPicker(page);
        await page.evaluate(() => {
            const grid = document.getElementById('emojiPickerPanel');
            grid.scrollTo({ left: grid.clientWidth * 2.4, behavior: 'auto' });
        });
        await settled(page);
        const state = await pickerState(page);
        expect(state.cardOffset, JSON.stringify(state)).toBeLessThanOrEqual(1);
        expect(state.selectedTab, JSON.stringify(state)).toBe(state.visiblePage);
    });

    test('a visible scrollbar runs along the bottom of the cards', async ({ page }) => {
        await openFullPicker(page);
        // The bar is drawn by the picker itself (a native one is hidden or
        // frozen on many phones), so it is measurable in headless too.
        const bar = await page.locator('#emojiPickerPanel').evaluate(el => ({
            overflowX: getComputedStyle(el).overflowX,
            snap: getComputedStyle(el).scrollSnapType,
            pages: el.querySelectorAll('.emoji-picker-section').length,
            scrollable: el.scrollWidth > el.clientWidth
        }));
        expect(bar.overflowX).toBe('auto');
        expect(bar.snap).toMatch(/x\s+mandatory/);
        expect(bar.scrollable).toBe(true);
        expect(bar.pages).toBe(9);

        const geometry = await pagerGeometry(page);
        expect(geometry.trackHeight, JSON.stringify(geometry)).toBeGreaterThanOrEqual(24);
        expect(geometry.barHeight, JSON.stringify(geometry)).toBe('10px');
        expect(geometry.thumbColor, JSON.stringify(geometry)).toBe('rgb(123, 31, 162)');
        // One card wide out of nine
        expect(geometry.thumbWidth / geometry.trackWidth, JSON.stringify(geometry)).toBeCloseTo(1 / 9, 1);
        // At the first card the thumb sits at the left end
        expect(geometry.thumbLeft, JSON.stringify(geometry)).toBeLessThanOrEqual(1);
    });

    test('the bar follows the cards: swiping moves the thumb, to the far end on the last card', async ({ page }) => {
        await openFullPicker(page);
        let previous = (await pagerGeometry(page)).thumbLeft;
        for (const target of [2, 5, 8]) {
            await page.evaluate(i => {
                const grid = document.getElementById('emojiPickerPanel');
                grid.scrollTo({ left: i * grid.clientWidth, behavior: 'auto' });
            }, target);
            await settled(page);
            const now = await pagerGeometry(page);
            expect(now.thumbLeft, JSON.stringify(now)).toBeGreaterThan(previous);
            previous = now.thumbLeft;
        }
        const end = await pagerGeometry(page);
        // Last card: the thumb touches the right end of the track
        expect(Math.abs(end.trackWidth - (end.thumbLeft + end.thumbWidth)), JSON.stringify(end)).toBeLessThanOrEqual(1.5);
        // ...and comes back to the left end
        await page.evaluate(() => document.getElementById('emojiPickerPanel').scrollTo({ left: 0, behavior: 'auto' }));
        await settled(page);
        expect((await pagerGeometry(page)).thumbLeft).toBeLessThanOrEqual(1);
    });

    test('dragging the bar moves the cards, and letting go settles on a whole card', async ({ page }) => {
        await openFullPicker(page);
        const g = await pagerGeometry(page);
        const y = g.trackTop + g.trackHeight / 2;
        const startX = g.trackLeftPage + g.thumbWidth / 2;
        // Drag the thumb about 40% of the way along the track
        const endX = startX + (g.trackWidth - g.thumbWidth) * 0.4;
        await page.mouse.move(startX, y);
        await page.mouse.down();
        await page.mouse.move((startX + endX) / 2, y, { steps: 5 });
        await page.mouse.move(endX, y, { steps: 5 });
        const during = await pickerState(page);
        expect(during.scrollLeft, JSON.stringify(during)).toBeGreaterThan(g.width);
        await page.mouse.up();
        await settled(page);
        const after = await pickerState(page);
        expect(after.cardOffset, JSON.stringify(after)).toBeLessThanOrEqual(1);
        expect(after.selectedTab, JSON.stringify(after)).toBe(after.visiblePage);
        expect(after.visiblePage, JSON.stringify(after)).toBeGreaterThanOrEqual(3);
        expect(after.visiblePage, JSON.stringify(after)).toBeLessThanOrEqual(4);
    });

    test('tapping the bar jumps to the card under the finger', async ({ page }) => {
        await openFullPicker(page);
        const g = await pagerGeometry(page);
        // Middle of the 7th ninth of the track (card index 6)
        const x = g.trackLeftPage + g.trackWidth * (6.5 / 9);
        await page.mouse.click(x, g.trackTop + g.trackHeight / 2);
        await settled(page);
        const state = await pickerState(page);
        expect(state.visiblePage, JSON.stringify(state)).toBe(6);
        expect(state.selectedTab, JSON.stringify(state)).toBe(6);
        expect(state.cardOffset, JSON.stringify(state)).toBeLessThanOrEqual(1);
    });

    test('the bar is hidden while searching and back afterwards', async ({ page }) => {
        await openFullPicker(page);
        const pager = page.locator('#emojiPickerRoot .emoji-picker-pager');
        await expect(pager).toBeVisible();
        await page.locator('#emojiPickerRoot .emoji-picker-search').fill('kot');
        await expect(pager).toBeHidden();
        await page.locator('#emojiPickerRoot .emoji-picker-search').fill('');
        await expect(pager).toBeVisible();
    });

    test('closing and reopening keeps tab and card together', async ({ page }) => {
        await openFullPicker(page);
        await tabEl(page, 'travel').click();
        await settled(page);
        await page.keyboard.press('Escape');
        await expect(page.locator(SHEET)).toHaveAttribute('aria-hidden', 'true');

        await openFullPicker(page);
        await settled(page);
        const state = await pickerState(page);
        expect(state.selectedTab, JSON.stringify(state)).toBe(state.visiblePage);
        expect(state.cardOffset, JSON.stringify(state)).toBeLessThanOrEqual(1);
        // Initial focus must not drag the cards back to page 0
        const focused = await activeDescription(page);
        expect(focused, JSON.stringify(focused)).toBeTruthy();
    });

    test('searching and clearing returns to the card the tab names', async ({ page }) => {
        await openFullPicker(page);
        await tabEl(page, 'food').click();
        await settled(page);
        await page.locator('#emojiPickerRoot .emoji-picker-search').fill('kot');
        await expect(page.locator('#emojiPickerRoot .emoji-picker-grid--search')).toHaveCount(1);
        await page.locator('#emojiPickerRoot .emoji-picker-search').fill('');
        await settled(page);
        const state = await pickerState(page);
        expect(state.selectedTab, JSON.stringify(state)).toBe(state.visiblePage);
        expect(state.cardOffset, JSON.stringify(state)).toBeLessThanOrEqual(1);
    });

    test('keyboard: arrows stay on the card, Left/Right carry across the card edge and the tab follows', async ({ page }) => {
        await openFullPicker(page);
        // End jumps to the last emoji of THIS card only
        await page.keyboard.press('End');
        const lastOfFirst = await page.evaluate(() => document.activeElement.getAttribute('data-cat-index'));
        expect(lastOfFirst).toBe('0');
        // One more step to the right crosses into the next card
        await page.keyboard.press('ArrowRight');
        await settled(page);
        const state = await pickerState(page);
        expect(state.selectedTab, JSON.stringify(state)).toBe(1);
        expect(state.visiblePage, JSON.stringify(state)).toBe(1);
        expect(await page.evaluate(() => document.activeElement.getAttribute('data-cat-index'))).toBe('1');
        // ...and back
        await page.keyboard.press('ArrowLeft');
        await settled(page);
        expect((await pickerState(page)).selectedTab).toBe(0);
    });
});

// ===========================================================================
// Emoji picker: swiping the cards with a finger
//
// Earlier tests moved the cards with scrollTo(), which skips the touch
// pipeline entirely - so they passed while a real swipe did nothing (each
// card had `overscroll-behavior: contain` on both axes and swallowed the
// sideways gesture). These tests send real touch events.
// ===========================================================================

/** A finger swipe: touch down, many small moves, lift. dx/dy in CSS px. */
async function swipe(cdp, x, y, dx, dy, msPerStep) {
    const steps = 14;
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
    for (let i = 1; i <= steps; i++) {
        await cdp.send('Input.dispatchTouchEvent', {
            type: 'touchMove', touchPoints: [{ x: x + dx * i / steps, y: y + (dy || 0) * i / steps }]
        });
        await new Promise(resolve => setTimeout(resolve, msPerStep || 16));
    }
    // A hesitant drag stops moving before the finger lifts (no fling)
    if (msPerStep) await new Promise(resolve => setTimeout(resolve, 150));
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}

test.describe('emoji picker: swipe the cards', () => {
    test.use({ hasTouch: true, isMobile: true });
    // Several swipes in a row, each waiting for the snap to settle
    test.describe.configure({ timeout: 90000 });

    let cdp;
    let frame; // bounding box of the card area

    test.beforeEach(async ({ page, context }) => {
        await openPage(page, THREAD);
        await setViewport(page, 375);
        await openFullPicker(page);
        await settled(page);
        cdp = await context.newCDPSession(page);
        frame = await page.locator('#emojiPickerPanel').boundingBox();
    });

    const startOnEmoji = async (page) => {
        const box = await page.locator('#emojiPickerRoot .emoji-picker-section:not([hidden]) .emoji-picker-btn').first().boundingBox();
        return { x: Math.round(box.x + box.width / 2), y: Math.round(box.y + box.height / 2) };
    };

    test('a swipe that starts on an emoji moves exactly one card, flush, and the tab follows', async ({ page }) => {
        const from = await startOnEmoji(page);
        await swipe(cdp, from.x, from.y, -Math.round(frame.width * 0.6));
        await settled(page);
        const state = await pickerState(page);
        expect(state.visiblePage, JSON.stringify(state)).toBe(1);
        expect(state.selectedTab, JSON.stringify(state)).toBe(1);
        expect(state.cardOffset, JSON.stringify(state)).toBeLessThanOrEqual(1);
    });

    test('a swipe that starts in the margin at the edge works too, and swiping back returns', async ({ page }) => {
        await swipe(cdp, Math.round(frame.x + frame.width - 5), Math.round(frame.y + frame.height * 0.5), -Math.round(frame.width * 0.6));
        await settled(page);
        expect((await pickerState(page)).visiblePage).toBe(1);

        await swipe(cdp, Math.round(frame.x + 20), Math.round(frame.y + frame.height * 0.5), Math.round(frame.width * 0.6));
        await settled(page);
        const back = await pickerState(page);
        expect(back.visiblePage, JSON.stringify(back)).toBe(0);
        expect(back.selectedTab, JSON.stringify(back)).toBe(0);
        expect(back.cardOffset, JSON.stringify(back)).toBeLessThanOrEqual(1);
    });

    test('a short swipe snaps back: it never rests between two cards', async ({ page }) => {
        const from = await startOnEmoji(page);
        await swipe(cdp, from.x, from.y, 0 - Math.round(frame.width * 0.2), 0, 60);
        await settled(page);
        const state = await pickerState(page);
        expect(state.visiblePage, JSON.stringify(state)).toBe(0);
        expect(state.cardOffset, JSON.stringify(state)).toBeLessThanOrEqual(1);
    });

    test('several swipes in a row always land on a whole card', async ({ page }) => {
        const from = await startOnEmoji(page);
        for (const distance of [-0.55, -0.7, -0.4, 0.8, -0.65]) {
            await swipe(cdp, from.x, from.y, Math.round(frame.width * distance));
            await settled(page);
            const state = await pickerState(page);
            expect(state.cardOffset, `after ${distance}: ${JSON.stringify(state)}`).toBeLessThanOrEqual(1);
            expect(state.selectedTab, `after ${distance}: ${JSON.stringify(state)}`).toBe(state.visiblePage);
        }
    });

    test('scrolling a card up and down still works and does not nudge the cards sideways', async ({ page }) => {
        const from = await startOnEmoji(page);
        await swipe(cdp, from.x, from.y + 150, 0, -140);
        await page.waitForTimeout(500);
        const result = await page.evaluate(() => {
            const grid = document.getElementById('emojiPickerPanel');
            const card = grid.querySelector('.emoji-picker-section');
            return { cardScrollTop: Math.round(card.scrollTop), gridScrollLeft: Math.round(grid.scrollLeft) };
        });
        expect(result.cardScrollTop, JSON.stringify(result)).toBeGreaterThan(0);
        expect(result.gridScrollLeft, JSON.stringify(result)).toBe(0);
    });

    test('the bar moves along with a swipe', async ({ page }) => {
        const before = (await pagerGeometry(page)).thumbLeft;
        const from = await startOnEmoji(page);
        await swipe(cdp, from.x, from.y, -Math.round(frame.width * 0.6));
        await settled(page);
        expect((await pagerGeometry(page)).thumbLeft).toBeGreaterThan(before + 5);
    });
});

test.describe('emoji picker: trackpad / horizontal wheel', () => {
    test('a sideways wheel over the cards scrolls them and always rests on a whole card', async ({ page }) => {
        await openPage(page, THREAD);
        await setViewport(page, 1024);
        await openFullPicker(page);
        await settled(page);
        const box = await page.locator('#emojiPickerPanel').boundingBox();
        await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
        for (const dx of [140, 260, -90, 400]) {
            await page.mouse.wheel(dx, 0);
            await settled(page);
            const state = await pickerState(page);
            expect(state.cardOffset, `wheel ${dx}: ${JSON.stringify(state)}`).toBeLessThanOrEqual(1);
            expect(state.selectedTab, `wheel ${dx}: ${JSON.stringify(state)}`).toBe(state.visiblePage);
        }
        expect((await pickerState(page)).visiblePage).toBeGreaterThan(0);
    });
});

test.describe('emoji picker: the up/down scrollbar only shows while scrolling', () => {
    const thumbColor = (page) => page.locator('#emojiPickerRoot .emoji-picker-section').first()
        .evaluate(el => getComputedStyle(el).scrollbarColor);

    test('hidden when a card loads, visible while scrolling it, hidden again after', async ({ page }) => {
        await openPage(page, THREAD);
        await setViewport(page, 1024);
        await openFullPicker(page);
        await settled(page);

        // On load: thin bar with a transparent thumb, and its space is reserved
        const idle = await thumbColor(page);
        expect(idle, idle).toMatch(/^(rgba\(0, 0, 0, 0\)|transparent)/);
        const gutter = await page.locator('#emojiPickerRoot .emoji-picker-section').first().evaluate(el => ({
            width: getComputedStyle(el).scrollbarWidth,
            scrollable: el.scrollHeight > el.clientHeight
        }));
        expect(gutter.width).toBe('thin');
        expect(gutter.scrollable, 'the first card is taller than the frame').toBe(true);

        // Scrolling the card up/down shows it
        const box = await page.locator('#emojiPickerPanel').boundingBox();
        await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
        await page.mouse.wheel(0, 120);
        await expect(page.locator('#emojiPickerRoot .emoji-picker-section').first()).toHaveClass(/is-scrolling/);
        const scrolling = await thumbColor(page);
        expect(scrolling, scrolling).toMatch(/rgba?\(123, 31, 162/);

        // ...and it goes away once scrolling stops
        await expect(page.locator('#emojiPickerRoot .emoji-picker-section').first()).not.toHaveClass(/is-scrolling/, { timeout: 4000 });
        expect(await thumbColor(page)).toMatch(/^(rgba\(0, 0, 0, 0\)|transparent)/);
    });

    test('moving the cards sideways does not flash the up/down bar', async ({ page }) => {
        await openPage(page, THREAD);
        await setViewport(page, 1024);
        await openFullPicker(page);
        await settled(page);
        await page.evaluate(() => document.getElementById('emojiPickerPanel')
            .scrollTo({ left: document.getElementById('emojiPickerPanel').clientWidth * 2, behavior: 'auto' }));
        await settled(page);
        await expect(page.locator('#emojiPickerRoot .emoji-picker-section.is-scrolling')).toHaveCount(0);
    });

    test('only the card being scrolled shows its bar', async ({ page }) => {
        await openPage(page, THREAD);
        await setViewport(page, 1024);
        await openFullPicker(page);
        await page.locator('#emojiPickerTab-food').click();
        await settled(page);
        const box = await page.locator('#emojiPickerPanel').boundingBox();
        await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
        await page.mouse.wheel(0, 120);
        await expect(page.locator('#emojiPickerRoot .emoji-picker-section.is-scrolling')).toHaveCount(1);
        // ...and it is the Food card (index 3), not a neighbour
        const shown = await page.locator('#emojiPickerRoot .emoji-picker-section').evaluateAll(list =>
            list.findIndex(el => el.classList.contains('is-scrolling')));
        expect(shown).toBe(3);
    });

    test('search results: the list scrolls and shows its bar only while moving', async ({ page }) => {
        await openPage(page, THREAD);
        await setViewport(page, 1024);
        await openFullPicker(page);
        await page.locator('#emojiPickerRoot .emoji-picker-search').fill('s');
        const grid = page.locator('#emojiPickerPanel');
        await expect(grid).toHaveClass(/emoji-picker-grid--search/);
        expect(await grid.evaluate(el => el.scrollHeight > el.clientHeight), 'the result list is taller than the frame').toBe(true);
        expect(await grid.evaluate(el => getComputedStyle(el).scrollbarColor)).toMatch(/^(rgba\(0, 0, 0, 0\)|transparent)/);
        const box = await grid.boundingBox();
        await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
        await page.mouse.wheel(0, 100);
        // The wheel really scrolls the result list (regression: a card-level
        // overscroll rule once swallowed it)
        await expect.poll(() => grid.evaluate(el => el.scrollTop)).toBeGreaterThan(0);
        await expect(grid).toHaveClass(/is-scrolling/);
        await expect(grid).not.toHaveClass(/is-scrolling/, { timeout: 4000 });
    });
});
