// Shared wording for activity / notification messages.
// Warm activity-feed style with present-tense verbs, which are
// gender-neutral in Polish: "Monika rezerwuje „Książka” dla: Tomek".
// No emoji here - the notification UI already shows a per-type icon.
// Names after "dla" use the colon form because names can't be declined
// reliably.
//
//   notificationText(type, data, actor, opts) -> HTML string (or plain text)
//   reactionPreview(emoji, excerpt)           -> plain text for the chat
//                                                conversation-list preview
//
// type:  recipient_added | present_added | present_reserved |
//        present_unreserved | present_checked | present_unchecked |
//        present_added_batch (data.count = number of presents)
//        anything else -> "<actor> coś zmienia"
// data:  { presentTitle, recipientName, count, ... } (notification payload)
// actor: username of whoever did it (falsy -> "Ktoś")
// opts (all optional) - renderers keep their own links/markup:
//   html:      true (default) escapes values; false returns plain text
//   showActor: true (default) prefixes "<actor> "; false returns only the
//              rest ("dodaje prezent …") for renderers that print the
//              actor themselves
//   actor(escapedActor)              -> markup for the actor
//   person(escapedName, rawName)     -> markup for a person name
//   present(quotedTitle, data)       -> markup for the present title;
//                                       quotedTitle is already escaped
//   count(countText, data)           -> markup for "5 prezentów"
(function (root) {
    function escapeHtml(text) {
        return String(text == null ? '' : text)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function countText(n) {
        let plCount = root.plCount;
        if (typeof plCount !== 'function' && typeof require === 'function') {
            try { plCount = require('./pluralize-pl.js').plCount; } catch (e) { /* browser */ }
        }
        if (typeof plCount === 'function') {
            return plCount(n, 'prezent', 'prezenty', 'prezentów');
        }
        // Same rule as pluralize-pl.js, in case it isn't loaded
        const abs = Math.abs(n), last = abs % 10, lastTwo = abs % 100;
        const word = abs === 1 ? 'prezent'
            : (last >= 2 && last <= 4 && !(lastTwo >= 12 && lastTwo <= 14)) ? 'prezenty' : 'prezentów';
        return `${n} ${word}`;
    }

    function sameName(a, b) {
        return String(a).trim().toLowerCase() === String(b).trim().toLowerCase();
    }

    function notificationText(type, data, actor, opts) {
        data = data || {};
        opts = opts || {};
        const html = opts.html !== false;
        const esc = html ? escapeHtml : (t) => String(t == null ? '' : t);
        const strong = (t) => (html ? `<strong>${t}</strong>` : t);

        const actorName = actor || 'Ktoś';
        const actorOut = opts.actor ? opts.actor(esc(actorName)) : strong(esc(actorName));
        const person = (name) => (opts.person ? opts.person(esc(name), name) : strong(esc(name)));
        const quoted = `„${esc(data.presentTitle || 'prezent')}”`;
        const present = opts.present ? opts.present(quoted, data) : strong(quoted);
        // " dla: X" - skipped when X is the actor themselves (own list)
        const forWhom = (data.recipientName && !(actor && sameName(data.recipientName, actor)))
            ? ` dla: ${person(data.recipientName)}` : '';

        let body;
        switch (type) {
            case 'recipient_added':
                body = data.recipientName
                    ? `dodaje nową osobę: ${person(data.recipientName)}`
                    : 'dodaje nową osobę';
                break;
            case 'present_added':
                body = `dodaje prezent ${present}${forWhom}`;
                break;
            case 'present_reserved':
                body = `rezerwuje ${present}${forWhom}`;
                break;
            case 'present_unreserved':
                body = `rezygnuje z rezerwacji ${present}${forWhom}`;
                break;
            case 'present_checked':
                body = `kupuje ${present}${forWhom}`;
                break;
            case 'present_unchecked':
                body = `cofa oznaczenie „kupione” przy ${present}${forWhom}`;
                break;
            case 'present_added_batch': {
                const n = Number(data.count) || 0;
                const text = esc(countText(n));
                body = `dodaje ${opts.count ? opts.count(text, data) : strong(text)}${forWhom}`;
                break;
            }
            default:
                body = 'coś zmienia';
        }

        return opts.showActor === false ? body : `${actorOut} ${body}`;
    }

    // Conversation-list preview when the OTHER side reacted to a message:
    //   Zareagowano 👍 na „treść wiadomości…”
    // Impersonal past form on purpose: no name, no gender. This is the ONE
    // place that owns the wording - change the template here only.
    // Plain text: callers escape it for their own context.
    function reactionPreview(emoji, excerpt) {
        const text = String(excerpt == null ? '' : excerpt);
        return text ? `Zareagowano ${emoji} na „${text}”` : `Zareagowano ${emoji} na wiadomość`;
    }
    root.notificationText = notificationText;
    root.reactionPreview = reactionPreview;
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = { notificationText, escapeHtml, reactionPreview };
    }
})(typeof window !== 'undefined' ? window : globalThis);
