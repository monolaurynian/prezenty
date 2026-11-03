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
//   { id, title, intro, items: [{ icon, text }], action?: { label, url } }
//   `action` is the main button (it refreshes the page and then opens `url`);
//   without it the button just refreshes.

const RELEASES = [
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

/** The newest announcement, or null when there is nothing worth announcing. */
function latestRelease() {
    return RELEASES.length ? RELEASES[0] : null;
}

module.exports = { RELEASES, latestRelease };
