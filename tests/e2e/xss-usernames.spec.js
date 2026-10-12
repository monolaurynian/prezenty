'use strict';
/**
 * Stored XSS through user-controlled names.
 *
 * `GET /api/leaderboard` returns `recipients.name AS username`, and
 * `POST /api/recipients` accepts any non-empty string, so every name the
 * leaderboard and the intro page render is attacker supplied. Those pages
 * built HTML strings and handed them to innerHTML, which made the app
 * exploitable by anyone who could add a person.
 *
 * Three payloads, one per injection context, seeded at the FRONT of
 * `demoLeaderboard.users` (server.js) so that each of them lands on every
 * render path at once:
 *
 *   element content   `<img src=x onerror=...>`  - creates a real element
 *   attribute         `" onmouseover=...  x="`   - closes the attribute and
 *                                                  adds another one
 *   JS-in-attribute   `'); ...; //`              - the worst case: a bare
 *                                                  apostrophe was enough to
 *                                                  break out of the
 *                                                  onclick="f('NAME')" string
 *                                                  with no angle bracket in
 *                                                  sight
 *
 * Every assertion checks three separate things, because any one of them alone
 * can be satisfied by a broken fix:
 *   1. nothing executed (`window.__xss` is still undefined),
 *   2. nothing was created (no element inside the name, no injected handler),
 *   3. the name still DISPLAYS, character for character - a fix that strips
 *      or mangles names is not a fix.
 */
const { test, expect } = require('../fixtures');
const { openPage, setViewport } = require('../helpers/pages');
const { escapeHtml, escapeAttr, safeImageSrc } = require('../../public/escape-html.js');

// Seeded in DEMO_MODE - see demoLeaderboard.users in server.js.
const ELEMENT_PAYLOAD = 'Ola <img src=x onerror=window.__xss=1> Z';
const ATTR_PAYLOAD = 'Ala" onmouseover=window.__xss=1 x="';
const JS_PAYLOAD = "O'Brien'); window.__xss=1; //";
const PAYLOADS = [ELEMENT_PAYLOAD, ATTR_PAYLOAD, JS_PAYLOAD];

// id 10 is the only payload row with a picture, and it is a legitimate
// same-origin path, so the <img> branch (and its alt=) is exercised for real.
const PAYLOAD_WITH_PICTURE = ATTR_PAYLOAD;
const PAYLOAD_PICTURE_URL = '/images/default-avatar.svg';
// id 9 carries a javascript: URL, which safeImageSrc must reject.
const PAYLOAD_WITH_BAD_PICTURE = ELEMENT_PAYLOAD;

// Already-seeded fixtures, full of HTML specials. Used where a payload cannot
// reach: intro.html's "4-10" list only ever shows rows below the top three.
const NASTY_NAME = 'Zuzia & "Zuza" <mała> \'Z\'';
const NASTY_TITLE = 'Zestaw <script>alert(1)</script> & "mega" \'mini\'';

const LEADERBOARD = { path: '/leaderboard.html', name: 'leaderboard', ready: '#usersList .user-card' };
// /intro.html is served by express.static and is not in helpers/pages PAGES on
// purpose: adding it there would enlist it in the overflow / a11y / smoke
// matrices, which is a different task.
const INTRO = { path: '/intro.html', name: 'intro', ready: '#stepsContainer' };

/**
 * The intro page is a multi-step wizard and only fetches the leaderboard on
 * the last step. Clicking through five marketing slides is not what this test
 * is about, so the page's own transition is invoked directly - the render path
 * that follows is identical.
 */
async function openIntroLeaderboard(page) {
    await openPage(page, INTRO);
    await setViewport(page, 375);
    await page.evaluate(() => showLeaderboard());
    await expect(page.locator('#podium .podium-name').first(),
        'the intro leaderboard must render').toBeAttached();
}
const ACTIVITY = { path: '/activity', name: 'activity', ready: '.notification-item' };
const OSOBY = { path: '/osoby', name: 'osoby', ready: '#peopleContent .present-row' };

/** Has any payload managed to run? */
function noExecution(page) {
    return page.evaluate(() => window.__xss === undefined);
}

/**
 * The name shows as literal text and holds no elements.
 * @param {import('@playwright/test').Locator} locator the element that holds
 *        only the name
 */
async function expectLiteralName(page, locator, payload, where) {
    await expect(locator, where + ': the payload row must be rendered').toBeAttached();
    const seen = await locator.evaluate(el => ({
        text: el.textContent,
        html: el.innerHTML,
        children: el.querySelectorAll('*').length
    }));
    expect(seen.text, where + ': the name must display as literal text').toBe(payload);
    expect(seen.children,
        where + ': the name must be a single text node, got ' + seen.html).toBe(0);
    if (payload.includes('<')) {
        expect(seen.html, where + ': raw markup leaked into innerHTML: ' + seen.html)
            .not.toMatch(/<[a-z]/i);
        expect(seen.html, where + ': angle brackets must be entity-encoded: ' + seen.html)
            .toContain('&lt;img');
    }
    expect(await noExecution(page), where + ': a payload executed').toBe(true);
}

/**
 * The card around the name carries nothing the payload put there.
 * `allow` matches the inline handlers the app legitimately still emits here -
 * by default only the static avatar `onerror` fallback, which contains no
 * interpolated value. Anything else, and anything mentioning `__xss`, fails.
 */
async function expectNoInjectedHandlers(card, where, allow) {
    const allowed = allow || /^img\[onerror\]/;
    const seen = await card.evaluate(el => {
        const nodes = Array.prototype.slice.call(el.querySelectorAll('*')).concat([el]);
        const handlers = [];
        nodes.forEach(n => {
            Array.prototype.slice.call(n.attributes).forEach(a => {
                if (/^on/i.test(a.name)) {
                    handlers.push(n.tagName.toLowerCase() + '[' + a.name + ']=' + a.value);
                }
            });
        });
        return { outer: el.outerHTML, handlers, onclick: el.getAttribute('onclick') };
    });
    const unexpected = seen.handlers.filter(h => !allowed.test(h));
    expect(unexpected, where + ': unexpected inline handler(s) in ' + seen.outer).toEqual([]);
    const tainted = seen.handlers.filter(h => /__xss/.test(h));
    expect(tainted, where + ': a payload reached a handler attribute: ' + seen.outer).toEqual([]);
    expect(seen.outer, where + ': a javascript: URL reached the markup')
        .not.toContain('javascript:');
}

/** Find the card whose name element holds exactly `payload`. */
function cardFor(page, cardSelector, nameSelector, payload) {
    return page.locator(cardSelector).filter({
        has: page.locator(nameSelector, { hasText: payload })
    }).first();
}

test.describe('escape-html.js (shared helper, no browser needed)', () => {
    test('escapeHtml entity-encodes all five dangerous characters', () => {
        expect(escapeHtml('a&b<c>d"e\'f')).toBe('a&amp;b&lt;c&gt;d&quot;e&#39;f');
        // & first, so nothing is double-encoded into a wrong entity
        expect(escapeHtml('&lt;')).toBe('&amp;lt;');
        expect(escapeHtml(ELEMENT_PAYLOAD))
            .toBe('Ola &lt;img src=x onerror=window.__xss=1&gt; Z');
        expect(escapeHtml(ATTR_PAYLOAD))
            .toBe('Ala&quot; onmouseover=window.__xss=1 x=&quot;');
        expect(escapeHtml(JS_PAYLOAD))
            .toBe('O&#39;Brien&#39;); window.__xss=1; //');
        expect(escapeHtml(null)).toBe('');
        expect(escapeHtml(undefined)).toBe('');
        expect(escapeHtml(0)).toBe('0');
    });

    test('escapeAttr matches escapeHtml - quotes are what attributes need', () => {
        for (const value of PAYLOADS.concat([NASTY_NAME, NASTY_TITLE, null, undefined, ''])) {
            expect(escapeAttr(value)).toBe(escapeHtml(value));
        }
    });

    test('jsStringAttr yields a JS string literal that survives HTML-attribute decoding', () => {
        const { jsStringAttr } = require('../../public/escape-html.js');
        // Decode the way an HTML parser decodes an attribute value, then
        // evaluate: the result must be the original string, for any input.
        const decode = s => s.replace(/&quot;/g, '"').replace(/&#39;/g, "'")
            .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
        for (const value of PAYLOADS.concat(["'-__xssFn()-'", 'a\\b', 'x\ny', '\u2028', 'Zażółć gęślą jaźń'])) {
            const attr = jsStringAttr(value);
            expect(attr, 'the attribute text must contain no raw quote: ' + attr).not.toMatch(/["']/);
            expect(new Function('return ' + decode(attr))(), 'round trip of ' + JSON.stringify(value)).toBe(value);
        }
        expect(jsStringAttr(null)).toBe('&quot;&quot;');
        expect(jsStringAttr(undefined)).toBe('&quot;&quot;');
    });

    test('safeImageSrc allows only same-origin paths and https, escaped', () => {
        expect(safeImageSrc('/api/recipients/1/profile-picture'))
            .toBe('/api/recipients/1/profile-picture');
        expect(safeImageSrc('/images/default-avatar.svg')).toBe('/images/default-avatar.svg');
        expect(safeImageSrc('https://example.test/a.png')).toBe('https://example.test/a.png');
        // accepted, but still escaped for the attribute it is going into
        expect(safeImageSrc('/a&b"c')).toBe('/a&amp;b&quot;c');

        for (const rejected of [
            'javascript:window.__xss=1',
            'JaVaScRiPt:window.__xss=1',
            '\tjavascript:window.__xss=1',
            '\njavascript:window.__xss=1',
            ' javascript:window.__xss=1',
            'data:image/png;base64,AAAA',
            'data:image/svg+xml,<svg onload=window.__xss=1>',
            'vbscript:msgbox(1)',
            '//evil.example/x.png',
            // "\" is parsed as "/" in http(s) URLs, so these resolve off-origin
            '/\\evil.example/x.png',
            '/\\/evil.example/x.png',
            'http://example.test/a.png',
            'x" onerror="window.__xss=1',
            '',
            null,
            undefined
        ]) {
            expect(safeImageSrc(rejected), 'must be rejected: ' + String(rejected)).toBe('');
        }
    });
});

test.describe('XSS: leaderboard names', () => {
    test('the activity list renders every payload as literal text', async ({ page }) => {
        await openPage(page, LEADERBOARD);
        await setViewport(page, 375);

        for (const payload of PAYLOADS) {
            const card = cardFor(page, '#activityList .activity-card', '.activity-name', payload);
            await expectLiteralName(page, card.locator('.activity-name'), payload, 'activity list');
            await expectNoInjectedHandlers(card, 'activity list');
            // The activity cards have never been clickable - they must not have
            // become clickable by acquiring a data-username.
            expect(await card.getAttribute('data-username'),
                'activity cards must stay non-clickable').toBeNull();
        }
    });

    test('the activity podium renders every payload as literal text', async ({ page }) => {
        await openPage(page, LEADERBOARD);
        await setViewport(page, 375);

        for (const payload of PAYLOADS) {
            const card = cardFor(page, '#activityPodium .podium-place', '.podium-name', payload);
            await expectLiteralName(page, card.locator('.podium-name'), payload, 'activity podium');
            await expectNoInjectedHandlers(card, 'activity podium');
        }
    });

    test('the total-presents podium renders every payload as literal text', async ({ page }) => {
        await openPage(page, LEADERBOARD);
        await setViewport(page, 375);

        // renderPodium is a near-duplicate of renderActivityPodium; both have
        // to be fixed, so both are asserted.
        for (const payload of PAYLOADS) {
            const card = cardFor(page, '#podium .podium-place', '.podium-name', payload);
            await expectLiteralName(page, card.locator('.podium-name'), payload, 'podium');
            await expectNoInjectedHandlers(card, 'podium');
        }
    });

    test('the ranking list renders every payload as literal text', async ({ page }) => {
        await openPage(page, LEADERBOARD);
        await setViewport(page, 375);

        for (const payload of PAYLOADS) {
            const card = cardFor(page, '#usersList .user-card', '.user-name', payload);
            await expectLiteralName(page, card.locator('.user-name'), payload, 'ranking list');
            await expectNoInjectedHandlers(card, 'ranking list');
        }
    });

    test('no clickable card carries an inline onclick, and the raw name survives in data-username', async ({ page }) => {
        await openPage(page, LEADERBOARD);
        await setViewport(page, 375);

        const inline = await page.locator('[onclick]').evaluateAll(nodes =>
            nodes.filter(n => /navigateToUserInRecipients/.test(n.getAttribute('onclick') || ''))
                .map(n => n.outerHTML.slice(0, 200)));
        expect(inline, 'navigateToUserInRecipients must not be an inline handler any more').toEqual([]);

        for (const payload of PAYLOADS) {
            const podium = cardFor(page, '#podium .podium-place', '.podium-name', payload);
            const row = cardFor(page, '#usersList .user-card', '.user-name', payload);
            for (const [el, where] of [[podium, 'podium'], [row, 'ranking list']]) {
                expect(await el.getAttribute('onclick'), where + ': onclick must be gone').toBeNull();
                expect(await el.getAttribute('data-username'),
                    where + ': dataset must hand back the original name').toBe(payload);
                // the affordance is unchanged
                expect(await el.evaluate(n => n.style.cursor), where + ': cursor').toBe('pointer');
            }
        }
    });

    test('hovering a payload name fires nothing', async ({ page }) => {
        await openPage(page, LEADERBOARD);
        await setViewport(page, 375);

        // The attribute-breakout payload ends up as onmouseover if the
        // attribute was closed, so a hover is the only way to catch it.
        for (const payload of PAYLOADS) {
            await page.locator('#usersList .user-card', { hasText: payload }).first().hover();
            await page.locator('#podium .podium-place', { hasText: payload }).first().hover();
        }
        expect(await noExecution(page), 'hovering a payload executed something').toBe(true);
    });

    test('clicking a payload card still navigates to that person', async ({ page }) => {
        await openPage(page, LEADERBOARD);
        await setViewport(page, 375);

        // The JS-string payload is the one the old inline handler could not
        // survive, so it is the one worth clicking.
        const payload = JS_PAYLOAD;

        // Asserted through searchParams rather than a literal URL string: the
        // point is that the ORIGINAL name reaches the query, and the browser is
        // free to percent-encode an apostrophe either way.
        await cardFor(page, '#usersList .user-card', '.user-name', payload).click();
        await page.waitForURL(/[?&]osoba=/, { timeout: 20000, waitUntil: 'commit' });
        let got = new URL(page.url());
        expect(got.pathname, 'ranking card must open the recipients page').toBe('/recipients.html');
        expect(got.searchParams.get('osoba'),
            'the original name must survive the round trip').toBe(payload);

        await openPage(page, LEADERBOARD);
        await setViewport(page, 375);
        await cardFor(page, '#podium .podium-place', '.podium-name', payload).click();
        await page.waitForURL(/[?&]osoba=/, { timeout: 20000, waitUntil: 'commit' });
        got = new URL(page.url());
        expect(got.pathname, 'podium place must open the recipients page').toBe('/recipients.html');
        expect(got.searchParams.get('osoba'),
            'the original name must survive the round trip').toBe(payload);

        expect(await noExecution(page), 'clicking a payload executed something').toBe(true);
    });

    test('an untrusted profile_picture is allowlisted, a legitimate one still renders', async ({ page }) => {
        await openPage(page, LEADERBOARD);
        await setViewport(page, 375);

        // A javascript: URL must never reach src=; the renderer falls through
        // to the emoji avatar instead of emitting a broken <img>.
        const rejected = cardFor(page, '#usersList .user-card', '.user-name', PAYLOAD_WITH_BAD_PICTURE);
        const rejectedSeen = await rejected.evaluate(el => ({
            imgs: el.querySelectorAll('img').length,
            emoji: el.querySelectorAll('.user-avatar-emoji').length,
            outer: el.outerHTML
        }));
        expect(rejectedSeen.imgs,
            'a rejected picture must not render an <img>: ' + rejectedSeen.outer).toBe(0);
        expect(rejectedSeen.emoji,
            'a rejected picture must fall back to the emoji avatar: ' + rejectedSeen.outer)
            .toBeGreaterThan(0);

        // A legitimate same-origin path still renders, with the name in alt=
        // as literal text - this is the attribute-escaping path end to end.
        const allowed = cardFor(page, '#usersList .user-card', '.user-name', PAYLOAD_WITH_PICTURE);
        const img = allowed.locator('img').first();
        await expect(img, 'a legitimate picture must still render').toBeAttached();
        expect(await img.getAttribute('src')).toBe(PAYLOAD_PICTURE_URL);
        expect(await img.getAttribute('alt'),
            'alt must round-trip the name exactly').toBe(PAYLOAD_WITH_PICTURE);
        expect(await img.getAttribute('onmouseover'),
            'the attribute-breakout payload must not have added an attribute').toBeNull();
        // the static fallback handler is still there
        expect(await img.getAttribute('onerror'),
            'the existing onerror fallback must be preserved').toContain('nextElementSibling');
        expect(await noExecution(page)).toBe(true);
    });
});

test.describe('XSS: intro page names', () => {
    test('the intro podium renders every payload as literal text', async ({ page }) => {
        await openIntroLeaderboard(page);

        for (const payload of PAYLOADS) {
            const card = cardFor(page, '#podium .podium-place', '.podium-name', payload);
            await expectLiteralName(page, card.locator('.podium-name'), payload, 'intro podium');
            await expectNoInjectedHandlers(card, 'intro podium');
        }

        // The rejected javascript: picture falls back to the default avatar
        // rather than reaching src=.
        const rejected = cardFor(page, '#podium .podium-place', '.podium-name', PAYLOAD_WITH_BAD_PICTURE);
        expect(await rejected.locator('img').first().getAttribute('src'))
            .toBe('/images/default-avatar.svg');
        expect(await rejected.locator('img').first().getAttribute('alt'))
            .toBe(PAYLOAD_WITH_BAD_PICTURE);
    });

    test('the intro 4-10 list renders an HTML-special name as literal text', async ({ page }) => {
        await openIntroLeaderboard(page);

        // The payload rows occupy the top three, so this list can only be
        // reached by the seeded HTML-special recipient name.
        const row = cardFor(page, '#otherUsers .user-row', '.user-name', 'Zuza');
        await expect(row).toBeAttached();
        const seen = await row.locator('.user-name').evaluate(el => ({
            text: el.textContent, html: el.innerHTML, children: el.querySelectorAll('*').length
        }));
        expect(seen.text).toBe(NASTY_NAME);
        expect(seen.children, 'name must be a single text node: ' + seen.html).toBe(0);
        expect(seen.html).toContain('&lt;mała&gt;');
        expect(await row.locator('img').first().getAttribute('alt')).toBe(NASTY_NAME);
        expect(await noExecution(page)).toBe(true);
    });
});

test.describe('XSS: leaderboard-leader notification', () => {
    test('/activity renders both leader names as literal text', async ({ page }) => {
        await openPage(page, ACTIVITY);
        await setViewport(page, 375);

        // The seeded leaderboard_leader row carries the element payload as the
        // new leader and the attribute payload as the previous one.
        const message = page.locator('.notification-message', { hasText: 'wyprzedza' }).first();
        await expect(message, 'the leaderboard_leader notification must be rendered').toBeAttached();

        const seen = await message.evaluate(el => ({
            text: el.textContent.replace(/\s+/g, ' ').trim(),
            html: el.innerHTML,
            injected: el.querySelectorAll('img, script, iframe, svg, object, embed').length
        }));
        expect(seen.text, 'the new leader name must display literally').toContain(ELEMENT_PAYLOAD);
        expect(seen.text, 'the previous leader name must display literally').toContain(ATTR_PAYLOAD);
        expect(seen.injected,
            'the payload created elements in the notification: ' + seen.html).toBe(0);
        expect(seen.html, 'angle brackets must be entity-encoded: ' + seen.html).toContain('&lt;img');
        // The "rankingu" link in this message legitimately carries a static
        // onclick="event.stopPropagation();" - nothing else may.
        await expectNoInjectedHandlers(message, 'activity notification',
            /^(img\[onerror\]|a\[onclick\]=event\.stopPropagation)/);
        expect(await noExecution(page)).toBe(true);
    });
});

// The dock's notifications panel (tab-bar-functions.js) is on every page and
// renders recipients.name straight from /api/notifications. Opening the real
// panel marks everything read on the shared demo server (workers: 1), so the
// production renderer is driven directly with crafted rows instead:
// displayNotifications() writes only to #notificationsContent in the DOM.
const DOCK_PAGES = [
    { path: '/leaderboard.html', name: 'leaderboard', ready: '#usersList .user-card' },
    { path: '/recipients', name: 'recipients', ready: '.present-name' }
];
// No character here is changed by encodeURIComponent (it leaves ' ( ) - _ .
// alone), which is the point: the name needs no angle bracket, no double
// quote and no `=` or `;` (those become %3D / %3B and would only produce a
// syntax error). The page defines __xssFn so that running it is observable.
const APOSTROPHE_NAME = "'-__xssFn()-'";

test.describe('XSS: dock notifications panel (tab-bar-functions.js)', () => {
    for (const dockPage of DOCK_PAGES) {
        test(`${dockPage.name}: leader names and message labels render as literal text`, async ({ page }) => {
            await openPage(page, dockPage);
            await setViewport(page, 375);

            await page.evaluate(({ el, attr }) => {
                displayNotifications([
                    { id: 9001, type: 'leaderboard_leader', actor_username: 'Ola', is_read: false,
                      created_at: new Date().toISOString(),
                      data: { leaderName: el, previousLeaderName: attr, presentCount: 3 } },
                    { id: 9002, type: 'anon_message', actor_username: null, is_read: false,
                      created_at: new Date().toISOString(),
                      data: { label: el, threadId: 2 } }
                ]);
            }, { el: ELEMENT_PAYLOAD, attr: ATTR_PAYLOAD });

            const rows = page.locator('#notificationsContent .tab-bar-notification-message');
            await expect(rows, 'both notifications must be rendered').toHaveCount(2);
            for (let i = 0; i < 2; i++) {
                const seen = await rows.nth(i).evaluate(el => ({
                    text: el.textContent.replace(/\s+/g, ' ').trim(),
                    html: el.innerHTML,
                    injected: el.querySelectorAll('img, script, iframe, svg, object, embed').length
                }));
                expect(seen.injected,
                    dockPage.name + ' dock row ' + i + ' created elements: ' + seen.html).toBe(0);
                expect(seen.html, 'angle brackets must be entity-encoded: ' + seen.html)
                    .toContain('&lt;img');
                expect(seen.text, 'the name must display literally').toContain(ELEMENT_PAYLOAD);
            }
            const leader = await rows.first().evaluate(el => el.textContent.replace(/\s+/g, ' '));
            expect(leader, 'the previous leader must display literally').toContain(ATTR_PAYLOAD);
            await expectNoInjectedHandlers(page.locator('#notificationsContent'),
                dockPage.name + ' dock panel', /^a\[onclick\]=event\.stopPropagation/);
            expect(await noExecution(page)).toBe(true);
        });

        test(`${dockPage.name}: an apostrophe-only recipient name cannot break out of the present link's onclick`, async ({ page }) => {
            await openPage(page, dockPage);
            await setViewport(page, 375);

            // Record the call instead of navigating away.
            await page.evaluate(name => {
                window.__xssFn = () => { window.__xss = 1; return 0; };
                window.__scrollCalls = [];
                window.scrollToPresentFromNotification = (id, enc) => { window.__scrollCalls.push([id, enc]); };
                displayNotifications([
                    { id: 9003, type: 'present_checked', actor_username: 'Ola', is_read: false,
                      created_at: new Date().toISOString(),
                      data: { presentId: 8, presentTitle: 'Prezent', recipientName: name } }
                ]);
            }, APOSTROPHE_NAME);

            const link = page.locator('#notificationsContent a[onclick*="scrollToPresentFromNotification"]').first();
            await expect(link, 'the present link must be rendered').toBeAttached();
            // The panel is closed (off-screen), so a real click cannot reach the
            // link; dispatching the event still runs the inline onclick exactly
            // as a click would.
            await link.dispatchEvent('click');

            const calls = await page.evaluate(() => window.__scrollCalls);
            expect(calls.length, 'the click must call the handler exactly once').toBe(1);
            expect(decodeURIComponent(calls[0][1]),
                'the original name must round-trip through the handler argument').toBe(APOSTROPHE_NAME);
            expect(await noExecution(page),
                'the apostrophe name broke out of the onclick string and ran').toBe(true);
        });
    }
});

test.describe('XSS: inline handlers on /recipients', () => {
    // Every handler below used to be onclick="f(id, '${escapeHtml(name)}')".
    // escapeHtml there is the textContent idiom: it escapes & < > but NOT
    // quotes, and entity-escaping cannot protect a JS string anyway. So a
    // recipient called  O'Brien'); window.__xss=1; //  ran code on click.
    const RECIPIENT_PAYLOADS = [
        { id: 98, name: JS_PAYLOAD },
        { id: 99, name: ATTR_PAYLOAD }
    ];

    test('a recipient name cannot break out of the identify / share / cancel handlers', async ({ page }) => {
        // Serve the demo data plus two hostile recipients, without mutating
        // the shared in-memory demo dataset (workers: 1).
        await page.route('**/api/recipients-with-presents', async route => {
            const response = await route.fetch();
            const body = await response.json();
            body.recipients = (body.recipients || []).concat(RECIPIENT_PAYLOADS.map(r => ({
                id: r.id, name: r.name, identified_by: null, profile_picture: null, identified_by_username: null
            })));
            await route.fulfill({ response, json: body });
        });

        await openPage(page, { path: '/recipients', name: 'recipients', ready: '.present-name' });
        await setViewport(page, 1024);

        // Replace the real handlers with recorders. Inline onclick resolves
        // the identifier at click time, so this sees exactly what the
        // attribute passes. Nothing is sent to the server.
        const names = ['identifyAsRecipient', 'cancelIdentification', 'shareFormularzLink',
            'identifyAsRecipientFromSelection', 'deleteRecipientFromSelection'];
        await page.evaluate(fnNames => {
            window.__calls = [];
            fnNames.forEach(n => { window[n] = (...args) => { window.__calls.push([n].concat(args)); }; });
        }, names);

        // Fire every handler that mentions one of our recipients' ids or names
        // by dispatching the click: the buttons may be hidden at this width.
        const fired = await page.evaluate(fnNames => {
            const re = new RegExp('^(' + fnNames.join('|') + ')\\(');
            let count = 0;
            document.querySelectorAll('[onclick]').forEach(el => {
                if (re.test(el.getAttribute('onclick'))) { el.dispatchEvent(new MouseEvent('click', { bubbles: true })); count++; }
            });
            return count;
        }, names);
        expect(fired, 'the page must render identify/share handlers').toBeGreaterThan(0);

        expect(await noExecution(page),
            'a recipient name broke out of an inline handler and ran').toBe(true);

        // Each hostile name must arrive intact at its handler. escapeHtml is
        // the page's own (textContent idiom) so the expected value is what the
        // handlers always received for benign names.
        for (const r of RECIPIENT_PAYLOADS) {
            const expected = await page.evaluate(n => {
                const d = document.createElement('div'); d.textContent = n; return d.innerHTML;
            }, r.name);
            const received = await page.evaluate(() => window.__calls);
            const mine = received.filter(c => c.some(arg => arg === expected));
            expect(mine.length,
                'no handler received the name "' + r.name + '" intact; calls: ' + JSON.stringify(received.slice(0, 12))).toBeGreaterThan(0);
        }
    });

    test('jsStringAttr survives a real HTML parser for every payload', async ({ page }) => {
        await openPage(page, { path: '/leaderboard.html', name: 'leaderboard', ready: '#usersList .user-card' });

        const results = await page.evaluate(payloads => {
            window.__got = [];
            window.__record = v => { window.__got.push(v); };
            const host = document.createElement('div');
            document.body.appendChild(host);
            payloads.forEach(p => {
                host.innerHTML = '<button onclick="__record(' + PrezentyEscape.jsStringAttr(p) + ')">x</button>';
                host.firstChild.click();
            });
            host.remove();
            return window.__got;
        }, PAYLOADS.concat([APOSTROPHE_NAME, 'back\\slash', 'line\nbreak', "</script><b>", NASTY_NAME]));

        expect(results,
            'each value must reach the handler exactly as typed').toEqual(
            PAYLOADS.concat([APOSTROPHE_NAME, 'back\\slash', 'line\nbreak', "</script><b>", NASTY_NAME]));
        expect(await noExecution(page)).toBe(true);
    });
});

test.describe('XSS: present titles on /osoby', () => {
    test('the delete button carries no title and the edit field round-trips it', async ({ page }) => {
        await openPage(page, OSOBY);
        await setViewport(page, 375);

        const row = page.locator('#peopleContent .present-row')
            .filter({ hasText: 'alert(1)' }).first();
        await expect(row, 'the HTML-special present must be rendered').toBeAttached();

        const del = row.locator('[data-delete-present]');
        await expect(del, 'the delete button must be driven by a data attribute').toBeAttached();
        expect(await del.getAttribute('onclick'),
            'the title must not be interpolated into an inline handler').toBeNull();
        expect(await del.getAttribute('title'),
            'the accessible name must be unchanged').toBe('Usuń');
        // The edit button still uses an inline handler, but it only ever takes
        // the numeric id - nothing user supplied reaches it.
        await expectNoInjectedHandlers(row, 'osoby present row',
            /^button\[onclick\]=startEdit\(\d+\)$/);

        // The edit field is an attribute context: the title has to survive it
        // character for character.
        await row.locator('[onclick^="startEdit"]').click();
        const input = page.locator('input[id^="editTitle-"]').first();
        await expect(input).toBeAttached();
        expect(await input.inputValue(),
            'the edit field must round-trip the title exactly').toBe(NASTY_TITLE);
        expect(await noExecution(page)).toBe(true);

        // Leave the page as it was - workers: 1, the demo data is shared.
        await page.locator('button', { hasText: 'Anuluj' }).first().click();
        await expect(row.locator('[data-delete-present]')).toBeAttached();
    });

    test('deleting still confirms with the real title', async ({ page }) => {
        await openPage(page, OSOBY);
        await setViewport(page, 375);

        const messages = [];
        // Dismiss, so the demo present is not actually deleted.
        page.on('dialog', async dialog => {
            messages.push(dialog.message());
            await dialog.dismiss();
        });

        const row = page.locator('#peopleContent .present-row')
            .filter({ hasText: 'alert(1)' }).first();
        await row.locator('[data-delete-present]').click();

        await expect.poll(() => messages.length, { timeout: 5000 }).toBe(1);
        expect(messages[0], 'the confirm dialog must name the present being deleted')
            .toContain(NASTY_TITLE);
        // Nothing was deleted
        await expect(row).toBeAttached();
        expect(await noExecution(page)).toBe(true);
    });
});
