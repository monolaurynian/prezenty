'use strict';
const fs = require('fs');
const path = require('path');
const dir = path.join(__dirname, 'home-buckets-baseline');
const B = JSON.parse(fs.readFileSync(path.join(dir, 'before.json'), 'utf8'));
const A = JSON.parse(fs.readFileSync(path.join(dir, 'after.json'), 'utf8'));
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const diffKeys = (a, b) => Object.keys(a).filter(k => a[k] !== b[k]).map(k => `${k}: ${a[k]} -> ${b[k]}`);
const lines = [];
const out = (s) => { lines.push(s); console.log(s); };
let fail = 0;
const check = (name, ok, extra) => { if (!ok) fail++; out(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  ' + extra : ''}`); };

for (const vp of Object.keys(A.viewports)) {
    const b = B.viewports[vp], a = A.viewports[vp];
    // (1) Available cards + rows + list(padding/gap/display) identical before vs after
    const av = ['cards', 'rows'].every(k => eq(b.populated.available[k].map(x => ({ ...x, w: 0, h: 0 })), a.populated.available[k].map(x => ({ ...x, w: 0, h: 0 }))));
    const listKeys = ['display', 'rowGap', 'columnGap', 'flexDirection', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft', 'boxSizing'];
    const listSame = listKeys.every(k => b.populated.available.list[k] === a.populated.available.list[k]);
    check(`${vp} (1) Available cards/rows computed-style diff = 0 (excluding w/h)`, av);
    check(`${vp} (1) Available list display/gap/padding unchanged`, listSame);
    // geometry of available card offsets
    check(`${vp} (1) Available offsets unchanged`, eq(b.populated.available.offsets, a.populated.available.offsets), JSON.stringify(a.populated.available.offsets));
    // (2) all buckets: card padding / radius / gap identical
    const pk = (x) => `${x.paddingTop} ${x.paddingRight} ${x.paddingBottom} ${x.paddingLeft}`;
    const cards = ['available', 'reservations', 'bought'].map(n => a.populated[n].cards[0]);
    check(`${vp} (2) card padding identical across buckets`, new Set(cards.map(pk)).size === 1, pk(cards[0]));
    check(`${vp} (2) card radius identical across buckets`, new Set(cards.map(c => c.borderTopLeftRadius + c.borderBottomRightRadius)).size === 1, cards[0].borderTopLeftRadius);
    check(`${vp} (2) row padding identical across buckets`, new Set(['available', 'reservations', 'bought'].map(n => pk(a.populated[n].rows[0]))).size === 1);
    const lists = ['available', 'reservations', 'bought'].map(n => a.populated[n].list);
    check(`${vp} (2) list padding+gap+display identical across buckets`, new Set(lists.map(l => pk(l) + l.rowGap + l.display + l.flexDirection)).size === 1, pk(lists[0]) + ' gap ' + lists[0].rowGap);
    check(`${vp} (2) offsets (inset/between) identical across buckets`, new Set(['available', 'reservations', 'bought'].map(n => JSON.stringify(a.populated[n].offsets))).size === 1);
    // cards content other than layout unchanged vs before in all buckets
    ['reservations', 'bought'].forEach(n => {
        const same = a.populated[n].cards.every((c, i) => eq({ ...c, w: 0, h: 0 }, { ...b.populated[n].cards[i], w: 0, h: 0 }));
        check(`${vp} cards of ${n}: computed style unchanged vs before (only position moves)`, same);
    });
    // (3) nesting rule
    const R = parseFloat(cards[0].borderTopLeftRadius);
    const item = a.populated.available.item;
    const inset = Math.min(parseFloat(a.populated.available.list.paddingLeft), parseFloat(a.populated.available.list.paddingTop));
    const border = parseFloat(item.borderTopWidth);
    ['available', 'reservations', 'bought'].forEach(n => {
        const it = a.populated[n].item, bt = a.populated[n].button, co = a.populated[n].collapse;
        const outerOk = parseFloat(it.borderTopLeftRadius) === R + inset + border && parseFloat(it.borderBottomRightRadius) === R + inset + border;
        const innerOk = parseFloat(bt.borderTopLeftRadius) === R + inset && parseFloat(co.borderBottomLeftRadius) === R + inset + border;
        check(`${vp} (3) ${n} frame radius = card R(${R}) + inset(${inset}) + border(${border})`, outerOk && innerOk, `item ${it.borderTopLeftRadius} header ${bt.borderTopLeftRadius} collapse-bottom ${co.borderBottomLeftRadius}`);
    });
    // (4) clip chain unchanged
    check(`${vp} (4) clipping ancestors unchanged`, eq(b.clip, a.clip), JSON.stringify(a.clip.available));
    // (5) overflow
    check(`${vp} (5) no horizontal overflow, populated`, a.scroll.sw <= a.scroll.iw, `${a.scroll.sw}/${a.scroll.iw}`);
    check(`${vp} (5) no horizontal overflow, very long titles/names`, a.longText.noOverflow && a.longText.rowsWithInnerOverflow === 0 && a.longText.maxCardRight <= a.longText.minItemRight, JSON.stringify(a.longText));
    // (7) focus
    check(`${vp} (7) focus ring not clipped (all buckets)`, ['available', 'reservations', 'bought'].every(n => a.focus[n].clippedBy === null && a.focus[n].focusVisible));
    // empty-state
    const e = a.empty;
    check(`${vp} empty states: list padding identical across buckets`, new Set(['available', 'reservations', 'bought'].map(n => pk(e[n].list))).size === 1, pk(e.available.list));
    check(`${vp} empty box unchanged (padding/size)`, ['available', 'reservations', 'bought'].every(n => eq({ ...e[n].empty, w: 0 }, { ...b.empty[n].empty, w: 0 })));
    // skeleton
    const sk = a.skeleton;
    check(`${vp} skeleton: Available identical to before`, eq(sk.availablePresentsList, b.skeleton.availablePresentsList));
    check(`${vp} skeleton: all buckets identical`, new Set(Object.values(sk).map(x => JSON.stringify(x))).size === 1, JSON.stringify(sk.myReservationsList));
}
// (6) other pages
for (const k of Object.keys(A.other)) {
    const a = A.other[k], b = B.other[k];
    if (a.error || b.error) { out(`NOTE  other page ${k}: error before=${b.error} after=${a.error}`); continue; }
    let diffs = 0; const samples = [];
    if (a.length !== b.length) { diffs++; samples.push(`length ${b.length} -> ${a.length}`); }
    const norm = (e) => { const n = { ...e, k: e.k.replace(/-[a-z0-9]{9}\b/g, '-RND') }; if (/spinner-border|progress-bar|skeleton/.test(e.k)) { n.w = 0; n.h = 0; n.boxShadow = ''; } return n; };
    a.forEach((el0, i) => { const el = norm(el0); const o = b[i] && norm(b[i]); if (!o) return; const d = diffKeys(o, el); if (d.length) { diffs++; if (samples.length < 3) samples.push(el.k + ' ' + d.join('; ')); } });
    check(`(6) other page ${k}: ${a.length} elements, computed-style diff = 0`, diffs === 0, samples.join(' | '));
}
out(fail === 0 ? 'ALL CHECKS PASSED' : `${fail} CHECK(S) FAILED`);
fs.writeFileSync(path.join(dir, 'compare-result.txt'), lines.join('\n'));
