'use strict';
/**
 * Three mechanical accessibility checks that do not need a full audit engine
 * and that catch the mistakes this codebase actually makes:
 *
 *  - an icon-only button with no accessible name (a screen reader announces
 *    "button" and nothing else);
 *  - an element that is aria-hidden AND still focusable (a keyboard user lands
 *    on something a screen reader refuses to announce);
 *  - a positive tabindex, which rearranges tab order globally.
 *
 * Full WCAG conformance still needs manual assistive-technology testing; this
 * is a smoke check, not a certificate.
 */

const FOCUSABLE_SELECTOR =
    'a[href], area[href], button, input, select, textarea, iframe, object, embed, ' +
    'summary, audio[controls], video[controls], [contenteditable], [tabindex]';

const ICON_ONLY = function (excludeSelector) {
    function visible(el) {
        const s = getComputedStyle(el);
        if (s.display === 'none' || s.visibility === 'hidden') return false;
        // No client rects means an ancestor is display:none - not rendered,
        // so not reachable and not a finding.
        if (el.getClientRects().length === 0) return false;
        const r = el.getBoundingClientRect();
        return r.width > 0 || r.height > 0;
    }
    function path(el) {
        let out = el.tagName.toLowerCase();
        if (el.id) return out + '#' + el.id;
        const cls = (el.getAttribute('class') || '').trim().split(/\s+/).filter(Boolean).slice(0, 3);
        if (cls.length) out += '.' + cls.join('.');
        const parent = el.parentElement;
        return (parent ? path(parent).split(' > ').slice(-1)[0] + ' > ' : '') + out;
    }
    // Text a screen reader would read, ignoring aria-hidden subtrees.
    function visibleText(el) {
        let text = '';
        el.childNodes.forEach(function (node) {
            if (node.nodeType === 3) { text += node.nodeValue; return; }
            if (node.nodeType !== 1) return;
            if (node.getAttribute('aria-hidden') === 'true') return;
            const s = getComputedStyle(node);
            if (s.display === 'none' || s.visibility === 'hidden') return;
            text += visibleText(node);
        });
        return text;
    }
    function accessibleName(el) {
        const label = el.getAttribute('aria-label');
        if (label && label.trim()) return label.trim();
        const labelledby = el.getAttribute('aria-labelledby');
        if (labelledby) {
            const parts = labelledby.split(/\s+/)
                .map(id => document.getElementById(id))
                .filter(Boolean)
                .map(node => (node.textContent || '').trim())
                .filter(Boolean);
            if (parts.length) return parts.join(' ');
        }
        const title = el.getAttribute('title');
        if (title && title.trim()) return title.trim();
        const value = el.getAttribute('value');
        if (el.tagName === 'INPUT' && value && value.trim()) return value.trim();
        return visibleText(el).trim();
    }

    const controls = Array.prototype.slice.call(
        document.querySelectorAll('button, a[href], [role="button"], input[type="button"], input[type="submit"]')
    );
    return controls
        .filter(visible)
        .filter(el => el.getAttribute('aria-hidden') !== 'true')
        .filter(el => !(excludeSelector && el.closest(excludeSelector)))
        .filter(el => !accessibleName(el))
        .map(el => ({ path: path(el), html: el.outerHTML.slice(0, 160) }));
};

const ARIA_HIDDEN_FOCUSABLE = function (focusableSelector) {
    function path(el) {
        let out = el.tagName.toLowerCase();
        if (el.id) out += '#' + el.id;
        const cls = (el.getAttribute('class') || '').trim().split(/\s+/).filter(Boolean).slice(0, 2);
        if (cls.length) out += '.' + cls.join('.');
        return out;
    }
    const out = [];
    Array.prototype.slice.call(document.querySelectorAll('[aria-hidden="true"]')).forEach(function (hidden) {
        if (hidden.hasAttribute('inert')) return; // inert removes it from the tab order
        const candidates = Array.prototype.slice.call(hidden.querySelectorAll(focusableSelector));
        if (hidden.matches(focusableSelector)) candidates.unshift(hidden);
        candidates.forEach(function (el) {
            if (el.disabled) return;
            if (el.hasAttribute('inert') || el.closest('[inert]')) return;
            const tabindex = el.getAttribute('tabindex');
            if (tabindex !== null && Number(tabindex) < 0) return;
            const s = getComputedStyle(el);
            if (s.display === 'none' || s.visibility === 'hidden') return;
            // A closed Bootstrap modal is aria-hidden AND display:none, so its
            // buttons have no client rects and cannot be tabbed to. Only a
            // RENDERED focusable inside an aria-hidden subtree is a finding.
            if (el.getClientRects().length === 0) return;
            out.push({ path: path(el), insideHidden: path(hidden), html: el.outerHTML.slice(0, 140) });
        });
    });
    return out;
};

const POSITIVE_TABINDEX = function () {
    return Array.prototype.slice.call(document.querySelectorAll('[tabindex]'))
        .filter(el => Number(el.getAttribute('tabindex')) > 0)
        .map(el => ({ tabindex: el.getAttribute('tabindex'), html: el.outerHTML.slice(0, 140) }));
};

async function iconOnlyButtonsWithoutName(page, excludeSelector) {
    return page.evaluate(ICON_ONLY, excludeSelector || null);
}

async function focusableInsideAriaHidden(page) {
    return page.evaluate(ARIA_HIDDEN_FOCUSABLE, FOCUSABLE_SELECTOR);
}

async function positiveTabIndexes(page) {
    return page.evaluate(POSITIVE_TABINDEX);
}

/**
 * Tab `steps` times and report where focus lands, so a focus trap can be
 * asserted: every landing must be inside `rootSelector`.
 */
async function tabCycle(page, rootSelector, steps) {
    const seen = [];
    for (let i = 0; i < steps; i++) {
        await page.keyboard.press('Tab');
        seen.push(await page.evaluate((selector) => {
            const root = document.querySelector(selector);
            const active = document.activeElement;
            return {
                inside: !!(root && active && root.contains(active)),
                tag: active ? active.tagName.toLowerCase() : null,
                id: active ? active.id || null : null,
                cls: active && active.getAttribute ? active.getAttribute('class') : null,
                isBody: active === document.body
            };
        }, rootSelector));
    }
    return seen;
}

module.exports = {
    iconOnlyButtonsWithoutName,
    focusableInsideAriaHidden,
    positiveTabIndexes,
    tabCycle,
    FOCUSABLE_SELECTOR
};
