
        // Cold-start detection: if the server doesn't answer /health quickly,
        // it's waking up from sleep (free hosting) - show a friendly overlay
        // instead of letting the user submit a login into the void.
        (function detectColdStart() {
            const overlay = document.getElementById('coldStartOverlay');
            const timerEl = document.getElementById('coldStartTimer');
            let overlayShown = false;
            let secondsWaiting = 0;

            const showTimer = setTimeout(() => {
                overlayShown = true;
                overlay.style.display = 'flex';
                const tick = setInterval(() => {
                    if (!overlayShown) { clearInterval(tick); return; }
                    secondsWaiting++;
                    timerEl.textContent = secondsWaiting >= 5 ? `Czekamy już ${secondsWaiting} s (zwykle trwa to do minuty)` : '';
                }, 1000);
            }, 2500); // only show if health check is slower than 2.5s

            function hideOverlay() {
                clearTimeout(showTimer);
                if (overlayShown) {
                    overlayShown = false;
                    overlay.style.display = 'none';
                }
            }

            function poll() {
                fetch('/health', { cache: 'no-store' })
                    .then(r => r.json())
                    .then(() => hideOverlay())
                    .catch(() => setTimeout(poll, 3000)); // server still asleep, retry
            }
            poll();
        })();

        document.addEventListener('DOMContentLoaded', function () {
            // Add content transition effect
            setTimeout(() => {
                document.getElementById('loginHeader').classList.add('loaded');
                document.getElementById('loginBody').classList.add('loaded');
            }, 100);

            const loginForm = document.getElementById('loginForm');
            const loginMessage = document.getElementById('loginMessage');

            loginForm.addEventListener('submit', function (e) {
                e.preventDefault();
                const username = document.getElementById('username').value;
                const password = document.getElementById('password').value;
                loginMessage.style.display = 'none';

                const submitBtn = loginForm.querySelector('button[type="submit"]');
                const originalText = submitBtn.innerHTML;
                submitBtn.innerHTML = '<span class="spinner-border spinner-border-sm me-2"></span>Logowanie...';
                submitBtn.disabled = true;

                fetch('/api/login', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ username, password }),
                    credentials: 'include' // Important: include cookies
                })
                    .then(response => {
                        console.log('Login response status:', response.status);
                        console.log('Login response headers:', response.headers);
                        return response.json().then(data => ({ status: response.status, body: data }));
                    })
                    .then(({ status, body }) => {
                        console.log('Login response:', { status, body });
                        if (status === 200 && body.success) {
                            // Session is saved server-side before this response
                            // arrives, so we can redirect right away
                            document.getElementById('loginHeader').classList.remove('loaded');
                            document.getElementById('loginBody').classList.remove('loaded');
                            setTimeout(() => { window.location.href = '/'; }, 300);
                        } else {
                            console.error('Login failed:', body.error);
                            showError(friendlyLoginError(status, body));
                        }
                    })
                    .catch(error => {
                        console.error('Login error:', error);
                        showError(navigator.onLine
                            ? 'Nie udało się połączyć z serwerem. Spróbuj ponownie za chwilę.'
                            : 'Brak połączenia z internetem. Sprawdź sieć i spróbuj ponownie.');
                    })
                    .finally(() => {
                        submitBtn.innerHTML = originalText;
                        submitBtn.disabled = false;
                    });
            });

            // Translate server/HTTP errors into human language with a next step
            function friendlyLoginError(status, body) {
                if (status === 401) {
                    return body.error || 'Nieprawidłowa nazwa użytkownika lub hasło.';
                }
                if (status === 503 && body.maintenance) {
                    return 'Trwa przerwa techniczna. Spróbuj ponownie za kilka minut.';
                }
                if (status >= 500) {
                    return 'Coś poszło nie tak po naszej stronie. Odczekaj chwilę i spróbuj ponownie.';
                }
                return body.error || 'Nie udało się zalogować. Spróbuj ponownie.';
            }

            function showError(message) {
                loginMessage.textContent = message;
                loginMessage.className = 'alert alert-danger mt-3';
                loginMessage.style.display = 'block';
            }

            // Note: Server-side redirect handles authenticated users
            // No need for client-side auth check here to avoid redirect loops
        });

        function toggleToRegister(event) {
            event.preventDefault();

            // Fade out content
            document.getElementById('loginHeader').classList.remove('loaded');
            document.getElementById('loginBody').classList.remove('loaded');

            setTimeout(() => {
                window.location.href = '/register';
            }, 300);
        }
    