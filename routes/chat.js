// Moved verbatim from server.js (Phase 2 split)
const express = require('express');
const router = express.Router();
const {
    isAllowedReactionEmoji,
    buildReactionList,
    groupReactionsByMessage,
    buildLastReaction,
    parseMessageId: parseReactionMessageId,
    toggleAction: reactionToggleAction
} = require('../public/chat-reactions');
const { DEMO_MODE, pool } = require('../lib/db');
const { handleDbError, notFound, forbidden, badRequest } = require('../lib/http-errors');
const { requireAuth } = require('../lib/auth');
const { ensureAnonMessageTables, notifyAnonMessage, reactionRateAllows } = require('../lib/chat');
const { linkPreviewCache, LINK_PREVIEW_TTL, isSafePreviewUrl, extractMeta, fetchPreview } = require('../lib/link-preview');
const { demoChat, demoThreadMessages, demoIsParticipant, demoOtherLabel, demoThreadList, demoUnreadCount, demoReactionRows, demoThreadReactionRows, demoReactionToggle } = require('../lib/demo-data');

// Users the current user can message (everyone but themselves)
router.get('/api/wiadomosci/users', requireAuth, async (req, res) => {
    if (DEMO_MODE) return res.json({ users: demoChat.users.filter(u => u.id !== req.session.userId) });
    try {
        const [users] = await pool.execute(
            'SELECT id, username FROM users WHERE id != ? ORDER BY username',
            [req.session.userId]
        );
        res.json({ users });
    } catch (err) {
        return handleDbError(err, res, 'Błąd podczas pobierania użytkowników');
    }
});

// Thread list for the current user (both roles), newest activity first
router.get('/api/wiadomosci/threads', requireAuth, async (req, res) => {
    if (DEMO_MODE) return res.json({ threads: demoThreadList(req.session.userId) });
    const userId = req.session.userId;
    try {
        await ensureAnonMessageTables();
        const [threads] = await pool.execute(`
            SELECT t.id, t.initiator_id, t.target_id, t.created_at,
                   u.username AS target_username,
                   (SELECT id FROM anon_messages m WHERE m.thread_id = t.id ORDER BY m.id DESC LIMIT 1) AS last_id,
                   (SELECT body FROM anon_messages m WHERE m.thread_id = t.id ORDER BY m.id DESC LIMIT 1) AS last_body,
                   (SELECT created_at FROM anon_messages m WHERE m.thread_id = t.id ORDER BY m.id DESC LIMIT 1) AS last_at,
                   (SELECT COUNT(*) FROM anon_messages m WHERE m.thread_id = t.id AND m.is_read = 0 AND m.sender_id != ?) AS unread_count
            FROM anon_threads t
            JOIN users u ON u.id = t.target_id
            WHERE t.initiator_id = ? OR t.target_id = ?
            ORDER BY last_at DESC
        `, [userId, userId, userId]);

        // The OTHER side's newest reaction per thread, in ONE query (no
        // N+1). The viewer's own reactions are excluded (r.user_id <> ?) in
        // both the outer filter and the "newest" pick, so they can never
        // become - or mask - the preview, whichever role the viewer has.
        // Newest = highest id (toggle is DELETE-then-INSERT, so id order is
        // creation order). No identity leaves the server: buildLastReaction
        // keeps only { emoji, at, messageId, excerpt }. Reactions still
        // create NO notification, push or unread change.
        // A failure here must not break the whole list: log and carry on
        // without previews.
        const reactionByThread = new Map();
        try {
            const [reactionRows] = await pool.execute(`
                SELECT r.id, r.emoji, r.created_at AS reacted_at, r.message_id, m.thread_id, m.body
                FROM anon_message_reactions r
                JOIN anon_messages m ON m.id = r.message_id
                JOIN anon_threads t ON t.id = m.thread_id
                WHERE (t.initiator_id = ? OR t.target_id = ?)
                  AND r.user_id <> ?
                  AND r.user_id IN (t.initiator_id, t.target_id)
                  AND r.id = (
                      SELECT r2.id
                      FROM anon_message_reactions r2
                      JOIN anon_messages m2 ON m2.id = r2.message_id
                      WHERE m2.thread_id = m.thread_id
                        AND r2.user_id <> ?
                        AND r2.user_id IN (t.initiator_id, t.target_id)
                      ORDER BY r2.id DESC
                      LIMIT 1)
            `, [userId, userId, userId, userId]);
            reactionRows.forEach(row => reactionByThread.set(Number(row.thread_id), row));
        } catch (reactionErr) {
            console.error('[WIADOMOSCI] thread reaction preview failed:', reactionErr.message);
        }

        res.json({
            threads: threads.map(t => ({
                id: t.id,
                role: t.initiator_id === userId ? 'initiator' : 'target',
                // Target sees "Święty Mikołaj"; initiator sees who they wrote to
                otherLabel: t.initiator_id === userId ? t.target_username : 'Święty Mikołaj 🎅',
                // The target's id is never a secret (they're the known
                // party) - lets ?do= deep links find an existing thread
                targetUserId: t.target_id,
                lastBody: t.last_body,
                lastAt: t.last_at,
                unreadCount: Number(t.unread_count),
                // null unless the other side reacted AFTER the last message
                lastReaction: buildLastReaction(
                    reactionByThread.get(Number(t.id)) || null,
                    { id: t.last_id, at: t.last_at }
                )
            }))
        });
    } catch (err) {
        return handleDbError(err, res, 'Błąd podczas pobierania wiadomości');
    }
});

// Unread messages badge
router.get('/api/wiadomosci/unread-count', requireAuth, async (req, res) => {
    if (DEMO_MODE) return res.json({ count: demoUnreadCount(req.session.userId) });
    const userId = req.session.userId;
    try {
        await ensureAnonMessageTables();
        const [rows] = await pool.execute(`
            SELECT COUNT(*) AS count FROM anon_messages m
            JOIN anon_threads t ON t.id = m.thread_id
            WHERE (t.initiator_id = ? OR t.target_id = ?)
              AND m.sender_id != ? AND m.is_read = 0
        `, [userId, userId, userId]);
        res.json({ count: Number(rows[0].count) });
    } catch (err) {
        return handleDbError(err, res, 'Błąd');
    }
});

// Start a new anonymous thread
router.post('/api/wiadomosci/threads', requireAuth, async (req, res) => {
    const userId = req.session.userId;
    const { targetUserId, body } = req.body;

    if (!targetUserId || !body || !String(body).trim()) {
        return badRequest(res, 'Wybierz odbiorcę i wpisz wiadomość');
    }
    if (Number(targetUserId) === Number(userId)) {
        return badRequest(res, 'Nie możesz wysłać wiadomości do siebie');
    }

    // Demo: same validation above, then an in-memory thread + first message.
    if (DEMO_MODE) {
        if (!demoChat.users.some(u => u.id === Number(targetUserId))) {
            return notFound(res, 'Nie znaleziono użytkownika');
        }
        const threadId = demoChat.nextThreadId++;
        demoChat.threads.push({ id: threadId, initiator_id: userId, target_id: Number(targetUserId), created_at: new Date() });
        demoChat.messages.push({
            id: demoChat.nextMessageId++, thread_id: threadId, sender_id: userId,
            body: String(body).trim(), is_read: true, created_at: new Date()
        });
        return res.json({ success: true, threadId });
    }

    try {
        await ensureAnonMessageTables();
        const [target] = await pool.execute('SELECT id FROM users WHERE id = ?', [targetUserId]);
        if (target.length === 0) return notFound(res, 'Nie znaleziono użytkownika');

        // Every compose starts a NEW thread - multiple parallel threads
        // to the same person are intentional (distinguishable conversations)
        const [tRes] = await pool.execute(
            'INSERT INTO anon_threads (initiator_id, target_id) VALUES (?, ?)',
            [userId, targetUserId]
        );
        const threadId = tRes.insertId;

        await pool.execute(
            'INSERT INTO anon_messages (thread_id, sender_id, body) VALUES (?, ?, ?)',
            [threadId, userId, String(body).trim()]
        );

        notifyAnonMessage(Number(targetUserId), 'Wiadomość od Świętego Mikołaja', threadId, String(body).trim());
        res.json({ success: true, threadId });
    } catch (err) {
        return handleDbError(err, res, 'Błąd podczas wysyłania wiadomości');
    }
});

// Read a thread (marks incoming messages as read)
router.get('/api/wiadomosci/threads/:id', requireAuth, async (req, res) => {
    const userId = req.session.userId;
    // Demo: same projection as the production path below, including the
    // aggregate-only reaction shape built by the SHIPPED helpers, so the
    // privacy contract ({ emoji, count, mine } and nothing else) is the
    // one actually under test.
    if (DEMO_MODE) {
        const thread = demoChat.threads.find(t => Number(t.id) === Number(req.params.id));
        if (!thread) return notFound(res, 'Nie znaleziono rozmowy');
        if (!demoIsParticipant(thread, userId)) return forbidden(res, 'To nie Twoja rozmowa');

        const msgs = demoThreadMessages(thread.id);
        const reactionsByMessage = groupReactionsByMessage(demoThreadReactionRows(thread.id, userId));
        // Reading the thread marks incoming messages as read
        msgs.forEach(m => { if (Number(m.sender_id) !== Number(userId)) m.is_read = true; });

        return res.json({
            threadId: thread.id,
            role: Number(thread.initiator_id) === Number(userId) ? 'initiator' : 'target',
            otherLabel: demoOtherLabel(thread, userId),
            messages: msgs.map(m => ({
                id: m.id,
                fromMe: Number(m.sender_id) === Number(userId),
                body: m.body,
                createdAt: m.created_at,
                reactions: reactionsByMessage.get(Number(m.id)) || []
            }))
        });
    }
    try {
        await ensureAnonMessageTables();
        const [tRows] = await pool.execute('SELECT * FROM anon_threads WHERE id = ?', [req.params.id]);
        if (tRows.length === 0) return notFound(res, 'Nie znaleziono rozmowy');
        const thread = tRows[0];
        if (thread.initiator_id !== userId && thread.target_id !== userId) {
            return forbidden(res, 'To nie Twoja rozmowa');
        }

        const [msgs] = await pool.execute(
            'SELECT id, sender_id, body, created_at FROM anon_messages WHERE thread_id = ? ORDER BY id ASC',
            [thread.id]
        );
        await pool.execute(
            'UPDATE anon_messages SET is_read = 1 WHERE thread_id = ? AND sender_id != ?',
            [thread.id, userId]
        );

        // Reactions for the WHOLE thread in one grouped query (no N+1).
        // Scoped by thread_id after the participation check above, so
        // reactions from other conversations are unreachable. Only the
        // aggregate leaves the server - `mine` replaces any user id.
        const [reactionRows] = await pool.execute(`
            SELECT r.message_id, r.emoji, COUNT(*) AS cnt, MAX(r.user_id = ?) AS mine
            FROM anon_message_reactions r
            JOIN anon_messages m ON m.id = r.message_id
            WHERE m.thread_id = ?
            GROUP BY r.message_id, r.emoji
        `, [userId, thread.id]);
        const reactionsByMessage = groupReactionsByMessage(reactionRows);

        const isInitiator = thread.initiator_id === userId;
        const [uRows] = await pool.execute('SELECT username FROM users WHERE id = ?', [thread.target_id]);
        const targetName = uRows.length ? uRows[0].username : '?';

        res.json({
            threadId: thread.id,
            role: isInitiator ? 'initiator' : 'target',
            otherLabel: isInitiator ? targetName : 'Święty Mikołaj 🎅',
            // sender_id is NEVER exposed - only fromMe
            messages: msgs.map(m => ({
                id: m.id,
                fromMe: m.sender_id === userId,
                body: m.body,
                createdAt: m.created_at,
                // Aggregate only: [{ emoji, count, mine }]
                reactions: reactionsByMessage.get(Number(m.id)) || []
            }))
        });
    } catch (err) {
        return handleDbError(err, res, 'Błąd podczas pobierania rozmowy');
    }
});

// Delete a thread - removes the conversation FOR BOTH SIDES (messages
// cascade). Deliberate: hiding it one-sidedly would leave ghost threads
// that can still receive replies into the void.
router.delete('/api/wiadomosci/threads/:id', requireAuth, async (req, res) => {
    const userId = req.session.userId;
    if (DEMO_MODE) {
        const idx = demoChat.threads.findIndex(t => Number(t.id) === Number(req.params.id));
        if (idx === -1) return notFound(res, 'Nie znaleziono rozmowy');
        if (!demoIsParticipant(demoChat.threads[idx], userId)) return forbidden(res, 'To nie Twoja rozmowa');
        const threadId = demoChat.threads[idx].id;
        demoChat.threads.splice(idx, 1);
        demoChat.messages
            .filter(m => Number(m.thread_id) === Number(threadId))
            .forEach(m => demoChat.reactions.delete(Number(m.id)));
        demoChat.messages = demoChat.messages.filter(m => Number(m.thread_id) !== Number(threadId));
        return res.json({ success: true });
    }
    try {
        await ensureAnonMessageTables();
        const [tRows] = await pool.execute('SELECT * FROM anon_threads WHERE id = ?', [req.params.id]);
        if (tRows.length === 0) return notFound(res, 'Nie znaleziono rozmowy');
        const thread = tRows[0];
        if (thread.initiator_id !== userId && thread.target_id !== userId) {
            return forbidden(res, 'To nie Twoja rozmowa');
        }

        await pool.execute('DELETE FROM anon_threads WHERE id = ?', [thread.id]);
        console.log(`🗑️ [WIADOMOSCI] Thread ${thread.id} deleted by user ${userId}`);
        res.json({ success: true });
    } catch (err) {
        return handleDbError(err, res, 'Błąd podczas usuwania rozmowy');
    }
});

// Reply within a thread
router.post('/api/wiadomosci/threads/:id/messages', requireAuth, async (req, res) => {
    const userId = req.session.userId;
    const { body } = req.body;
    if (!body || !String(body).trim()) return badRequest(res, 'Wpisz wiadomość');

    if (DEMO_MODE) {
        const thread = demoChat.threads.find(t => Number(t.id) === Number(req.params.id));
        if (!thread) return notFound(res, 'Nie znaleziono rozmowy');
        if (!demoIsParticipant(thread, userId)) return forbidden(res, 'To nie Twoja rozmowa');
        demoChat.messages.push({
            id: demoChat.nextMessageId++, thread_id: thread.id, sender_id: userId,
            body: String(body).trim(), is_read: true, created_at: new Date()
        });
        return res.json({ success: true });
    }

    try {
        await ensureAnonMessageTables();
        const [tRows] = await pool.execute('SELECT * FROM anon_threads WHERE id = ?', [req.params.id]);
        if (tRows.length === 0) return notFound(res, 'Nie znaleziono rozmowy');
        const thread = tRows[0];
        if (thread.initiator_id !== userId && thread.target_id !== userId) {
            return forbidden(res, 'To nie Twoja rozmowa');
        }

        await pool.execute(
            'INSERT INTO anon_messages (thread_id, sender_id, body) VALUES (?, ?, ?)',
            [thread.id, userId, String(body).trim()]
        );

        const otherUserId = thread.initiator_id === userId ? thread.target_id : thread.initiator_id;
        // The initiator stays anonymous in the target's notification;
        // the target's reply is labeled as a reply to your message
        const label = thread.initiator_id === userId
            ? 'Wiadomość od Świętego Mikołaja'
            : 'Odpowiedź na Twoją anonimową wiadomość';
        notifyAnonMessage(otherUserId, label, thread.id, String(body).trim());

        res.json({ success: true });
    } catch (err) {
        return handleDbError(err, res, 'Błąd podczas wysyłania odpowiedzi');
    }
});

// ---- Emoji reactions on a message ----
// Toggle: tapping the same emoji again removes it, a different emoji on
// the same message is allowed. Idempotent by the unique key.
// NO notification of any kind is produced here - no notifications row,
// no push, no activity feed, no is_read change. That is deliberate
// ("you don't need to notify about them").

router.post('/api/wiadomosci/messages/:messageId/reactions', requireAuth, async (req, res) => {
    const userId = req.session.userId;

    const messageId = parseReactionMessageId(req.params.messageId);
    if (messageId === null) return badRequest(res, 'Nieprawidłowa wiadomość');

    // Allowlist is the ONLY source of storable values - anything else is
    // rejected before it can reach the database
    const emoji = req.body ? req.body.emoji : null;
    if (!isAllowedReactionEmoji(emoji)) return badRequest(res, 'Nieprawidłowa reakcja');

    // Cheap checks first; the throttle counts only well-formed attempts
    if (!reactionRateAllows(userId)) {
        return res.status(429).json({ error: 'Zbyt wiele reakcji. Odczekaj chwilę' });
    }

    // Demo: same order of checks, same throttle, same participation rule and
    // the same aggregate-only response shape - no notification, no push, no
    // activity write, and never a reactor identity.
    if (DEMO_MODE) {
        const message = demoChat.messages.find(m => Number(m.id) === messageId);
        if (!message) return notFound(res, 'Nie znaleziono wiadomości');
        const thread = demoChat.threads.find(t => Number(t.id) === Number(message.thread_id));
        if (!thread || !demoIsParticipant(thread, userId)) return forbidden(res, 'To nie Twoja rozmowa');

        const action = demoReactionToggle(messageId, userId, emoji);
        console.log(`💜 [WIADOMOSCI] Reaction ${action} on message ${messageId}`);
        return res.json({
            success: true,
            action,
            messageId,
            emoji,
            reactions: buildReactionList(demoReactionRows(messageId, userId))
        });
    }

    try {
        await ensureAnonMessageTables();

        // Message + thread in one go, so participation is verified from
        // the message itself (sender_id is never read or returned)
        const [mRows] = await pool.execute(`
            SELECT m.id, t.initiator_id, t.target_id
            FROM anon_messages m
            JOIN anon_threads t ON t.id = m.thread_id
            WHERE m.id = ?
        `, [messageId]);
        if (mRows.length === 0) return notFound(res, 'Nie znaleziono wiadomości');
        const row = mRows[0];
        if (row.initiator_id !== userId && row.target_id !== userId) {
            return forbidden(res, 'To nie Twoja rozmowa');
        }

        // Toggle: delete first, insert only when nothing was removed.
        // INSERT IGNORE swallows the duplicate-key a racing double tap
        // would cause - the response still reflects the real aggregate.
        const [del] = await pool.execute(
            'DELETE FROM anon_message_reactions WHERE message_id = ? AND user_id = ? AND emoji = ?',
            [messageId, userId, emoji]
        );
        const action = reactionToggleAction(del.affectedRows);
        if (action === 'added') {
            await pool.execute(
                'INSERT IGNORE INTO anon_message_reactions (message_id, user_id, emoji) VALUES (?, ?, ?)',
                [messageId, userId, emoji]
            );
        }

        const [aggRows] = await pool.execute(`
            SELECT emoji, COUNT(*) AS cnt, MAX(user_id = ?) AS mine
            FROM anon_message_reactions
            WHERE message_id = ?
            GROUP BY emoji
        `, [userId, messageId]);

        // Identity-free log line: no user id, no emoji->user pairing
        console.log(`💜 [WIADOMOSCI] Reaction ${action} on message ${messageId}`);
        res.json({
            success: true,
            action,
            messageId,
            emoji,
            reactions: buildReactionList(aggRows)
        });
    } catch (err) {
        return handleDbError(err, res, 'Błąd podczas zapisywania reakcji');
    }
});

// ---- Link previews (Open Graph) for chat messages ----
// The browser can't read foreign pages (CORS), so the server fetches the
// URL and extracts og:title / og:image / description. Results cached.

router.get('/api/link-preview', requireAuth, async (req, res) => {
    const rawUrl = req.query.url;
    if (!rawUrl) return badRequest(res, 'Brak adresu URL');

    let parsed;
    try {
        parsed = new URL(rawUrl);
    } catch (e) {
        return badRequest(res, 'Nieprawidłowy adres URL');
    }
    if (!isSafePreviewUrl(parsed)) {
        return badRequest(res, 'Ten adres nie jest obsługiwany');
    }

    // Demo mode must stay hermetic: no outbound request, no network wait.
    if (DEMO_MODE) {
        return res.json({ url: parsed.href, title: null, description: null, image: null, siteName: parsed.hostname });
    }

    const cached = linkPreviewCache.get(parsed.href);
    if (cached && (Date.now() - cached.ts) < LINK_PREVIEW_TTL) {
        return res.json(cached.data);
    }

    try {
        // fetchPreview validates every resolved address and every redirect hop.
        // Hosts that resolve or redirect to private addresses yield the same
        // graceful empty preview (catch below); literal private IPs still get
        // the 400 from isSafePreviewUrl above.
        const page = await fetchPreview(parsed.href);

        const contentType = page.contentType;
        if (!contentType.includes('text/html')) {
            const data = { url: parsed.href, title: null, image: contentType.startsWith('image/') ? parsed.href : null, siteName: parsed.hostname };
            linkPreviewCache.set(parsed.href, { ts: Date.now(), data });
            return res.json(data);
        }

        // fetchPreview reads at most ~300KB - og tags live in <head>
        const html = page.html;

        const finalUrl = page.finalUrl || parsed.href;
        let image = extractMeta(html, 'og:image') || extractMeta(html, 'twitter:image');
        if (image) {
            try { image = new URL(image, finalUrl).href; } catch (e) { image = null; }
        }
        const titleTag = html.match(/<title[^>]*>([^<]*)<\/title>/i);
        const data = {
            url: finalUrl,
            title: extractMeta(html, 'og:title') || (titleTag ? titleTag[1].trim() : null),
            description: extractMeta(html, 'og:description') || extractMeta(html, 'description'),
            image,
            siteName: extractMeta(html, 'og:site_name') || new URL(finalUrl).hostname
        };

        linkPreviewCache.set(parsed.href, { ts: Date.now(), data });
        // Keep the cache bounded
        if (linkPreviewCache.size > 500) {
            const oldest = linkPreviewCache.keys().next().value;
            linkPreviewCache.delete(oldest);
        }
        res.json(data);
    } catch (err) {
        // Preview failures are expected (timeouts, bot blocks) - cache the
        // miss briefly and answer gracefully
        const data = { url: parsed.href, title: null, image: null, siteName: parsed.hostname };
        linkPreviewCache.set(parsed.href, { ts: Date.now(), data });
        res.json(data);
    }
});

module.exports = router;
