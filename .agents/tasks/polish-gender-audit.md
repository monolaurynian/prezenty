# Polish UI gender audit (Prezenty)

## Summary

- The schema stores no gender. `users` has only `id, username, password, created_at, updated_at`, and `recipients` has `id, name, identified_by, profile_picture*, timestamps` (init-db.js at HEAD; the working copy could not be read because of OneDrive timeouts). No gender field exists in register.html/register.js or ustawienia.html either.
- 39 gender-inflected strings need attention:
  - 11 hardcoded masculine (class a): 10 addressed to the current user ("będziesz mógł", "Nie dodałeś", "chciałbyś", "zidentyfikowany", "matole"), plus activity.html `wykonał akcję`.
  - 28 slash/paren forms (class c): 26 activity verbs (`dodał(a)`, `zarezerwował(a)` …) spread over 4 duplicated renderers, plus `zarezerwowałeś(-aś)` and `zidentyfikowany(-a)`.
  - 0 hardcoded feminine forms that refer to a person (class b).
- Server-side push text is already neutral: "Dodano nowy prezent…", "Wiadomość od Świętego Mikołaja", "Masz … do kupienia".
- A second, related problem: names are inserted in the nominative after prepositions that need another case. Examples are `dla ${name}` (should be genitive: "dla Moniki") and `przez ${username}` (should be accusative). This affects 7 places.
- Recommendation: apply Tier A (neutral rephrasing) to everything now. It needs no data and fixes all 39 strings. Tier B (optional "forma zwracania się") is cheap, about 1 column, 1 endpoint, 1 settings control and 1 helper. It only adds value for the activity-feed verbs, so treat it as optional polish.

## 1–2. Findings

Class key: a = hardcoded masculine, b = hardcoded feminine, c = slash/paren form, d = neutral or correct. Subject key: 2p = current user, 3p = another named user (actor), R = recipient/person.

### Activity / notification renderers (3p actor). The same 6–7 messages are duplicated in 4 files.

| file:line | string | subj | class | Tier A fix |
|---|---|---|---|---|
| activity.html:488 | `${actor} dodał(a) osobę X` | 3p | c | `${actor} · nowa osoba: X` |
| activity.html:494 | `${actor} dodał(a) prezent "T" dla X` | 3p | c | `${actor} · nowy prezent "T" (dla: X)` |
| activity.html:500 | `${actor} zarezerwował(a) prezent "T"` | 3p | c | `${actor} · rezerwacja: "T"` |
| activity.html:506 | `${actor} anulował(a) rezerwację "T"` | 3p | c | `${actor} · anulowana rezerwacja: "T"` |
| activity.html:512 | `${actor} oznaczył(a) jako kupione "T"` | 3p | c | `${actor} · kupione: "T"` |
| activity.html:518 | `${actor} odznaczył(a) "T"` | 3p | c | `${actor} · cofnięto „kupione”: "T"` |
| activity.html:722 | `${actor} dodał(a) N prezentów dla X` (batched) | 3p | c | `${actor} · nowe prezenty: N (dla: X)` |
| activity.html:740 | `${actor \|\| 'Ktoś'} wykonał akcję` | 3p | a | `${actor \|\| 'Ktoś'} · nowa aktywność` |
| recipients.html:1835–1884 | `dodał(a) osobę…`, `dodał(a) prezent…`, `zarezerwował(a)…`, `anulował(a)…`, `oznaczył(a)…`, `odznaczył(a)…` (6 strings, actor rendered separately) | 3p | c | Same pattern as activity.html |
| recipients.html:2306–2331 | `${actor} dodał(a) osobę/prezent…`, `zarezerwował(a)`, `anulował(a)`, `oznaczył(a)`, `odznaczył(a)` (6 strings) | 3p | c | Same pattern |
| tab-bar-functions.js:219–229 | Same 6 messages | 3p | c | Same pattern |
| tab-bar-functions.js:237 | `${actor} wykonał(a) akcję` | 3p | c | `${actor} · nowa aktywność` |

Class-c count: activity.html 7 + recipients.html 6 + 6 + tab-bar-functions.js 7 = 26, plus rezerwacje.html:103 and ustawienia.html:418 = 28.

### Current user (2nd person)

| file:line | string | subj | class | Tier A fix |
|---|---|---|---|---|
| rezerwacje.html:103 | `Prezenty, które zarezerwowałeś(-aś) dla innych.` | 2p | c | `Twoje rezerwacje prezentów dla innych.` |
| ustawienia.html:418 | `Nie jesteś jeszcze zidentyfikowany(-a). Wybierz siebie z listy:` | 2p | c | `Nie wybrano jeszcze Twojej osoby. Wybierz siebie z listy:` |
| home.html:1293 | `Po identyfikacji będziesz mógł zarządzać swoimi…` | 2p | a | `Po identyfikacji możesz zarządzać swoimi…` |
| home.html:1396 | `Przestaniesz być zidentyfikowany jako X` | 2p | a | `Identyfikacja jako X zostanie anulowana.` |
| home.html:1399 | `Będziesz mógł ponownie się zidentyfikować w każdej chwili` | 2p | a | `Możesz ponownie się zidentyfikować w każdej chwili.` |
| recipients.html:1228 | `Po identyfikacji będziesz mógł zarządzać swoimi…` | 2p | a | Same as home.html:1293 |
| recipients.html:1326 | `Po anulowaniu będziesz mógł ponownie zidentyfikować się jako ta osoba.` | 2p | a | `Po anulowaniu możesz ponownie zidentyfikować się jako ta osoba.` |
| recipients.js:1154 | `Nie dodałeś jeszcze żadnych prezentów.` | 2p | a | `Nie masz jeszcze dodanych prezentów.` or `Brak dodanych prezentów.` |
| formularz.html:585 | placeholder `Co chciałbyś dostać?` | 2p | a | `O czym marzysz?` / `Co chcesz dostać?` / `Np. książka, słuchawki…` |
| server.js:3455 | `Jesteś już zidentyfikowany jako ${name}` | 2p | a | `Twoje konto jest już powiązane z: ${name}` |
| intro.html:646 | `Bądź pierwszym aktywnym użytkownikiem!` | 2p | a | `Zostań pierwszą aktywną osobą!` / `Zacznij jako pierwsza osoba w rankingu!` |
| recipients.js:3313 | `…Trzeba było szybciej rezerwować matole!` | 2p | a (masc. vocative insult) | Drop it or make it neutral: `…Trzeba było szybciej rezerwować! Wybierz coś innego.` |

### Neutral or already correct (class d, no change needed)

- ustawienia.html:127 `Zalogowano jako:` (impersonal, good). recipients.js:1368/1524/1561 `Pomyślnie zidentyfikowano…`. ustawienia.html:438 `Zidentyfikowano!`. All are impersonal -no/-to forms.
- server.js:1685, 3309 push `Dodano nowy prezent…`; server.js:2692/2790 `Wiadomość od Świętego Mikołaja`; server.js:3872 nudge. These are neutral, but see the case issue below.
- osoby.html:102 `których nikt nie zidentyfikował` and archiwum.html:299 `Nikt nie zarezerwował`: "nikt" always takes masculine agreement, which is correct.
- index.html:123–124 `Aplikacja drzemała… będzie gotowa`: agrees with "aplikacja", correct.
- recipients.js:2450 badge tooltip `Zidentyfikowane przez: X`: neuter, with an implied "konto/imię". Acceptable. `Potwierdzone przez: X` reads more naturally.
- Generic masculine nouns are standard Polish and fine to keep: `Nazwa użytkownika` (index, register, formularz, ustawienia, server), `Ranking Użytkowników`, leaderboard.html:873 `Użytkownicy, którzy kupili…`, intro.html:456/498, wiadomosci.html:173 `odbiorca zobaczy`, `Wybierz odbiorcę`, `Święty Mikołaj` (persona).
- recipients.js:1086/2174/2175/4112/4113 `nieznany użytkownik` / `Nieznany użytkownik`: generic, acceptable. `nieznana osoba` or `ktoś` is the neutral alternative if you want full consistency.
- osoby.html:286–287 `zarezerwowany`, `kupiony`, `dodany przez`: agree with "prezent", correct.

## 3. Data model and the cost of Tier B

The schema has no gender column and no other way to infer gender. Inferring from names (e.g. names ending in -a) is unreliable: Kuba, Barnaba, nicknames, and usernames that are not names. Don't do it.

Adding an optional "Forma zwracania się" is low effort, roughly half a day:

1. Schema: add `users.address_form CHAR(1) NULL` (`'m'`/`'f'`/`'n'`, NULL = neutral). Add it idempotently at startup, the same way server.js already does `ensureCreatedByNullable` (~line 3184) and the notifications `ALTER TABLE` migration (~line 3044). Also add it to init-db.js.
2. API: include `address_form` in the session/profile response and add `PUT /api/user/address-form` with requireAuth and validation against the 3 values. In the notifications query (server.js ~2369, `SELECT n.*, u.username as actor_username … LEFT JOIN users u`), also select `u.address_form AS actor_form`.
3. UI: add a 3-option select in ustawienia.html "Konto" (~line 127): "Jak się do Ciebie zwracać? on / ona / neutralnie". Registration can keep it optional or skip it.
4. Helper in public/pluralize-pl.js, which is already a dual browser/Node module, so server.js can use it too:
   ```js
   // plGender('f', 'dodał', 'dodała', 'dodało/a') -> 'dodała'; unknown -> neutral
   function plGender(form, m, f, n) { return form === 'm' ? m : form === 'f' ? f : n; }
   ```
   The `n` argument must be a neutral rephrase, not "dodało" (which reads as an object). So in practice, Tier B renders `Monika dodała prezent` when the form is known and falls back to the Tier A wording otherwise.

## 4. Recommendation per string

| group | tier | why |
|---|---|---|
| All 2nd-person strings (home, recipients.html/js, rezerwacje, ustawienia, formularz, server.js:3455, intro) | A only | The present/impersonal rephrases read naturally and lose nothing. Gender data adds no value here. |
| `matole` joke (recipients.js:3313) | A | Gendered and mildly insulting toward the user. Remove it. |
| Activity verbs ×4 files | A now, optional B later | Tier A ("Monika · rezerwacja: …") fixes the slash forms immediately. If a gender field is added, use `plGender(actor_form, …)` to render the natural `Monika zarezerwowała…`, with Tier A as the fallback. |
| Duplication | n/a | The 6 messages are copy-pasted into activity.html, recipients.html (twice) and tab-bar-functions.js. Extract them once, e.g. into one shared `notificationText(type, data, actor, actorForm)` in a public JS file, or else every wording fix has to be made 4 times. |

## 5. Other language issues noticed

- server.js:952 `Taka osoba já istnieje!` is a typo (Czech/Portuguese "já"). It should be `Taka osoba już istnieje!`
- Names in the nominative after prepositions:
  - `dla ${name}` should take the genitive: activity.html:545 and 722, recipients.html:1806, tab-bar-functions.js:211, server.js:1685 and 3309. Names can't be declined reliably, so use `dla: Monika` or `(dla: Monika)`.
  - realtime-updates.js:254 `Zarezerwowane przez ${username}` has no colon. Use `Zarezerwowane przez: X`, matching recipients.js:2175.
- Hardcoded genitive plural: osoby.html:252 `<strong>${n}</strong> prezentów` and `łącznie ${total} prezentów` render "1 prezentów" or "3 prezentów". Use the existing `plCount`.
- intro.html:6 `Witaj w Prezentownik` should use the locative: `Witaj w Prezentowniku`.
- Missing commas before subordinate clauses: recipients.js:1121 `Nie możesz zobaczyć, które…`; recipients.js:~1104 `kliknij, aby edytować`; recipients.js:3341 `Co, korci Cię, żeby zobaczyć, czy…`.
- Capitalisation: English-style Title Case in labels. Polish uses sentence case:
  - `Dodaj Prezent` → `Dodaj prezent`
  - `Zarezerwowane Prezenty` → `Zarezerwowane prezenty`
  - `Dodaj Osobę` → `Dodaj osobę`
  - `Anonimowe Wiadomości` → `Anonimowe wiadomości`
  - `Edytuj Moje Prezenty` → `Edytuj moje prezenty`
  - `Ranking Użytkowników` → `Ranking użytkowników`
  - `Wymagana Autoryzacja` → `Wymagana autoryzacja`
  - `Twój Asystent Prezentowy` → `Twój asystent prezentowy`
  
  These appear in desktop-nav.js:24–28, bottom-tab-bar-snippet.html, rezerwacje.html:103, leaderboard.html:761, formularz.html:712 and intro.html:6.
- recipients.js:3313 mixes in English ("Sorry") and dialect ("po ptokach"). That's fine if it's intentional humour.
- archiwum.html:339 `Zarchiwizowano … pod rokiem 2024` is unidiomatic. Use `w archiwum za rok 2024`.
- Missing diacritics: none found in user-visible text. `wiadomosci` only appears in URLs and routes, which is fine.
