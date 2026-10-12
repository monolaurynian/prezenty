'use strict';
/**
 * Horizontal-overflow detector.
 *
 * Three independent measurements, because each one catches a different bug:
 *
 *  1. root scroll        - document.scrollingElement.scrollWidth vs clientWidth.
 *                          This is what makes the page scroll sideways.
 *  2. scroll containers  - every element whose computed overflow-x/overflow-y is
 *                          auto|scroll, compared scrollWidth vs clientWidth.
 *                          Catches the inner scrollbar case (#chatMessages was
 *                          scrollWidth 323 / clientWidth 317 - a real +6px bug).
 *  3. element right edge - a DOM walk comparing getBoundingClientRect().right
 *                          to the limit, skipping anything a clipping ancestor
 *                          already contains, plus ::before/::after boxes
 *                          reconstructed from computed style (pseudo elements
 *                          have no client rect of their own).
 *
 * `ignoreGuard: true` first neutralises any `html, body { overflow-x: hidden }`
 * rule and re-measures, which is how you tell a structurally clean layout from
 * one that merely has its overflow clipped out of sight.
 */

const COLLECT = function (options) {
    const tolerance = options.tolerance;
    const containerSelector = options.containerSelector || null;
    const ignoreGuard = !!options.ignoreGuard;

    // ---- optionally neutralise the body-level overflow guard ----
    const restore = [];
    if (ignoreGuard) {
        const sheets = Array.prototype.slice.call(document.styleSheets);
        sheets.forEach(function (sheet) {
            let rules;
            try { rules = sheet.cssRules; } catch (e) { return; } // cross-origin
            if (!rules) return;
            Array.prototype.slice.call(rules).forEach(function (rule) {
                if (!rule.style || !rule.selectorText) return;
                if (!/(^|,)\s*(html|body)\b/.test(rule.selectorText)) return;
                ['overflow-x', 'overflow'].forEach(function (prop) {
                    const value = rule.style.getPropertyValue(prop);
                    if (value === 'hidden' || value === 'clip') {
                        restore.push({ style: rule.style, prop: prop, value: value, priority: rule.style.getPropertyPriority(prop) });
                        rule.style.removeProperty(prop);
                    }
                });
            });
        });
        [document.documentElement, document.body].forEach(function (el) {
            if (!el) return;
            ['overflow-x', 'overflow'].forEach(function (prop) {
                const value = el.style.getPropertyValue(prop);
                if (value === 'hidden' || value === 'clip') {
                    restore.push({ style: el.style, prop: prop, value: value, priority: el.style.getPropertyPriority(prop) });
                    el.style.removeProperty(prop);
                }
            });
        });
        // force a reflow so the measurements below see the new layout
        void document.documentElement.offsetWidth;
    }

    function path(el) {
        const parts = [];
        let node = el;
        while (node && node.nodeType === 1 && parts.length < 6) {
            let part = node.tagName.toLowerCase();
            if (node.id) {
                part += '#' + node.id;
                parts.unshift(part);
                break;
            }
            const cls = (node.getAttribute('class') || '').trim().split(/\s+/).filter(Boolean).slice(0, 2);
            if (cls.length) part += '.' + cls.join('.');
            parts.unshift(part);
            node = node.parentElement;
        }
        return parts.join(' > ');
    }

    function clips(style) {
        return ['hidden', 'clip', 'auto', 'scroll'].indexOf(style.overflowX) !== -1;
    }

    const root = document.scrollingElement || document.documentElement;
    const container = containerSelector ? document.querySelector(containerSelector) : null;
    if (containerSelector && !container) {
        return { error: 'container not found: ' + containerSelector };
    }

    let limit;
    let scopeRoot;
    if (container) {
        const cs = getComputedStyle(container);
        const rect = container.getBoundingClientRect();
        limit = rect.right - parseFloat(cs.borderRightWidth || 0) - parseFloat(cs.paddingRight || 0);
        scopeRoot = container;
    } else {
        limit = root.clientWidth;
        scopeRoot = document.body;
    }

    const result = {
        viewport: { width: window.innerWidth, height: window.innerHeight },
        limit: limit,
        rootScroll: {
            scrollWidth: root.scrollWidth,
            clientWidth: root.clientWidth,
            delta: root.scrollWidth - root.clientWidth
        },
        scrollers: [],
        offenders: []
    };

    const all = scopeRoot ? Array.prototype.slice.call(scopeRoot.querySelectorAll('*')) : [];
    if (container) all.unshift(container);

    all.forEach(function (el) {
        const style = getComputedStyle(el);
        if (style.display === 'none' || style.visibility === 'hidden') return;

        // (2) scroll containers.
        // Only overflow-x auto|scroll can actually scroll sideways. An
        // element with overflow-y:auto and overflow-x:hidden reports
        // scrollWidth > clientWidth too, but it clips instead of scrolling,
        // so counting it produces nothing but noise.
        const scrollable = ['auto', 'scroll'].indexOf(style.overflowX) !== -1;
        if (scrollable && el.scrollWidth - el.clientWidth > tolerance) {
            result.scrollers.push({
                path: path(el),
                scrollWidth: el.scrollWidth,
                clientWidth: el.clientWidth,
                delta: el.scrollWidth - el.clientWidth,
                overflowX: style.overflowX,
                overflowY: style.overflowY
            });
        }

        const rect = el.getBoundingClientRect();
        if (rect.width === 0 && rect.height === 0) return;

        // Parked off-canvas, not overflowing: the whole box starts at or past
        // the limit (a closed slide-in menu, an off-screen drawer). Those are
        // deliberate. An element that STARTS inside and reaches past the edge
        // is the thing we are hunting.
        if (rect.left >= limit - tolerance) return;

        // Is anything between this element and the scope root already
        // containing the overflow? Then it cannot push the page sideways.
        let clipped = false;
        let ancestor = el.parentElement;
        while (ancestor && ancestor !== scopeRoot.parentElement) {
            if (clips(getComputedStyle(ancestor))) { clipped = true; break; }
            ancestor = ancestor.parentElement;
        }

        // (3a) the element's own box
        if (!clipped && rect.right - limit > tolerance) {
            result.offenders.push({
                path: path(el),
                right: Math.round(rect.right * 100) / 100,
                limit: Math.round(limit * 100) / 100,
                delta: Math.round((rect.right - limit) * 100) / 100,
                pseudo: null,
                text: (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 60)
            });
        }

        // (3b) ::before / ::after - no client rect, so rebuild the box from
        // computed style relative to the element it hangs off.
        ['::before', '::after'].forEach(function (pseudo) {
            const ps = getComputedStyle(el, pseudo);
            if (!ps) return;
            if (ps.content === 'none' || ps.content === 'normal' || ps.content === '') return;
            if (ps.display === 'none' || ps.visibility === 'hidden') return;
            const width = parseFloat(ps.width) || 0;
            let pseudoRight;
            if (ps.position === 'absolute' || ps.position === 'fixed') {
                if (ps.right !== 'auto') pseudoRight = rect.right - parseFloat(ps.right);
                else if (ps.left !== 'auto') pseudoRight = rect.left + parseFloat(ps.left) + width;
                else pseudoRight = rect.left + width;
            } else {
                pseudoRight = rect.left + width;
            }
            if (!clipped && pseudoRight - limit > tolerance) {
                result.offenders.push({
                    path: path(el),
                    right: Math.round(pseudoRight * 100) / 100,
                    limit: Math.round(limit * 100) / 100,
                    delta: Math.round((pseudoRight - limit) * 100) / 100,
                    pseudo: pseudo,
                    text: ''
                });
            }
        });
    });

    // ---- put the guard back so later measurements are unaffected ----
    restore.reverse().forEach(function (entry) {
        entry.style.setProperty(entry.prop, entry.value, entry.priority);
    });

    return result;
};

/**
 * @param {import('@playwright/test').Page} page
 * @param {{container?:string, ignoreGuard?:boolean, tolerance?:number}} [options]
 */
async function collectOverflow(page, options) {
    const opts = options || {};
    const result = await page.evaluate(COLLECT, {
        containerSelector: opts.container || null,
        ignoreGuard: !!opts.ignoreGuard,
        // Sub-pixel layout rounds in ways that are not real overflow.
        tolerance: typeof opts.tolerance === 'number' ? opts.tolerance : 0.5
    });
    if (result && result.error) throw new Error(result.error);
    return result;
}

/** Human-readable failure text - the numbers are the point. */
function describeOverflow(label, report) {
    const lines = [
        `${label}: viewport ${report.viewport.width}x${report.viewport.height}, ` +
        `root scrollWidth ${report.rootScroll.scrollWidth} / clientWidth ${report.rootScroll.clientWidth} ` +
        `(delta ${report.rootScroll.delta})`
    ];
    report.scrollers.forEach(s => {
        lines.push(`  scroller ${s.path}: scrollWidth ${s.scrollWidth} / clientWidth ${s.clientWidth} (+${s.delta}px, overflow-x: ${s.overflowX})`);
    });
    report.offenders.forEach(o => {
        lines.push(`  overflows by +${o.delta}px${o.pseudo ? ' [' + o.pseudo + ']' : ''}: ${o.path}` +
            (o.text ? ` — "${o.text}"` : ''));
    });
    return lines.join('\n');
}

module.exports = { collectOverflow, describeOverflow };
