'use strict';
/**
 * Emoji reactions in the anonymous chat.
 *
 * The behaviours locked in here all come from real problems:
 *  - the chip strip used to be rebuilt wholesale, so keyboard focus fell to
 *    <body> on every toggle and again on every 8s poll;
 *  - "pressed" has to be recognisable without seeing the purple hue;
 *  - the response must stay aggregate-only. A reactor's identity exists in
 *    anon_message_reactions and must never leave the server, so the response
 *    keys are asserted, not just the rendered output.
 */
const { test, expect } = require('../fixtures');
const { openPage, setViewport } = require('../helpers/pages');
const { stashFocus, focusSurvived, activeDescription, describeFocus } = require('../helpers/focus');
const { nonColorSignature, signatureKey, describeSignature } = require('../helpers/non-color-cue');
const { measureContrast, measureBorderContrast, requiredRatio } = require('../helpers/contrast');
const { collectOverflow, describeOverflow } = require('../helpers/overflow');
const { CHAT_REACTION_EMOJI } = require('../../public/chat-reactions');

const THREAD = { path: '/wiadomosci?rozmowa=1', name: 'chat thread', ready: '.chat-bubble' };

// Message 2 is seeded with three emoji (counts 1 / 2 / 9, two of them mine);
// message 4 is seeded with none. See demoChat.reactions in server.js.
const SEEDED_MESSAGE = 2;
const BARE_MESSAGE = 4;

const strip = (page, id) => page.locator(`.chat-reactions[data-reactions-for="${id}"]`);
const chip = (page, id, emoji) => strip(page, id).locator(`.chat-reaction-chip[data-emoji="${emoji}"]`);
const addButton = (page, id) => strip(page, id).locator('.chat-reaction-add');

/** Walk a JSON value looking for any key that could name a person. */
function identityKeys(value, path, found) {
    found = found || [];
    path = path || '$';
    if (Array.isArray(value)) {
        value.forEach((v, i) => identityKeys(v, `${path}[${i}]`, found));
    } else if (value && typeof value === 'object') {
        Object.keys(value).forEach(key => {
            if (/user|sender|reactor|identit|author|owner/i.test(key)) found.push(`${path}.${key}`);
            identityKeys(value[key], `${path}.${key}`, found);
        });
    }
    return found;
}

test.describe('chat reactions', () => {
    test('chips render in allowlist order with counts and Polish labels', async ({ page }) => {
        await openPage(page, THREAD);
        await setViewport(page, 375);

        const rendered = await strip(page, SEEDED_MESSAGE).evaluate(el =>
            Array.prototype.slice.call(el.children).map(child => ({
                cls: child.className,
                emoji: child.getAttribute('data-emoji'),
                count: child.querySelector('.chat-reaction-count')
                    ? child.querySelector('.chat-reaction-count').textContent.trim() : null,
                pressed: child.getAttribute('aria-pressed'),
                label: child.getAttribute('aria-label')
            })));

        const chips = rendered.filter(r => r.cls.includes('chat-reaction-chip'));
        expect(chips.length, JSON.stringify(rendered)).toBe(3);
        expect(chips.map(c => c.count)).toEqual(['1', '2', '9']);
        expect(chips.map(c => c.pressed)).toEqual(['true', 'true', 'false']);

        // Allowlist order, not insertion order
        const order = chips.map(c => CHAT_REACTION_EMOJI.indexOf(c.emoji));
        expect(order, 'chips must follow the allowlist order: ' + JSON.stringify(chips.map(c => c.emoji)))
            .toEqual(order.slice().sort((a, b) => a - b));
        expect(order.every(i => i >= 0)).toBe(true);

        // Polish, pluralised, and it says what activating the chip will do
        expect(chips[0].label).toContain('Reakcja');
        expect(chips[0].label).toContain('1 osoba');
        expect(chips[0].label).toContain('Usuń swoją reakcję');
        expect(chips[1].label).toContain('2 osoby');
        expect(chips[2].label).toContain('9 osób');
        expect(chips[2].label).toContain('Dodaj swoją reakcję');

        // The add control is LAST
        expect(rendered[rendered.length - 1].cls).toContain('chat-reaction-add');

        // A message with no reactions still gets the add control, no chips
        const bare = await strip(page, BARE_MESSAGE).evaluate(el =>
            Array.prototype.slice.call(el.children).map(c => c.className));
        expect(bare.length).toBe(1);
        expect(bare[0]).toContain('chat-reaction-add');
    });

    test('clicking a chip flips aria-pressed and the count, and the server agrees', async ({ page }) => {
        await openPage(page, THREAD);
        await setViewport(page, 375);

        const target = chip(page, SEEDED_MESSAGE, CHAT_REACTION_EMOJI[2]); // 9, not mine
        await expect(target).toHaveAttribute('aria-pressed', 'false');
        await expect(target.locator('.chat-reaction-count')).toHaveText('9');

        const responsePromise = page.waitForResponse(r =>
            r.url().includes(`/api/wiadomosci/messages/${SEEDED_MESSAGE}/reactions`) && r.request().method() === 'POST');
        await target.click();

        // Optimistic update lands immediately...
        await expect(target).toHaveAttribute('aria-pressed', 'true');
        await expect(target.locator('.chat-reaction-count')).toHaveText('10');

        const body = await (await responsePromise).json();
        expect(body.success).toBe(true);
        expect(body.action).toBe('added');

        // ...and still matches after the server response is folded back in
        await expect(target).toHaveAttribute('aria-pressed', 'true');
        await expect(target.locator('.chat-reaction-count')).toHaveText('10');

        // Toggle back so the shared demo state is restored for later tests
        const undo = page.waitForResponse(r =>
            r.url().includes(`/api/wiadomosci/messages/${SEEDED_MESSAGE}/reactions`) && r.request().method() === 'POST');
        await target.click();
        expect((await (await undo).json()).action).toBe('removed');
        await expect(target).toHaveAttribute('aria-pressed', 'false');
        await expect(target.locator('.chat-reaction-count')).toHaveText('9');
    });

    test('keyboard focus survives a toggle', async ({ page }) => {
        await openPage(page, THREAD);
        await setViewport(page, 375);

        const target = chip(page, SEEDED_MESSAGE, CHAT_REACTION_EMOJI[2]);
        await target.focus();
        await stashFocus(page);

        const responsePromise = page.waitForResponse(r =>
            r.url().includes('/reactions') && r.request().method() === 'POST');
        await page.keyboard.press('Enter');
        await responsePromise;
        await expect(target).toHaveAttribute('aria-pressed', 'true');

        const after = await focusSurvived(page);
        expect(after.same, describeFocus('focus after toggle', after.active)).toBe(true);
        expect(after.activeIsBody).toBe(false);

        // restore
        await page.keyboard.press('Enter');
        await expect(target).toHaveAttribute('aria-pressed', 'false');
    });

    test('keyboard focus survives a poll that repaints the strips', async ({ page }) => {
        await openPage(page, THREAD);
        await setViewport(page, 375);

        const target = chip(page, SEEDED_MESSAGE, CHAT_REACTION_EMOJI[0]);
        await target.focus();
        await stashFocus(page);

        // The page's own refresh function, called directly instead of waiting
        // 8 seconds for the interval.
        await page.evaluate(() => window.loadThreadMessages());
        await page.waitForResponse(r => r.url().includes(`/api/wiadomosci/threads/${1}`));
        await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));

        const after = await focusSurvived(page);
        expect(after.same, describeFocus('focus after poll', after.active)).toBe(true);
        expect(after.activeIsBody).toBe(false);
    });

    test('keyboard focus survives the real 8 second poll', async ({ page }) => {
        test.slow(); // deliberately waits for the app's own interval
        await openPage(page, THREAD);
        await setViewport(page, 375);

        const target = chip(page, SEEDED_MESSAGE, CHAT_REACTION_EMOJI[0]);
        await target.focus();
        await stashFocus(page);

        // wiadomosci.html polls loadThreadMessages() every 8000ms
        await page.waitForResponse(r => r.url().includes('/api/wiadomosci/threads/1'), { timeout: 20000 });
        await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));

        const after = await focusSurvived(page);
        expect(after.same, describeFocus('focus after the real poll', after.active)).toBe(true);
    });

    test('un-reacting the last holder removes the chip and moves focus to the add button', async ({ page }) => {
        await openPage(page, THREAD);
        await setViewport(page, 375);

        // The first seeded emoji has count 1 and is mine, so un-reacting
        // deletes the chip the user is standing on.
        const solo = chip(page, SEEDED_MESSAGE, CHAT_REACTION_EMOJI[0]);
        await expect(solo).toHaveAttribute('aria-pressed', 'true');
        await expect(solo.locator('.chat-reaction-count')).toHaveText('1');

        await solo.focus();
        const responsePromise = page.waitForResponse(r =>
            r.url().includes('/reactions') && r.request().method() === 'POST');
        await page.keyboard.press('Enter');
        await responsePromise;

        await expect(solo).toHaveCount(0);
        const active = await activeDescription(page);
        expect(active.isBody, describeFocus('focus after the chip vanished', active)).toBe(false);
        expect(active.cls, describeFocus('focus after the chip vanished', active)).toContain('chat-reaction-add');
        expect(active.messageId).toBe(String(SEEDED_MESSAGE));

        // restore the seeded state
        const undo = page.waitForResponse(r => r.url().includes('/reactions') && r.request().method() === 'POST');
        await page.keyboard.press('Enter'); // focus is on the add button -> opens the sheet
        await page.locator(`#reactionSheetGrid .reaction-sheet-btn[data-emoji="${CHAT_REACTION_EMOJI[0]}"]`).click();
        await undo;
        await page.keyboard.press('Escape');
        await expect(chip(page, SEEDED_MESSAGE, CHAT_REACTION_EMOJI[0])).toHaveAttribute('aria-pressed', 'true');
    });

    test('pressed state is distinguishable without colour and does not change the box size', async ({ page }) => {
        await openPage(page, THREAD);
        await setViewport(page, 375);

        const pressed = chip(page, SEEDED_MESSAGE, CHAT_REACTION_EMOJI[1]); // mine
        const unpressed = chip(page, SEEDED_MESSAGE, CHAT_REACTION_EMOJI[2]); // not mine
        await expect(pressed).toHaveAttribute('aria-pressed', 'true');
        await expect(unpressed).toHaveAttribute('aria-pressed', 'false');

        const a = await nonColorSignature(pressed);
        const b = await nonColorSignature(unpressed);
        expect(signatureKey(a), 'pressed must differ from unpressed WITHOUT relying on colour:\n' +
            describeSignature('pressed  ', a) + '\n' + describeSignature('unpressed', b))
            .not.toBe(signatureKey(b));
        // The specific cue the CSS promises: a thicker border plus an inset ring
        expect(a.borderWidth).toContain('2px');
        expect(b.borderWidth).toContain('1px');
        expect(a.boxShadow).toContain('inset');

        // Toggling must not reflow the strip: the extra border width is paid
        // for out of the padding. Measured on the count-2 chip, which goes
        // 2 -> 1: same number of digits, and tabular-nums makes digits equal
        // width, so any size change left is the border/padding compensation.
        const before = (await nonColorSignature(pressed)).box;
        const responsePromise = page.waitForResponse(r => r.url().includes('/reactions'));
        await pressed.click();
        await responsePromise;
        await expect(pressed).toHaveAttribute('aria-pressed', 'false');
        await expect(pressed.locator('.chat-reaction-count')).toHaveText('1');
        const after = (await nonColorSignature(pressed)).box;
        expect(Math.abs(after.width - before.width), `box width ${before.width} -> ${after.width}`).toBeLessThanOrEqual(0.5);
        expect(Math.abs(after.height - before.height), `box height ${before.height} -> ${after.height}`).toBeLessThanOrEqual(0.5);

        // restore
        const undo = page.waitForResponse(r => r.url().includes('/reactions'));
        await pressed.click();
        await undo;
        await expect(pressed).toHaveAttribute('aria-pressed', 'true');
        await expect(pressed.locator('.chat-reaction-count')).toHaveText('2');
    });

    test('chip text and border clear the WCAG contrast floors', async ({ page }) => {
        await openPage(page, THREAD);
        await setViewport(page, 375);

        const unpressed = chip(page, SEEDED_MESSAGE, CHAT_REACTION_EMOJI[2]);
        const text = await measureContrast(unpressed);
        expect(text.ratio, `chip text ${text.color} on ${text.background} = ${text.ratio}:1`)
            .toBeGreaterThanOrEqual(requiredRatio(text));

        const border = await measureBorderContrast(unpressed);
        expect(border.ratio, `chip border ${border.borderColor} on ${border.surface} = ${border.ratio}:1`)
            .toBeGreaterThanOrEqual(3);

        const pressed = chip(page, SEEDED_MESSAGE, CHAT_REACTION_EMOJI[1]);
        const pressedText = await measureContrast(pressed);
        expect(pressedText.ratio, `pressed chip text ${pressedText.color} on ${pressedText.background} = ${pressedText.ratio}:1`)
            .toBeGreaterThanOrEqual(requiredRatio(pressedText));
    });

    test('no response ever carries a reactor identity', async ({ page }) => {
        await openPage(page, THREAD);
        await setViewport(page, 375);

        const threadResponse = await page.waitForResponse(async r => {
            if (!r.url().includes('/api/wiadomosci/threads/1')) return false;
            return true;
        }, { timeout: 20000 }).catch(() => null);

        // Fetch it directly too, so the assertion does not depend on catching a poll
        const threadBody = await page.evaluate(() =>
            fetch('/api/wiadomosci/threads/1').then(r => r.json()));

        expect(identityKeys(threadBody), 'thread payload must not name anyone: ' +
            JSON.stringify(identityKeys(threadBody))).toEqual([]);
        threadBody.messages.forEach(m => {
            expect(Object.keys(m).sort()).toEqual(['body', 'createdAt', 'fromMe', 'id', 'reactions']);
            m.reactions.forEach(r => {
                expect(Object.keys(r).sort(), 'a reaction may only expose emoji/count/mine')
                    .toEqual(['count', 'emoji', 'mine']);
            });
        });

        const toggleBody = await page.evaluate((id) =>
            fetch(`/api/wiadomosci/messages/${id}/reactions`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ emoji: '😮' })
            }).then(r => r.json()), SEEDED_MESSAGE);

        expect(identityKeys(toggleBody), 'toggle payload must not name anyone: ' +
            JSON.stringify(identityKeys(toggleBody))).toEqual([]);
        toggleBody.reactions.forEach(r => {
            expect(Object.keys(r).sort()).toEqual(['count', 'emoji', 'mine']);
        });
        expect(threadResponse === null || threadResponse.ok()).toBeTruthy();

        // restore
        await page.evaluate((id) =>
            fetch(`/api/wiadomosci/messages/${id}/reactions`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ emoji: '😮' })
            }).then(r => r.json()), SEEDED_MESSAGE);
    });

    test('the picker opens on the add button, traps Tab, and Escape returns focus', async ({ page }) => {
        await openPage(page, THREAD);
        await setViewport(page, 375);

        const add = addButton(page, BARE_MESSAGE);
        const sheet = page.locator('#reactionSheet');
        await expect(sheet).toHaveAttribute('aria-hidden', 'true');

        await add.focus();
        await page.keyboard.press('Enter');

        await expect(sheet).not.toHaveAttribute('aria-hidden', 'true');
        await expect(sheet).toHaveClass(/is-open/);
        await expect(page.locator('#reactionSheetOverlay')).toHaveClass(/is-open/);

        // Focus lands on the first emoji, not on "Zamknij"
        const landed = await activeDescription(page);
        expect(landed.cls, describeFocus('focus on open', landed)).toContain('reaction-sheet-btn');

        // Tab stays inside
        for (let i = 0; i < 9; i++) {
            await page.keyboard.press('Tab');
            const inside = await page.evaluate(() =>
                document.getElementById('reactionSheet').contains(document.activeElement));
            expect(inside, `Tab #${i + 1} escaped the picker`).toBe(true);
        }

        await page.keyboard.press('Escape');
        await expect(sheet).toHaveAttribute('aria-hidden', 'true');
        const returned = await activeDescription(page);
        expect(returned.cls, describeFocus('focus after Escape', returned)).toContain('chat-reaction-add');
        expect(returned.messageId).toBe(String(BARE_MESSAGE));
    });

    test('a six-chip strip does not push the message list sideways at 320px', async ({ page }) => {
        await openPage(page, THREAD);
        await setViewport(page, 320);

        // Fill one message with every allowed emoji - the widest a strip gets.
        for (const emoji of CHAT_REACTION_EMOJI) {
            await page.evaluate(([id, e]) =>
                fetch(`/api/wiadomosci/messages/${id}/reactions`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ emoji: e })
                }).then(r => r.json()), [BARE_MESSAGE, emoji]);
        }
        await page.evaluate(() => window.loadThreadMessages());
        await expect(strip(page, BARE_MESSAGE).locator('.chat-reaction-chip')).toHaveCount(6);

        const report = await collectOverflow(page, { container: '#chatMessages' });
        expect(describeOverflow('chat list with 6 chips', report)).not.toMatch(/overflows by/);
        const page_report = await collectOverflow(page);
        expect(page_report.scrollers, JSON.stringify(page_report.scrollers)).toEqual([]);
        expect(page_report.rootScroll.delta).toBeLessThanOrEqual(0.5);

        // restore
        for (const emoji of CHAT_REACTION_EMOJI) {
            await page.evaluate(([id, e]) =>
                fetch(`/api/wiadomosci/messages/${id}/reactions`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ emoji: e })
                }).then(r => r.json()), [BARE_MESSAGE, emoji]);
        }
    });
});
