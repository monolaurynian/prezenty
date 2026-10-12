
        // Register service worker
        if ('serviceWorker' in navigator) {
            window.addEventListener('load', function () {
                navigator.serviceWorker.register('/sw.js')
                    .then(function (registration) {
                        console.log('ServiceWorker registration successful');
                    })
                    .catch(function (err) {
                        console.log('ServiceWorker registration failed: ', err);
                    });
            });
        }

        // PWA Install functionality
        let deferredPrompt;
        const installButton = document.getElementById('installButton');
        const installButtonContainer = document.getElementById('installButtonContainer');

        window.addEventListener('beforeinstallprompt', (e) => {
            console.log('PWA install prompt triggered');
            e.preventDefault();
            deferredPrompt = e;

            // Show the install button
            if (installButtonContainer) {
                installButtonContainer.style.display = 'block';
            }
        });

        // Check if app is already installed
        if (window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone) {
            console.log('App is already installed');
            if (installButtonContainer) {
                installButtonContainer.style.display = 'none';
            }
        }

        // Install button click handler
        if (installButton) {
            installButton.addEventListener('click', async () => {
                if (deferredPrompt) {
                    deferredPrompt.prompt();
                    const { outcome } = await deferredPrompt.userChoice;

                    if (outcome === 'accepted') {
                        console.log('User accepted the PWA install prompt');
                        hideInstallButton();
                    } else {
                        console.log('User dismissed the PWA install prompt');
                    }

                    deferredPrompt = null;
                } else {
                    // Show install instructions if prompt not available
                    alert('Aby zainstalować aplikację:\n\n• Chrome/Edge: Szukaj ikony "Zainstaluj" w pasku adresu\n• Safari (iOS): Udostępnij → Dodaj do ekranu głównego\n• Android: Menu → Dodaj do ekranu głównego');
                }
            });
        }

        function hideInstallButton() {
            if (installButtonContainer) {
                installButtonContainer.style.display = 'none';
            }
        }

        // Hide install button if app is already installed
        window.addEventListener('appinstalled', (evt) => {
            console.log('PWA was installed');
            hideInstallButton();
        });
    