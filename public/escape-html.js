// Shared output-escaping helpers, used by every page that builds HTML
// strings from user-controlled values (recipient names, present titles,
// profile-picture URLs) and hands them to innerHTML.
//
//   PrezentyEscape.escapeHtml(text)     -> text-safe AND quoted-attribute-safe
//   PrezentyEscape.escapeAttr(text)     -> same output; documents intent
//   PrezentyEscape.safeImageSrc(url)    -> an allowlisted, escaped URL or ''
//
// Deliberately namespaced on `PrezentyEscape` rather than a flat
// `window.escapeHtml`: nine page scripts already declare a top-level
// `function escapeHtml` (filters.js, formularz.js, recipients.js,
// archiwum.html, home.html, osoby.html, rezerwacje.html, ustawienia.html,
// wiadomosci.html) and every one of them is the `textContent -> innerHTML`
// idiom, which escapes & < > but NOT quotes. A function declaration would
// silently shadow a flat global and downgrade attribute escaping with no
// visible symptom; an object property cannot be shadowed that way, so the
// escaping here is load-order independent.
//
// Dual browser/Node module, same IIFE shape as notification-text.js and
// pluralize-pl.js, so the Node side can be unit-tested with require().
(function (root) {
    // The five replacements from notification-text.js:27-34 - the one
    // correct implementation already in this repo. Escaping both quote
    // characters is what makes the output safe inside a quoted attribute
    // as well as in element content.
    function escapeHtml(text) {
        return String(text == null ? '' : text)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    // Identical output. The separate name marks attribute call sites, the
    // same way recipients.js and formularz.js pair escapeHtml/escapeAttr.
    function escapeAttr(text) {
        return escapeHtml(text);
    }

    // Untrusted image URL -> a URL that is safe to drop into src="...".
    // Allowlist, not denylist: anything not positively recognised is
    // rejected, and the caller falls back to its emoji / default avatar.
    //
    // Accepted: a same-origin absolute path ("/api/recipients/5/profile-picture")
    //           or an absolute https:// URL.
    // Rejected: javascript:, data:, vbscript:, protocol-relative "//host"
    //           (that is off-origin), and anything carrying whitespace or a
    //           control character - "java\tscript:..." is parsed as
    //           javascript: by some browsers, so a URL containing either is
    //           never worth rendering.
    function safeImageSrc(url) {
        if (url == null) return '';
        const raw = String(url);
        if (raw === '') return '';
        // eslint-disable-next-line no-control-regex
        if (/[\u0000-\u0020\u007f-\u009f]/.test(raw)) return '';
        // Browsers treat "\" as "/" in http(s) URLs, so "/\evil.example/x"
        // resolves to https://evil.example/x and would slip past the
        // protocol-relative check below. No legitimate picture URL here
        // contains a backslash, so reject any.
        if (raw.indexOf('\\') !== -1) return '';
        const sameOriginPath = raw.charAt(0) === '/' && raw.charAt(1) !== '/';
        const absoluteHttps = /^https:\/\/[^/?#]/i.test(raw);
        if (!sameOriginPath && !absoluteHttps) return '';
        return escapeAttr(raw);
    }

    // A value as a JS string literal for use INSIDE a double-quoted inline
    // handler:  onclick="doThing(${jsStringAttr(name)})".
    //
    // Why this exists: escapeHtml / escapeAttr cannot make
    // onclick="f('NAME')" safe. The HTML parser decodes entities BEFORE the JS
    // parser runs, so &#39; reaches JS as a bare apostrophe and ends the
    // string. Here the value is first made a complete JS string literal
    // (JSON.stringify escapes " \ and control characters, so the literal
    // cannot end early), and only then HTML-escaped for the attribute. After
    // the HTML parser decodes it, JS sees exactly that literal - nothing the
    // value contains can leave the string.
    // The caller supplies the quotes' replacement itself: the returned text
    // already includes the surrounding (entity-encoded) double quotes, so do
    // NOT wrap it in '...'.
    function jsStringAttr(value) {
        return escapeAttr(JSON.stringify(String(value == null ? '' : value)));
    }

    root.PrezentyEscape = { escapeHtml, escapeAttr, safeImageSrc, jsStringAttr };
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = { escapeHtml, escapeAttr, safeImageSrc, jsStringAttr };
    }
})(typeof window !== 'undefined' ? window : globalThis);
