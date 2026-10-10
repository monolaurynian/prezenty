// Shared wording for activity / notification messages.
// Gender-neutral Polish: "Monika · rezerwacja: „Książka” (dla: Tomek)"
// instead of "Monika zarezerwował(a) …". Names after "dla" use the colon
// form because names can't be declined reliably.
//
//   notificationText(type, data, actor, opts) -> HTML string (or plain text)
//
// type:  recipient_added | present_added | present_reserved |
//        present_unreserved | present_checked | present_unchecked |
//        present_added_batch (data.count = number of presents)
//        anything else -> "<actor> · nowa aktywność"
// data:  { presentTitle, recipientName, count, ... } (notification payload)
// actor: username of whoever did it (falsy -> "Ktoś")
// opts (all optional) - renderers keep their own links/markup:
//   html:      true (default) escapes values; false returns plain text
//   showActor: true (default) prefixes "<actor> · "; false returns "· …"
//              for renderers that print the actor themselves
//   actor(escapedActor)              -> markup for the actor
//   person(escapedName, rawName)     -> markup for a person name
//   present(quotedTitle, data)       -> markup for the present title;
//                                       quotedTitle is already escaped
//   count(countText, data)           -> markup for "5 nowych prezentów"
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
            return plCount(n, 'nowy prezent', 'nowe prezenty', 'nowych prezentów');
        }
        return `nowe prezenty: ${n}`;
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
        // " (dla: X)" - skipped when X is the actor themselves
        const forWhom = (data.recipientName && !(actor && sameName(data.recipientName, actor)))
            ? ` (dla: ${person(data.recipientName)})` : '';

        let body;
        switch (type) {
            case 'recipient_added':
                body = data.recipientName ? `nowa osoba: ${person(data.recipientName)}` : 'nowa osoba';
                break;
            case 'present_added':
                body = `nowy prezent ${present}${forWhom}`;
                break;
            case 'present_reserved':
                body = `rezerwacja: ${present}${forWhom}`;
                break;
            case 'present_unreserved':
                body = `anulowana rezerwacja: ${present}${forWhom}`;
                break;
            case 'present_checked':
                body = `kupione: ${present}${forWhom}`;
                break;
            case 'present_unchecked':
                body = `cofnięto „kupione”: ${present}${forWhom}`;
                break;
            case 'present_added_batch': {
                const n = Number(data.count) || 0;
                const text = esc(countText(n));
                body = `${opts.count ? opts.count(text, data) : strong(text)}${forWhom}`;
                break;
            }
            default:
                body = 'nowa aktywność';
        }

        return opts.showActor === false ? `· ${body}` : `${actorOut} · ${body}`;
    }

    root.notificationText = notificationText;
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = { notificationText, escapeHtml };
    }
})(typeof window !== 'undefined' ? window : globalThis);
