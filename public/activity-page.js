
        console.log('[Activity] Script loaded!');
        let currentPage = 1;
        const itemsPerPage = 20;
        let totalNotifications = 0;

        // Escape then turn plain URLs into real hyperlinks (inline, shortened)
        function escapeHtmlText(text) {
            const div = document.createElement('div');
            div.textContent = text == null ? '' : String(text);
            return div.innerHTML;
        }

        function linkifyEscaped(escapedText) {
            return escapedText.replace(/(https?:\/\/[^\s<>"{}|\\^`\[\]]+)/g, (url) => {
                const clean = url.replace(/[.,;:!?)]+$/, '');
                const display = clean.length > 40 ? clean.substring(0, 37) + '...' : clean;
                return `<a href="${clean}" target="_blank" rel="noopener noreferrer" onclick="event.stopPropagation();" style="color: #64B5F6; text-decoration: underline; word-break: break-all;">${display}</a>`;
            });
        }

        // Present title for a notification message. If the title contains a URL
        // we render it as a real hyperlink; otherwise it links to the present.
        function presentLinkHtml(data, color) {
            const safeTitle = escapeHtmlText(data.presentTitle || 'prezent');
            const linkified = linkifyEscaped(safeTitle);
            if (linkified !== safeTitle) {
                return `<strong>„${linkified}”</strong>`;
            }
            // Opens the recipients page filtered to the present's recipient
            // with the present highlighted (see tab-bar-functions.js)
            // encodeURIComponent leaves ' untouched and this lands in a
            // single-quoted JS string inside onclick, so encode it as well
            // (see the same fix in tab-bar-functions.js).
            const recipientEnc = encodeURIComponent(data.recipientName || '').replace(/'/g, '%27');
            return data.presentId ?
                `<a href="#" onclick="scrollToPresentFromNotification(${data.presentId}, '${recipientEnc}'); return false;" style="color: ${color}; text-decoration: underline;"><strong>„${safeTitle}”</strong></a>` :
                `<strong>„${safeTitle}”</strong>`;
        }

        // Shared wording (notification-text.js) with this page's links
        function activityMessage(type, data, actor, color) {
            return notificationText(type, data, actor, {
                person: (safe, raw) => personLinkHtml(raw),
                present: (quoted, d) => presentLinkHtml(d, color)
            });
        }

        // Notification type configuration
        const notificationConfig = {
            recipient_added: {
                icon: 'fa-user-plus',
                color: '#4CAF50',
                getMessage: (data, actor) => activityMessage('recipient_added', data, actor, '#4CAF50')
            },
            present_added: {
                icon: 'fa-gift',
                color: '#2196F3',
                getMessage: (data, actor) => activityMessage('present_added', data, actor, '#2196F3')
            },
            present_reserved: {
                icon: 'fa-bookmark',
                color: '#FF9800',
                getMessage: (data, actor) => activityMessage('present_reserved', data, actor, '#FF9800')
            },
            present_unreserved: {
                icon: 'fa-bookmark-slash',
                color: '#9E9E9E',
                getMessage: (data, actor) => activityMessage('present_unreserved', data, actor, '#9E9E9E')
            },
            present_checked: {
                icon: 'fa-check-circle',
                color: '#4CAF50',
                getMessage: (data, actor) => activityMessage('present_checked', data, actor, '#4CAF50')
            },
            present_unchecked: {
                icon: 'fa-circle',
                color: '#9E9E9E',
                getMessage: (data, actor) => activityMessage('present_unchecked', data, actor, '#9E9E9E')
            },
            leaderboard_leader: {
                icon: 'fa-trophy',
                color: '#FFC107',
                // leaderName / previousLeaderName are recipients.name, i.e.
                // user supplied, and this string goes straight to innerHTML.
                // Element context, so the page's own escapeHtmlText is enough.
                getMessage: (data) =>
                    `🏆 <strong>${escapeHtmlText(data.leaderName || 'Ktoś')}</strong>${data.previousLeaderName ? ` wyprzedza <strong>${escapeHtmlText(data.previousLeaderName)}</strong> i` : ''} prowadzi w <a href="/leaderboard.html" onclick="event.stopPropagation();" style="color: #FFC107; text-decoration: underline;">rankingu</a> z <strong>${data.presentCount || '?'}</strong> ${data.presentCount === 1 ? 'prezentem' : 'prezentami'}!`
            },
            anon_message: {
                icon: 'fa-comment-dots',
                color: '#7B1FA2',
                getMessage: (data) =>
                    `💬 <a href="${data.threadId ? '/wiadomosci?rozmowa=' + data.threadId : '/wiadomosci'}" style="color: #7B1FA2; text-decoration: underline;"><strong>${escapeHtmlText(data.label || 'Nowa wiadomość')}</strong></a>${data.preview ? ': "' + escapeHtmlText(data.preview.length > 60 ? data.preview.slice(0, 57) + '...' : data.preview) + '"' : ''}`
            }
        };

        // Person name -> link to their prefiltered presents page
        function personLinkHtml(name) {
            const safe = escapeHtmlText(name);
            return `<a href="/recipients.html?osoba=${encodeURIComponent(name)}" onclick="event.stopPropagation();" style="color: #2196F3; text-decoration: underline;"><strong>${safe}</strong></a>`;
        }

        // Load notifications
        function loadNotifications(page = 1) {
            console.log('[Activity] Loading notifications, page:', page);
            currentPage = page;
            const offset = (page - 1) * itemsPerPage;
            
            const activityFeed = document.getElementById('activityFeed');
            if (!activityFeed) {
                console.error('[Activity] activityFeed element not found!');
                return;
            }
            
            activityFeed.innerHTML = '<div class="text-center py-5" id="loadingState"><div class="spinner-border text-primary" role="status"><span class="visually-hidden">Ładowanie...</span></div><p class="mt-3 text-muted">Ładowanie aktywności...</p></div>';
            
            console.log('[Activity] Fetching notifications from API...');
            fetch(`/api/notifications?limit=${itemsPerPage}&offset=${offset}`)
                .then(response => {
                    console.log('[Activity] API response status:', response.status);
                    return response.json();
                })
                .then(data => {
                    console.log('[Activity] Received notifications:', data.notifications ? data.notifications.length : 0);
                    console.log('[Activity] About to call displayNotifications...');
                    try {
                        console.log('[Activity] Calling displayActivityNotifications now...');
                        displayActivityNotifications(data.notifications);
                        console.log('[Activity] displayActivityNotifications returned');
                        totalNotifications = offset + data.notifications.length + (data.hasMore ? 1 : 0);
                        updatePagination(data.hasMore);
                    } catch (error) {
                        console.error('[Activity] Error in displayNotifications:', error);
                        document.getElementById('activityFeed').innerHTML = `
                            <div class="text-center py-5 text-danger">
                                <i class="fas fa-exclamation-triangle fa-3x mb-3"></i>
                                <p>Błąd podczas wyświetlania powiadomień</p>
                                <p class="small">${error.message}</p>
                            </div>
                        `;
                    }
                })
                .catch(error => {
                    console.error('[Activity] Error loading notifications:', error);
                    document.getElementById('activityFeed').innerHTML = `
                        <div class="text-center py-5 text-danger">
                            <i class="fas fa-exclamation-triangle fa-3x mb-3"></i>
                            <p>Błąd podczas ładowania aktywności</p>
                            <p class="small">${error.message}</p>
                        </div>
                    `;
                });
        }

        // --- Grouping helpers ---
        function parseNotifData(n) {
            if (typeof n.data === 'string') {
                try { return JSON.parse(n.data); } catch (e) { return {}; }
            }
            return n.data || {};
        }

        function getDayKey(ts) {
            const d = new Date(ts);
            return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
        }

        function getDayLabel(ts) {
            const d = new Date(ts);
            const today = new Date();
            const yesterday = new Date();
            yesterday.setDate(today.getDate() - 1);
            if (getDayKey(d) === getDayKey(today)) return 'Dzisiaj';
            if (getDayKey(d) === getDayKey(yesterday)) return 'Wczoraj';
            return d.toLocaleDateString('pl-PL', { day: 'numeric', month: 'long', year: 'numeric' });
        }

        // Turns a flat notification list into: day headers, collapsed bursts
        // (3+ presents added in a row by the same person for the same recipient)
        // and regular single entries
        function groupNotificationsForDisplay(notifications) {
            const result = [];
            let lastDayKey = null;
            let i = 0;

            while (i < notifications.length) {
                const n = notifications[i];
                const dayKey = getDayKey(n.created_at);
                if (dayKey !== lastDayKey) {
                    result.push({ dayHeader: getDayLabel(n.created_at) });
                    lastDayKey = dayKey;
                }

                if (n.type === 'present_added') {
                    const nData = parseNotifData(n);
                    const burstItems = [n];
                    let j = i + 1;
                    while (j < notifications.length) {
                        const m = notifications[j];
                        if (m.type === 'present_added' &&
                            (m.actor_username || '') === (n.actor_username || '') &&
                            getDayKey(m.created_at) === dayKey &&
                            parseNotifData(m).recipientId === nData.recipientId) {
                            burstItems.push(m);
                            j++;
                        } else {
                            break;
                        }
                    }
                    if (burstItems.length >= 3) {
                        result.push({
                            burst: {
                                actor: n.actor_username || 'Ktoś',
                                recipientName: nData.recipientName || null,
                                items: burstItems
                            }
                        });
                        i = j;
                        continue;
                    }
                }

                result.push({ notification: n });
                i++;
            }
            return result;
        }

        // Display notifications on activity page
        function displayActivityNotifications(notifications) {
            console.log('[Activity] Displaying activity notifications...');
            const feed = document.getElementById('activityFeed');
            
            if (!feed) {
                console.error('[Activity] activityFeed element not found!');
                return;
            }
            
            if (notifications.length === 0) {
                feed.innerHTML = `
                    <div class="text-center py-5 text-muted">
                        <i class="fas fa-bell-slash fa-3x mb-3"></i>
                        <p>Brak powiadomień</p>
                    </div>
                `;
                return;
            }
            
            // Group notifications by day, and collapse bursts (several presents
            // added by the same person for the same recipient in a row)
            const grouped = groupNotificationsForDisplay(notifications);

            const html = grouped.map(entry => {
                if (entry.dayHeader) {
                    return `
                        <div class="activity-day-header" style="padding: 14px 16px 6px; font-weight: 700; font-size: 13px;
                             text-transform: uppercase; letter-spacing: 0.5px; color: #8e8e93;">
                            ${entry.dayHeader}
                        </div>`;
                }
                if (entry.burst) {
                    // Collapsed burst entry - the count links to the
                    // recipient's presents when we know who they're for
                    const b = entry.burst;
                    const isUnread = b.items.some(n => !n.is_read);
                    const burstMessage = notificationText('present_added_batch',
                        { count: b.items.length, recipientName: b.recipientName }, b.actor, {
                            person: (safe, raw) => personLinkHtml(raw),
                            count: (countText) => b.recipientName
                                ? `<a href="/recipients.html?osoba=${encodeURIComponent(b.recipientName)}" onclick="event.stopPropagation();" style="color: #2196F3; text-decoration: underline;"><strong>${countText}</strong></a>`
                                : `<strong>${countText}</strong>`
                        });
                    return `
                        <div class="notification-item ${isUnread ? 'unread' : ''}">
                            <div class="notification-icon" style="background-color: #2196F320; color: #2196F3;">
                                <i class="fas fa-gifts"></i>
                            </div>
                            <div class="notification-content">
                                <div class="notification-message">
                                    ${burstMessage}
                                </div>
                                <div class="notification-time">
                                    <i class="fas fa-clock me-1"></i>${getTimeAgo(b.items[0].created_at)}
                                </div>
                            </div>
                            ${isUnread ? '<div class="notification-unread-dot"></div>' : ''}
                        </div>`;
                }

                const notification = entry.notification;
                let config = notificationConfig[notification.type];
                if (!config) {
                    console.warn('[Activity] Unknown notification type:', notification.type);
                    // Fallback config for unknown types
                    config = {
                        icon: 'fa-bell',
                        color: '#666',
                        getMessage: (data, actor) => notificationText(notification.type, data, actor)
                    };
                }
                
                // Parse data if it's a string
                let data = notification.data;
                if (typeof data === 'string') {
                    try {
                        data = JSON.parse(data);
                    } catch (e) {
                        console.error('[Activity] Error parsing notification data:', e);
                        data = {};
                    }
                }
                
                const isUnread = !notification.is_read;
                const timeAgo = getTimeAgo(notification.created_at);
                
                return `
                    <div class="notification-item ${isUnread ? 'unread' : ''}" 
                         data-id="${notification.id}"
                         onclick="markNotificationAsRead(${notification.id})">
                        <div class="notification-icon" style="background-color: ${config.color}20; color: ${config.color};">
                            <i class="fas ${config.icon}"></i>
                        </div>
                        <div class="notification-content">
                            <div class="notification-message">
                                ${config.getMessage(data, notification.actor_username || 'Ktoś')}
                            </div>
                            <div class="notification-time">
                                <i class="fas fa-clock me-1"></i>${timeAgo}
                            </div>
                        </div>
                        ${isUnread ? '<div class="notification-unread-dot"></div>' : ''}
                    </div>
                `;
            }).join('');
            
            console.log('[Activity] Setting HTML with', notifications.length, 'notifications');
            console.log('[Activity] HTML length:', html.length);
            if (html.length === 0) {
                console.error('[Activity] Generated HTML is empty!');
            }
            feed.innerHTML = html;
            console.log('[Activity] HTML set successfully');
        }

        // Update pagination
        function updatePagination(hasMore) {
            const paginationContainer = document.getElementById('paginationContainer');
            const pagination = document.getElementById('pagination');
            
            if (currentPage === 1 && !hasMore) {
                paginationContainer.style.display = 'none';
                return;
            }
            
            paginationContainer.style.display = 'block';
            
            let html = '';
            
            // Previous button
            if (currentPage > 1) {
                html += `
                    <li class="page-item">
                        <a class="page-link" href="#" onclick="loadNotifications(${currentPage - 1}); return false;">
                            <i class="fas fa-chevron-left"></i> Poprzednia
                        </a>
                    </li>
                `;
            }
            
            // Page number
            html += `
                <li class="page-item active">
                    <span class="page-link">Strona ${currentPage}</span>
                </li>
            `;
            
            // Next button
            if (hasMore) {
                html += `
                    <li class="page-item">
                        <a class="page-link" href="#" onclick="loadNotifications(${currentPage + 1}); return false;">
                            Następna <i class="fas fa-chevron-right"></i>
                        </a>
                    </li>
                `;
            }
            
            pagination.innerHTML = html;
        }

        // Mark notification as read
        function markNotificationAsRead(notificationId) {
            fetch(`/api/notifications/${notificationId}/read`, {
                method: 'POST'
            })
            .then(response => response.json())
            .then(data => {
                // Update UI
                const notificationElement = document.querySelector(`[data-id="${notificationId}"]`);
                if (notificationElement) {
                    notificationElement.classList.remove('unread');
                    const dot = notificationElement.querySelector('.notification-unread-dot');
                    if (dot) dot.remove();
                }
            })
            .catch(error => {
                console.error('Error marking notification as read:', error);
            });
        }

        // Mark all as read
        function markAllAsRead() {
            const btn = document.getElementById('markAllReadBtn');
            btn.disabled = true;
            btn.innerHTML = '<i class="fas fa-spinner fa-spin me-1"></i>Oznaczanie...';
            
            fetch('/api/notifications/read-all', {
                method: 'POST'
            })
            .then(response => response.json())
            .then(data => {
                // Reload notifications
                loadNotifications(currentPage);
                btn.disabled = false;
                btn.innerHTML = '<i class="fas fa-check-double me-1"></i>Oznacz wszystkie jako przeczytane';
            })
            .catch(error => {
                console.error('Error marking all as read:', error);
                btn.disabled = false;
                btn.innerHTML = '<i class="fas fa-check-double me-1"></i>Oznacz wszystkie jako przeczytane';
            });
        }

        // Get time ago string
        function getTimeAgo(timestamp) {
            const now = new Date();
            const then = new Date(timestamp);
            const seconds = Math.floor((now - then) / 1000);
            
            if (seconds < 60) return 'przed chwilą';
            if (seconds < 3600) return `${Math.floor(seconds / 60)} min temu`;
            if (seconds < 86400) return `${Math.floor(seconds / 3600)} godz. temu`;
            if (seconds < 604800) return `${plCount(Math.floor(seconds / 86400), 'dzień', 'dni', 'dni')} temu`;
            
            return then.toLocaleDateString('pl-PL');
        }

        // Logout function
        function logout() {
            fetch('/api/logout', { method: 'POST' })
                .then(() => window.location.href = '/')
                .catch(error => {
                    console.error('Logout error:', error);
                    window.location.href = '/';
                });
        }

        // Wait for DOM to be ready
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', initActivity);
        } else {
            initActivity();
        }
        
        function initActivity() {
            console.log('[Activity] Initializing activity page...');
            checkAuth();
        }
        
        // Check authentication
        function checkAuth() {
            console.log('[Activity] Checking authentication...');
            fetch('/api/auth')
            .then(response => {
                console.log('[Activity] Auth response status:', response.status);
                return response.json();
            })
            .then(data => {
                console.log('[Activity] Auth data:', data);
                if (!data.authenticated) {
                    console.log('[Activity] Not authenticated, redirecting...');
                    window.location.href = '/';
                } else {
                    console.log('[Activity] Authenticated, loading notifications...');
                    // Load notifications
                    loadNotifications(1);
                }
            })
            .catch(error => {
                console.error('[Activity] Auth check error:', error);
                window.location.href = '/';
            });
        }
    