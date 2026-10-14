#!/usr/bin/env node
'use strict';
/**
 * Builds public/emoji-data.js (the bundled emoji dataset behind the chat
 * reaction picker and the server-side reaction allowlist) from the pinned
 * Unicode file emoji-test.txt.
 *
 *   node scripts/build-emoji-data.js [--in <local emoji-test.txt>] [--out <path>] [--help]
 *
 *   --in <path>   read a local copy of emoji-test.txt (default: download SOURCE_URL)
 *   --out <path>  write the generated module here (default: public/emoji-data.js)
 *
 * Rules:
 *   - only `fully-qualified` lines are kept;
 *   - the `Component` group is dropped;
 *   - any sequence containing a skin-tone modifier (U+1F3FB..U+1F3FF) is dropped;
 *   - every emoji must be unique and have <= 16 code points, because
 *     chat_message_reactions.emoji is VARCHAR(16) (VARCHAR counts code points);
 *   - categories keep the order of the Unicode file.
 *
 * Dev-time only: nothing at runtime or in package.json depends on this script.
 */
const fs = require('fs');
const path = require('path');

const EMOJI_VERSION = '15.0';
const SOURCE_URL = 'https://unicode.org/Public/emoji/15.0/emoji-test.txt';
const MAX_CODE_POINTS = 16;
const DEFAULT_OUT = path.resolve(__dirname, '..', 'public', 'emoji-data.js');

// Unicode group name -> picker category (Polish label, tab icon as plain text).
const CATEGORIES = [
    { group: 'Smileys & Emotion', id: 'smileys', label: 'Buźki i emocje', icon: '😀' },
    { group: 'People & Body', id: 'people', label: 'Ludzie', icon: '🧑' },
    { group: 'Animals & Nature', id: 'animals', label: 'Zwierzęta i natura', icon: '🐻' },
    { group: 'Food & Drink', id: 'food', label: 'Jedzenie i picie', icon: '🍔' },
    { group: 'Travel & Places', id: 'travel', label: 'Podróże i miejsca', icon: '🚗' },
    { group: 'Activities', id: 'activities', label: 'Aktywności', icon: '⚽' },
    { group: 'Objects', id: 'objects', label: 'Przedmioty', icon: '💡' },
    { group: 'Symbols', id: 'symbols', label: 'Symbole', icon: '🔣' },
    { group: 'Flags', id: 'flags', label: 'Flagi', icon: '🏁' }
];

function parseArgs(argv) {
    const args = { in: null, out: DEFAULT_OUT, help: false };
    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        if (arg === '--help' || arg === '-h') args.help = true;
        else if (arg === '--in' && argv[i + 1]) args.in = path.resolve(argv[++i]);
        else if (arg === '--out' && argv[i + 1]) args.out = path.resolve(argv[++i]);
        else throw new Error('Unknown or incomplete argument: ' + arg);
    }
    return args;
}

async function readSource(inPath) {
    if (inPath) return fs.readFileSync(inPath, 'utf8');
    if (typeof fetch !== 'function') throw new Error('Global fetch is not available; use --in <path>.');
    const response = await fetch(SOURCE_URL);
    if (!response.ok) throw new Error('Download failed: HTTP ' + response.status + ' for ' + SOURCE_URL);
    return response.text();
}

function isSkinTone(codePoint) {
    return codePoint >= 0x1F3FB && codePoint <= 0x1F3FF;
}

function parse(text) {
    const byGroup = new Map();
    let group = null;
    text.split(/\r?\n/).forEach(line => {
        const groupMatch = /^# group: (.+)$/.exec(line);
        if (groupMatch) {
            group = groupMatch[1].trim();
            return;
        }
        if (!line || line.charAt(0) === '#') return;
        const match = /^([0-9A-F ]+?)\s*;\s*([a-z-]+)\s*#\s*(\S+)\s+E[0-9.]+\s/.exec(line);
        if (!match || match[2] !== 'fully-qualified' || !group || group === 'Component') return;
        const codePoints = match[1].trim().split(/\s+/).map(hex => parseInt(hex, 16));
        if (codePoints.some(isSkinTone)) return;
        const emoji = String.fromCodePoint.apply(null, codePoints);
        if (emoji !== match[3]) throw new Error('Code points do not match glyph on line: ' + line);
        if (codePoints.length > MAX_CODE_POINTS) {
            throw new Error(emoji + ' has ' + codePoints.length + ' code points (max ' + MAX_CODE_POINTS + ')');
        }
        if (!byGroup.has(group)) byGroup.set(group, []);
        byGroup.get(group).push(emoji);
    });
    return byGroup;
}

function build(byGroup) {
    const seen = new Set();
    const categories = CATEGORIES.map(category => {
        const list = byGroup.get(category.group);
        if (!list || !list.length) throw new Error('No emoji found for group: ' + category.group);
        list.forEach(emoji => {
            if (seen.has(emoji)) throw new Error('Duplicate emoji: ' + emoji);
            seen.add(emoji);
        });
        return { id: category.id, label: category.label, icon: category.icon, emoji: list.join(' ') };
    });
    return { categories: categories, total: seen.size };
}

function render(data, command) {
    const lines = data.categories.map(category =>
        '            { id: ' + JSON.stringify(category.id)
        + ', label: ' + JSON.stringify(category.label)
        + ', icon: ' + JSON.stringify(category.icon)
        + ', emoji: ' + JSON.stringify(category.emoji) + ' }');
    return [
        '/*',
        ' * GENERATED FILE - do not edit by hand.',
        ' * Source:    ' + SOURCE_URL,
        ' * Emoji:     ' + EMOJI_VERSION + ' (fully-qualified, base emoji without skin tones, no Component group)',
        ' * Generator: ' + command,
        ' *',
        ' * Shape: EmojiData = { version, categories: [{ id, label, icon, emoji }] }, where',
        ' * `emoji` is ONE space-separated string. Used by chat-reactions.js (allowlist +',
        ' * ordering, also on the server via require) and the reaction picker.',
        ' */',
        '(function (root) {',
        "    'use strict';",
        '    const EmojiData = {',
        '        version: ' + JSON.stringify(EMOJI_VERSION) + ',',
        '        categories: [',
        lines.join(',\n'),
        '        ]',
        '    };',
        "    if (typeof module !== 'undefined' && module.exports) {",
        '        module.exports = EmojiData;',
        '    }',
        "    if (root) root.EmojiData = EmojiData;",
        "})(typeof window !== 'undefined' ? window : null);",
        ''
    ].join('\n');
}

async function main() {
    const args = parseArgs(process.argv.slice(2));
    if (args.help) {
        console.log('Usage: node scripts/build-emoji-data.js [--in <emoji-test.txt>] [--out <path>]');
        return;
    }
    const data = build(parse(await readSource(args.in)));
    const command = 'node scripts/build-emoji-data.js'
        + (args.in ? ' --in <local emoji-test.txt>' : '')
        + ' --out public/emoji-data.js';
    fs.mkdirSync(path.dirname(args.out), { recursive: true });
    fs.writeFileSync(args.out, render(data, command), 'utf8');
    console.log('Wrote ' + args.out + ' (' + data.total + ' emoji, ' + data.categories.length + ' categories)');
}

main().catch(error => {
    console.error(error.message);
    process.exit(1);
});
