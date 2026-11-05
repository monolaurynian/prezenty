// "Nowości": every announcement, newest first, as cards (the same content the
// "what's new" banner shows once). The list comes from /api/releases and is
// drawn with createElement / textContent only: notes are plain text, never HTML.
// Pictures use the banner's own code (update-checker.js), so the same safety
// rules apply: our own files, or an exact KLIPY file with our picture as the fallback.
(function () {
    'use strict';

    const MONTHS = ['styczeń', 'luty', 'marzec', 'kwiecień', 'maj', 'czerwiec', 'lipiec',
        'sierpień', 'wrzesień', 'październik', 'listopad', 'grudzień'];

    // "2026-11-gify" -> "listopad 2026" (ids start with the year and month)
    function whenOf(id) {
        const match = /^(\d{4})-(\d{2})/.exec(String(id || ''));
        const month = match ? MONTHS[Number(match[2]) - 1] : null;
        return month ? month + ' ' + match[1] : '';
    }

    function node(tag, className, text) {
        const element = document.createElement(tag);
        if (className) element.className = className;
        if (text !== undefined) element.textContent = text;
        return element;
    }

    function buildCard(release, index) {
        const checker = window.updateChecker || {};
        const card = node('article', 'release-card glass-card');
        card.setAttribute('data-release', String(release.id || ''));
        const titleId = 'releaseTitle' + index;
        card.setAttribute('aria-labelledby', titleId);

        const head = node('div', 'release-card-head');
        const when = whenOf(release.id);
        if (when) head.appendChild(node('span', 'release-date', when));
        if (index === 0) head.appendChild(node('span', 'release-badge', 'Najnowsze'));
        if (head.children.length) card.appendChild(head);

        const image = checker.safeImage ? checker.safeImage(release.image) : null;
        if (image && checker.buildPicture) card.appendChild(checker.buildPicture(image));

        const title = node('h2', 'release-title', release.title || 'Nowość');
        title.id = titleId;
        card.appendChild(title);
        if (release.intro) card.appendChild(node('p', 'release-intro', release.intro));

        const items = Array.isArray(release.items) ? release.items : [];
        if (items.length) {
            const list = node('ul', 'release-items');
            items.forEach(function (item) {
                const row = node('li');
                row.appendChild(node('span', 'release-icon', item.icon || '•'));
                row.appendChild(node('span', '', item.text || ''));
                list.appendChild(row);
            });
            card.appendChild(list);
        }

        // Only same-site paths: never a link to another origin
        const target = release.action && checker.safeInternalUrl ? checker.safeInternalUrl(release.action.url) : null;
        if (target) {
            const link = node('a', 'release-action', release.action.label || 'Zobacz');
            link.href = target;
            card.appendChild(link);
        }
        return card;
    }

    function show(container, releases) {
        container.textContent = '';
        if (!releases.length) {
            container.appendChild(node('div', 'release-card glass-card release-error', 'Na razie nic tu nie ma.'));
            return;
        }
        releases.forEach(function (release, index) { container.appendChild(buildCard(release, index)); });
    }

    function init() {
        const container = document.getElementById('releaseList');
        if (!container) return;
        fetch('/api/releases', { credentials: 'same-origin', cache: 'no-store' })
            .then(function (response) {
                if (response.status === 401) { window.location.assign('/'); return null; }
                if (!response.ok) throw new Error('HTTP ' + response.status);
                return response.json();
            })
            .then(function (data) {
                if (data) show(container, Array.isArray(data.releases) ? data.releases : []);
            })
            .catch(function () {
                container.textContent = '';
                container.appendChild(node('div', 'release-card glass-card release-error', 'Nie udało się wczytać nowości. Spróbuj odświeżyć stronę.'));
            });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
