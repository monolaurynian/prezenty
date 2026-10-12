
        // Notification configuration
        const notificationConfig = {
            recipient_added: {
                icon: 'fa-user-plus',
                color: '#4CAF50',
                getMessage: (data, actor) => notificationText('recipient_added', data, actor, { html: false })
            },
            present_added: {
                icon: 'fa-gift',
                color: '#2196F3',
                getMessage: (data, actor) => notificationText('present_added', data, actor, { html: false })
            },
            present_reserved: {
                icon: 'fa-bookmark',
                color: '#FF9800',
                getMessage: (data, actor) => notificationText('present_reserved', data, actor, { html: false })
            },
            present_unreserved: {
                icon: 'fa-bookmark-slash',
                color: '#9E9E9E',
                getMessage: (data, actor) => notificationText('present_unreserved', data, actor, { html: false })
            },
            present_checked: {
                icon: 'fa-check-circle',
                color: '#4CAF50',
                getMessage: (data, actor) => notificationText('present_checked', data, actor, { html: false })
            },
            present_unchecked: {
                icon: 'fa-circle',
                color: '#9E9E9E',
                getMessage: (data, actor) => notificationText('present_unchecked', data, actor, { html: false })
            },
            leaderboard_leader: {
                icon: 'fa-trophy',
                color: '#FFC107',
                getMessage: (data, actor) => `🏆 ${data.leaderName || 'Ktoś'}${data.previousLeaderName ? ` wyprzedza ${data.previousLeaderName} i` : ''} prowadzi w rankingu z ${data.presentCount || '?'} ${data.presentCount === 1 ? 'prezentem' : 'prezentami'}!`
            },
            anon_message: {
                icon: 'fa-comment-dots',
                color: '#7B1FA2',
                getMessage: (data, actor) => `💬 ${data.label || 'Nowa wiadomość'}`
            }
        };

        // Load unread count
        function loadUnreadCount() {
            fetch('/api/notifications/unread-count')
                .then(response => response.json())
                .then(data => {
                    updateBadge(data.count);
                })
                .catch(error => {
                    console.error('Error loading unread count:', error);
                });
        }

        // Update badge
        function updateBadge(count) {
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

        // Duplicate removed - using the one defined earlier

        // Duplicate functions removed - using the ones defined earlier

        // Load unread count on page load
        loadUnreadCount();

        // Poll for updates every 30 seconds
        setInterval(loadUnreadCount, 30000);
    