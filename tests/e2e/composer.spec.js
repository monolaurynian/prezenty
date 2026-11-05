/**
 * The chat composer (pill field, GIF pill / send arrow) and the GIF panel
 * that docks to the bottom of the screen on phones.
 *
 * Locked in here:
 *  - empty field: the GIF pill; text: the round send arrow (never both);
 *  - the field grows with the text up to a cap and Enter still sends;
 *  - on a phone the GIF panel is docked, does not dim the chat, can be
 *    expanded with the chevron, and the newest messages stay visible above
 *    it; closing puts the page back;
 *  - touch targets are >= 44px and nothing overflows sideways.
 *
 * Uses the demo GIF provider (local files), so no key and no network.
 */
const { test, expect } = require('../fixtures');
const { openPage, setViewport } = require('../helpers/pages');
const { collectOverflow } = require('../helpers/overflow');

const GROUP = { path: '/wiadomosci?rozmowa=group', name: 'group chat', ready: '.chat-bubble' };
const SHEET = '#gifSheet';

async function openComposer(page, width) {
    await setViewport(page, width || 375, 740);
    await openPage(page, GROUP);
    await expect(page.locator('#gifBtn')).toBeVisible();
}

const box = (page, selector) => page.locator(selector).evaluate(el => {
    const r = el.getBoundingClientRect();
    return { top: r.top, bottom: r.bottom, left: r.left, right: r.right, width: r.width, height: r.height };
});

test.describe('composer', () => {
    test('empty: the GIF pill; typing swaps it for the send arrow; clearing swaps back', async ({ page }) => {
        await openComposer(page);
        const field = page.locator('#replyBody');
        await expect(field).toHaveAttribute('aria-label', 'Twoja wiadomość');
        await expect(page.locator('#gifBtn')).toBeVisible();
        await expect(page.locator('#replyBtn')).toBeHidden();

        await field.fill('Cześć!');
        await expect(page.locator('#replyBtn')).toBeVisible();
        await expect(page.locator('#replyBtn')).toBeEnabled();
        await expect(page.locator('#gifBtn')).toBeHidden();

        await field.fill('');
        await expect(page.locator('#gifBtn')).toBeVisible();
        await expect(page.locator('#replyBtn')).toBeHidden();
    });

    test('spaces and new lines alone do not count as a message', async ({ page }) => {
        await openComposer(page);
        await page.locator('#replyBody').fill('   \n  ');
        await expect(page.locator('#gifBtn')).toBeVisible();
        await expect(page.locator('#replyBtn')).toBeHidden();
    });

    test('the field grows with the text up to a cap, then shrinks back', async ({ page }) => {
        await openComposer(page);
        const field = page.locator('#replyBody');
        const one = (await box(page, '#replyBody')).height;
        await field.fill('a\nb\nc');
        const three = (await box(page, '#replyBody')).height;
        expect(three).toBeGreaterThan(one);
        await field.fill(Array.from({ length: 30 }, (_, i) => `linia ${i}`).join('\n'));
        const many = (await box(page, '#replyBody')).height;
        expect(many).toBeLessThanOrEqual(133);
        expect(many).toBeGreaterThanOrEqual(three);
        await field.fill('');
        expect((await box(page, '#replyBody')).height).toBeLessThanOrEqual(one + 1);
    });

    test('Enter sends, Shift+Enter makes a new line, and the composer goes back to the GIF pill', async ({ page }) => {
        await openComposer(page);
        const field = page.locator('#replyBody');
        await field.fill('pierwsza');
        await field.press('Shift+Enter');
        await field.pressSequentially('druga');
        expect(await field.inputValue()).toBe('pierwsza\ndruga');

        const sent = page.waitForResponse(r => /\/api\/wiadomosci\/group$/.test(r.url()) && r.request().method() === 'POST');
        await field.press('Enter');
        expect((await sent).status()).toBe(200);
        await expect(field).toHaveValue('');
        await expect(page.locator('#gifBtn')).toBeVisible();
        await expect(page.locator('#replyBtn')).toBeHidden();
    });

    test('the send arrow sends too', async ({ page }) => {
        await openComposer(page);
        await page.locator('#replyBody').fill('przez strzałkę');
        const sent = page.waitForResponse(r => /\/api\/wiadomosci\/group$/.test(r.url()) && r.request().method() === 'POST');
        await page.locator('#replyBtn').click();
        expect((await sent).status()).toBe(200);
        await expect(page.locator('#replyBody')).toHaveValue('');
    });

    test('the buttons have names and are at least 44px', async ({ page }) => {
        await openComposer(page);
        await expect(page.locator('#gifBtn')).toHaveAttribute('aria-label', 'Wyślij GIF');
        const gif = await box(page, '#gifBtn');
        expect(gif.height).toBeGreaterThanOrEqual(44);
        expect(gif.width).toBeGreaterThanOrEqual(44);
        await page.locator('#replyBody').fill('x');
        await expect(page.locator('#replyBtn')).toHaveAccessibleName(/wyślij/i);
        const send = await box(page, '#replyBtn');
        expect(send.height).toBeGreaterThanOrEqual(44);
        expect(send.width).toBeGreaterThanOrEqual(44);
    });

    for (const width of [320, 375, 768, 1024]) {
        test(`no horizontal overflow at ${width}px, empty and with a long text`, async ({ page }) => {
            await openComposer(page, width);
            for (const text of ['', 'bardzo-długie-słowo-bez-spacji-'.repeat(8)]) {
                await page.locator('#replyBody').fill(text);
                const report = await collectOverflow(page);
                expect(report.rootScroll.delta, JSON.stringify(report.rootScroll)).toBeLessThanOrEqual(0.5);
                expect(report.offenders, JSON.stringify(report.offenders)).toEqual([]);
                const c = await box(page, '#composer');
                expect(c.right).toBeLessThanOrEqual(width + 0.5);
                expect(c.left).toBeGreaterThanOrEqual(-0.5);
            }
        });
    }
});

// The "Wyślij anonimową wiadomość" card uses the very same composer
test.describe('new-message card composer', () => {
    const LIST = { path: '/wiadomosci', name: 'chat list', ready: '.thread-row' };

    async function openList(page, width) {
        await setViewport(page, width || 375, 740);
        await openPage(page, LIST);
        await expect(page.locator('#gifComposeBtn')).toBeVisible();
    }

    test('it is the same pill composer: GIF pill while empty, round send arrow once there is text', async ({ page }) => {
        await openList(page);
        await expect(page.locator('#composeComposer .composer-field')).toBeVisible();
        await expect(page.locator('#composeBody')).toHaveAttribute('aria-label', 'Twoja wiadomość');
        await expect(page.locator('#composeBtn')).toBeHidden();

        await page.locator('#composeBody').fill('Jaki rozmiar buta?');
        await expect(page.locator('#composeBtn')).toBeVisible();
        await expect(page.locator('#composeBtn')).toBeEnabled();
        await expect(page.locator('#composeBtn')).toHaveAccessibleName('Wyślij anonimowo');
        await expect(page.locator('#gifComposeBtn')).toBeHidden();
        const send = await box(page, '#composeBtn');
        expect(send.width).toBeGreaterThanOrEqual(44);
        expect(send.height).toBeGreaterThanOrEqual(44);

        await page.locator('#composeBody').fill('');
        await expect(page.locator('#gifComposeBtn')).toBeVisible();
        await expect(page.locator('#composeBtn')).toBeHidden();
    });

    test('the field grows with the text like in a conversation', async ({ page }) => {
        await openList(page);
        const one = (await box(page, '#composeBody')).height;
        await page.locator('#composeBody').fill('a\nb\nc\nd');
        expect((await box(page, '#composeBody')).height).toBeGreaterThan(one);
    });

    test('without a recipient it says so instead of sending, and keeps the text', async ({ page }) => {
        await openList(page);
        await page.locator('#composeBody').fill('Bez odbiorcy');
        await page.locator('#composeBtn').click();
        await expect(page.locator('.toast.show .toast-body')).toContainText('Wybierz odbiorcę');
        await expect(page.locator('#composeBody')).toHaveValue('Bez odbiorcy');
    });

    test('Enter sends to the group chat and opens it; the card is empty again afterwards', async ({ page }) => {
        await openList(page);
        await page.locator('#targetSelect').selectOption('group');
        const text = 'Z karty ' + Date.now();
        await page.locator('#composeBody').fill(text);
        const sent = page.waitForResponse(r => /\/api\/wiadomosci\/group$/.test(r.url()) && r.request().method() === 'POST');
        await page.locator('#composeBody').press('Enter');
        expect((await sent).status()).toBe(200);
        await expect(page).toHaveURL(/rozmowa=group/);
        await expect(page.locator('.chat-bubble', { hasText: text }).last()).toBeVisible();
        await page.goBack();
        await expect(page.locator('#composeBody')).toHaveValue('');
        await expect(page.locator('#gifComposeBtn')).toBeVisible();
    });

    for (const width of [320, 375, 768, 1024]) {
        test(`the card causes no horizontal overflow at ${width}px`, async ({ page }) => {
            await openList(page, width);
            for (const text of ['', 'bardzo-długie-słowo-bez-spacji-'.repeat(8)]) {
                await page.locator('#composeBody').fill(text);
                const report = await collectOverflow(page);
                expect(report.rootScroll.delta, JSON.stringify(report.rootScroll)).toBeLessThanOrEqual(0.5);
                expect(report.offenders, JSON.stringify(report.offenders)).toEqual([]);
            }
        });
    }
});

test.describe('GIF panel header', () => {
    for (const width of [320, 375, 768, 1024]) {
        test(`at ${width}px the X keeps a clear gap above the search field and is still a 44px target`, async ({ page }) => {
            await openComposer(page, width);
            await page.locator('#gifBtn').click();
            await expect(page.locator(SHEET)).toHaveClass(/is-open/);
            await expect(page.locator(`${SHEET} .gif-sheet-item`).first()).toBeVisible();
            await page.waitForTimeout(400);   // the panel finishes sliding / scaling
            const close = await box(page, `${SHEET} .gif-sheet-close`);
            const search = await box(page, `${SHEET} .gif-sheet-searchbox`);
            expect(close.width).toBeGreaterThanOrEqual(44);
            expect(close.height).toBeGreaterThanOrEqual(44);
            // The drawn circle is 36px inside the 44px target (4px each side),
            // so the visible gap is at least this much
            const visibleGap = search.top - close.bottom + 4;
            expect(visibleGap, JSON.stringify({ close, search })).toBeGreaterThanOrEqual(12);
        });
    }
});

test.describe('GIF panel on a phone', () => {
    test('docked at the bottom, no dimming, compact first; the chevron expands and collapses it', async ({ page }) => {
        await openComposer(page, 375);
        await page.locator('#gifBtn').click();
        await expect(page.locator(SHEET)).toHaveClass(/is-open/);
        await expect(page.locator(`${SHEET} .gif-sheet-item`).first()).toBeVisible();

        await expect.poll(async () => Math.round((await box(page, SHEET)).bottom)).toBe(740);   // (it slides up)
        const compact = await box(page, SHEET);
        expect(compact.height).toBeLessThanOrEqual(740 * 0.5 + 1);
        expect(await page.locator('#gifSheetOverlay').evaluate(el => getComputedStyle(el).backgroundColor))
            .toMatch(/rgba\(0, 0, 0, 0\)|transparent/);
        await expect(page.locator('html')).toHaveClass(/gif-panel-open/);

        const chevron = page.locator(`${SHEET} .gif-sheet-expand`);
        await expect(chevron).toBeVisible();
        await expect(chevron).toHaveAttribute('aria-expanded', 'false');
        expect((await box(page, `${SHEET} .gif-sheet-expand`)).height).toBeGreaterThanOrEqual(44);
        await chevron.click();
        await expect(chevron).toHaveAttribute('aria-expanded', 'true');
        await expect(page.locator(SHEET)).toHaveClass(/is-expanded/);
        await expect.poll(async () => (await box(page, SHEET)).height).toBeGreaterThan(compact.height + 100);
        await chevron.click();
        await expect(chevron).toHaveAttribute('aria-expanded', 'false');
        await expect.poll(async () => Math.round((await box(page, SHEET)).height)).toBe(Math.round(compact.height));
    });

    test('the newest message stays visible above the panel, and closing puts the composer back', async ({ page }) => {
        await openComposer(page, 375);
        await page.locator('#gifBtn').click();
        await expect(page.locator(SHEET)).toHaveClass(/is-open/);
        await expect(page.locator(`${SHEET} .gif-sheet-item`).first()).toBeVisible();
        await page.waitForTimeout(500); // the page scrolls while the panel slides up

        const panelTop = (await box(page, SHEET)).top;
        const last = await page.locator('.chat-msg-row').last().evaluate(el => el.getBoundingClientRect().bottom);
        expect(last, 'newest message must end above the panel').toBeLessThanOrEqual(panelTop + 0.5);

        await page.keyboard.press('Escape');
        await expect(page.locator(SHEET)).not.toHaveClass(/is-open/);
        await expect(page.locator('html')).not.toHaveClass(/gif-panel-open/);
        await expect(page.locator('#composer')).toBeInViewport();
        expect(await page.evaluate(() => getComputedStyle(document.body).paddingBottom)).not.toBe('0px');
    });

    test('scrolling the list grows the panel first while the list stays put, then eases to expanded; scrolling back at the top shrinks it', async ({ page }) => {
        await openComposer(page, 375);
        await page.locator('#gifBtn').click();
        await expect(page.locator(`${SHEET} .gif-sheet-item`).first()).toBeVisible();
        await page.waitForTimeout(500);
        const compact = (await box(page, SHEET)).height;
        const list = () => page.locator(`${SHEET} .gif-sheet-results`).evaluate(el => el.scrollTop);

        await page.mouse.move(187, 600);
        await page.mouse.wheel(0, 180);   // past half way, so it settles on expanded
        await expect.poll(async () => (await box(page, SHEET)).height).toBeGreaterThan(compact + 40);
        expect(await list(), 'the list does not move while the panel is growing').toBe(0);
        await expect(page.locator(SHEET)).toHaveClass(/is-expanded/);   // eases to the nearer end on its own

        await page.mouse.wheel(0, -400);
        await expect.poll(async () => Math.round((await box(page, SHEET)).height)).toBe(Math.round(compact));
        await expect(page.locator(SHEET)).not.toHaveClass(/is-expanded/);
    });

    test('tapping the chat outside the panel closes it', async ({ page }) => {
        await openComposer(page, 375);
        await page.locator('#gifBtn').click();
        await expect(page.locator(SHEET)).toHaveClass(/is-open/);
        await page.mouse.click(187, 30);
        await expect(page.locator(SHEET)).not.toHaveClass(/is-open/);
    });

    test('choosing a GIF still needs "Wyślij GIF" in the docked panel, and sending closes it', async ({ page }) => {
        await openComposer(page, 375);
        await page.locator('#gifBtn').click();
        await page.locator(`${SHEET} .gif-sheet-item`).first().click();
        const send = page.locator(`#gifPreview .gif-sheet-send`);
        await expect(send).toBeVisible();
        const sent = page.waitForResponse(r => /\/api\/wiadomosci\/group$/.test(r.url()) && r.request().method() === 'POST');
        await send.click();
        expect((await sent).status()).toBe(200);
        await expect(page.locator(SHEET)).not.toHaveClass(/is-open/);
        await expect(page.locator('.chat-bubble.has-gif').last()).toBeVisible();
    });

    test('on a desktop screen it stays a centred card with a dimmed background and no chevron', async ({ page }) => {
        await openComposer(page, 1024);
        await page.locator('#gifBtn').click();
        await expect(page.locator(SHEET)).toHaveClass(/is-open/);
        expect(await page.locator('#gifSheetOverlay').evaluate(el => getComputedStyle(el).backgroundColor)).toBe('rgba(0, 0, 0, 0.35)');
        await expect(page.locator(`${SHEET} .gif-sheet-expand`)).toBeHidden();
        const s = await box(page, SHEET);
        expect(s.bottom).toBeLessThan(740);
        expect(Math.abs((s.left + s.right) / 2 - 512)).toBeLessThan(2);
    });

    for (const width of [320, 375, 768]) {
        test(`the open panel causes no horizontal overflow at ${width}px, compact and expanded`, async ({ page }) => {
            await openComposer(page, width);
            await page.locator('#gifBtn').click();
            await expect(page.locator(`${SHEET} .gif-sheet-item`).first()).toBeVisible();
            for (const expanded of [false, true]) {
                if (expanded) await page.locator(`${SHEET} .gif-sheet-expand`).click();
                const report = await collectOverflow(page);
                expect(report.rootScroll.delta, JSON.stringify(report.rootScroll)).toBeLessThanOrEqual(0.5);
                expect(report.offenders, JSON.stringify(report.offenders)).toEqual([]);
            }
        });
    }

    test('reduced motion: the panel still opens and closes', async ({ page }) => {
        await page.emulateMedia({ reducedMotion: 'reduce' });
        await openComposer(page, 375);
        await page.locator('#gifBtn').click();
        await expect(page.locator(SHEET)).toHaveClass(/is-open/);
        await page.keyboard.press('Escape');
        await expect(page.locator(SHEET)).not.toHaveClass(/is-open/);
    });
});
