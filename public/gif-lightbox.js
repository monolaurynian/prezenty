/*
 * GIF zoom: tap a GIF in the chat to see it larger in a modal.
 *
 *   GifLightbox.open({ animated, still, zoomAnimated, zoomStill,
 *                      width, height, alt, trigger })
 *
 * The page passes URLs it already built from a validated message (never
 * text taken from a message), so nothing here parses markup: every node is
 * made with createElement and every value is set as a property.
 *
 * Behaviour:
 *   - opens instantly with the picture the chat already has, then swaps in
 *     the bigger one as soon as it has loaded (no empty box while waiting);
 *   - closes with the x button, Escape, or a tap anywhere outside the
 *     picture or on it; focus goes back to the GIF that was tapped;
 *   - Tab stays inside the dialog; the page behind does not scroll;
 *   - reduced motion: opens on the still picture and offers a play/stop
 *     button, so nothing moves unless asked to;
 *   - if the picture cannot be loaded it says so instead of showing a
 *     broken-image icon.
 */
(function (root) {
    'use strict';

    if (typeof document === 'undefined') return;

    const OPEN_CLASS = 'gif-lightbox-open';
    let els = null;
    let state = null;

    function prefersReducedMotion() {
        return !!(root.matchMedia && root.matchMedia('(prefers-reduced-motion: reduce)').matches);
    }

    function node(tag, className, text) {
        const el = document.createElement(tag);
        if (className) el.className = className;
        if (text !== undefined) el.textContent = text;
        return el;
    }

    function build() {
        const overlay = node('div');
        overlay.id = 'gifLightbox';
        overlay.setAttribute('role', 'dialog');
        overlay.setAttribute('aria-modal', 'true');
        overlay.setAttribute('aria-label', 'Powiększony GIF');
        overlay.setAttribute('aria-hidden', 'true');
        overlay.setAttribute('inert', '');

        const close = node('button', 'gif-lightbox-close');
        close.type = 'button';
        close.setAttribute('aria-label', 'Zamknij');
        close.textContent = '\u00D7';

        const figure = node('div', 'gif-lightbox-figure');
        const image = node('img', 'gif-lightbox-img');
        image.alt = '';
        const missing = node('p', 'gif-lightbox-missing', 'Ten GIF jest niedostępny');
        missing.hidden = true;
        figure.appendChild(image);
        figure.appendChild(missing);

        const play = node('button', 'gif-lightbox-play', 'Odtwórz GIF');
        play.type = 'button';
        play.hidden = true;

        // "Powered by KLIPY" for GIFs that come from there (text set per opening)
        const credit = node('p', 'gif-lightbox-credit');
        credit.hidden = true;

        overlay.appendChild(close);
        overlay.appendChild(figure);
        overlay.appendChild(play);
        overlay.appendChild(credit);
        document.body.appendChild(overlay);

        els = { overlay: overlay, close: close, figure: figure, image: image, missing: missing, play: play, credit: credit };

        // A tap on the dark area, the picture or the figure closes it; the
        // buttons do their own thing
        overlay.addEventListener('click', function (e) {
            if (!(e.target instanceof Element)) return;
            if (e.target.closest('.gif-lightbox-close, .gif-lightbox-play')) return;
            closeBox();
        });
        close.addEventListener('click', closeBox);
        play.addEventListener('click', togglePlay);
        image.addEventListener('error', function () {
            // The picture the chat already had cannot be loaded (removed
            // upstream, offline). The bigger one is only swapped in after it
            // has loaded, so it can never leave a broken image behind.
            image.hidden = true;
            missing.hidden = false;
            play.hidden = true;
        });
        overlay.addEventListener('keydown', function (e) {
            if (!state) return;
            if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeBox(); return; }
            if (e.key !== 'Tab') return;
            const items = [close, play].filter(function (el) { return !el.hidden; });
            const first = items[0];
            const last = items[items.length - 1];
            if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
            else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
            else if (items.indexOf(document.activeElement) === -1) { e.preventDefault(); first.focus(); }
        });
    }

    function safeSize(value, fallback) {
        const n = Math.round(Number(value));
        return n >= 20 && n <= 2000 ? n : fallback;
    }

    function setPlaying(playing) {
        state.playing = playing;
        const src = playing ? state.zoomAnimated : state.zoomStill;
        // Instant: what the chat already shows; then the bigger one
        els.image.src = playing ? state.animated : state.still;
        const big = new Image();
        big.onload = function () {
            if (state && state.playing === playing) els.image.src = src;
        };
        big.src = src;
        els.play.textContent = playing ? 'Zatrzymaj GIF' : 'Odtwórz GIF';
    }

    function togglePlay() {
        if (state) setPlaying(!state.playing);
    }

    function open(options) {
        const o = options || {};
        if (!o.animated) return;
        if (!els) build();
        state = {
            animated: o.animated,
            still: o.still || o.animated,
            zoomAnimated: o.zoomAnimated || o.animated,
            zoomStill: o.zoomStill || o.still || o.animated,
            playing: true,
            trigger: o.trigger || document.activeElement
        };
        const width = safeSize(o.width, 220);
        const height = safeSize(o.height, 220);
        els.image.hidden = false;
        els.missing.hidden = true;
        els.credit.textContent = typeof o.credit === 'string' ? o.credit : '';
        els.credit.hidden = !els.credit.textContent;
        els.image.alt = typeof o.alt === 'string' ? o.alt : 'Powiększony GIF';
        els.image.width = width;
        els.image.height = height;
        els.image.style.aspectRatio = width + ' / ' + height;

        const reduced = prefersReducedMotion();
        els.play.hidden = !reduced;
        setPlaying(!reduced); // reduced motion starts on the still picture

        els.overlay.removeAttribute('aria-hidden');
        els.overlay.removeAttribute('inert');
        els.overlay.classList.add('is-open');
        document.documentElement.classList.add(OPEN_CLASS);
        els.close.focus();
    }

    function closeBox() {
        if (!els || !state) return;
        const trigger = state.trigger;
        state = null;
        els.overlay.classList.remove('is-open');
        els.overlay.setAttribute('aria-hidden', 'true');
        els.overlay.setAttribute('inert', '');
        els.image.removeAttribute('src'); // stop the animation, free the memory
        document.documentElement.classList.remove(OPEN_CLASS);
        if (trigger && document.contains(trigger) && typeof trigger.focus === 'function') trigger.focus();
    }

    root.GifLightbox = { open: open, close: closeBox, isOpen: function () { return !!state; } };
})(window);
