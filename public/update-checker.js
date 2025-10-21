// Auto-update checker for ensuring users see the latest version
(function() {
    'use strict';

    const UPDATE_CHECK_INTERVAL = 5 * 60 * 1000; // Check every 5 minutes
    const STORAGE_KEY = 'app_version';
    let currentVersion = null;

    // Check for updates
    async function checkForUpdates() {
        try {
            const response = await fetch('/api/version', {
                cache: 'no-cache',
                headers: {
                    'Cache-Control': 'no-cache',
                    'Pragma': 'no-cache'
                }
            });
            
            if (!response.ok) return;
            
            const data = await response.json();
            const serverVersion = data.version;
            const storedVersion = localStorage.getItem(STORAGE_KEY);
            
            // Store current version if not set
            if (!storedVersion) {
                localStorage.setItem(STORAGE_KEY, serverVersion);
                currentVersion = serverVersion;
                return;
            }
            
            // Check if version changed
            if (storedVersion !== serverVersion) {
                console.log('New version detected:', serverVersion, 'Current:', storedVersion);
                showUpdateNotification(serverVersion);
            }
        } catch (error) {
            console.error('Error checking for updates:', error);
        }
    }

    // Show update notification
    function showUpdateNotification(newVersion) {
        // Create notification banner
        const banner = document.createElement('div');
        banner.id = 'updateBanner';
        banner.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            right: 0;
            background: linear-gradient(135deg, #4CAF50, #45a049);
            color: white;
            padding: 15px;
            text-align: center;
            z-index: 10000;
            box-shadow: 0 2px 10px rgba(0,0,0,0.2);
            animation: slideDown 0.3s ease-out;
        `;
        
        banner.innerHTML = `
            <div style="max-width: 1200px; margin: 0 auto; display: flex; align-items: center; justify-content: center; gap: 20px; flex-wrap: wrap;">
                <div style="display: flex; align-items: center; gap: 10px;">
                    <i class="fas fa-sync-alt" style="font-size: 1.2rem;"></i>
                    <strong>Nowa wersja dostępna!</strong>
                    <span style="opacity: 0.9;">Odśwież stronę, aby zobaczyć najnowsze zmiany.</span>
                </div>
                <div style="display: flex; gap: 10px;">
                    <button onclick="window.updateChecker.reload()" style="
                        background: white;
                        color: #4CAF50;
                        border: none;
                        padding: 8px 20px;
                        border-radius: 5px;
                        font-weight: bold;
                        cursor: pointer;
                        transition: transform 0.2s;
                    " onmouseover="this.style.transform='scale(1.05)'" onmouseout="this.style.transform='scale(1)'">
                        <i class="fas fa-redo me-1"></i>Odśwież teraz
                    </button>
                    <button onclick="window.updateChecker.dismiss()" style="
                        background: rgba(255,255,255,0.2);
                        color: white;
                        border: 1px solid white;
                        padding: 8px 20px;
                        border-radius: 5px;
                        cursor: pointer;
                        transition: background 0.2s;
                    " onmouseover="this.style.background='rgba(255,255,255,0.3)'" onmouseout="this.style.background='rgba(255,255,255,0.2)'">
                        Później
                    </button>
                </div>
            </div>
        `;
        
        // Add animation
        const style = document.createElement('style');
        style.textContent = `
            @keyframes slideDown {
                from {
                    transform: translateY(-100%);
                    opacity: 0;
                }
                to {
                    transform: translateY(0);
                    opacity: 1;
                }
            }
        `;
        document.head.appendChild(style);
        
        document.body.insertBefore(banner, document.body.firstChild);
        
        // Update stored version
        localStorage.setItem(STORAGE_KEY, newVersion);
    }

    // Reload the page with cache clearing
    function reloadPage() {
        // Clear service worker cache
        if ('serviceWorker' in navigator && 'caches' in window) {
            caches.keys().then(function(cacheNames) {
                return Promise.all(
                    cacheNames.map(function(cacheName) {
                        return caches.delete(cacheName);
                    })
                );
            }).then(function() {
                // Force reload from server
                window.location.reload(true);
            });
        } else {
            // Force reload from server
            window.location.reload(true);
        }
    }

    // Dismiss notification
    function dismissNotification() {
        const banner = document.getElementById('updateBanner');
        if (banner) {
            banner.style.animation = 'slideDown 0.3s ease-out reverse';
            setTimeout(() => banner.remove(), 300);
        }
    }

    // Initialize
    function init() {
        // Check immediately
        checkForUpdates();
        
        // Check periodically
        setInterval(checkForUpdates, UPDATE_CHECK_INTERVAL);
        
        // Check when page becomes visible
        document.addEventListener('visibilitychange', function() {
            if (!document.hidden) {
                checkForUpdates();
            }
        });
        
        // Check when online
        window.addEventListener('online', checkForUpdates);
    }

    // Expose public API
    window.updateChecker = {
        reload: reloadPage,
        dismiss: dismissNotification,
        check: checkForUpdates
    };

    // Start when DOM is ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
