# Prezenty - Aplikacja do Zarządzania Pomysłami na Prezenty Świąteczne

Aplikacja webowa w języku polskim do zarządzania pomysłami na prezenty świąteczne. Pozwala na dodawanie prezentów, zarządzanie listą osób oraz odznaczanie zakupionych prezentów.

## Funkcje

- 🔐 **Autoryzacja użytkowników** - Prosty system logowania
- 🎁 **Zarządzanie prezentami** - Dodawanie, usuwanie i odznaczanie prezentów
- 👥 **Zarządzanie osobami** - Dodawanie i usuwanie osób z listy
- ✅ **Lista zadań** - Odznaczanie zakupionych prezentów
- 🎨 **Motyw świąteczny** - Piękny interfejs z motywem Bożego Narodzenia
- 📱 **Responsywny design** - Działa na wszystkich urządzeniach

## Technologie

- **Backend**: Node.js, Express.js
- **Baza danych**: SQLite
- **Frontend**: HTML5, CSS3, JavaScript (Vanilla)
- **Styling**: Bootstrap 5, Font Awesome
- **Autoryzacja**: Express Session, bcryptjs

## Instalacja Lokalna

### Wymagania
- Node.js 16+ 
- npm lub yarn

### Kroki instalacji

1. **Sklonuj repozytorium**
   ```bash
   git clone https://github.com/monolaurynian/prezenty.git
   cd prezenty
   ```

2. **Zainstaluj zależności**
   ```bash
   npm install
   ```

3. **Uruchom aplikację**
   ```bash
   npm start
   ```

4. **Otwórz przeglądarkę**
   ```
   http://localhost:3000
   ```

## Wdrażanie z Coolify

### Przygotowanie

1. **Przygotuj repozytorium GitHub**
   - Wypchnij kod do repozytorium GitHub
   - Upewnij się, że wszystkie pliki są dodane

2. **Konfiguracja Coolify**
   - Zaloguj się do panelu Coolify
   - Dodaj nową aplikację
   - Wybierz repozytorium `monolaurynian/prezenty`

### Konfiguracja w Coolify

1. **Podstawowe ustawienia**
   - **Nazwa aplikacji**: `prezenty`
   - **Port**: `3000`
   - **Build Pack**: `Nixpacks`

2. **Zmienne środowiskowe** (opcjonalne)
   ```
   NODE_ENV=production
   PORT=3000
   ```

3. **Domena**
   - **Domena**: `prezenty.matmamon.com`
   - **SSL**: Włącz automatyczne SSL

### Konfiguracja Hostinger

1. **Dodaj rekord DNS**
   - **Typ**: `A`
   - **Nazwa**: `prezenty`
   - **Wartość**: `[YOUR_SERVER_IP]` (IP serwera)
   - **TTL**: `300`

2. **Czekaj na propagację DNS** (może potrwać do 24h)

## Struktura Projektu

```
prezenty/
├── public/                 # Pliki frontend
│   ├── index.html         # Strona logowania
│   ├── presents.html      # Strona z prezentami
│   ├── recipients.html    # Strona z osobami
│   ├── styles.css         # Style CSS
│   ├── login.js           # Logika logowania
│   ├── presents.js        # Logika prezentów
│   └── recipients.js      # Logika osób
├── server.js              # Serwer Express
├── package.json           # Zależności Node.js
├── Dockerfile             # Konfiguracja Docker
├── .dockerignore          # Pliki ignorowane przez Docker
└── README.md              # Ten plik
```

## API Endpoints

### Autoryzacja
- `POST /api/login` - Logowanie
- `POST /api/logout` - Wylogowanie
- `GET /api/auth` - Sprawdzenie statusu autoryzacji

### Prezenty
- `GET /api/presents` - Pobierz listę prezentów
- `POST /api/presents` - Dodaj nowy prezent
- `PUT /api/presents/:id/check` - Odznacz/zaznacz prezent
- `DELETE /api/presents/:id` - Usuń prezent

### Osoby
- `GET /api/recipients` - Pobierz listę osób
- `POST /api/recipients` - Dodaj nową osobę
- `DELETE /api/recipients/:id` - Usuń osobę

## Baza Danych

Aplikacja używa SQLite z trzema tabelami:

- **users** - Użytkownicy systemu
- **recipients** - Lista osób
- **presents** - Lista prezentów

Baza danych jest automatycznie tworzona przy pierwszym uruchomieniu.

## Bezpieczeństwo

- Hasła są hashowane za pomocą bcrypt
- Sesje są zarządzane przez express-session
- Wszystkie endpointy API wymagają autoryzacji (poza logowaniem)

## Rozwój

### Tryb deweloperski
```bash
npm run dev
```

### Budowanie
```bash
npm run build
```

## Licencja

MIT License

## Wsparcie

W przypadku problemów z wdrażaniem lub użytkowaniem aplikacji, sprawdź:
1. Logi aplikacji w Coolify
2. Status DNS w panelu Hostinger
3. Konfigurację SSL w Coolify 