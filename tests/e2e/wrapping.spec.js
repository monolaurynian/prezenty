'use strict';
/**
 * Polish words must never be sliced in half.
 *
 * The regression this guards: a present title rendered as "Murph / y" at
 * 320px because a container had `word-break: break-all`. Long single tokens
 * and URLs are allowed to wrap or ellipsize - they just must not overflow.
 */
const { test, expect } = require('../fixtures');
const { openPage, setViewport } = require('../helpers/pages');
const { wordBreakReport, describeBreaks } = require('../helpers/line-breaks');
const { collectOverflow, describeOverflow } = require('../helpers/overflow');

const RECIPIENTS = { path: '/recipients', name: 'recipients', ready: '.present-title, .present-name' };
const THREAD = { path: '/wiadomosci?rozmowa=1', name: 'chat thread', ready: '.chat-bubble' };

// The recipients page uses two title classes: `.present-title` for other
// people's presents and `.present-name` inside the identified-recipient
// accordion. Both hold user-entered text, so both are under test.
const TITLE = '.present-title, .present-name';

// Seeded in DEMO_MODE (server.js demoData.presents)
const POLISH_TITLE = 'Ciepły wełniany szalik w kolorze butelkowej zieleni dla Murphy';
const LONG_WORD_TITLE = 'Niezwyklenieprawdopodobnieskomplikowanazabawkaedukacyjnadladzieci';
const LONG_URL_TITLE = 'https://www.sklep-z-prezentami.example.com/katalog/zabawki/edukacyjne/zestaw-konstrukcyjny-xxl?kolor=czerwony&rozmiar=duzy&utm_source=prezenty';
const POLISH_CHAT = 'Jeszcze zastanawiam się nad ciepłym wełnianym szalikiem';

test.describe('Polish text wrapping at 320px', () => {
    test('a multi-word present title breaks only at spaces', async ({ page }) => {
        await openPage(page, RECIPIENTS);
        await setViewport(page, 320);

        const title = page.locator(TITLE, { hasText: POLISH_TITLE }).first();
        await expect(title).toBeAttached();
        const report = await wordBreakReport(title);
        expect(report.ok, describeBreaks('present title', report)).toBe(true);
        // It really does wrap at this width - otherwise the test proves nothing
        expect(report.info.lines.length, 'title should wrap at 320px: ' + JSON.stringify(report.info.lines))
            .toBeGreaterThan(1);
    });

    test('a long Polish chat message breaks only at spaces', async ({ page }) => {
        await openPage(page, THREAD);
        await setViewport(page, 320);

        const bubble = page.locator('.chat-bubble', { hasText: POLISH_CHAT }).first();
        await expect(bubble).toBeAttached();
        const report = await wordBreakReport(bubble);
        expect(report.ok, describeBreaks('chat bubble', report)).toBe(true);
        expect(report.info.lines.length).toBeGreaterThan(1);
    });

    test('word-break stays normal on the text containers that hold Polish prose', async ({ page }) => {
        await openPage(page, RECIPIENTS);
        await setViewport(page, 320);
        const presentName = await page.locator(TITLE).first()
            .evaluate(el => getComputedStyle(el).wordBreak);
        expect(presentName, '.present-name must not break words').toBe('normal');

        await openPage(page, THREAD);
        await setViewport(page, 320);
        const bubble = await page.locator('.chat-bubble').first()
            .evaluate(el => getComputedStyle(el).wordBreak);
        expect(bubble, '.chat-bubble must not break words').toBe('normal');

        await openPage(page, { path: '/leaderboard.html', name: 'leaderboard', ready: '.activity-card' });
        await setViewport(page, 320);
        const activityName = await page.locator('.activity-name').first()
            .evaluate(el => getComputedStyle(el).wordBreak);
        expect(activityName, '.activity-name must not break words').toBe('normal');
    });

    test('a 64-character single-word title may wrap but must not overflow its card', async ({ page }) => {
        await openPage(page, RECIPIENTS);
        await setViewport(page, 320);

        const title = page.locator(TITLE, { hasText: LONG_WORD_TITLE }).first();
        await expect(title).toBeAttached();

        // Breaking INSIDE this token is fine (there is nowhere else to break);
        // sticking out of the card is not.
        const card = title.locator('xpath=ancestor::*[contains(@class,"card") or contains(@class,"list-group-item")][1]');
        const cardCount = await card.count();
        const containerSelector = cardCount ? await card.first().evaluate(el => {
            el.setAttribute('data-e2e-wrap-scope', '1');
            return '[data-e2e-wrap-scope="1"]';
        }) : null;

        const report = await collectOverflow(page, { container: containerSelector || undefined });
        expect(describeOverflow('long single-word title', report)).not.toMatch(/overflows by/);
        if (containerSelector) {
            await card.first().evaluate(el => el.removeAttribute('data-e2e-wrap-scope'));
        }
    });

    test('a long URL title may break anywhere or ellipsize, but must not overflow', async ({ page }) => {
        await openPage(page, RECIPIENTS);
        await setViewport(page, 320);

        const title = page.locator(TITLE, { hasText: 'sklep-z-prezentami' }).first();
        await expect(title).toBeAttached();

        const metrics = await title.evaluate(el => {
            const r = el.getBoundingClientRect();
            const s = getComputedStyle(el);
            const parent = el.parentElement.getBoundingClientRect();
            const link = el.querySelector('a');
            return {
                wordBreak: s.wordBreak,
                overflowWrap: s.overflowWrap,
                right: r.right,
                parentRight: parent.right,
                text: el.textContent.trim(),
                href: link ? link.getAttribute('href') : null
            };
        });

        // The app renders a long URL as a link with SHORTENED display text and
        // the full address in href. Both facts are asserted so a change to
        // either is caught.
        expect(metrics.href, 'full URL must survive in the href').toBe(LONG_URL_TITLE);
        expect(metrics.text, 'display text is shortened').toMatch(/^https:\/\/www\.sklep-z-prezentami\.example\.com\/.*\.\.\.$/);
        // break-all / anywhere is explicitly ALLOWED for a URL
        expect(['normal', 'break-all', 'break-word', 'anywhere']).toContain(metrics.wordBreak);
        expect(metrics.right, 'URL title must stay inside its parent').toBeLessThanOrEqual(metrics.parentRight + 0.5);

        const report = await collectOverflow(page);
        expect(describeOverflow('long URL title page', report)).not.toMatch(/overflows by|scroller/);
    });

    test('a long single-word chat message stays inside the message list', async ({ page }) => {
        await openPage(page, THREAD);
        await setViewport(page, 320);

        const bubble = page.locator('.chat-bubble', { hasText: 'Nieprzewidywalnieskomplikowana' }).first();
        await expect(bubble).toBeAttached();

        const report = await collectOverflow(page, { container: '#chatMessages' });
        expect(describeOverflow('chat message list', report)).not.toMatch(/overflows by/);
        expect(report.scrollers, JSON.stringify(report.scrollers)).toEqual([]);
    });
});
