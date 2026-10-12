'use strict';
/**
 * WCAG 2.x contrast ratio from MEASURED computed colours.
 *
 * The effective background is resolved by walking ancestors until the first
 * non-transparent background-color, because the element itself is usually
 * transparent. Font size and weight come back too, so the caller can pick the
 * right threshold (3:1 for large text and UI components, 4.5:1 otherwise).
 */

const MEASURE = function (element) {
    function parse(color) {
        const m = String(color).match(/rgba?\(([^)]+)\)/);
        if (!m) return null;
        const parts = m[1].split(/[,\s/]+/).filter(Boolean).map(Number);
        return { r: parts[0], g: parts[1], b: parts[2], a: parts.length > 3 ? parts[3] : 1 };
    }

    function blend(fg, bg) {
        if (fg.a >= 1) return fg;
        return {
            r: fg.r * fg.a + bg.r * (1 - fg.a),
            g: fg.g * fg.a + bg.g * (1 - fg.a),
            b: fg.b * fg.a + bg.b * (1 - fg.a),
            a: 1
        };
    }

    function luminance(c) {
        const channel = (v) => {
            const s = v / 255;
            return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
        };
        return 0.2126 * channel(c.r) + 0.7152 * channel(c.g) + 0.0722 * channel(c.b);
    }

    const style = getComputedStyle(element);
    const fg = parse(style.color) || { r: 0, g: 0, b: 0, a: 1 };

    let bg = { r: 255, g: 255, b: 255, a: 1 };
    let node = element;
    const chain = [];
    while (node) {
        const c = parse(getComputedStyle(node).backgroundColor);
        if (c && c.a > 0) {
            chain.push({ tag: node.tagName.toLowerCase(), color: getComputedStyle(node).backgroundColor });
            if (c.a >= 1) { bg = c; break; }
            bg = blend(c, bg);
        }
        node = node.parentElement;
    }

    const effectiveFg = blend(fg, bg);
    const l1 = luminance(effectiveFg);
    const l2 = luminance(bg);
    const ratio = (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);

    return {
        ratio: Math.round(ratio * 100) / 100,
        color: style.color,
        background: 'rgb(' + Math.round(bg.r) + ', ' + Math.round(bg.g) + ', ' + Math.round(bg.b) + ')',
        fontPx: parseFloat(style.fontSize),
        fontWeight: style.fontWeight,
        backgroundChain: chain
    };
};

const MEASURE_BORDER = function (element) {
    function parse(color) {
        const m = String(color).match(/rgba?\(([^)]+)\)/);
        if (!m) return null;
        const parts = m[1].split(/[,\s/]+/).filter(Boolean).map(Number);
        return { r: parts[0], g: parts[1], b: parts[2], a: parts.length > 3 ? parts[3] : 1 };
    }
    function blend(fg, bg) {
        if (fg.a >= 1) return fg;
        return {
            r: fg.r * fg.a + bg.r * (1 - fg.a),
            g: fg.g * fg.a + bg.g * (1 - fg.a),
            b: fg.b * fg.a + bg.b * (1 - fg.a),
            a: 1
        };
    }
    function luminance(c) {
        const channel = (v) => {
            const s = v / 255;
            return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
        };
        return 0.2126 * channel(c.r) + 0.7152 * channel(c.g) + 0.0722 * channel(c.b);
    }

    const style = getComputedStyle(element);
    // The surface the border sits ON is the first opaque background OUTSIDE
    // the element itself.
    let bg = { r: 255, g: 255, b: 255, a: 1 };
    let node = element.parentElement;
    while (node) {
        const c = parse(getComputedStyle(node).backgroundColor);
        if (c && c.a > 0) {
            if (c.a >= 1) { bg = c; break; }
            bg = blend(c, bg);
        }
        node = node.parentElement;
    }
    const border = blend(parse(style.borderTopColor) || { r: 0, g: 0, b: 0, a: 1 }, bg);
    const l1 = luminance(border);
    const l2 = luminance(bg);
    return {
        ratio: Math.round(((Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05)) * 100) / 100,
        borderColor: style.borderTopColor,
        borderWidth: style.borderTopWidth,
        surface: 'rgb(' + Math.round(bg.r) + ', ' + Math.round(bg.g) + ', ' + Math.round(bg.b) + ')'
    };
};

/** @param {import('@playwright/test').Locator} locator */
async function measureContrast(locator) {
    return locator.evaluate(MEASURE);
}

/** @param {import('@playwright/test').Locator} locator */
async function measureBorderContrast(locator) {
    return locator.evaluate(MEASURE_BORDER);
}

/** 3:1 for large text (>=24px, or >=18.66px bold), else 4.5:1. */
function requiredRatio(measurement) {
    const bold = Number(measurement.fontWeight) >= 700;
    const large = measurement.fontPx >= 24 || (bold && measurement.fontPx >= 18.66);
    return large ? 3 : 4.5;
}

module.exports = { measureContrast, measureBorderContrast, requiredRatio };
