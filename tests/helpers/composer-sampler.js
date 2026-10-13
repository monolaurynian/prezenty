'use strict';
/**
 * Per-frame sampler for the composer and the dock, used by
 * tests/e2e/composer-dock.spec.js.
 *
 * A requestAnimationFrame loop recording the geometry of the composer and
 * the dock, plus MutationObservers counting the writes that used to happen
 * once per scroll event. START_SAMPLER and STOP_SAMPLER are handed to
 * page.evaluate(), so they are serialised with toString() and must stay
 * self-contained.
 */

const START_SAMPLER = function () {
    const composer = document.getElementById('quickAddForm');
    const dock = document.querySelector('.bottom-tab-bar');
    const s = {
        frames: [],
        bodyClassMutations: 0,
        bodyStyleMutations: 0,
        quickAddBottomWrites: 0,
        dockAttrMutations: 0,
        dockStateChanges: 0,
        scrollEvents: 0,
        running: true
    };
    window.__e2eComposer = s;

    let lastHidden = document.body.classList.contains('dock-hidden');
    let lastVar = document.body.style.getPropertyValue('--quick-add-bottom');
    s.bodyObserver = new MutationObserver(function (records) {
        records.forEach(function (r) {
            if (r.attributeName === 'class') {
                s.bodyClassMutations++;
                const now = document.body.classList.contains('dock-hidden');
                if (now !== lastHidden) { s.dockStateChanges++; lastHidden = now; }
            } else if (r.attributeName === 'style') {
                s.bodyStyleMutations++;
                const now = document.body.style.getPropertyValue('--quick-add-bottom');
                if (now !== lastVar) { s.quickAddBottomWrites++; lastVar = now; }
            }
        });
    });
    s.bodyObserver.observe(document.body, { attributes: true, attributeFilter: ['class', 'style'] });

    if (dock) {
        s.dockObserver = new MutationObserver(function (records) {
            s.dockAttrMutations += records.length;
        });
        s.dockObserver.observe(dock, { attributes: true });
    }

    s.onScroll = function () { s.scrollEvents++; };
    window.addEventListener('scroll', s.onScroll, { passive: true });

    const t0 = performance.now();
    const round = function (n) { return Math.round(n * 100) / 100; };
    const sample = function () {
        const cRect = composer.getBoundingClientRect();
        const dRect = dock ? dock.getBoundingClientRect() : null;
        const cs = getComputedStyle(composer);
        const bs = getComputedStyle(document.body);
        s.frames.push({
            t: Math.round(performance.now() - t0),
            scrollY: Math.round(window.scrollY),
            scrollHeight: document.documentElement.scrollHeight,
            paddingBottom: bs.paddingBottom,
            innerHeight: window.innerHeight,
            // Distance from the viewport's bottom edge to the composer's own
            // bottom edge: the number the user sees move.
            composerOffset: round(window.innerHeight - cRect.bottom),
            composerTop: round(cRect.top),
            composerHeight: round(cRect.height),
            dockTop: dRect ? round(dRect.top) : null,
            gap: dRect ? round(dRect.top - cRect.bottom) : null,
            transform: cs.transform,
            bottom: cs.bottom,
            quickAddBottom: bs.getPropertyValue('--quick-add-bottom').trim(),
            quickAddReserve: bs.getPropertyValue('--quick-add-reserve').trim(),
            dockHideShift: bs.getPropertyValue('--dock-hide-shift').trim(),
            addMode: document.body.classList.contains('quick-add-active'),
            dockHidden: document.body.classList.contains('dock-hidden')
        });
    };
    sample();
    const tick = function () {
        if (!s.running) return;
        sample();
        requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
    return true;
};

const STOP_SAMPLER = function () {
    const s = window.__e2eComposer;
    if (!s) return null;
    s.running = false;
    if (s.bodyObserver) s.bodyObserver.disconnect();
    if (s.dockObserver) s.dockObserver.disconnect();
    if (s.onScroll) window.removeEventListener('scroll', s.onScroll);
    delete window.__e2eComposer;
    return {
        frames: s.frames,
        bodyClassMutations: s.bodyClassMutations,
        bodyStyleMutations: s.bodyStyleMutations,
        quickAddBottomWrites: s.quickAddBottomWrites,
        dockAttrMutations: s.dockAttrMutations,
        dockStateChanges: s.dockStateChanges,
        scrollEvents: s.scrollEvents
    };
};

async function startSampler(page) {
    await page.evaluate(START_SAMPLER);
}

async function stopSampler(page) {
    const raw = await page.evaluate(STOP_SAMPLER);
    if (!raw) throw new Error('sampler was never started');
    return Object.assign(raw, derive(raw.frames));
}

/** Node-side summary of a frame series - these are the reported numbers. */
function derive(frames) {
    const distinct = key => Array.from(new Set(frames.map(f => f[key])));
    let maxComposerStep = 0;
    let maxDockStep = 0;
    for (let i = 1; i < frames.length; i++) {
        maxComposerStep = Math.max(maxComposerStep,
            Math.abs(frames[i].composerOffset - frames[i - 1].composerOffset));
        if (frames[i].dockTop !== null && frames[i - 1].dockTop !== null) {
            maxDockStep = Math.max(maxDockStep, Math.abs(frames[i].dockTop - frames[i - 1].dockTop));
        }
    }
    const gaps = frames.map(f => f.gap).filter(g => g !== null);
    const offsets = frames.map(f => f.composerOffset);
    return {
        frameCount: frames.length,
        scrollHeights: distinct('scrollHeight'),
        paddings: distinct('paddingBottom'),
        maxComposerStep: Math.round(maxComposerStep * 100) / 100,
        maxDockStep: Math.round(maxDockStep * 100) / 100,
        minGap: gaps.length ? Math.min.apply(null, gaps) : null,
        maxGap: gaps.length ? Math.max.apply(null, gaps) : null,
        minComposerOffset: Math.min.apply(null, offsets),
        maxComposerOffset: Math.max.apply(null, offsets)
    };
}

function report(label, m) {
    return `${label}: ${m.frameCount} frames, scrollHeight ${JSON.stringify(m.scrollHeights)}, ` +
        `padding ${JSON.stringify(m.paddings)}, --quick-add-bottom writes ${m.quickAddBottomWrites}, ` +
        `dock attr mutations ${m.dockAttrMutations}, dock state changes ${m.dockStateChanges}, ` +
        `scroll events ${m.scrollEvents}, composer step max ${m.maxComposerStep}px, ` +
        `dock step max ${m.maxDockStep}px, gap ${m.minGap}..${m.maxGap}px, ` +
        `composer offset ${m.minComposerOffset}..${m.maxComposerOffset}px`;
}

module.exports = { startSampler, stopSampler, report };
