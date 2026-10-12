'use strict';
/**
 * "Did focus survive?" asserted on the NODE, not on a selector.
 *
 * The chat reaction strip used to be rebuilt wholesale on every 8 s poll, so
 * document.activeElement silently became <body> - a keyboard user was thrown
 * back to the top of the page mid-conversation. A selector-based check cannot
 * see that (the new node matches the same selector); stashing the actual node
 * and comparing identity can.
 */

const STASH = function () {
    window.__e2eFocusStash = document.activeElement;
    const el = document.activeElement;
    return el ? describe(el) : null;

    function describe(node) {
        return {
            tag: node.tagName ? node.tagName.toLowerCase() : String(node.nodeName),
            id: node.id || null,
            cls: node.getAttribute ? (node.getAttribute('class') || null) : null,
            emoji: node.getAttribute ? node.getAttribute('data-emoji') : null,
            messageId: node.getAttribute ? node.getAttribute('data-message-id') : null,
            label: node.getAttribute ? node.getAttribute('aria-label') : null
        };
    }
};

const SURVIVED = function () {
    const stashed = window.__e2eFocusStash;
    const active = document.activeElement;
    function describe(node) {
        if (!node) return null;
        return {
            tag: node.tagName ? node.tagName.toLowerCase() : String(node.nodeName),
            id: node.id || null,
            cls: node.getAttribute ? (node.getAttribute('class') || null) : null,
            emoji: node.getAttribute ? node.getAttribute('data-emoji') : null,
            messageId: node.getAttribute ? node.getAttribute('data-message-id') : null,
            label: node.getAttribute ? node.getAttribute('aria-label') : null
        };
    }
    return {
        same: stashed === active,
        stillInDocument: !!stashed && document.contains(stashed),
        stashed: describe(stashed),
        active: describe(active),
        activeIsBody: active === document.body
    };
};

const ACTIVE = function () {
    const node = document.activeElement;
    if (!node) return null;
    return {
        tag: node.tagName ? node.tagName.toLowerCase() : String(node.nodeName),
        id: node.id || null,
        cls: node.getAttribute ? (node.getAttribute('class') || null) : null,
        emoji: node.getAttribute ? node.getAttribute('data-emoji') : null,
        messageId: node.getAttribute ? node.getAttribute('data-message-id') : null,
        label: node.getAttribute ? node.getAttribute('aria-label') : null,
        isBody: node === document.body
    };
};

async function stashFocus(page) {
    return page.evaluate(STASH);
}

async function focusSurvived(page) {
    return page.evaluate(SURVIVED);
}

async function activeDescription(page) {
    return page.evaluate(ACTIVE);
}

function describeFocus(label, info) {
    if (!info) return label + ': nothing focused';
    return `${label}: <${info.tag}${info.id ? '#' + info.id : ''}` +
        `${info.cls ? ' class="' + info.cls + '"' : ''}` +
        `${info.emoji ? ' data-emoji="' + info.emoji + '"' : ''}>` +
        `${info.isBody ? ' (FOCUS FELL TO BODY)' : ''}`;
}

module.exports = { stashFocus, focusSurvived, activeDescription, describeFocus };
