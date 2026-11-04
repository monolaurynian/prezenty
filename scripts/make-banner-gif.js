// Generates the animated picture for the "GIF-y" entry of the "Nowa wersja"
// banner: public/release/gify.gif (+ gify-still.gif for reduced motion).
//
//   node scripts/make-banner-gif.js
//
// It is our own drawing (the GIF button is pressed, the picker opens, a GIF
// is chosen and lands in the chat), so it needs no GIF provider or key and
// has no third-party licence. The output is committed; re-run only to change
// it. Needs `sharp` (a dependency).
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const OUT = path.join(__dirname, '..', 'public', 'release');
const W = 360;
const H = 180;
const PURPLE = '#7B1FA2';
const SOFT = '#F3E5F5';
const FONT = 'font-family="Arial, Helvetica, sans-serif"';

// A flat smiley face centred at (cx, cy)
function face(cx, cy, r, fill) {
    return `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${fill}"/>` +
        `<circle cx="${cx - r * 0.35}" cy="${cy - r * 0.2}" r="${r * 0.1}" fill="#3e2723"/>` +
        `<circle cx="${cx + r * 0.35}" cy="${cy - r * 0.2}" r="${r * 0.1}" fill="#3e2723"/>` +
        `<path d="M ${cx - r * 0.45} ${cy + r * 0.15} Q ${cx} ${cy + r * 0.7} ${cx + r * 0.45} ${cy + r * 0.15}" ` +
        `fill="none" stroke="#3e2723" stroke-width="${Math.max(2, r * 0.12)}" stroke-linecap="round"/>`;
}

// The composer along the bottom: text box, GIF button, send button
function composer(gifPressed) {
    return `<rect x="14" y="132" width="196" height="34" rx="17" fill="#ffffff" stroke="#c5c9d0" stroke-width="2"/>` +
        `<text x="30" y="154" ${FONT} font-size="13" fill="#9aa0a6">Odpowiedz...</text>` +
        `<rect x="222" y="132" width="58" height="34" rx="9" fill="${gifPressed ? PURPLE : '#ffffff'}" stroke="${PURPLE}" stroke-width="3"/>` +
        `<text x="251" y="155" text-anchor="middle" ${FONT} font-size="15" font-weight="700" fill="${gifPressed ? '#ffffff' : PURPLE}">GIF</text>` +
        `<rect x="292" y="132" width="54" height="34" rx="9" fill="${PURPLE}"/>` +
        `<path d="M 311 149 L 331 140 L 325 158 L 321 150 Z" fill="#ffffff"/>`;
}

// The picker sheet with three GIF tiles; `selected` is 0-2 or -1
function picker(selected) {
    const colors = ['#ef5350', '#42a5f5', '#ffca28'];
    let tiles = '';
    for (let i = 0; i < 3; i++) {
        const x = 24 + i * 106;
        tiles += `<rect x="${x}" y="40" width="96" height="76" rx="10" fill="${colors[i]}"` +
            `${selected === i ? ` stroke="${PURPLE}" stroke-width="5"` : ''}/>` + face(x + 48, 78, 22, '#ffffff');
    }
    return `<rect x="8" y="10" width="344" height="114" rx="16" fill="#ffffff" stroke="#d6d9de" stroke-width="2"/>` +
        `<rect x="150" y="16" width="60" height="5" rx="2.5" fill="#d0d3d8"/>` + tiles;
}

// The sent GIF as a bubble on the right, bouncing by `lift` pixels
function bubble(lift) {
    // Same blue as the tile chosen in the picker, so the story is one GIF
    return `<rect x="184" y="${14 - lift}" width="156" height="92" rx="16" fill="${PURPLE}"/>` +
        `<rect x="192" y="${22 - lift}" width="140" height="76" rx="11" fill="#42a5f5"/>` +
        face(262, 60 - lift, 26, '#ffffff') +
        `<text x="332" y="${120 - lift}" text-anchor="end" ${FONT} font-size="10" fill="#6b7280">przed chwilą</text>`;
}

const FRAMES = [
    { delay: 700, body: composer(false) },
    { delay: 350, body: composer(true) },
    { delay: 500, body: picker(-1) + composer(true) },
    { delay: 600, body: picker(1) + composer(true) },
    { delay: 350, body: bubble(0) + composer(false) },
    { delay: 250, body: bubble(8) + composer(false) },
    { delay: 250, body: bubble(0) + composer(false) },
    { delay: 700, body: bubble(4) + composer(false) }
];

function svg(frame) {
    return Buffer.from(
        `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">` +
        `<rect width="100%" height="100%" fill="${SOFT}"/>${frame.body}</svg>`
    );
}

(async () => {
    fs.mkdirSync(OUT, { recursive: true });
    const frames = [];
    for (const frame of FRAMES) frames.push(await sharp(svg(frame)).png().toBuffer());
    await sharp(frames, { join: { animated: true } })
        .gif({ delay: FRAMES.map(f => f.delay), loop: 0 })
        .toFile(path.join(OUT, 'gify.gif'));
    // The still for reduced motion is the finished state: the GIF in the chat
    await sharp(frames[FRAMES.length - 1]).gif().toFile(path.join(OUT, 'gify-still.gif'));
    // Frames for a quick visual check (not shipped)
    console.log('wrote public/release/gify.gif and gify-still.gif', W + 'x' + H, FRAMES.length + ' frames');
})().catch(err => { console.error(err); process.exit(1); });
