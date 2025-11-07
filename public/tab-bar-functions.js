// Tab Bar Functions - Shared across all pages

// Toggle hamburger menu
function toggleTabBarMenu() {
    const overlay = document.getElementById('tabBarOverlay');
    const panel = document.getElementById('tabBarMenuPanel');
    const notifPanel = document.getElementById('notificationsPanel');
    
    if (notifPanel) {
        notifPanel.classList.remove('show');
    }
    
    overlay.classList.toggle('show');
    panel.classList.toggle('show');
}

// Toggle notifications panel
function toggleNotificationsPanel() {
    const overlay = document.getElementById('tabBarOverlay');
    const panel = document.getElementById('notificationsPanel');
    const menuPanel = document.getElementById('tabBarMenuPanel');
    const badge = document.getElementById('activityBadge');
    
    if (menuPanel) {
        menuPanel.classList.remove('show');
    }
    
    const isOpen = panel.classList.toggle('show');
    overlay.classList.toggle('show', isOpen);
    
    if (isOpen) {
        // Load notifications when opening panel
        console.log('[Notifications] Opening panel - loading notifications');
        loadRecentNotifications();
        
        // Check for data updates when opening notifications
        if (window.realtimeUpdates && typeof window.realtimeUpdates.check === 'function') {
            setTimeout(() => {
                window.realtimeUpdates.check();
            }, 500);
        }
    } else {
        // Mark all notifications as read when closing panel
        console.log('[Notifications] Closing panel - marking all as read');
        fetch('/api/notifications/read-all', { method: 'POST' })
            .then(response => response.json())
            .then(data => {
                console.log('[Notifications] Marked all as read, response:', data);
                // Clear the badge after marking as read
                if (badge) {
                    badge.style.display = 'none';
                }
                updateNotificationBadge();
            })
            .catch(error => {
                console.error('[Notifications] Error marking as read:', error);
                // Still clear badge even if marking as read fails
                if (badge) {
                    badge.style.display = 'none';
                }
                updateNotificationBadge();
            });
    }
}

// Close all panels
function closeAllPanels() {
    const overlay = document.getElementById('tabBarOverlay');
    const menuPanel = document.getElementById('tabBarMenuPanel');
    const notifPanel = document.getElementById('notificationsPanel');
    
    if (overlay) overlay.classList.remove('show');
    if (menuPanel) menuPanel.classList.remove('show');
    if (notifPanel) notifPanel.classList.remove('show');
}

// Load recent notifications
function loadRecentNotifications() {
    const content = document.getElementById('notificationsContent');
    if (!content) return;
    
    console.log('[Notifications] Loading recent notifications');
    
    fetch('/api/notifications?limit=10&offset=0')
        .then(response => response.json())
        .then(data => {
            console.log('[Notifications] Loaded', data.notifications?.length || 0, 'notifications');
            if (data.notifications && data.notifications.length > 0) {
                displayNotifications(data.notifications);
            } else {
                content.innerHTML = `
                    <div class="tab-bar-notifications-empty" style="text-align: center; padding: 60px 20px; color: #718096;">
                        <i class="ri-notification-off-line" style="font-size: 48px; margin-bottom: 16px; opacity: 0.5;"></i>
                        <p>Brak powiadomień</p>
                    </div>
                `;
            }
        })
        .catch(error => {
            console.error('Error loading notifications:', error);
            content.innerHTML = `
                <div class="tab-bar-notifications-empty" style="text-align: center; padding: 60px 20px; color: #718096;">
                    <i class="ri-error-warning-line" style="font-size: 48px; margin-bottom: 16px; opacity: 0.5;"></i>
                    <p>Błąd podczas ładowania powiadomień</p>
                </div>
            `;
        });
}

// Display notifications
function displayNotifications(notifications) {
    const content = document.getElementById('notificationsContent');
    const notificationConfig = {
        recipient_added: { icon: 'ri-user-add-line', color: '#4CAF50' },
        present_added: { icon: 'ri-gift-line', color: '#2196F3' },
        present_reserved: { icon: 'ri-bookmark-line', color: '#FF9800' },
        present_unreserved: { icon: 'ri-bookmark-line', color: '#9E9E9E' },
        present_checked: { icon: 'ri-checkbox-circle-line', color: '#4CAF50' },
        present_unchecked: { icon: 'ri-checkbox-blank-circle-line', color: '#9E9E9E' }
    };

    const html = notifications.map(notif => {
        const config = notificationConfig[notif.type] || { icon: 'ri-notification-line', color: '#666' };
        const isUnread = !notif.is_read;
        const timeAgo = getTimeAgo(notif.created_at);
        
        return `
            <div class="tab-bar-notification-item ${isUnread ? 'unread' : ''}" onclick="markNotificationAsRead(${notif.id})" style="display: flex; align-items: flex-start; gap: 12px; padding: 15px 20px; border-bottom: 1px solid rgba(0, 0, 0, 0.05); cursor: pointer; background: ${isUnread ? 'rgba(33, 150, 243, 0.05)' : '#ffffff'};">
                <div class="tab-bar-notification-icon" style="width: 40px; height: 40px; border-radius: 50%; display: flex; align-items: center; justify-content: center; background-color: ${config.color}20; color: ${config.color};">
                    <i class="${config.icon}" style="font-size: 20px;"></i>
                </div>
                <div class="tab-bar-notification-content" style="flex: 1; min-width: 0;">
                    <div class="tab-bar-notification-message" style="font-size: 14px; color: #2d3748; margin-bottom: 4px; line-height: 1.4;">
                        ${getNotificationMessage(notif)}
                    </div>
                    <div class="tab-bar-notification-time" style="font-size: 12px; color: #718096;">
                        <i class="ri-time-line"></i> ${timeAgo}
                    </div>
                </div>
                ${isUnread ? '<div class="tab-bar-notification-unread-dot" style="width: 8px; height: 8px; border-radius: 50%; background: #2196F3; flex-shrink: 0; margin-top: 6px;"></div>' : ''}
            </div>
        `;
    }).join('');
    
    content.innerHTML = html;
}

// Get notification message
function getNotificationMessage(notif) {
    let data = notif.data;
    if (typeof data === 'string') {
        try {
            data = JSON.parse(data);
        } catch (e) {
            data = {};
        }
    }
    
    const actor = notif.actor_username || 'Ktoś';
    const presentTitle = data.presentTitle || 'prezent';
    const presentId = data.presentId;
    const presentLink = presentId ? `<a href="#" onclick="scrollToPresentFromNotification(${presentId}); return false;" style="color: #2196F3; text-decoration: underline; cursor: pointer;"><strong>${presentTitle}</strong></a>` : `<strong>${presentTitle}</strong>`;
    
    switch(notif.type) {
        case 'recipient_added':
            return `<strong>${actor}</strong> dodał(a) osobę <strong>${data.recipientName || 'nową osobę'}</strong>`;
        case 'present_added':
            return `<strong>${actor}</strong> dodał(a) prezent "${presentLink}"${data.recipientName ? ' dla ' + data.recipientName : ''}`;
        case 'present_reserved':
            return `<strong>${actor}</strong> zarezerwował(a) "${presentLink}"`;
        case 'present_unreserved':
            return `<strong>${actor}</strong> anulował(a) rezerwację "${presentLink}"`;
        case 'present_checked':
            return `<strong>${actor}</strong> oznaczył(a) jako kupione "${presentLink}"`;
        case 'present_unchecked':
            return `<strong>${actor}</strong> odznaczył(a) "${presentLink}"`;
        default:
            return `<strong>${actor}</strong> wykonał(a) akcję`;
    }
}

// Scroll to present from notification
function scrollToPresentFromNotification(presentId) {
    // Close the notifications panel
    const panel = document.getElementById('notificationsPanel');
    if (panel && panel.classList.contains('show')) {
        toggleNotificationsPanel();
    }
    
    // Find the present element by data-id attribute
    const presentElement = document.querySelector(`.present-item[data-id="${presentId}"]`);
    if (presentElement) {
        // Scroll to the element
        presentElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
        
        // Highlight the element briefly
        presentElement.style.transition = 'background-color 0.3s ease';
        const originalBg = presentElement.style.backgroundColor;
        presentElement.style.backgroundColor = 'rgba(33, 150, 243, 0.2)';
        setTimeout(() => {
            presentElement.style.backgroundColor = originalBg;
        }, 2000);
        
        console.log('[Notification] Scrolled to present:', presentId);
    } else {
        console.warn('[Notification] Present element not found:', presentId);
    }
}

// Get time ago string
function getTimeAgo(timestamp) {
    const now = new Date();
    const then = new Date(timestamp);
    const seconds = Math.floor((now - then) / 1000);
    
    if (seconds < 60) return 'przed chwilą';
    if (seconds < 3600) return `${Math.floor(seconds / 60)} min temu`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)} godz. temu`;
    if (seconds < 604800) return `${Math.floor(seconds / 86400)} dni temu`;
    
    return then.toLocaleDateString('pl-PL');
}

// Mark notification as read
function markNotificationAsRead(notificationId) {
    fetch(`/api/notifications/${notificationId}/read`, { method: 'POST' })
        .then(() => {
            updateNotificationBadge();
            loadRecentNotifications();
            
            // Trigger realtime update check
            if (window.realtimeUpdates && typeof window.realtimeUpdates.check === 'function') {
                window.realtimeUpdates.check();
            }
            
            // Dispatch event for other listeners
            document.dispatchEvent(new CustomEvent('notificationClicked'));
        })
        .catch(error => console.error('Error marking notification as read:', error));
}

// Update notification badge
function updateNotificationBadge() {
    fetch('/api/notifications/unread-count')
        .then(response => response.json())
        .then(data => {
            const badge = document.getElementById('activityBadge');
            if (badge) {
                if (data.count > 0) {
                    badge.textContent = data.count > 99 ? '99+' : data.count;
                    badge.style.display = 'flex';
                    console.log('[Badge] Updated with count:', data.count);
                } else {
                    badge.style.display = 'none';
                    console.log('[Badge] Hidden - no unread notifications');
                }
            }
        })
        .catch(error => {
            console.error('Error fetching notification count:', error);
            // Hide badge on error to be safe
            const badge = document.getElementById('activityBadge');
            if (badge) {
                badge.style.display = 'none';
            }
        });
}

// Update badge on page load and periodically
document.addEventListener('DOMContentLoaded', function() {
    if (document.getElementById('activityBadge')) {
        updateNotificationBadge();
        setInterval(updateNotificationBadge, 30000);
    }
});
