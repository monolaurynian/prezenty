'use strict';
const fs = require('fs');
const path = require('path');
const dir = path.join(__dirname, 'home-buckets-baseline');
const load = (n) => JSON.parse(fs.readFileSync(path.join(dir, n + '.json'), 'utf8'));
const label = process.argv[2];
const d = load(label);
const pad = (el) => el ? `${el.paddingTop} ${el.paddingRight} ${el.paddingBottom} ${el.paddingLeft}` : '-';
const rad = (el) => el ? `${el.borderTopLeftRadius}/${el.borderTopRightRadius}/${el.borderBottomRightRadius}/${el.borderBottomLeftRadius}` : '-';
for (const [vp, v] of Object.entries(d.viewports)) {
    console.log('=== ' + vp + ' ===');
    for (const b of ['available', 'reservations', 'bought']) {
        const x = v.populated[b];
        const c = x.cards[0];
        console.log(`${b}: cards=${x.cardCount} list{display:${x.list.display} gap:${x.list.rowGap} pad:${pad(x.list)}} item r=${rad(x.item)} btn r=${rad(x.button)} collapse r=${rad(x.collapse)}`);
        console.log(`   card pad:${pad(c)} r:${rad(c)} mb:${c.marginBottom} border:${c.borderTopWidth} | row pad:${pad(x.rows[0])} r:${rad(x.rows[0])}`);
        console.log(`   offsets: ${JSON.stringify(x.offsets)} inset=${x.customProps.inset} cardR=${x.customProps.cardR}`);
        console.log(`   empty: ${x.empty ? 'n/a(populated)' : '-'} | emptyState list pad:${pad(v.empty[b].list)} emptyBox:${v.empty[b].empty ? v.empty[b].empty.paddingTop + ' ' + v.empty[b].empty.h + 'h' : '-'}`);
    }
    console.log('clip:', JSON.stringify(v.clip));
    console.log('scroll:', JSON.stringify(v.scroll), 'longText:', JSON.stringify(v.longText));
    console.log('focus:', JSON.stringify(v.focus));
    console.log('skeleton:', JSON.stringify(v.skeleton));
}
