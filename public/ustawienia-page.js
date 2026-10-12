
        let myIdentification = null;

        // Register service worker (needed for push notifications)
        if ('serviceWorker' in navigator) {
            navigator.serviceWorker.register('/sw.js').catch(() => {});
        }

        // ===== PWA install =====
        // Capture the install prompt early - the browser fires it once,
        // often before DOMContentLoaded.
        let deferredInstallPrompt = null;

        window.addEventListener('beforeinstallprompt', (e) => {
            e.preventDefault();
            deferredInstallPrompt = e;
            renderInstallSection();
        });

        window.addEventListener('appinstalled', () => {
            deferredInstallPrompt = null;
            renderInstallSection();
            showToast('Aplikacja zainstalowana!', 'success');
        });

        function isStandalone() {
            return window.matchMedia('(display-mode: standalone)').matches
                || window.navigator.standalone === true;
        }

        function isIosDevice() {
            // iPadOS 13+ reports itself as MacIntel with touch support
            return /iphone|ipad|ipod/i.test(navigator.userAgent)
                || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
        }

        function isIosSafari() {
            // Chrome/Firefox/Edge on iOS and in-app webviews can't reliably
            // add to home screen - it has to be real Safari
            const ua = navigator.userAgent;
            return isIosDevice() && !/CriOS|FxiOS|EdgiOS|OPiOS|mercury|FBAN|FBAV|Instagram/i.test(ua);
        }

        function iosInstructionsHTML() {
            const notSafariHint = !isIosSafari()
                ? `<div class="alert alert-warning py-2 px-3 mb-2" style="font-size:13px;">
                       <i class="fas fa-triangle-exclamation me-1"></i>
                       Najpierw otwórz tę stronę w <strong>Safari</strong> - tylko Safari
                       pozwala dodać aplikację do ekranu początkowego.
                   </div>` : '';
            return `
                ${notSafariHint}
                <p class="mb-2" style="font-size:14px;">Na iPhonie instaluje się tak:</p>
                <ol class="mb-0 ps-3" style="font-size:14px;">
                    <li class="mb-2">Stuknij przycisk <strong>Udostępnij</strong>
                        <i class="fas fa-arrow-up-from-bracket mx-1" style="color:#1E88E5;"></i>
                        na dolnym pasku Safari</li>
                    <li class="mb-2">Przewiń w dół i wybierz
                        <strong>"Dodaj do ekranu początkowego"</strong>
                        <i class="fas fa-plus-square ms-1" style="color:#43A047;"></i></li>
                    <li>Potwierdź - ikona Prezentów pojawi się na ekranie 🎁</li>
                </ol>`;
        }

        function renderInstallSection() {
            const content = document.getElementById('installContent');
            if (!content) return;

            if (isStandalone()) {
                content.innerHTML = '<p class="mb-0" style="font-size:14px;"><i class="fas fa-check-circle me-1" style="color:#43A047;"></i>Aplikacja jest już zainstalowana na tym urządzeniu.</p>';
                return;
            }

            // iOS has NO install prompt API - a button pretending to install
            // would always dead-end. Show the honest step-by-step guide
            // right away instead.
            if (isIosDevice()) {
                content.innerHTML = iosInstructionsHTML();
                return;
            }

            // Android/desktop: button-first. With the native prompt captured
            // it installs in one tap; otherwise the click reveals instructions.
            content.innerHTML = `
                <button class="btn btn-success fw-semibold" onclick="installApp()">
                    <i class="fas fa-download me-1"></i>Zainstaluj na tym urządzeniu
                </button>
                <div id="installInstructions" class="mt-3" style="display: none; font-size: 14px;"></div>`;
        }

        function triggerNativeInstall() {
            deferredInstallPrompt.prompt();
            deferredInstallPrompt.userChoice.then(choice => {
                if (choice.outcome === 'accepted') {
                    showToast('Instalowanie aplikacji...', 'success');
                }
                deferredInstallPrompt = null;
                renderInstallSection();
            });
        }

        function showInstallInstructions() {
            const box = document.getElementById('installInstructions');
            if (!box) return;
            box.innerHTML = isIosDevice()
                ? iosInstructionsHTML()
                : 'Otwórz menu przeglądarki (⋮) i wybierz <strong>"Zainstaluj aplikację"</strong> lub <strong>"Dodaj do ekranu głównego"</strong>.';
            box.style.display = 'block';
        }

        function installApp() {
            if (deferredInstallPrompt) {
                triggerNativeInstall();
                return;
            }

            // The browser fires beforeinstallprompt asynchronously, often
            // a moment after load - wait briefly for it before falling
            // back to the manual instructions
            const box = document.getElementById('installInstructions');
            if (box) {
                box.innerHTML = '<i class="fas fa-spinner fa-spin me-1"></i>Przygotowywanie instalacji...';
                box.style.display = 'block';
            }
            let waited = 0;
            const waiter = setInterval(() => {
                waited += 250;
                if (deferredInstallPrompt) {
                    clearInterval(waiter);
                    if (box) box.style.display = 'none';
                    triggerNativeInstall();
                } else if (waited >= 2000) {
                    clearInterval(waiter);
                    showInstallInstructions();
                }
            }, 250);
        }

        document.addEventListener('DOMContentLoaded', () => {
            // The install shortcut has no dependency on auth - render it
            // right away instead of leaving "Sprawdzanie..." on screen
            // while the (possibly cold-starting) server answers /api/auth
            renderInstallSection();

            fetch('/api/auth')
                .then(r => r.json())
                .then(data => {
                    if (!data.authenticated) { window.location.href = '/'; return; }
                    document.getElementById('accountUsername').textContent = data.user.username;
                    loadProfile();
                    updateNotifSection();
                })
                .catch(() => { window.location.href = '/'; });
        });

        function escapeHtml(text) {
            const div = document.createElement('div');
            div.textContent = text == null ? '' : String(text);
            return div.innerHTML;
        }

        function showToast(message, type) {
            const el = document.getElementById(`${type}Toast`);
            document.getElementById(`${type}ToastMessage`).textContent = message;
            new bootstrap.Toast(el, { autohide: true, delay: type === 'error' ? 5000 : 3000 }).show();
        }

        // ===== My profile =====
        function loadProfile() {
            Promise.all([
                fetch('/api/user/identification').then(r => r.json()),
                fetch('/api/recipients').then(r => r.json())
            ])
                .then(([ident, recipients]) => {
                    myIdentification = ident;
                    renderProfile(ident, Array.isArray(recipients) ? recipients : (recipients.recipients || []));
                })
                .catch(() => {
                    document.getElementById('profileContent').innerHTML =
                        '<p class="mb-0">Nie udało się załadować profilu. <a href="#" onclick="loadProfile(); return false;" style="color:white;">Spróbuj ponownie</a></p>';
                });
        }

        function renderProfile(ident, recipients) {
            const content = document.getElementById('profileContent');

            if (ident.isIdentified && ident.identifiedRecipient) {
                const rec = ident.identifiedRecipient;
                content.innerHTML = `
                    <div class="d-flex align-items-center gap-3 flex-wrap">
                        <div class="profile-pic" id="profilePicBox">
                            <img src="/api/recipients/${rec.id}/profile-picture" alt=""
                                 style="width:100%; height:100%; border-radius:50%; object-fit:cover;"
                                 onerror="this.style.display='none'; this.parentElement.textContent='🎅';">
                        </div>
                        <div class="flex-grow-1">
                            <div class="fw-semibold" style="font-size:18px;">${escapeHtml(rec.name)}</div>
                            <div style="font-size:13px; opacity:0.85;">
                                <i class="fas fa-eye-slash me-1"></i>Twoje prezenty są przed Tobą ukryte 🙈
                            </div>
                        </div>
                    </div>
                    <div class="d-flex gap-2 flex-wrap mt-3">
                        <label class="btn btn-light btn-sm fw-semibold" style="color:#212529;">
                            <i class="fas fa-camera me-1"></i>Zmień zdjęcie
                            <input type="file" accept="image/*" hidden onchange="uploadPicture(this, ${rec.id})">
                        </label>
                        <button class="btn btn-outline-secondary btn-sm" onclick="cancelIdentification(${rec.id})">
                            <i class="fas fa-user-slash me-1"></i>To nie ja - anuluj
                        </button>
                    </div>`;
                return;
            }

            // Not identified - offer the unclaimed recipients
            const free = recipients.filter(r => !r.identified_by);
            content.innerHTML = `
                <p style="font-size:14px;">Nie wybrano jeszcze Twojej osoby. Wybierz siebie z listy:</p>
                <div class="d-flex gap-2 flex-wrap">
                    <select id="identifySelect" class="form-select" style="max-width: 320px;">
                        <option value="">Wybierz osobę...</option>
                        ${free.map(r => `<option value="${r.id}">${escapeHtml(r.name)}</option>`).join('')}
                    </select>
                    <button class="btn btn-light fw-semibold" style="color:#212529;" onclick="identifySelf()">
                        <i class="fas fa-user-check me-1"></i>To jestem ja
                    </button>
                </div>
                ${free.length === 0 ? '<p class="mt-2 mb-0" style="font-size:13px; opacity:0.85;">Brak wolnych osób - dodaj siebie na stronie <a href="/osoby">Zarządzanie osobami</a>.</p>' : ''}`;
        }

        function identifySelf() {
            const id = document.getElementById('identifySelect').value;
            if (!id) { showToast('Wybierz osobę z listy', 'error'); return; }
            fetch(`/api/recipients/${id}/identify`, { method: 'POST' })
                .then(r => r.json())
                .then(d => {
                    if (d.success) {
                        showToast('Zidentyfikowano! Twoje prezenty będą przed Tobą ukryte.', 'success');
                        try { localStorage.removeItem('recipientsCache'); } catch (e) {}
                        loadProfile();
                    } else {
                        showToast(d.error || 'Nie udało się zidentyfikować', 'error');
                    }
                })
                .catch(() => showToast('Błąd połączenia. Spróbuj ponownie.', 'error'));
        }

        function cancelIdentification(id) {
            fetch(`/api/recipients/${id}/identify`, { method: 'DELETE' })
                .then(r => r.json())
                .then(d => {
                    if (d.success) {
                        showToast('Identyfikacja anulowana', 'success');
                        try { localStorage.removeItem('recipientsCache'); } catch (e) {}
                        loadProfile();
                    } else {
                        showToast(d.error || 'Nie udało się anulować', 'error');
                    }
                })
                .catch(() => showToast('Błąd połączenia. Spróbuj ponownie.', 'error'));
        }

        function uploadPicture(input, recipientId) {
            const file = input.files && input.files[0];
            if (!file) return;
            if (!file.type.startsWith('image/')) { showToast('Wybierz plik graficzny', 'error'); return; }

            const reader = new FileReader();
            reader.onload = () => {
                fetch(`/api/recipients/${recipientId}/profile-picture`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ profile_picture: reader.result })
                })
                    .then(r => r.json())
                    .then(d => {
                        if (d.success) {
                            showToast('Zdjęcie zaktualizowane!', 'success');
                            try { localStorage.removeItem('recipientsCache'); } catch (e) {}
                            loadProfile();
                        } else {
                            showToast(d.error || 'Nie udało się zapisać zdjęcia', 'error');
                        }
                    })
                    .catch(() => showToast('Błąd połączenia. Spróbuj ponownie.', 'error'));
            };
            reader.readAsDataURL(file);
        }

        // ===== Notifications =====
        function updateNotifSection() {
            const content = document.getElementById('notifContent');
            if (!('Notification' in window) || !('serviceWorker' in navigator)) {
                content.innerHTML = '<p class="mb-0" style="font-size:14px;">Ta przeglądarka nie obsługuje powiadomień.</p>';
                return;
            }
            if (Notification.permission === 'granted') {
                // Don't just trust the browser permission - confirm the
                // subscription is actually registered with the server
                content.innerHTML = '<p class="mb-0" style="font-size:14px;"><i class="fas fa-spinner fa-spin me-1"></i>Sprawdzanie subskrypcji...</p>';
                subscribeToPush().then(ok => {
                    content.innerHTML = ok
                        ? '<p class="mb-0" style="font-size:14px;"><i class="fas fa-check-circle me-1" style="color:#43A047;"></i>Powiadomienia są włączone i zarejestrowane na tym urządzeniu.</p>'
                        : '<p class="mb-2" style="font-size:14px;"><i class="fas fa-triangle-exclamation me-1" style="color:#EF6C00;"></i>Zgoda jest udzielona, ale rejestracja powiadomień nie powiodła się.</p>' +
                          '<button class="btn btn-light btn-sm fw-semibold" style="color:#212529;" onclick="updateNotifSection()"><i class="fas fa-rotate-right me-1"></i>Spróbuj ponownie</button>';
                });
            } else if (Notification.permission === 'denied') {
                content.innerHTML = '<p class="mb-0" style="font-size:14px;"><i class="fas fa-bell-slash me-1"></i>Powiadomienia są zablokowane. Zmień to w ustawieniach przeglądarki.</p>';
            }
            // 'default' - leave the enable button as-is
        }

        function enableNotifications() {
            Notification.requestPermission().then(permission => {
                if (permission === 'granted') {
                    showToast('Powiadomienia włączone!', 'success');
                    subscribeToPush();
                }
                updateNotifSection();
            });
        }

        // True when the existing subscription was created with the same
        // VAPID key the server currently uses. Subscriptions made against
        // an older/broken key LOOK fine locally but every send fails.
        function subscriptionKeyMatches(sub, keyBytes) {
            try {
                const current = new Uint8Array(sub.options.applicationServerKey);
                if (current.length !== keyBytes.length) return false;
                for (let i = 0; i < keyBytes.length; i++) {
                    if (current[i] !== keyBytes[i]) return false;
                }
                return true;
            } catch (e) {
                return true; // can't inspect - assume it's fine
            }
        }

        function subscribeToPush() {
            return fetch('/api/vapid-public-key')
                .then(r => r.json())
                .then(data => {
                    if (!data.webPushAvailable) throw new Error('push unavailable');
                    const keyBytes = urlBase64ToUint8Array(data.publicKey);
                    return navigator.serviceWorker.ready.then(reg =>
                        reg.pushManager.getSubscription().then(existing => {
                            if (existing && !subscriptionKeyMatches(existing, keyBytes)) {
                                // Stale subscription from an old VAPID key -
                                // replace it or pushes never arrive
                                console.log('[Push] Re-subscribing (VAPID key changed)');
                                return existing.unsubscribe().then(() =>
                                    reg.pushManager.subscribe({
                                        userVisibleOnly: true,
                                        applicationServerKey: keyBytes
                                    }));
                            }
                            return existing || reg.pushManager.subscribe({
                                userVisibleOnly: true,
                                applicationServerKey: keyBytes
                            });
                        })
                    );
                })
                .then(subscription => fetch('/api/notifications/subscribe', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(subscription)
                }).then(r => r.json()))
                .then(d => {
                    if (!d || !d.success) throw new Error('server did not save subscription');
                    return true;
                })
                .catch(err => {
                    console.warn('Push subscription failed:', err.message);
                    return false;
                });
        }

        function urlBase64ToUint8Array(base64String) {
            const padding = '='.repeat((4 - base64String.length % 4) % 4);
            const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
            const rawData = window.atob(base64);
            const outputArray = new Uint8Array(rawData.length);
            for (let i = 0; i < rawData.length; ++i) outputArray[i] = rawData.charCodeAt(i);
            return outputArray;
        }

        // ===== Account =====
        function logout() {
            fetch('/api/logout', { method: 'POST' })
                .finally(() => { window.location.href = '/'; });
        }

        function toggleRename() {
            const box = document.getElementById('renameSection');
            const open = box.style.display !== 'none';
            box.style.display = open ? 'none' : 'block';
            if (!open) {
                document.getElementById('newUsername').value =
                    document.getElementById('accountUsername').textContent.trim();
                document.getElementById('renamePassword').value = '';
                document.getElementById('newUsername').focus();
            }
        }

        function changeUsername() {
            const newUsername = document.getElementById('newUsername').value.trim();
            const password = document.getElementById('renamePassword').value;

            if (!newUsername) { showToast('Wpisz nową nazwę użytkownika', 'error'); return; }
            if (!password) { showToast('Potwierdź zmianę hasłem', 'error'); return; }

            const btn = document.getElementById('renameBtn');
            const original = btn.innerHTML;
            btn.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span>Zapisywanie...';
            btn.disabled = true;

            fetch('/api/account/username', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ newUsername, password })
            })
                .then(r => r.json())
                .then(d => {
                    if (d.success) {
                        document.getElementById('accountUsername').textContent = d.username;
                        toggleRename();
                        showToast('Nazwa użytkownika zmieniona!', 'success');
                    } else {
                        showToast(d.error || 'Nie udało się zmienić nazwy', 'error');
                    }
                })
                .catch(() => showToast('Błąd połączenia', 'error'))
                .finally(() => { btn.innerHTML = original; btn.disabled = false; });
        }

        function showDeleteAccount() {
            document.getElementById('deleteAccountConfirm').style.display = 'block';
        }

        function hideDeleteAccount() {
            document.getElementById('deleteAccountConfirm').style.display = 'none';
            document.getElementById('deletePassword').value = '';
        }

        function deleteAccount() {
            const password = document.getElementById('deletePassword').value;
            if (!password) {
                showToast('Podaj hasło, aby potwierdzić', 'error');
                return;
            }

            const btn = document.getElementById('deleteAccountBtn');
            const original = btn.innerHTML;
            btn.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span>Usuwanie...';
            btn.disabled = true;

            fetch('/api/account', {
                method: 'DELETE',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ password })
            })
                .then(r => r.json())
                .then(d => {
                    if (d.success) {
                        try { localStorage.clear(); sessionStorage.clear(); } catch (e) {}
                        alert('Twoje konto zostało usunięte. Do zobaczenia! 👋');
                        window.location.href = '/';
                    } else {
                        showToast(d.error || 'Nie udało się usunąć konta', 'error');
                        btn.innerHTML = original;
                        btn.disabled = false;
                    }
                })
                .catch(() => {
                    showToast('Błąd połączenia', 'error');
                    btn.innerHTML = original;
                    btn.disabled = false;
                });
        }
    