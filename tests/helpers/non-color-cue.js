'use strict';
/**
 * "Pressed" must be visible to someone who cannot tell the two colours apart.
 *
 * nonColorSignature() deliberately strips every colour component, so two
 * elements that differ ONLY in colour produce an identical signature. If the
 * pressed and unpressed signatures are equal, colour is the only cue - which
 * is a WCAG 1.4.1 failure, and the thing this helper exists to catch.
 */

const SIGNATURE = function (element) {
    const s = getComputedStyle(element);
    // box-shadow strings carry colours; keep only the geometry numbers.
    const shadowGeometry = (s.boxShadow || 'none')
        .replace(/rgba?\([^)]*\)/g, '')
        .replace(/#[0-9a-f]{3,8}/gi, '')
        .replace(/\s+/g, ' ')
        .trim();
    const rect = element.getBoundingClientRect();
    return {
        borderWidth: s.borderTopWidth + ' ' + s.borderRightWidth + ' ' + s.borderBottomWidth + ' ' + s.borderLeftWidth,
        borderStyle: s.borderTopStyle + ' ' + s.borderRightStyle + ' ' + s.borderBottomStyle + ' ' + s.borderLeftStyle,
        outline: s.outlineWidth + ' ' + s.outlineStyle,
        boxShadow: shadowGeometry,
        textDecoration: s.textDecorationLine,
        fontWeight: s.fontWeight,
        fontStyle: s.fontStyle,
        hasBackgroundImage: s.backgroundImage !== 'none',
        // size is reported but kept OUT of the signature comparison helpers
        // below, so a layout shift can be asserted separately
        box: { width: Math.round(rect.width * 100) / 100, height: Math.round(rect.height * 100) / 100 }
    };
};

/** @param {import('@playwright/test').Locator} locator */
async function nonColorSignature(locator) {
    return locator.evaluate(SIGNATURE);
}

function signatureKey(sig) {
    return [
        sig.borderWidth, sig.borderStyle, sig.outline, sig.boxShadow,
        sig.textDecoration, sig.fontWeight, sig.fontStyle, String(sig.hasBackgroundImage)
    ].join(' | ');
}

function describeSignature(label, sig) {
    return `${label}: border-width [${sig.borderWidth}] border-style [${sig.borderStyle}] ` +
        `outline [${sig.outline}] box-shadow [${sig.boxShadow}] weight ${sig.fontWeight} ` +
        `bg-image ${sig.hasBackgroundImage} box ${sig.box.width}x${sig.box.height}`;
}

module.exports = { nonColorSignature, signatureKey, describeSignature };
