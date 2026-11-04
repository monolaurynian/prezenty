// Generates the tiny demo GIFs in public/demo-gifs/ (offline GIF provider
// used by demo mode and the e2e suite - no network, no GIPHY key).
//
//   node scripts/make-demo-gifs.js
//
// Each GIF is a few flat-colour frames with a short word, plus a
// `<id>-still.gif` first frame (what reduced-motion users see). The output
// is committed; re-run only to change the set. Needs `sharp` (a dependency).
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const OUT = path.join(__dirname, '..', 'public', 'demo-gifs');

// id, label, width x height, frame colours
const GIFS = [
    { id: 'brawo', label: 'Brawo!', width: 200, height: 150, colors: ['#e53935', '#fb8c00', '#fdd835'] },
    { id: 'hura', label: 'Hura!', width: 200, height: 200, colors: ['#43a047', '#1e88e5', '#8e24aa'] },
    { id: 'dzieki', label: 'Dzięki', width: 200, height: 112, colors: ['#00897b', '#3949ab', '#d81b60'] },
    { id: 'swieta', label: 'Święta', width: 200, height: 260, colors: ['#c62828', '#2e7d32', '#c62828'] }
];

function frameSvg(gif, color) {
    return Buffer.from(
        `<svg xmlns="http://www.w3.org/2000/svg" width="${gif.width}" height="${gif.height}">` +
        `<rect width="100%" height="100%" fill="${color}"/>` +
        `<text x="50%" y="52%" text-anchor="middle" dominant-baseline="middle" ` +
        `font-family="Arial, Helvetica, sans-serif" font-size="34" font-weight="700" fill="#ffffff">${gif.label}</text>` +
        `</svg>`
    );
}

async function frame(gif, color) {
    return sharp(frameSvg(gif, color)).png().toBuffer();
}

(async () => {
    fs.mkdirSync(OUT, { recursive: true });
    for (const gif of GIFS) {
        const frames = [];
        for (const color of gif.colors) frames.push(await frame(gif, color));
        await sharp(frames, { join: { animated: true } })
            .gif({ delay: gif.colors.map(() => 400), loop: 0 })
            .toFile(path.join(OUT, gif.id + '.gif'));
        await sharp(frames[0]).gif().toFile(path.join(OUT, gif.id + '-still.gif'));
        console.log('wrote', gif.id + '.gif', gif.width + 'x' + gif.height);
    }
})().catch(err => { console.error(err); process.exit(1); });
