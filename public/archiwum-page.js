
        let selectedYear = null;

        document.addEventListener('DOMContentLoaded', () => {
            loadYears();
            populateYearSelect();
        });

        function escapeHtml(text) {
            const div = document.createElement('div');
            div.textContent = text == null ? '' : String(text);
            return div.innerHTML;
        }

        // Turn plain URLs in already-escaped text into clickable links
        function linkify(text) {
            return escapeHtml(text).replace(/(https?:\/\/[^\s<>"{}|\\^`\[\]]+)/g, (url) => {
                const clean = url.replace(/[.,;:!?)]+$/, '');
                const display = clean.length > 40 ? clean.substring(0, 37) + '...' : clean;
                return `<a href="${clean}" target="_blank" rel="noopener noreferrer" style="color: #1E88E5; text-decoration: underline; word-break: break-all;">${display}</a>`;
            });
        }

        // Sensible default label: after Christmas you archive LAST year's presents,
        // in Nov/Dec you might close the current year
        function defaultArchiveYear() {
            const now = new Date();
            return now.getMonth() >= 10 ? now.getFullYear() : now.getFullYear() - 1;
        }

        function populateYearSelect() {
            const select = document.getElementById('archiveYearSelect');
            const def = defaultArchiveYear();
            const current = new Date().getFullYear();
            for (let y = current; y >= current - 5; y--) {
                const opt = document.createElement('option');
                opt.value = y;
                opt.textContent = y;
                if (y === def) opt.selected = true;
                select.appendChild(opt);
            }
        }

        function loadYears() {
            fetch('/api/archive/years')
                .then(r => {
                    if (r.status === 401) { window.location.href = '/'; throw new Error('auth'); }
                    return r.json();
                })
                .then(data => {
                    const pills = document.getElementById('yearPills');
                    if (!data.years || data.years.length === 0) {
                        pills.innerHTML = '';
                        document.getElementById('archiveContent').innerHTML = `
                            <div class="text-center py-5">
                                <div style="font-size: 48px;">🗃️</div>
                                <h5 class="mt-2">Archiwum jest puste</h5>
                                <p style="opacity: 0.85;">Gdy zamkniesz rok, wszystkie prezenty trafią tutaj.</p>
                            </div>`;
                        return;
                    }
                    pills.innerHTML = data.years.map(y =>
                        `<button class="year-pill" data-year="${y.year}" onclick="selectYear(${y.year})">${y.year} <span style="opacity:0.7;">(${y.count})</span></button>`
                    ).join('');
                    selectYear(data.years[0].year);
                })
                .catch(err => {
                    if (err.message === 'auth') return;
                    showLoadError();
                });
        }

        function selectYear(year) {
            selectedYear = year;
            document.querySelectorAll('.year-pill').forEach(p =>
                p.classList.toggle('active', parseInt(p.dataset.year) === year));

            const content = document.getElementById('archiveContent');
            content.innerHTML = `<div class="text-center py-4"><div class="spinner-border text-light"></div></div>`;

            fetch(`/api/archive/presents?year=${year}`)
                .then(r => r.json())
                .then(data => renderPresents(data.presents || []))
                .catch(() => showLoadError());
        }

        function renderPresents(presents) {
            const content = document.getElementById('archiveContent');
            if (presents.length === 0) {
                content.innerHTML = '<p class="text-center py-4" style="opacity:0.85;">Brak prezentów w tym roku</p>';
                return;
            }

            // Group by recipient
            const groups = {};
            presents.forEach(p => {
                const key = p.recipient_name || 'Bez osoby';
                (groups[key] = groups[key] || []).push(p);
            });

            content.innerHTML = Object.keys(groups).sort((a, b) => a.localeCompare(b, 'pl')).map(name => `
                <div class="archive-recipient-header"><i class="fas fa-user"></i>${escapeHtml(name)}
                    <span style="font-weight:400; opacity:0.7; font-size:14px;">(${groups[name].length})</span>
                </div>
                ${groups[name].map(p => `
                    <div class="archive-present">
                        <div class="fw-semibold">
                            ${p.is_checked ? '<i class="fas fa-check-circle me-1" style="color:#2e7d32;"></i>' : ''}${linkify(p.title)}
                        </div>
                        ${p.comments ? `<div style="font-size:13px; opacity:0.8;">${linkify(p.comments)}</div>` : ''}
                        <div class="status">
                            ${statusLine(p)}
                        </div>
                    </div>
                `).join('')}
            `).join('');
        }

        // Status line for one present. For the logged-in user's own presents
        // the server sends spoiler=true and strips the name - we show a
        // blurred placeholder instead (the blurred text is fake, not the real name).
        function statusLine(p) {
            const hiddenName = '<span class="spoiler-name">Tajny Mikołaj</span> 🙈';
            if (p.is_checked) {
                if (p.spoiler) return `🛍️ Kupione przez: ${hiddenName}`;
                return `🛍️ Kupione${p.reserved_by_username ? ' przez: ' + escapeHtml(p.reserved_by_username) : ''}`;
            }
            if (p.spoiler) {
                // Don't reveal whether anyone reserved it either
                return `🔖 Status rezerwacji: ${hiddenName}`;
            }
            if (p.reserved_by_username) {
                return `🔖 Zarezerwowane przez: ${escapeHtml(p.reserved_by_username)} (niekupione)`;
            }
            return '⚪ Nikt nie zarezerwował';
        }

        function showLoadError() {
            document.getElementById('archiveContent').innerHTML = `
                <div class="text-center py-4">
                    <p>Nie udało się załadować archiwum.</p>
                    <button class="btn btn-outline-secondary btn-sm" onclick="loadYears()">
                        <i class="fas fa-rotate-right me-1"></i>Spróbuj ponownie
                    </button>
                </div>`;
        }

        function runArchive() {
            const year = parseInt(document.getElementById('archiveYearSelect').value);
            const confirmText = document.getElementById('archiveConfirmInput').value.trim();
            const msg = document.getElementById('archiveModalMessage');
            const btn = document.getElementById('archiveRunBtn');

            msg.style.display = 'none';

            if (confirmText !== 'ARCHIWIZUJ') {
                msg.className = 'alert alert-danger mt-3';
                msg.textContent = 'Wpisz ARCHIWIZUJ (dokładnie tak), aby potwierdzić.';
                msg.style.display = 'block';
                return;
            }

            btn.disabled = true;
            btn.innerHTML = '<span class="spinner-border spinner-border-sm me-2"></span>Archiwizuję...';

            fetch('/api/archive/run', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ year, confirmText })
            })
                .then(r => r.json().then(data => ({ ok: r.ok, data })))
                .then(({ ok, data }) => {
                    if (ok && data.success) {
                        msg.className = 'alert alert-success mt-3';
                        msg.textContent = `Gotowe! Zarchiwizowano ${plCount(Number(data.archivedPresents) || 0, 'prezent', 'prezenty', 'prezentów')} w archiwum za rok ${data.year}. Lista prezentów jest teraz pusta.`;
                        msg.style.display = 'block';
                        // Clear cached data so all pages show the clean slate
                        try {
                            localStorage.removeItem('recipientsCache');
                        } catch (e) { /* ignore */ }
                        document.getElementById('archiveConfirmInput').value = '';
                        setTimeout(() => {
                            const modalEl = document.getElementById('archiveModal');
                            const instance = bootstrap.Modal.getInstance(modalEl);
                            if (instance) instance.hide();
                            loadYears();
                        }, 2500);
                    } else {
                        msg.className = 'alert alert-danger mt-3';
                        msg.textContent = data.error || 'Nie udało się zarchiwizować. Spróbuj ponownie.';
                        msg.style.display = 'block';
                    }
                })
                .catch(() => {
                    msg.className = 'alert alert-danger mt-3';
                    msg.textContent = 'Błąd połączenia. Sprawdź internet i spróbuj ponownie.';
                    msg.style.display = 'block';
                })
                .finally(() => {
                    btn.disabled = false;
                    btn.innerHTML = '<i class="fas fa-box-archive me-1"></i>Archiwizuj';
                });
        }
    