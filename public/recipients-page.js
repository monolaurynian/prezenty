
        let recipientsDeferredPrompt;

        // Add click event listener to logo
        const logoContainer = document.querySelector('.brand-logo-container');
        if (logoContainer) {
            // Check if app is installed as PWA
            const isInstalled = window.matchMedia('(display-mode: standalone)').matches ||
                window.navigator.standalone === true;

            if (isInstalled) {
                // App is installed - remove the install instruction tooltip
                logoContainer.removeAttribute('title');
                logoContainer.style.cursor = 'default';
            } else {
                // App not installed - show install instructions on click
                logoContainer.addEventListener('click', function (event) {
                    event.preventDefault();
                    event.stopPropagation();
                    showInstallInstructions();
                });
            }
        }

        window.addEventListener('beforeinstallprompt', (e) => {
            console.log('PWA install prompt available');
            e.preventDefault();
            recipientsDeferredPrompt = e;
        });



        function showInstallInstructions() {
            console.log('showInstallInstructions() called');

            // Try native prompt first if available
            if (recipientsDeferredPrompt) {
                console.log('Using native PWA install prompt');
                recipientsDeferredPrompt.prompt();
                recipientsDeferredPrompt.userChoice.then((choiceResult) => {
                    if (choiceResult.outcome === 'accepted') {
                        console.log('User accepted the PWA install prompt');
                    } else {
                        console.log('User dismissed the PWA install prompt');
                        // Show manual instructions if they dismissed the native prompt
                        showManualInstallInstructions();
                    }
                    recipientsDeferredPrompt = null;
                });
                return;
            }

            // Show manual instructions if native prompt not available
            showManualInstallInstructions();
        }

        function showManualInstallInstructions() {
            const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
            const isAndroid = /Android/.test(navigator.userAgent);
            const isChrome = /Chrome/.test(navigator.userAgent);
            const isEdge = /Edg/.test(navigator.userAgent);

            let instructions = '';
            let title = 'Zainstaluj aplikację';

            if (isIOS) {
                title = 'Dodaj do ekranu głównego';
                instructions = `
                    <div class="text-center mb-3">
                        <i class="fab fa-safari fa-3x text-primary mb-2"></i>
                        <h6>Safari na iOS</h6>
                    </div>
                    <div class="alert alert-info mb-3">
                        <i class="fas fa-info-circle me-2"></i>
                        <strong>Ważne:</strong> Musisz używać przeglądarki Safari
                    </div>
                    <ol class="text-start">
                        <li class="mb-3">
                            <strong>Krok 1:</strong> Naciśnij przycisk <strong>Udostępnij</strong> 
                            <i class="fas fa-share text-primary"></i> na dole ekranu w Safari
                        </li>
                        <li class="mb-3">
                            <strong>Krok 2:</strong> Przewiń w dół i znajdź opcję 
                            <strong>"Dodaj do ekranu głównego"</strong> <i class="fas fa-plus-square text-success"></i>
                        </li>
                        <li class="mb-3">
                            <strong>Krok 3:</strong> Naciśnij <strong>"Dodaj"</strong> w prawym górnym rogu
                        </li>
                        <li class="mb-2">
                            <strong>Gotowe!</strong> Aplikacja pojawi się na ekranie głównym
                        </li>
                    </ol>
                `;
            } else if (isAndroid && isChrome) {
                instructions = `
                    <div class="text-center mb-3">
                        <i class="fab fa-chrome fa-3x text-success mb-2"></i>
                        <h6>Chrome na Android</h6>
                    </div>
                    <ol class="text-start">
                        <li class="mb-2">Naciśnij menu <strong>⋮</strong> w prawym górnym rogu</li>
                        <li class="mb-2">Wybierz <strong>"Dodaj do ekranu głównego"</strong> lub <strong>"Zainstaluj aplikację"</strong></li>
                        <li class="mb-2">Potwierdź instalację</li>
                    </ol>
                `;
            } else if (isChrome || isEdge) {
                const browserName = isEdge ? 'Edge' : 'Chrome';
                const browserIcon = isEdge ? 'fab fa-edge' : 'fab fa-chrome';
                instructions = `
                    <div class="text-center mb-3">
                        <i class="${browserIcon} fa-3x text-primary mb-2"></i>
                        <h6>${browserName} na komputerze</h6>
                    </div>
                    <ol class="text-start">
                        <li class="mb-2">Poszukaj ikony <strong>"Zainstaluj"</strong> <i class="fas fa-download"></i> w pasku adresu</li>
                        <li class="mb-2">Lub naciśnij menu <strong>⋮</strong> → <strong>"Zainstaluj Życzenia Prezentowe"</strong></li>
                        <li class="mb-2">Potwierdź instalację w oknie dialogowym</li>
                    </ol>
                `;
            } else {
                instructions = `
                    <div class="text-center mb-3">
                        <i class="fas fa-mobile-alt fa-3x text-warning mb-2"></i>
                        <h6>Instalacja niedostępna</h6>
                    </div>
                    <p class="text-center">
                        Aby zainstalować aplikację, użyj jednej z obsługiwanych przeglądarek:
                    </p>
                    <ul class="text-start">
                        <li><strong>Chrome</strong> (Android, Windows, Mac)</li>
                        <li><strong>Safari</strong> (iOS, Mac)</li>
                        <li><strong>Edge</strong> (Windows, Mac)</li>
                    </ul>
                `;
            }

            // Create and show modal
            const modal = document.createElement('div');
            modal.className = 'modal fade';
            modal.innerHTML = `
                <div class="modal-dialog modal-dialog-centered">
                    <div class="modal-content">
                        <div class="modal-header">
                            <h5 class="modal-title">
                                <i class="fas fa-download me-2"></i>${title}
                            </h5>
                            <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
                        </div>
                        <div class="modal-body">
                            ${instructions}

                        </div>
                        <div class="modal-footer">
                            <button type="button" class="btn btn-primary" data-bs-dismiss="modal">
                                <i class="fas fa-check me-1"></i>Rozumiem
                            </button>
                        </div>
                    </div>
                </div>
            `;

            document.body.appendChild(modal);
            const bootstrapModal = new bootstrap.Modal(modal);
            bootstrapModal.show();

            // Remove modal from DOM when hidden
            modal.addEventListener('hidden.bs.modal', () => {
                document.body.removeChild(modal);
            });
        }

        // Hide install button if app is already installed
        window.addEventListener('appinstalled', (evt) => {
            console.log('PWA was installed');
            // Request notification permission after app installation
            requestNotificationPermission();
        });

        // Check if app is already installed and update logo tooltip
        if (window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone) {
            console.log('App is already installed');
            if (logoContainer) {
                logoContainer.title = 'Aplikacja jest już zainstalowana';
            }
            // Request notification permission for installed app
            requestNotificationPermission();
        }

        // Notification Bell Functions
        let notificationDropdownOpen = false;

        function toggleNotificationDropdown() {
            const dropdown = document.getElementById('notificationDropdown');
            notificationDropdownOpen = !notificationDropdownOpen;

            if (notificationDropdownOpen) {
                dropdown.classList.add('show');
                loadRecentNotifications();
                // Mark all notifications as read when opening the dropdown
                markAllNotificationsAsReadOnOpen();
            } else {
                dropdown.classList.remove('show');
            }
        }

        function markAllNotificationsAsReadOnOpen() {
            // Only mark as read if there are unread notifications
            const badge = document.getElementById('notificationBadge');
            if (badge && badge.style.display !== 'none') {
                fetch('/api/notifications/read-all', {
                    method: 'POST'
                })
                    .then(response => response.json())
                    .then(data => {
                        if (data.success) {
                            // Update badge count to 0
                            updateBadgeCount(0);
                            // Reload notifications to show updated read status
                            setTimeout(() => loadRecentNotifications(), 100);
                        }
                    })
                    .catch(error => {
                        console.error('Error marking notifications as read:', error);
                    });
            }
        }

        function loadUnreadCount() {
            fetch('/api/notifications/unread-count')
                .then(response => response.json())
                .then(data => {
                    updateBadgeCount(data.count);
                    // Show banner if there are unread notifications
                    if (data.count > 0) {
                        showNotificationBanner(data.count);
                    }
                })
                .catch(error => {
                    console.error('Error loading unread count:', error);
                });
        }

        function updateBadgeCount(count) {
            const badge = document.getElementById('activityBadge');
            if (badge) {
                if (count > 0) {
                    badge.textContent = count > 99 ? '99+' : count;
                    badge.style.display = 'flex';
                } else {
                    badge.style.display = 'none';
                }
            }
        }

        function loadRecentNotifications() {
            const body = document.getElementById('notificationDropdownBody');
            const markAllBtn = document.getElementById('markAllReadBtn');

            if (!body) return;

            body.innerHTML = '<div class="text-center py-3"><i class="fas fa-spinner fa-spin"></i></div>';

            fetch('/api/notifications?limit=5')
                .then(response => response.json())
                .then(data => {
                    if (data.notifications.length === 0) {
                        body.innerHTML = '<div class="text-center py-4 text-muted"><i class="fas fa-bell-slash fa-2x mb-2"></i><p class="mb-0">Brak powiadomień</p></div>';
                        if (markAllBtn) markAllBtn.style.display = 'none';
                    } else {
                        body.innerHTML = data.notifications.map(n => renderNotification(n)).join('');
                        if (markAllBtn) markAllBtn.style.display = data.unreadCount > 0 ? 'inline-block' : 'none';
                    }
                })
                .catch(error => {
                    console.error('Error loading notifications:', error);
                    if (body) body.innerHTML = '<div class="text-center py-3 text-danger"><i class="fas fa-exclamation-circle"></i> Błąd ładowania</div>';
                });
        }

        // Person name -> link to their prefiltered presents page
        function personLinkHtml(name) {
            return `<a href="/recipients.html?osoba=${encodeURIComponent(name)}" onclick="event.stopPropagation();" style="color: #2196F3; text-decoration: underline;"><strong>${notificationTextEscape(name)}</strong></a>`;
        }

        function notificationTextEscape(text) {
            const div = document.createElement('div');
            div.textContent = text == null ? '' : String(text);
            return div.innerHTML;
        }

        // Shared wording (notification-text.js); the actor is printed
        // separately by renderNotification, so it's left out here
        function bellMessage(type, data, actor, color) {
            return notificationText(type, data, actor, {
                showActor: false,
                person: (safe, raw) => personLinkHtml(raw),
                present: (quoted, d) => d.presentId ?
                    `<span onclick="event.stopPropagation(); window.navigateToPresent(${Number(d.presentId)});" style="color: ${color}; text-decoration: underline; cursor: pointer;"><strong>${quoted}</strong></span>` :
                    `<strong>${quoted}</strong>`
            });
        }

        function renderNotification(notification) {
            const config = getNotificationConfig(notification.type);
            const isUnread = !notification.is_read;
            const timeAgo = getTimeAgo(notification.created_at);

            return `
                <div class="notification-item ${isUnread ? 'unread' : ''}" onclick="handleNotificationClick(${notification.id}, ${JSON.stringify(notification.data).replace(/"/g, '&quot;')})">
                    <div class="notification-icon" style="color: ${config.color}">
                        <i class="fas ${config.icon}"></i>
                    </div>
                    <div class="notification-content">
                        <div class="notification-text">
                            <strong>${notificationTextEscape(notification.actor_username || 'Ktoś')}</strong> ${config.getMessage(notification.data, notification.actor_username || 'Ktoś')}
                        </div>
                        <div class="notification-time">${timeAgo}</div>
                    </div>
                    ${isUnread ? '<div class="notification-unread-dot"></div>' : ''}
                </div>
            `;
        }

        function getNotificationConfig(type) {
            const configs = {
                recipient_added: {
                    icon: 'fa-user-plus',
                    color: '#4CAF50',
                    getMessage: (data, actor) => bellMessage('recipient_added', data, actor, '#4CAF50')
                },
                present_added: {
                    icon: 'fa-gift',
                    color: '#2196F3',
                    getMessage: (data, actor) => bellMessage('present_added', data, actor, '#2196F3')
                },
                present_reserved: {
                    icon: 'fa-bookmark',
                    color: '#FF9800',
                    getMessage: (data, actor) => bellMessage('present_reserved', data, actor, '#FF9800')
                },
                present_unreserved: {
                    icon: 'fa-bookmark-slash',
                    color: '#9E9E9E',
                    getMessage: (data, actor) => bellMessage('present_unreserved', data, actor, '#9E9E9E')
                },
                present_checked: {
                    icon: 'fa-check-circle',
                    color: '#4CAF50',
                    getMessage: (data, actor) => bellMessage('present_checked', data, actor, '#4CAF50')
                },
                present_unchecked: {
                    icon: 'fa-circle',
                    color: '#9E9E9E',
                    getMessage: (data, actor) => bellMessage('present_unchecked', data, actor, '#9E9E9E')
                },
                leaderboard_leader: {
                    icon: 'fa-trophy',
                    color: '#FFC107',
                    // leaderName / previousLeaderName are recipients.name, i.e.
                    // user supplied, and renderNotification feeds this straight
                    // to innerHTML. Element context, so the page's own
                    // notificationTextEscape is enough. (The second
                    // leaderboard_leader config further down this file is the
                    // html:false plain-text one - do not escape that one.)
                    getMessage: (data, actor) => `🏆 <strong>${notificationTextEscape(data.leaderName || 'Ktoś')}</strong>${data.previousLeaderName ? ` wyprzedza <strong>${notificationTextEscape(data.previousLeaderName)}</strong> i` : ''} prowadzi w <a href="/leaderboard.html" onclick="event.stopPropagation();" style="color: #FFC107; text-decoration: underline;">rankingu</a> z ${data.presentCount || '?'} ${data.presentCount === 1 ? 'prezentem' : 'prezentami'}!`
                },
                anon_message: {
                    icon: 'fa-comment-dots',
                    color: '#7B1FA2',
                    // Same innerHTML path as leaderboard_leader above.
                    getMessage: (data, actor) => `💬 <strong>${notificationTextEscape(data.label || 'Nowa wiadomość')}</strong> - <a href="${data.threadId ? '/wiadomosci?rozmowa=' + data.threadId : '/wiadomosci'}" style="color: #7B1FA2;">otwórz</a>`
                }
            };
            return configs[type] || configs.present_added;
        }

        function getTimeAgo(timestamp) {
            const now = new Date();
            const time = new Date(timestamp);
            const diffMs = now - time;
            const diffMins = Math.floor(diffMs / 60000);
            const diffHours = Math.floor(diffMs / 3600000);
            const diffDays = Math.floor(diffMs / 86400000);

            if (diffMins < 1) return 'Teraz';
            if (diffMins < 60) return `${diffMins} min temu`;
            if (diffHours < 24) return `${diffHours} godz. temu`;
            if (diffDays < 7) return `${plCount(diffDays, 'dzień', 'dni', 'dni')} temu`;
            return time.toLocaleDateString('pl-PL');
        }

        // Make navigateToPresent globally accessible
        window.navigateToPresent = function(presentId) {
            console.log('[Notification] Navigating to present:', presentId);
            sessionStorage.setItem('scrollToPresentId', presentId);
            if (window.location.pathname !== '/recipients') {
                window.location.href = '/recipients';
            } else {
                // Already on recipients page, just scroll to this present
                if (typeof scrollToPresentById === 'function') {
                    scrollToPresentById(presentId);
                } else {
                    // Fallback: reload page
                    window.location.reload();
                }
            }
        };

        function handleNotificationClick(notificationId, data) {
            // Mark as read
            fetch(`/api/notifications/${notificationId}/read`, {
                method: 'POST'
            })
                .then(response => response.json())
                .then(result => {
                    if (result.success) {
                        updateBadgeCount(result.unreadCount);
                        loadRecentNotifications();
                    }
                })
                .catch(error => {
                    console.error('Error marking notification as read:', error);
                });

            // Navigate to present if presentId is available
            if (data && data.presentId) {
                navigateToPresent(data.presentId);
            }
        }

        function markNotificationAsRead(notificationId) {
            fetch(`/api/notifications/${notificationId}/read`, {
                method: 'POST'
            })
                .then(response => response.json())
                .then(data => {
                    if (data.success) {
                        updateBadgeCount(data.unreadCount);
                        loadRecentNotifications();
                    }
                })
                .catch(error => {
                    console.error('Error marking notification as read:', error);
                });
        }

        function markAllAsRead() {
            fetch('/api/notifications/read-all', {
                method: 'POST'
            })
                .then(response => response.json())
                .then(data => {
                    if (data.success) {
                        updateBadgeCount(0);
                        loadRecentNotifications();
                        dismissNotificationBanner();
                        showSuccessToast('Wszystkie powiadomienia oznaczone jako przeczytane');
                    }
                })
                .catch(error => {
                    console.error('Error marking all as read:', error);
                    showErrorToast('Błąd podczas oznaczania powiadomień');
                });
        }

        // Notification Banner Functions
        function showNotificationBanner(count) {
            const banner = document.getElementById('notificationBanner');
            const bannerMessage = document.getElementById('bannerMessage');

            if (count > 0) {
                bannerMessage.textContent = `Masz ${plCount(count, 'nowe powiadomienie', 'nowe powiadomienia', 'nowych powiadomień')}`;
                banner.style.display = 'block';
            }
        }

        function dismissNotificationBanner() {
            const banner = document.getElementById('notificationBanner');
            banner.style.display = 'none';
        }

        // Close dropdown when clicking outside
        document.addEventListener('click', function (event) {
            const dropdown = document.getElementById('notificationDropdown');
            const bellBtn = document.querySelector('.notification-bell-btn');

            if (notificationDropdownOpen && dropdown && bellBtn) {
                if (!dropdown.contains(event.target) && !bellBtn.contains(event.target)) {
                    toggleNotificationDropdown();
                }
            }
        });

        // Load unread count on page load and poll every 30 seconds
        document.addEventListener('DOMContentLoaded', function () {
            loadUnreadCount();
            setInterval(loadUnreadCount, 30000); // Poll every 30 seconds
        });

        // Push notification functions
        function requestNotificationPermission() {
            const notificationButton = document.getElementById('notificationButton');

            // Check if notifications are supported
            if (!('Notification' in window)) {
                showErrorToast('Powiadomienia nie są obsługiwane w tej przeglądarce');
                if (notificationButton) {
                    notificationButton.innerHTML = '<i class="fas fa-bell-slash me-1"></i>Nieobsługiwane';
                    notificationButton.disabled = true;
                }
                return;
            }

            if (!('serviceWorker' in navigator)) {
                showErrorToast('Service Worker nie jest obsługiwany');
                return;
            }

            // Show loading state
            if (notificationButton) {
                notificationButton.innerHTML = '<i class="fas fa-spinner fa-spin me-1"></i>Ładowanie...';
                notificationButton.disabled = true;
            }

            Notification.requestPermission().then(function (permission) {
                console.log('Notification permission:', permission);

                if (permission === 'granted') {
                    showSuccessToast('Powiadomienia włączone!');
                    subscribeToNotifications();
                    if (notificationButton) {
                        notificationButton.style.display = 'none';
                    }
                } else if (permission === 'denied') {
                    showErrorToast('Powiadomienia zostały zablokowane. Zmień ustawienia przeglądarki.');
                    if (notificationButton) {
                        notificationButton.innerHTML = '<i class="fas fa-bell-slash me-1"></i>Zablokowane';
                        notificationButton.disabled = true;
                    }
                } else {
                    // Permission dismissed
                    if (notificationButton) {
                        notificationButton.innerHTML = '<i class="fas fa-bell me-1"></i>Powiadomienia';
                        notificationButton.disabled = false;
                    }
                }
            }).catch(function (error) {
                console.error('Error requesting notification permission:', error);
                showErrorToast('Błąd podczas włączania powiadomień');
                if (notificationButton) {
                    notificationButton.innerHTML = '<i class="fas fa-bell me-1"></i>Powiadomienia';
                    notificationButton.disabled = false;
                }
            });
        }

        // Check notification permission status and show button if needed
        function checkNotificationStatus() {
            const notificationButton = document.getElementById('notificationButton');

            if ('Notification' in window && 'serviceWorker' in navigator) {
                if (Notification.permission === 'default') {
                    if (notificationButton) {
                        notificationButton.style.display = 'inline-block';
                    }
                } else if (Notification.permission === 'granted') {
                    subscribeToNotifications();
                    if (notificationButton) {
                        notificationButton.style.display = 'none';
                    }
                } else if (Notification.permission === 'denied') {
                    if (notificationButton) {
                        notificationButton.innerHTML = '<i class="fas fa-bell-slash me-1"></i>Zablokowane';
                        notificationButton.disabled = true;
                        notificationButton.style.display = 'inline-block';
                    }
                }
            }
        }

        function subscribeToNotifications() {
            // First, get the VAPID public key from the server
            fetch('/api/vapid-public-key')
                .then(response => response.json())
                .then(data => {
                    if (!data.webPushAvailable) {
                        throw new Error('Web-push module not available on server');
                    }

                    const keyBytes = urlBase64ToUint8Array(data.publicKey);
                    // Subscriptions created against an older VAPID key look
                    // valid locally but every send fails - detect and replace
                    const keyMatches = function (sub) {
                        try {
                            const current = new Uint8Array(sub.options.applicationServerKey);
                            if (current.length !== keyBytes.length) return false;
                            for (let i = 0; i < keyBytes.length; i++) {
                                if (current[i] !== keyBytes[i]) return false;
                            }
                            return true;
                        } catch (e) { return true; }
                    };

                    return navigator.serviceWorker.ready.then(function (registration) {
                        // Check if already subscribed
                        return registration.pushManager.getSubscription().then(function (existingSubscription) {
                            if (existingSubscription && keyMatches(existingSubscription)) {
                                console.log('Already subscribed:', existingSubscription);
                                sendSubscriptionToServer(existingSubscription);
                                return existingSubscription;
                            }

                            const doSubscribe = function () {
                                return registration.pushManager.subscribe({
                                    userVisibleOnly: true,
                                    applicationServerKey: keyBytes
                                });
                            };

                            if (existingSubscription) {
                                console.log('[Push] Re-subscribing (VAPID key changed)');
                                return existingSubscription.unsubscribe().then(doSubscribe);
                            }
                            return doSubscribe();
                        });
                    });
                })
                .then(function (subscription) {
                    console.log('Push subscription successful:', subscription);
                    sendSubscriptionToServer(subscription);
                    // Test notification removed - no annoying popup
                }).catch(function (error) {
                    console.error('Push subscription failed:', error);

                    let errorMessage = 'Błąd subskrypcji: ';
                    if (error.message.includes('Web-push module not available')) {
                        errorMessage += 'Serwer nie obsługuje powiadomień (brak modułu web-push)';
                    } else if (error.message.includes('Registration failed')) {
                        errorMessage += 'Błąd rejestracji - sprawdź połączenie internetowe';
                    } else {
                        errorMessage += error.message;
                    }

                    showErrorToast(errorMessage);
                });
        }

        function sendSubscriptionToServer(subscription) {
            console.log('📤 Sending subscription to server:', {
                endpoint: subscription.endpoint.substring(0, 50) + '...',
                hasKeys: !!(subscription.keys && subscription.keys.p256dh && subscription.keys.auth)
            });

            fetch('/api/notifications/subscribe', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(subscription)
            }).then(response => response.json())
                .then(data => {
                    console.log('✅ Subscription saved successfully:', data);
                    if (data.userSubscriptions !== undefined) {
                        console.log(`📊 You have ${data.userSubscriptions} subscription(s). Total system: ${data.totalSubscriptions}`);
                    }
                }).catch(error => {
                    console.error('❌ Error sending subscription to server:', error);
                });
        }

        function urlBase64ToUint8Array(base64String) {
            const padding = '='.repeat((4 - base64String.length % 4) % 4);
            const base64 = (base64String + padding)
                .replace(/-/g, '+')
                .replace(/_/g, '/');

            const rawData = window.atob(base64);
            const outputArray = new Uint8Array(rawData.length);

            for (let i = 0; i < rawData.length; ++i) {
                outputArray[i] = rawData.charCodeAt(i);
            }
            return outputArray;
        }

        // Test notification function
        function testNotification() {
            const testButton = document.getElementById('testNotificationButton');

            if (testButton) {
                testButton.innerHTML = '<i class="fas fa-spinner fa-spin me-1"></i>Wysyłanie...';
                testButton.disabled = true;
            }

            fetch('/api/test-notification', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    includeCurrentUser: true  // Send to yourself for testing
                })
            })
                .then(response => response.json())
                .then(data => {
                    if (data.success) {
                        showSuccessToast('Test notification sent! You should receive it in a few seconds.');
                    } else {
                        showErrorToast('Failed to send test notification: ' + (data.error || 'Unknown error'));
                    }
                })
                .catch(error => {
                    console.error('Test notification error:', error);
                    showErrorToast('Error sending test notification: ' + error.message);
                })
                .finally(() => {
                    if (testButton) {
                        testButton.innerHTML = '<i class="fas fa-vial me-1"></i>Test';
                        testButton.disabled = false;
                    }
                });
        }

        // Check notification status when page loads
        setTimeout(() => {
            checkNotificationStatus();

            // Show test button if notifications are supported
            const testButton = document.getElementById('testNotificationButton');
            if (testButton && 'Notification' in window && 'serviceWorker' in navigator) {
                testButton.style.display = 'inline-block';
            }
        }, 1000); // Wait 1 second after page load

        // Debug PWA installation criteria
        console.log('PWA Debug Info:', {
            isSecure: location.protocol === 'https:' || location.hostname === 'localhost',
            hasManifest: !!document.querySelector('link[rel="manifest"]'),
            hasServiceWorker: 'serviceWorker' in navigator,
            isStandalone: window.matchMedia('(display-mode: standalone)').matches,
            userAgent: navigator.userAgent
        });
    