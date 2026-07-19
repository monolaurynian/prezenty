// Desktop left navigation sidebar
// On screens >= 992px the bottom dock is replaced with a full navigation
// menu on the left (the Apple/macOS pattern). Self-contained: builds its
// own DOM, works on every page, visibility is controlled by CSS.
(function () {
    'use strict';

    // Remix Icon is not loaded on every page - inject it if missing
    if (!document.querySelector('link[href*="remixicon"]')) {
        const link = document.createElement('link');
        link.rel = 'stylesheet';
        link.href = 'https://cdn.jsdelivr.net/npm/remixicon@3.5.0/fonts/remixicon.css';
        document.head.appendChild(link);
    }

    const path = (window.location.pathname.replace(/\/$/, '') || '/').toLowerCase();

    const items = [
        { href: '/', icon: 'ri-home-line', activeIcon: 'ri-home-fill', label: 'Strona Główna', match: ['/', '/home.html', '/home'] },
        { href: '/activity.html', icon: 'ri-notification-3-line', activeIcon: 'ri-notification-3-fill', label: 'Aktywność', match: ['/activity', '/activity.html'], badge: true },
        { href: '/recipients.html', icon: 'ri-gift-2-line', activeIcon: 'ri-gift-2-fill', label: 'Wszystkie prezenty', match: ['/recipients', '/recipients.html'] },
        { href: '/leaderboard.html', icon: 'ri-trophy-line', activeIcon: 'ri-trophy-fill', label: 'Ranking', match: ['/leaderboard.html', '/leaderboard'] },
        { href: '/formularz.html', icon: 'ri-gift-line', activeIcon: 'ri-gift-fill', label: 'Dodaj Prezent', match: ['/formularz', '/formularz.html'] },
        { href: '/rezerwacje.html', icon: 'ri-bookmark-line', activeIcon: 'ri-bookmark-fill', label: 'Zarezerwowane', match: ['/rezerwacje', '/rezerwacje.html'] },
        { divider: true },
        { href: '/formularz.html', icon: 'ri-edit-line', label: 'Edytuj Moje Prezenty', editTab: true },
        { href: '/archiwum.html', icon: 'ri-archive-line', label: 'Archiwum', match: ['/archiwum', '/archiwum.html'] },
        { href: '/ustawienia.html', icon: 'ri-settings-3-line', label: 'Ustawienia', match: ['/ustawienia', '/ustawienia.html'] },
        { href: '#', icon: 'ri-logout-box-r-line', label: 'Wyloguj', logout: true }
    ];

    function build() {
        const nav = document.createElement('nav');
        nav.className = 'desktop-nav';
        nav.setAttribute('aria-label', 'Nawigacja');

        let html = '<div class="dnav-title"><i class="ri-gift-2-fill me-2" style="color:#E53935;"></i>Prezenty</div>';
        // Profile block - filled in by loadProfileBlock() after auth check
        html += `<a href="/ustawienia" class="dnav-profile" id="dnavProfile" style="display:none;">
                    <span class="dnav-avatar" id="dnavAvatar"><i class="ri-user-3-line"></i></span>
                    <span class="dnav-profile-name" id="dnavProfileName"></span>
                 </a>`;
        for (const item of items) {
            if (item.divider) {
                html += '<div class="dnav-divider"></div>';
                continue;
            }
            const isActive = (item.match || []).includes(path) && !item.editTab;
            const icon = isActive && item.activeIcon ? item.activeIcon : item.icon;
            html += `<a href="${item.href}" class="dnav-item${isActive ? ' active' : ''}"
                        ${item.editTab ? 'data-edit-tab="1"' : ''} ${item.logout ? 'data-logout="1"' : ''}>
                        <i class="${icon}"></i>
                        <span>${item.label}</span>
                        ${item.badge ? '<span class="dnav-badge" id="desktopNavBadge"></span>' : ''}
                    </a>`;
        }
        nav.innerHTML = html;
        document.body.appendChild(nav);
        document.body.classList.add('has-desktop-nav');

        nav.addEventListener('click', (e) => {
            const el = e.target.closest('a.dnav-item');
            if (!el) return;
            if (el.dataset.editTab) {
                try { localStorage.setItem('openEditTab', 'true'); } catch (err) { /* ignore */ }
            }
            if (el.dataset.logout) {
                e.preventDefault();
                fetch('/api/logout', { method: 'POST' })
                    .finally(() => { window.location.href = '/'; });
            }
        });
    }

    function loadProfileBlock() {
        if (!window.matchMedia('(min-width: 992px)').matches) return;
        fetch('/api/user/identification')
            .then(r => (r.ok ? r.json() : null))
            .then(d => {
                if (!d) return;
                const block = document.getElementById('dnavProfile');
                const avatar = document.getElementById('dnavAvatar');
                const name = document.getElementById('dnavProfileName');
                if (!block || !avatar || !name) return;

                name.textContent = d.name || d.username || '';
                if (d.identifiedRecipient && d.identifiedRecipient.id) {
                    avatar.innerHTML = `<img src="/api/recipients/${d.identifiedRecipient.id}/profile-picture" alt=""
                        style="width:100%; height:100%; object-fit:cover;"
                        onerror="this.parentElement.innerHTML='<i class=&quot;ri-user-3-line&quot;></i>';">`;
                }
                block.style.display = 'flex';
            })
            .catch(() => { /* not logged in - keep hidden */ });
    }

    function refreshBadge() {
        // Only bother when the sidebar is actually visible
        if (!window.matchMedia('(min-width: 992px)').matches) return;
        fetch('/api/notifications/unread-count')
            .then(r => (r.ok ? r.json() : null))
            .then(d => {
                if (!d) return;
                const b = document.getElementById('desktopNavBadge');
                if (b) {
                    b.textContent = d.count > 99 ? '99+' : d.count;
                    b.style.display = d.count > 0 ? 'inline-flex' : 'none';
                }
            })
            .catch(() => { /* not logged in or offline - no badge */ });
    }

    function init() {
        build();
        loadProfileBlock();
        refreshBadge();
        setInterval(refreshBadge, 30000);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
