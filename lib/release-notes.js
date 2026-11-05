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
//   `remote` (optional) is an exact KLIPY file { src, alt, width, height }: an
//   https URL on a klipy.com host, no query string. The browser loads it
//   straight from KLIPY (we never copy it); if it cannot be loaded, or the
//   person prefers reduced motion, `src` / `still` are shown instead.
//   `klipy` (optional) is the slug of a KLIPY GIF to show instead, looked up live
//   from the browser (KLIPY's rules: no copies of their files). It is used only
//   where a KLIPY key is configured and the lookup works within a few seconds;
//   otherwise `src` / `still` are shown. `klipyAlt` describes the KLIPY GIF.
//   scripts/make-banner-gif.js draws the current one.
//   `requires` names a server-side feature switch. The entry is only
//   announced where that feature is really on, so nobody is told about a
//   button they will not see. Switches: `gif` (any GIF provider has a key),
//   `klipy` (KLIPY is the provider: it has stickers and memes). They are
//   passed to latestRelease() by routes/system.js.

const RELEASES = [
    {
        id: '2026-11-naklejki-i-memy',
        requires: 'klipy',
        title: 'Nowość: naklejki i memy 🏷️',
        intro: 'Hej! GIF-y mają teraz towarzystwo.',
        image: {
            // our own picture: shown if KLIPY's file cannot be loaded, and as the still
            src: '/release/gify.gif',
            still: '/release/gify-still.gif',
            alt: 'Animacja: naciskasz przycisk GIF, wybierasz obrazek z listy i ląduje on w rozmowie.',
            width: 360,
            height: 180,
            // the funny one: an exact KLIPY file, loaded by the browser straight from KLIPY
            remote: {
                src: 'https://static.klipy.com/ii/6b3a6ab13999af763b4db87b91ee67d0/34/e9/2xWWyF55INvb7peHha6w.webp',
                alt: 'Animowany mem z KLIPY: Święty Mikołaj zabiera prezent z powrotem.',
                width: 291,
                height: 498
            }
        },
        items: [
            {
                icon: '🏷️',
                text: 'W panelu GIF-ów są teraz trzy zakładki: GIF-y, Naklejki i Memy. Przesuń palcem na bok albo dotknij zakładki.'
            },
            {
                icon: '🔎',
                text: 'Jedno pole wyszukiwania działa w każdej zakładce: wpisz słowo i zobacz, co znajdzie się wśród naklejek i memów.'
            },
            {
                icon: '👀',
                text: 'Podgląd jest teraz duży, na cały ekran. „Wyślij” wysyła, a „Pomiń” wraca do listy.'
            }
        ],
        action: { label: 'Zobacz naklejki', url: '/wiadomosci?rozmowa=group' }
    },
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

/**
 * Every announcement that applies on this server, newest first: what the
 * "Nowości" page lists. Same `features` rule as latestRelease().
 */
function releasesFor(features) {
    const on = features || {};
    return RELEASES.filter(release => !release.requires || on[release.requires]);
}

module.exports = { RELEASES, latestRelease, releasesFor };
