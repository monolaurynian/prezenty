// What's new, shown to signed-in users in the "Nowa wersja" banner
// (public/update-checker.js reads the newest entry through /api/version).
//
// WHEN TO ADD AN ENTRY
//   Only when users gain something they will notice or care about: a new
//   feature, a clearly better way of doing something. Bug fixes, internal
//   clean-ups and cache bumps get NO entry - those still reach everyone
//   (the service worker refreshes caches in the background), they just do
//   not interrupt anyone with a banner.
//
// HOW TO ADD ONE
//   Put a new object at the TOP of RELEASES. `id` must be new and unique:
//   every user sees an id once, and a repeat id is never shown again.
//
// TONE
//   Polish, relaxed and friendly, gender-neutral (no "zrobiłeś/zrobiłaś").
//   Plain text only: the banner renders it with textContent, never HTML.
//   Keep it short: a title, one friendly line and two to four items.
//
// SHAPE
//   { id, title, intro, items: [{ icon, text }], action?: { label, url },
//     image?: { src, still?, alt, width, height }, requires?: 'gif' }
//   `action` is the main button (it refreshes the page and then opens `url`);
//   without it the button just refreshes.
//   `image` is a picture (usually an animated GIF) shown at the top of the
//   banner. It must be a file of our own under public/ - a same-site path like
//   "/release/gify.gif", no query string - never another site. `still` is the
//   still version shown to people who prefer reduced motion; `alt` describes
//   it. If the file fails to load the banner simply shows without it.
//   `klipy` (optional) is the slug of a KLIPY GIF to show instead, looked up live
//   from the browser (KLIPY's rules: no copies of their files). It is used only
//   where a KLIPY key is configured and the lookup works within a few seconds;
//   otherwise `src` / `still` are shown. `klipyAlt` describes the KLIPY GIF.
//   scripts/make-banner-gif.js draws the current one.
//   `requires` names a server-side feature switch. The entry is only
//   announced where that feature is really on, so nobody is told about a
//   button they will not see (e.g. GIFs need a GIPHY_API_KEY).

const RELEASES = [
    {
        id: '2026-11-gify-klipy',
        requires: 'gif',
        title: 'Nowość: GIF-y w wiadomościach 🎞️',
        intro: 'Hej! Rozmowy zrobiły się trochę weselsze.',
        image: {
            src: '/release/gify.gif',
            still: '/release/gify-still.gif',
            // Where KLIPY is on, the banner shows this KLIPY GIF (looked up live in the
            // browser, see public/update-checker.js); otherwise the drawn one above.
            klipy: 'what-buddy',
            klipyAlt: 'Animowany GIF z KLIPY: „what buddy”.',
            alt: 'Animacja: naciskasz przycisk GIF, wybierasz obrazek z listy i ląduje on w rozmowie.',
            width: 360,
            height: 180
        },
        items: [
            {
                icon: '🎞️',
                text: 'Obok pola wiadomości jest nowy przycisk GIF. Wyszukaj coś zabawnego albo zajrzyj do tego, co akurat jest na topie.'
            },
            {
                icon: '👀',
                text: 'Najpierw zobaczysz podgląd, a dopiero „Wyślij GIF” wysyła. Żadnych przypadkowych wpadek.'
            },
            {
                icon: '🕵️',
                text: 'Dalej jest anonimowo: inni zobaczą sam obrazek, nigdy kto go wysłał.'
            }
        ],
        action: { label: 'Wypróbuj GIF-y', url: '/wiadomosci?rozmowa=group' }
    },
    {
        id: '2026-11-czat-grupowy',
        title: 'Nowość: Czat grupowy 🎉',
        intro: 'Hej! Wpadła mała nowość. Zajrzyj, kiedy będziesz mieć chwilę.',
        items: [
            {
                icon: '👥',
                text: 'Czat grupowy to jedno wspólne, anonimowe miejsce, gdzie można pogadać ze wszystkimi naraz. ' +
                    'Znajdziesz go na liście „Do kogo?” w Wiadomościach.'
            },
            {
                icon: '😍',
                text: 'Reakcje działają tam tak samo jak w zwykłych rozmowach: kliknij buźkę pod wiadomością i gotowe.'
            },
            {
                icon: '👆',
                text: 'Wybieranie emoji jest też wygodniejsze: karty przesuwasz palcem albo suwakiem na dole.'
            }
        ],
        action: { label: 'Pokaż czat grupowy', url: '/wiadomosci?rozmowa=group' }
    }
];

/**
 * The newest announcement that applies on this server, or null when there is
 * nothing worth announcing. `features` says which switches are on, e.g.
 * { gif: true }; an entry whose `requires` is off is skipped.
 */
function latestRelease(features) {
    const on = features || {};
    return RELEASES.find(release => !release.requires || on[release.requires]) || null;
}

module.exports = { RELEASES, latestRelease };
