// Real-time incremental updates system
// Catches individual changes instead of reloading entire list

(function() {
    'use strict';

    // Configuration
    const POLL_INTERVAL = 10000; // Check for updates every 10 seconds
    const STORAGE_KEY = 'last_update_timestamp';
    
    let isPolling = false;
    let pollTimer = null;
    let lastUpdateTimestamp = null;

    // Initialize
    function init() {
        // Get last update timestamp from storage
        lastUpdateTimestamp = localStorage.getItem(STORAGE_KEY) || Date.now();
        
        // Start polling for updates
        startPolling();
        
        // Poll when page becomes visible
        document.addEventListener('visibilitychange', function() {
            if (!document.hidden) {
                checkForUpdates();
            }
        });
        
        // Poll when online
        window.addEventListener('online', checkForUpdates);
    }

    // Start polling
    function startPolling() {
        if (isPolling) return;
        isPolling = true;
        
        pollTimer = setInterval(checkForUpdates, POLL_INTERVAL);
        console.log('[Realtime] Started polling for updates');
    }

    // Stop polling
    function stopPolling() {
        if (!isPolling) return;
        isPolling = false;
        
        if (pollTimer) {
            clearInterval(pollTimer);
            pollTimer = null;
        }
        console.log('[Realtime] Stopped polling for updates');
    }

    // Check for updates
    async function checkForUpdates() {
        try {
            const response = await fetch(`/api/updates?since=${lastUpdateTimestamp}`, {
                cache: 'no-cache',
                headers: {
                    'Cache-Control': 'no-cache',
                    'Pragma': 'no-cache'
                }
            });
            
            if (!response.ok) return;
            
            const data = await response.json();
            
            if (data.hasUpdates && data.updates && data.updates.length > 0) {
                console.log('[Realtime] Received updates:', data.updates.length);
                applyUpdates(data.updates);
                
                // Update timestamp
                lastUpdateTimestamp = data.timestamp;
                localStorage.setItem(STORAGE_KEY, lastUpdateTimestamp);
            }
        } catch (error) {
            console.error('[Realtime] Error checking for updates:', error);
        }
    }

    // Apply incremental updates to the UI
    function applyUpdates(updates) {
        updates.forEach(update => {
            switch(update.type) {
                case 'present_added':
                    handlePresentAdded(update.data);
                    break;
                case 'present_updated':
                    handlePresentUpdated(update.data);
                    break;
                case 'present_deleted':
                    handlePresentDeleted(update.data);
                    break;
                case 'present_reserved':
                    handlePresentReserved(update.data);
                    break;
                case 'present_unreserved':
                    handlePresentUnreserved(update.data);
                    break;
                case 'present_checked':
                    handlePresentChecked(update.data);
                    break;
                case 'recipient_added':
                    handleRecipientAdded(update.data);
                    break;
                case 'recipient_updated':
                    handleRecipientUpdated(update.data);
                    break;
                case 'recipient_deleted':
                    handleRecipientDeleted(update.data);
                    break;
                default:
                    console.log('[Realtime] Unknown update type:', update.type);
            }
        });
        
        // Show notification if updates were applied
        if (updates.length > 0 && typeof showToast === 'function') {
            showToast(`Zaktualizowano ${updates.length} ${updates.length === 1 ? 'element' : 'elementy'}`, 'info');
        }
    }

    // Handle present added
    function handlePresentAdded(data) {
        console.log('[Realtime] Present added:', data);
        
        // Find the recipient card
        const recipientCard = document.querySelector(`[data-recipient-id="${data.recipientId}"]`);
        if (!recipientCard) {
            // Recipient not visible, do a full reload
            if (typeof loadRecipientsAndPresents === 'function') {
                loadRecipientsAndPresents();
            }
            return;
        }
        
        // Add the present to the list
        const presentsList = recipientCard.querySelector('.presents-list');
        if (presentsList && typeof renderPresent === 'function') {
            const presentHtml = renderPresent(data.present, data.recipientId);
            presentsList.insertAdjacentHTML('afterbegin', presentHtml);
            
            // Update count
            updatePresentCount(data.recipientId);
        }
    }

    // Handle present updated
    function handlePresentUpdated(data) {
        console.log('[Realtime] Present updated:', data);
        
        const presentElement = document.querySelector(`[data-present-id="${data.presentId}"]`);
        if (presentElement && typeof renderPresent === 'function') {
            const newHtml = renderPresent(data.present, data.recipientId);
            presentElement.outerHTML = newHtml;
        }
    }

    // Handle present deleted
    function handlePresentDeleted(data) {
        console.log('[Realtime] Present deleted:', data);
        
        const presentElement = document.querySelector(`[data-present-id="${data.presentId}"]`);
        if (presentElement) {
            presentElement.remove();
            updatePresentCount(data.recipientId);
        }
    }

    // Handle present reserved
    function handlePresentReserved(data) {
        console.log('[Realtime] Present reserved:', data);
        
        const presentElement = document.querySelector(`[data-present-id="${data.presentId}"]`);
        if (presentElement) {
            // Update reservation status
            const reserveBtn = presentElement.querySelector('.reserve-btn');
            if (reserveBtn) {
                reserveBtn.textContent = `Zarezerwowane przez ${data.username}`;
                reserveBtn.classList.remove('btn-outline-success');
                reserveBtn.classList.add('btn-secondary');
                reserveBtn.disabled = true;
            }
        }
    }

    // Handle present unreserved
    function handlePresentUnreserved(data) {
        console.log('[Realtime] Present unreserved:', data);
        
        const presentElement = document.querySelector(`[data-present-id="${data.presentId}"]`);
        if (presentElement) {
            // Update reservation status
            const reserveBtn = presentElement.querySelector('.reserve-btn');
            if (reserveBtn) {
                reserveBtn.textContent = 'Zarezerwuj';
                reserveBtn.classList.remove('btn-secondary');
                reserveBtn.classList.add('btn-outline-success');
                reserveBtn.disabled = false;
            }
        }
    }

    // Handle present checked
    function handlePresentChecked(data) {
        console.log('[Realtime] Present checked:', data);
        
        const presentElement = document.querySelector(`[data-present-id="${data.presentId}"]`);
        if (presentElement) {
            const checkbox = presentElement.querySelector('.present-checkbox');
            if (checkbox) {
                checkbox.checked = data.isChecked;
            }
            
            // Update visual state
            if (data.isChecked) {
                presentElement.classList.add('checked');
            } else {
                presentElement.classList.remove('checked');
            }
        }
    }

    // Handle recipient added
    function handleRecipientAdded(data) {
        console.log('[Realtime] Recipient added:', data);
        
        // Do a full reload for new recipients
        if (typeof loadRecipientsAndPresents === 'function') {
            loadRecipientsAndPresents();
        }
    }

    // Handle recipient updated
    function handleRecipientUpdated(data) {
        console.log('[Realtime] Recipient updated:', data);
        
        const recipientCard = document.querySelector(`[data-recipient-id="${data.recipientId}"]`);
        if (recipientCard) {
            // Update recipient name
            const nameElement = recipientCard.querySelector('.recipient-name');
            if (nameElement && data.name) {
                nameElement.textContent = data.name;
            }
            
            // Update profile picture if changed
            if (data.profilePicture) {
                const imgElement = recipientCard.querySelector('.recipient-avatar');
                if (imgElement) {
                    imgElement.src = data.profilePicture;
                }
            }
        }
    }

    // Handle recipient deleted
    function handleRecipientDeleted(data) {
        console.log('[Realtime] Recipient deleted:', data);
        
        const recipientCard = document.querySelector(`[data-recipient-id="${data.recipientId}"]`);
        if (recipientCard) {
            recipientCard.remove();
        }
    }

    // Helper: Update present count for a recipient
    function updatePresentCount(recipientId) {
        const recipientCard = document.querySelector(`[data-recipient-id="${recipientId}"]`);
        if (recipientCard) {
            const presentsList = recipientCard.querySelector('.presents-list');
            const count = presentsList ? presentsList.children.length : 0;
            
            const countBadge = recipientCard.querySelector('.present-count');
            if (countBadge) {
                countBadge.textContent = count;
            }
        }
    }

    // Expose public API
    window.realtimeUpdates = {
        start: startPolling,
        stop: stopPolling,
        check: checkForUpdates,
        setTimestamp: function(timestamp) {
            lastUpdateTimestamp = timestamp;
            localStorage.setItem(STORAGE_KEY, timestamp);
        }
    };

    // Auto-start when DOM is ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
