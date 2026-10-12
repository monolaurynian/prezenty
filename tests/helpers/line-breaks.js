'use strict';
/**
 * Where does a block of text actually break on screen?
 *
 * A Range over the element's text nodes yields one client rect per visual
 * line, so grouping rects by `top` reconstructs the lines, and the character
 * at each line boundary tells you whether the browser broke at a space or
 * sliced a word in half. That is how the old 'Murph / y' bug was found - the
 * markup and the text content looked fine, only the rendering was wrong.
 */

const MEASURE = function (element) {
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT, null);
    const lines = [];
    // Every captured character keeps its offset in the concatenated source
    // text. A space at a wrap point often renders with a zero-width rect and
    // is therefore not captured - without the offsets the two sides of the
    // break would look adjacent and a legitimate space break would be
    // reported as a mid-word slice.
    let source = '';
    let node;
    while ((node = walker.nextNode())) {
        const text = node.nodeValue;
        const base = source.length;
        source += text || '';
        if (!text || !text.trim()) continue;
        const range = document.createRange();
        for (let i = 0; i < text.length; i++) {
            range.setStart(node, i);
            range.setEnd(node, i + 1);
            const rect = range.getClientRects()[0];
            if (!rect || (rect.width === 0 && rect.height === 0)) continue;
            const key = Math.round(rect.top);
            let line = lines[lines.length - 1];
            if (!line || line.top !== key) {
                line = { top: key, chars: [], offsets: [] };
                lines.push(line);
            }
            line.chars.push(text[i]);
            line.offsets.push(base + i);
        }
        range.detach && range.detach();
    }

    const visualLines = lines.map(l => l.chars.join(''));
    const breaks = [];
    for (let i = 0; i < lines.length - 1; i++) {
        const current = lines[i];
        const next = lines[i + 1];
        const lastOffset = current.offsets[current.offsets.length - 1];
        const firstOffset = next.offsets[0];
        // What the source actually holds between the two rendered characters
        const between = source.slice(lastOffset + 1, firstOffset);
        breaks.push({
            before: current.chars[current.chars.length - 1],
            after: next.chars[0],
            between: between,
            skippedWhitespace: /\s/.test(between),
            lineIndex: i,
            lineText: visualLines[i]
        });
    }
    return {
        lines: visualLines,
        breaks: breaks,
        text: (element.textContent || '').trim()
    };
};

/** @param {import('@playwright/test').Locator} locator */
async function lineBreakInfo(locator) {
    return locator.evaluate(MEASURE);
}

const BREAKABLE = [' ', '\u00a0', '-', '\u2013', '\u2014', '/', ':', '?', '&', '=', '.', ',', '_'];

/**
 * Lines must only ever end on whitespace (or an explicit punctuation break).
 * Returns { ok, badBreaks, info } so the caller can print the real lines.
 */
async function wordBreakReport(locator) {
    const info = await lineBreakInfo(locator);
    const badBreaks = info.breaks.filter(b =>
        !b.skippedWhitespace && BREAKABLE.indexOf(b.before) === -1
    );
    return { ok: badBreaks.length === 0, badBreaks, info };
}

function describeBreaks(label, report) {
    const lines = [label + ': rendered as ' + report.info.lines.length + ' line(s)'];
    report.info.lines.forEach((l, i) => lines.push(`  [${i}] "${l}"`));
    report.badBreaks.forEach(b => lines.push(`  broke mid-word after "${b.before}" then "${b.after}" (line ${b.lineIndex})`));
    return lines.join('\n');
}

module.exports = { lineBreakInfo, wordBreakReport, describeBreaks, BREAKABLE };
