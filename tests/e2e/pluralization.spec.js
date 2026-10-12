'use strict';
/**
 * Polish plurals, asserted twice: directly against the shared helpers, and
 * end-to-end against what the leaderboard and activity pages actually render
 * for the counts seeded in DEMO_MODE.
 *
 * The boundaries that matter in Polish: `one` only for 1, `few` for n%10 in
 * 2..4 unless n%100 is 12..14, `many` otherwise. 12 / 22 / 112 are the cases a
 * naive implementation gets wrong.
 */
const { test, expect } = require('../fixtures');
const { openPage, setViewport } = require('../helpers/pages');
const { plForm, plPlural, plCount } = require('../../public/pluralize-pl');
const { notificationText } = require('../../public/notification-text');

const LEADERBOARD = { path: '/leaderboard.html', name: 'leaderboard', ready: '.activity-card' };
const ACTIVITY = { path: '/activity', name: 'activity', ready: '.notification-item' };

test.describe('pluralize-pl (shared helper, no browser needed)', () => {
    test('plForm picks the CLDR category at every boundary', () => {
        expect(plForm(0)).toBe('many');
        expect(plForm(1)).toBe('one');
        expect(plForm(2)).toBe('few');
        expect(plForm(5)).toBe('many');
        expect(plForm(12)).toBe('many');
        expect(plForm(22)).toBe('few');
        expect(plForm(112)).toBe('many');
        expect(plForm(1.5)).toBe('other');
    });

    test('plCount renders the agreeing noun and adjective forms', () => {
        const gift = n => plCount(n, 'prezent', 'prezenty', 'prezentów');
        expect(gift(1)).toBe('1 prezent');
        expect(gift(2)).toBe('2 prezenty');
        expect(gift(5)).toBe('5 prezentów');
        expect(gift(12)).toBe('12 prezentów');
        expect(gift(22)).toBe('22 prezenty');
        expect(gift(112)).toBe('112 prezentów');
        expect(gift(0)).toBe('0 prezentów');

        const bought = n => plCount(n, 'kupiony', 'kupione', 'kupionych');
        expect(bought(1)).toBe('1 kupiony');
        expect(bought(2)).toBe('2 kupione');
        expect(bought(5)).toBe('5 kupionych');
        expect(bought(12)).toBe('12 kupionych');
        expect(bought(22)).toBe('22 kupione');
        expect(bought(112)).toBe('112 kupionych');

        const reserved = n => plCount(n, 'zarezerwowany', 'zarezerwowane', 'zarezerwowanych');
        expect(reserved(1)).toBe('1 zarezerwowany');
        expect(reserved(2)).toBe('2 zarezerwowane');
        expect(reserved(5)).toBe('5 zarezerwowanych');
        expect(reserved(112)).toBe('112 zarezerwowanych');

        const people = n => plCount(n, 'osoba', 'osoby', 'osób');
        expect(people(1)).toBe('1 osoba');
        expect(people(2)).toBe('2 osoby');
        expect(people(5)).toBe('5 osób');
        expect(people(22)).toBe('22 osoby');

        expect(plPlural(1, 'aktywność', 'aktywności', 'aktywności')).toBe('aktywność');
        expect(plPlural(2, 'aktywność', 'aktywności', 'aktywności')).toBe('aktywności');
        expect(plPlural(5, 'aktywność', 'aktywności', 'aktywności')).toBe('aktywności');
    });
});

test.describe('notification-text (shared helper, no browser needed)', () => {
    const data = { presentTitle: 'Ksiazka', recipientName: 'Tomek', count: 5 };
    const plain = (type, d, actor, opts) =>
        notificationText(type, d || data, actor === undefined ? 'Monika' : actor,
            Object.assign({ html: false }, opts || {}));

    test('every known type has its wording, and the default catches the rest', () => {
        // Emoji were deliberately removed - the notification UI already shows a
        // per-type icon. These assertions must stay emoji-free.
        expect(plain('recipient_added')).toBe('Monika dodaje nową osobę: Tomek');
        expect(plain('present_added')).toBe('Monika dodaje prezent „Ksiazka” dla: Tomek');
        expect(plain('present_reserved')).toBe('Monika rezerwuje „Ksiazka” dla: Tomek');
        expect(plain('present_unreserved')).toBe('Monika rezygnuje z rezerwacji „Ksiazka” dla: Tomek');
        expect(plain('present_checked')).toBe('Monika kupuje „Ksiazka” dla: Tomek');
        expect(plain('present_unchecked')).toBe('Monika cofa oznaczenie „kupione” przy „Ksiazka” dla: Tomek');
        expect(plain('present_added_batch')).toBe('Monika dodaje 5 prezentów dla: Tomek');
        expect(plain('leaderboard_leader')).toBe('Monika coś zmienia');
        expect(plain('anon_message')).toBe('Monika coś zmienia');
        expect(plain('totally_made_up')).toBe('Monika coś zmienia');

        for (const text of [plain('present_added'), plain('present_added_batch'), plain('totally_made_up')]) {
            expect(text, 'notification wording must not contain emoji').not.toMatch(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u);
        }
    });

    test('batch wording pluralises the count', () => {
        const batch = n => plain('present_added_batch', { count: n, recipientName: 'Tomek' });
        expect(batch(1)).toBe('Monika dodaje 1 prezent dla: Tomek');
        expect(batch(2)).toBe('Monika dodaje 2 prezenty dla: Tomek');
        expect(batch(5)).toBe('Monika dodaje 5 prezentów dla: Tomek');
        expect(batch(12)).toBe('Monika dodaje 12 prezentów dla: Tomek');
        expect(batch(22)).toBe('Monika dodaje 22 prezenty dla: Tomek');
        expect(batch(112)).toBe('Monika dodaje 112 prezentów dla: Tomek');
    });

    test('actor fallback, dla: suppression, escaping and showActor:false', () => {
        expect(plain('present_added', data, null)).toBe('Ktoś dodaje prezent „Ksiazka” dla: Tomek');
        // Own list: no " dla: X" suffix
        expect(plain('present_added', { presentTitle: 'X', recipientName: 'Monika' }))
            .toBe('Monika dodaje prezent „X”');
        expect(plain('present_added', { presentTitle: 'X', recipientName: '  monika ' }))
            .toBe('Monika dodaje prezent „X”');
        expect(plain('recipient_added', {})).toBe('Monika dodaje nową osobę');
        expect(plain('present_added', data, 'Monika', { showActor: false }))
            .toBe('dodaje prezent „Ksiazka” dla: Tomek');

        const html = notificationText('present_added', { presentTitle: 'a&b<c>d"e\'f' }, 'Monika');
        expect(html).toContain('a&amp;b&lt;c&gt;d&quot;e&#39;f');
        expect(html).not.toContain('<c>');
    });
});

test.describe('pluralization in the real UI', () => {
    test('leaderboard renders every bought/reserved boundary', async ({ page }) => {
        await openPage(page, LEADERBOARD);
        await setViewport(page, 375);

        const stats = await page.locator('.activity-card').evaluateAll(cards =>
            cards.map(card => ({
                name: card.querySelector('.activity-name').textContent.trim(),
                stats: Array.prototype.slice.call(card.querySelectorAll('.activity-stat'))
                    .map(s => s.textContent.replace(/\s+/g, ' ').trim()),
                scoreLabel: card.querySelector('.activity-score-label').textContent.trim(),
                scoreValue: card.querySelector('.activity-score-value').textContent.trim()
            })));

        const all = stats.flatMap(s => s.stats).join(' || ');
        for (const expected of [
            '1 kupiony', '2 kupione', '5 kupionych', '12 kupionych', '22 kupione', '112 kupionych',
            '1 zarezerwowany', '2 zarezerwowane', '5 zarezerwowanych', '12 zarezerwowanych',
            '22 zarezerwowane', '112 zarezerwowanych',
            '0 kupionych', '0 zarezerwowanych'
        ]) {
            expect(all, `leaderboard must render "${expected}"`).toContain(expected);
        }

        // The visually-hidden noun must agree with the count too
        for (const expected of [
            '1 kupiony prezent', '2 kupione prezenty', '5 kupionych prezentów',
            '12 kupionych prezentów', '22 kupione prezenty', '112 kupionych prezentów'
        ]) {
            expect(all, `accessible name must read "${expected}"`).toContain(expected);
        }

        const labels = stats.map(s => s.scoreValue + ' ' + s.scoreLabel);
        expect(labels, 'total 1 -> "1 aktywność"').toContain('1 aktywność');
        expect(labels, 'total 2 -> "2 aktywności"').toContain('2 aktywności');
        expect(labels.some(l => /^(\d+) aktywności$/.test(l) && Number(RegExp.$1) >= 5),
            'a total of 5+ must read "aktywności": ' + labels.join(', ')).toBe(true);
    });

    test('leaderboard total-presents counts pluralise in the ranking list', async ({ page }) => {
        await openPage(page, LEADERBOARD);
        await setViewport(page, 375);

        const texts = await page.locator('#usersList .user-card').evaluateAll(cards =>
            cards.map(c => c.querySelector('.user-stats').textContent.replace(/\s+/g, ' ').trim()));
        const joined = texts.join(' || ');
        for (const expected of ['1 prezent', '2 prezenty', '5 prezentów', '12 prezentów', '22 prezenty', '112 prezentów']) {
            expect(joined, `ranking list must render "${expected}"`).toContain(expected);
        }
    });

    test('the two leaderboard stats sit on separate lines on a phone and share one on a tablet', async ({ page }) => {
        await openPage(page, LEADERBOARD);

        // 320px: the user's "awkward" complaint - each stat on its own line,
        // separator hidden.
        await setViewport(page, 320);
        const phone = await page.locator('.activity-card').first().evaluate(card => {
            const stats = Array.prototype.slice.call(card.querySelectorAll('.activity-stat'));
            const sep = card.querySelector('.activity-stat-sep');
            return {
                tops: stats.map(s => Math.round(s.getBoundingClientRect().top)),
                sepDisplay: sep ? getComputedStyle(sep).display : null,
                whiteSpace: stats.map(s => getComputedStyle(s).whiteSpace)
            };
        });
        expect(phone.tops.length).toBe(2);
        expect(phone.tops[0], 'stats must not share a line at 320px').not.toBe(phone.tops[1]);
        expect(phone.sepDisplay).toBe('none');
        // A count must never be split from its adjective
        phone.whiteSpace.forEach(ws => expect(ws).toBe('nowrap'));

        await setViewport(page, 768);
        const tablet = await page.locator('.activity-card').first().evaluate(card => {
            const stats = Array.prototype.slice.call(card.querySelectorAll('.activity-stat'));
            const sep = card.querySelector('.activity-stat-sep');
            return {
                tops: stats.map(s => Math.round(s.getBoundingClientRect().top)),
                sepDisplay: sep ? getComputedStyle(sep).display : null
            };
        });
        expect(tablet.tops[0], 'stats should share a line at 768px').toBe(tablet.tops[1]);
        expect(tablet.sepDisplay).not.toBe('none');
    });

    test('the hidden agreeing noun costs no layout width', async ({ page }) => {
        await openPage(page, LEADERBOARD);
        await setViewport(page, 320);
        const noun = page.locator('.activity-stat-noun').first();
        const box = await noun.evaluate(el => {
            const r = el.getBoundingClientRect();
            const s = getComputedStyle(el);
            return { width: r.width, height: r.height, position: s.position, clip: s.clipPath || s.clip };
        });
        expect(box.width).toBeLessThanOrEqual(1);
        expect(box.height).toBeLessThanOrEqual(1);
    });

    test('activity feed pluralises the collapsed burst and the batch entries', async ({ page }) => {
        await openPage(page, ACTIVITY);
        await setViewport(page, 375);

        const messages = await page.locator('.notification-message').evaluateAll(nodes =>
            nodes.map(n => n.textContent.replace(/\s+/g, ' ').trim()));
        const joined = messages.join(' || ');

        // The seeded burst is 5 consecutive present_added by one actor for one
        // recipient, which activity.html collapses.
        expect(joined, 'collapsed burst must read "dodaje 5 prezentów"').toContain('dodaje 5 prezentów');
        for (const expected of [
            'dodaje 1 prezent ', 'dodaje 2 prezenty ', 'dodaje 12 prezentów ',
            'dodaje 22 prezenty ', 'dodaje 112 prezentów '
        ]) {
            expect(joined + ' ', `activity must render "${expected.trim()}"`).toContain(expected);
        }
    });
});
