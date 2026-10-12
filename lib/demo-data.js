// Moved verbatim from server.js (Phase 2 split)
const { toggleAction: reactionToggleAction } = require('../public/chat-reactions');

// Demo data for preview
const demoData = {
    users: [
        { id: 1, username: 'demo', password: '$2a$10$demo.hash.for.preview.only' }
    ],
    recipients: [
        { id: 1, name: 'Anna Kowalska', identified_by: null, profile_picture: null },
        { id: 2, name: 'Jan Nowak', identified_by: 1, profile_picture: null },
        { id: 3, name: 'Maria Wiśniewska', identified_by: null, profile_picture: null },
        // --- e2e layout fixtures (ids 4+, appended; ids 1-3 untouched) ---
        // A name that cannot be broken at a space, for the 320px overflow test
        { id: 4, name: 'Konstantynopolitańczykowianeczkaniezwykła', identified_by: null, profile_picture: null },
        // Every HTML special character, for the escaping test
        { id: 5, name: 'Zuzia & "Zuza" <mała> \'Z\'', identified_by: null, profile_picture: null }
    ],
    presents: [
        { id: 1, title: 'Książka o gotowaniu', recipient_id: 1, comments: 'Coś o kuchni włoskiej', is_checked: false, reserved_by: null, created_by: 1, created_at: new Date() },
        { id: 2, title: 'Słuchawki bezprzewodowe', recipient_id: 2, comments: 'Najlepiej Sony lub Bose', is_checked: true, reserved_by: 1, created_by: 1, created_at: new Date() },
        { id: 3, title: 'Roślina doniczkowa', recipient_id: 3, comments: 'Monstera lub fikus', is_checked: false, reserved_by: null, created_by: 1, created_at: new Date() },
        // --- e2e layout fixtures (ids 4+, appended; ids 1-3 untouched) ---
        // 64-char single token: may wrap or ellipsize, must not overflow
        { id: 4, title: 'Niezwyklenieprawdopodobnieskomplikowanazabawkaedukacyjnadladzieci', recipient_id: 4, comments: 'Bardzo długie jednowyrazowe tytuły nie mogą rozpychać karty', is_checked: false, reserved_by: null, created_by: 1, created_at: new Date() },
        // Long URL as the title - break-all is allowed here, overflow is not
        { id: 5, title: 'https://www.sklep-z-prezentami.example.com/katalog/zabawki/edukacyjne/zestaw-konstrukcyjny-xxl?kolor=czerwony&rozmiar=duzy&utm_source=prezenty', recipient_id: 1, comments: null, is_checked: false, reserved_by: null, created_by: 1, created_at: new Date() },
        // Ordinary Polish words - must never break mid-word at 320px
        { id: 6, title: 'Ciepły wełniany szalik w kolorze butelkowej zieleni dla Murphy', recipient_id: 3, comments: 'Najlepiej z merynosa', is_checked: false, reserved_by: null, created_by: 1, created_at: new Date() },
        // No description at all -> the "+ Dodaj szczegóły" nudge path
        { id: 7, title: 'Kubek termiczny', recipient_id: 2, comments: null, is_checked: false, reserved_by: null, created_by: 1, created_at: new Date() },
        // Escaping: must render as literal text, never as markup
        { id: 8, title: 'Zestaw <script>alert(1)</script> & "mega" \'mini\'', recipient_id: 5, comments: 'Opis z & < > " \' w środku', is_checked: false, reserved_by: null, created_by: 1, created_at: new Date() },
        // Both bought and reserved at once
        { id: 9, title: 'Puzzle 2000 elementów', recipient_id: 4, comments: 'Widok górski', is_checked: true, reserved_by: 1, created_by: 1, created_at: new Date() }
    ]
};

// ============================================================================
// DEMO_MODE fixtures for chat / leaderboard / notifications.
//
// Read and mutated ONLY from `if (DEMO_MODE)` branches - no production code
// path touches anything below, nothing is written to disk or to a database,
// and `requireAuth` still gates every route that uses it. The point is that
// the e2e suite can drive the real pages against realistic content; see
// tests/README.md for what this consequently canNOT verify.
//
// Every demo session is user id 1 (server.js login demo branch), so "me" is
// always user 1 here.
// ============================================================================

const DEMO_LONG_URL = 'https://www.example.com/bardzo/dluga/sciezka/do/produktu?kolor=czerwony&rozmiar=42&utm_source=prezenty&utm_campaign=mikolaj';

const demoChat = {
    users: [
        { id: 1, username: 'demo' },
        { id: 2, username: 'Mikołaj Testowy' },
        { id: 3, username: 'Ola' }
    ],
    // T1: demo user is the initiator -> label is the target's username.
    // T2: demo user is the target    -> label is 'Święty Mikołaj 🎅', unread.
    // T3: a deliberately unbreakable last message (thread-row shrink case).
    threads: [
        { id: 1, initiator_id: 1, target_id: 2, created_at: new Date(Date.now() - 36e5) },
        { id: 2, initiator_id: 3, target_id: 1, created_at: new Date(Date.now() - 72e5) },
        { id: 3, initiator_id: 1, target_id: 3, created_at: new Date(Date.now() - 108e5) }
    ],
    messages: [
        { id: 1, thread_id: 1, sender_id: 1, body: 'Cześć! Jaki rozmiar buta nosisz?', is_read: true, created_at: new Date(Date.now() - 35e5) },
        { id: 2, thread_id: 1, sender_id: 2, body: 'Czterdzieści dwa, ale wolę trochę luźniejsze.', is_read: true, created_at: new Date(Date.now() - 34e5) },
        { id: 3, thread_id: 1, sender_id: 1, body: 'Super, zobacz to: ' + DEMO_LONG_URL, is_read: true, created_at: new Date(Date.now() - 33e5) },
        { id: 4, thread_id: 1, sender_id: 2, body: 'Nieprzewidywalnieskomplikowanasuperniespodziankaurodzinowa', is_read: true, created_at: new Date(Date.now() - 32e5) },
        { id: 5, thread_id: 1, sender_id: 1, body: 'A co z <b>tym</b> & "tamtym"? \'Naprawdę\'?', is_read: true, created_at: new Date(Date.now() - 31e5) },
        { id: 6, thread_id: 1, sender_id: 2, body: 'Jeszcze zastanawiam się nad ciepłym wełnianym szalikiem w kolorze butelkowej zieleni, bo stary zupełnie się rozciągnął.', is_read: true, created_at: new Date(Date.now() - 30e5) },
        { id: 7, thread_id: 1, sender_id: 1, body: 'Dzięki, zapisuję!', is_read: true, created_at: new Date(Date.now() - 29e5) },
        { id: 8, thread_id: 2, sender_id: 3, body: 'Masz pomysł na prezent dla Anny?', is_read: false, created_at: new Date(Date.now() - 71e5) },
        { id: 9, thread_id: 2, sender_id: 3, body: 'Pytam, bo kończy mi się czas 🎅', is_read: false, created_at: new Date(Date.now() - 70e5) },
        { id: 10, thread_id: 3, sender_id: 1, body: 'Niezwyklenieprawdopodobnieskomplikowanazabawkaedukacyjnadladzieci', is_read: true, created_at: new Date(Date.now() - 107e5) }
    ],
    // messageId -> emoji -> Set(userId). Message 2 carries three emoji with
    // counts 1 / 2 / 9 (two of them mine); message 4 carries none.
    reactions: new Map([
        [2, new Map([
            ['❤️', new Set([1])],
            ['😂', new Set([1, 2])],
            ['👍', new Set([2, 3, 4, 5, 6, 7, 8, 9, 10])]
        ])],
        [6, new Map([
            ['🎁', new Set([2])]
        ])]
    ]),
    nextThreadId: 4,
    nextMessageId: 11
};

// Leaderboard rows use the EXACT column names the production query returns
// so the page code is exercised unchanged. The bought/reserved pairs cover
// every Polish plural boundary: 0, 1, 2, 5, 12, 22, 112.
const demoLeaderboard = {
    users: [
        // XSS regression fixtures (tests/e2e/xss-usernames.spec.js). `username`
        // here is recipients.name, written by POST /api/recipients with an
        // empty-check and nothing else, so it is attacker controlled. The three
        // payloads cover the three contexts the renderers use: element content,
        // attribute breakout, and JS-string-inside-an-HTML-attribute (including
        // a bare apostrophe, which needs no angle brackets at all).
        // They carry the highest total_presents AND the highest activity so one
        // payload reaches every one of the four leaderboard render paths plus
        // both intro.html lists. Exactly three rows: the activity list slices to
        // the top 10, and 8 + 3 = 11 drops only 'Oliwia Bezaktywności', whose
        // zero activity is skipped by the renderer anyway. A fourth row would
        // drop 'Piotr Jedyny' and break pluralization.spec.js.
        // id 9's profile_picture is a javascript: URL so safeImageSrc rejection
        // is exercised; id 10 gets a real same-origin path so the <img> branch
        // (and alt= attribute escaping) is exercised end-to-end.
        { id: 9, username: 'Ola <img src=x onerror=window.__xss=1> Z', recipient_id: 9, profile_picture: 'javascript:window.__xss=1', total_presents: 115, bought_presents: 0, reserved_presents: 0, available_presents: 115, user_bought_count: 200, user_reserved_count: 0 },
        { id: 10, username: 'Ala" onmouseover=window.__xss=1 x="', recipient_id: 10, profile_picture: '/images/default-avatar.svg', total_presents: 114, bought_presents: 0, reserved_presents: 0, available_presents: 114, user_bought_count: 180, user_reserved_count: 0 },
        { id: 11, username: 'O\'Brien\'); window.__xss=1; //', recipient_id: 11, profile_picture: null, total_presents: 113, bought_presents: 0, reserved_presents: 0, available_presents: 113, user_bought_count: 160, user_reserved_count: 0 },
        { id: 7, username: 'Katarzyna Zimowa', recipient_id: 7, profile_picture: null, total_presents: 112, bought_presents: 40, reserved_presents: 30, available_presents: 42, user_bought_count: 112, user_reserved_count: 1 },
        { id: 4, username: 'Konstantynopolitańczykowianeczkaniezwykła', recipient_id: 4, profile_picture: null, total_presents: 22, bought_presents: 8, reserved_presents: 6, available_presents: 8, user_bought_count: 22, user_reserved_count: 112 },
        { id: 5, username: 'Zuzia & "Zuza" <mała> \'Z\'', recipient_id: 5, profile_picture: null, total_presents: 12, bought_presents: 4, reserved_presents: 3, available_presents: 5, user_bought_count: 12, user_reserved_count: 22 },
        { id: 3, username: 'Maria Wiśniewska', recipient_id: 3, profile_picture: null, total_presents: 5, bought_presents: 2, reserved_presents: 1, available_presents: 2, user_bought_count: 5, user_reserved_count: 12 },
        { id: 2, username: 'Jan Nowak', recipient_id: 2, profile_picture: null, total_presents: 2, bought_presents: 1, reserved_presents: 1, available_presents: 0, user_bought_count: 2, user_reserved_count: 5 },
        { id: 1, username: 'Anna Kowalska', recipient_id: 1, profile_picture: null, total_presents: 1, bought_presents: 0, reserved_presents: 0, available_presents: 1, user_bought_count: 0, user_reserved_count: 2 },
        { id: 6, username: 'Piotr Jedyny', recipient_id: 6, profile_picture: null, total_presents: 1, bought_presents: 0, reserved_presents: 0, available_presents: 1, user_bought_count: 1, user_reserved_count: 0 },
        { id: 8, username: 'Oliwia Bezaktywności', recipient_id: 8, profile_picture: null, total_presents: 1, bought_presents: 0, reserved_presents: 0, available_presents: 1, user_bought_count: 0, user_reserved_count: 0 }
    ],
    cumulativeStats: { totalPresents: 156, boughtPresents: 55, reservedPresents: 41 }
};

// Rows shaped like the production query output (n.* + actor_username, `data`
// already parsed). Covers every type notification-text.js knows, both extra
// types activity.html can render, and one unknown type for the
// "coś zmienia ✨" default. 20 rows = exactly one page (limit 20).
function demoNotificationRows() {
    const t = (minutesAgo) => new Date(Date.now() - minutesAgo * 60000);
    const rows = [
        { id: 120, type: 'something_new', actor_username: 'Ola', is_read: false, created_at: t(2), data: { presentTitle: 'Cokolwiek' } },
        { id: 119, type: 'anon_message', actor_username: null, is_read: true, created_at: t(5), data: { label: 'Wiadomość od Świętego Mikołaja', threadId: 2, preview: 'Masz pomysł na prezent dla Anny?' } },
        // leaderName / previousLeaderName are recipients.name (see the
        // leaderboard-leader notification in server.js), so they get the same
        // XSS payloads as demoLeaderboard above - the custom leaderboard_leader
        // renderers on /activity and /recipients interpolate them directly.
        { id: 118, type: 'leaderboard_leader', actor_username: 'Ola', is_read: false, created_at: t(8), data: { leaderName: 'Ola <img src=x onerror=window.__xss=1> Z', previousLeaderName: 'Ala" onmouseover=window.__xss=1 x="', presentCount: 12 } },
        { id: 117, type: 'present_added_batch', actor_username: 'Mikołaj Testowy', is_read: false, created_at: t(11), data: { count: 1, recipientId: 2, recipientName: 'Jan Nowak' } },
        { id: 116, type: 'present_added_batch', actor_username: 'Mikołaj Testowy', is_read: false, created_at: t(14), data: { count: 2, recipientId: 2, recipientName: 'Jan Nowak' } },
        { id: 115, type: 'present_added_batch', actor_username: 'Mikołaj Testowy', is_read: true, created_at: t(17), data: { count: 12, recipientId: 3, recipientName: 'Maria Wiśniewska' } },
        { id: 114, type: 'present_added_batch', actor_username: 'Mikołaj Testowy', is_read: true, created_at: t(20), data: { count: 22, recipientId: 3, recipientName: 'Maria Wiśniewska' } },
        { id: 113, type: 'present_added_batch', actor_username: 'Mikołaj Testowy', is_read: true, created_at: t(23), data: { count: 112, recipientId: 3, recipientName: 'Maria Wiśniewska' } },
        { id: 112, type: 'present_checked', actor_username: 'Ola', is_read: true, created_at: t(26), data: { presentId: 8, presentTitle: 'Zestaw <script>alert(1)</script> & "mega" \'mini\'', recipientId: 5, recipientName: 'Zuzia & "Zuza" <mała> \'Z\'' } },
        { id: 111, type: 'present_unchecked', actor_username: 'Ola', is_read: true, created_at: t(29), data: { presentId: 2, presentTitle: 'Słuchawki bezprzewodowe', recipientId: 2, recipientName: 'Jan Nowak' } },
        { id: 110, type: 'present_reserved', actor_username: 'Mikołaj Testowy', is_read: true, created_at: t(32), data: { presentId: 1, presentTitle: 'Książka o gotowaniu', recipientId: 1, recipientName: 'Anna Kowalska' } },
        { id: 109, type: 'present_unreserved', actor_username: 'Mikołaj Testowy', is_read: true, created_at: t(35), data: { presentId: 3, presentTitle: 'Roślina doniczkowa', recipientId: 3, recipientName: 'Maria Wiśniewska' } },
        { id: 108, type: 'recipient_added', actor_username: 'Ola', is_read: true, created_at: t(38), data: { recipientId: 4, recipientName: 'Konstantynopolitańczykowianeczkaniezwykła' } },
        // recipientName === actor -> the " dla: X" suffix is suppressed
        { id: 107, type: 'present_added', actor_username: 'Ola', is_read: true, created_at: t(41), data: { presentId: 7, presentTitle: 'Kubek termiczny', recipientId: 9, recipientName: 'Ola' } },
        // 5 consecutive present_added, same actor, same recipient -> the
        // activity page collapses them into "dodaje 5 prezentów"
        { id: 106, type: 'present_added', actor_username: 'Mikołaj Testowy', is_read: true, created_at: t(44), data: { presentId: 4, presentTitle: 'Puzzle 2000 elementów', recipientId: 1, recipientName: 'Anna Kowalska' } },
        { id: 105, type: 'present_added', actor_username: 'Mikołaj Testowy', is_read: true, created_at: t(45), data: { presentId: 5, presentTitle: 'Szalik wełniany', recipientId: 1, recipientName: 'Anna Kowalska' } },
        { id: 104, type: 'present_added', actor_username: 'Mikołaj Testowy', is_read: true, created_at: t(46), data: { presentId: 6, presentTitle: 'Kubek termiczny', recipientId: 1, recipientName: 'Anna Kowalska' } },
        { id: 103, type: 'present_added', actor_username: 'Mikołaj Testowy', is_read: true, created_at: t(47), data: { presentId: 1, presentTitle: 'Książka o gotowaniu', recipientId: 1, recipientName: 'Anna Kowalska' } },
        { id: 102, type: 'present_added', actor_username: 'Mikołaj Testowy', is_read: true, created_at: t(48), data: { presentId: 3, presentTitle: 'Roślina doniczkowa', recipientId: 1, recipientName: 'Anna Kowalska' } },
        // No recipientName -> "dodaje nową osobę 👤"
        { id: 101, type: 'recipient_added', actor_username: null, is_read: true, created_at: t(55), data: {} }
    ];
    return rows.map(r => Object.assign({ user_id: 1, actor_id: null }, r));
}

const demoNotifications = demoNotificationRows();

// --- demo chat helpers (all pure reads unless named *Toggle/*Add) ---

function demoThreadMessages(threadId) {
    return demoChat.messages
        .filter(m => Number(m.thread_id) === Number(threadId))
        .sort((a, b) => a.id - b.id);
}

function demoIsParticipant(thread, userId) {
    return Number(thread.initiator_id) === Number(userId) || Number(thread.target_id) === Number(userId);
}

function demoOtherLabel(thread, userId) {
    if (Number(thread.initiator_id) === Number(userId)) {
        const target = demoChat.users.find(u => u.id === Number(thread.target_id));
        return target ? target.username : '?';
    }
    return 'Święty Mikołaj 🎅';
}

// Same projection the production thread-list query builds.
function demoThreadList(userId) {
    return demoChat.threads
        .filter(t => demoIsParticipant(t, userId))
        .map(t => {
            const msgs = demoThreadMessages(t.id);
            const last = msgs[msgs.length - 1];
            return {
                id: t.id,
                role: Number(t.initiator_id) === Number(userId) ? 'initiator' : 'target',
                otherLabel: demoOtherLabel(t, userId),
                targetUserId: t.target_id,
                lastBody: last ? last.body : null,
                lastAt: last ? last.created_at : t.created_at,
                unreadCount: msgs.filter(m => !m.is_read && Number(m.sender_id) !== Number(userId)).length
            };
        })
        .sort((a, b) => new Date(b.lastAt) - new Date(a.lastAt));
}

function demoUnreadCount(userId) {
    return demoChat.threads
        .filter(t => demoIsParticipant(t, userId))
        .reduce((sum, t) => sum + demoThreadMessages(t.id)
            .filter(m => !m.is_read && Number(m.sender_id) !== Number(userId)).length, 0);
}

// Grouped rows shaped exactly like the production GROUP BY output, so the
// SAME buildReactionList/groupReactionsByMessage code shapes the response.
function demoReactionRows(messageId, userId) {
    const byEmoji = demoChat.reactions.get(Number(messageId));
    if (!byEmoji) return [];
    const rows = [];
    byEmoji.forEach((users, emoji) => {
        if (users.size === 0) return;
        rows.push({ emoji, cnt: users.size, mine: users.has(Number(userId)) ? 1 : 0 });
    });
    return rows;
}

function demoThreadReactionRows(threadId, userId) {
    const rows = [];
    demoThreadMessages(threadId).forEach(m => {
        demoReactionRows(m.id, userId).forEach(r => {
            rows.push(Object.assign({ message_id: m.id }, r));
        });
    });
    return rows;
}

// Flips one (message, user, emoji) membership and reports which way it went.
function demoReactionToggle(messageId, userId, emoji) {
    const id = Number(messageId);
    if (!demoChat.reactions.has(id)) demoChat.reactions.set(id, new Map());
    const byEmoji = demoChat.reactions.get(id);
    if (!byEmoji.has(emoji)) byEmoji.set(emoji, new Set());
    const users = byEmoji.get(emoji);
    const had = users.has(Number(userId));
    if (had) users.delete(Number(userId)); else users.add(Number(userId));
    if (users.size === 0) byEmoji.delete(emoji);
    return reactionToggleAction(had ? 1 : 0);
}

module.exports = { demoData, demoChat, demoLeaderboard, demoNotifications, demoThreadMessages, demoIsParticipant, demoOtherLabel, demoThreadList, demoUnreadCount, demoReactionRows, demoThreadReactionRows, demoReactionToggle };
