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
 * The picker UI itself is covered by the UI tests added with the picker.
 */
const { test, expect } = require('../fixtures');
const { openPage } = require('../helpers/pages');
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
        // wiadomosci.html does not load the dataset until the picker UI lands, so
        // load it here and re-run chat-reactions.js: the fresh instance replaces
        // window.ChatReactions and has its own state (init() is never called).
        await page.addScriptTag({ url: '/emoji-data.js' });
        await page.addScriptTag({ url: '/chat-reactions.js?reload=1' });
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
