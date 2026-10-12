
        let people = [];
        let presents = [];
        let abandonedPresents = [];
        let abandonedSummary = null;
        let allRecipients = [];
        let currentUserId = null;

        document.addEventListener('DOMContentLoaded', () => {
            fetch('/api/auth')
                .then(r => r.json())
                .then(d => {
                    if (!d.authenticated) { window.location.href = '/'; return; }
                    currentUserId = d.user && d.user.id;
                    loadData();
                })
                .catch(() => { window.location.href = '/'; });
        });

        function escapeHtml(text) {
            const div = document.createElement('div');
            div.textContent = text == null ? '' : String(text);
            return div.innerHTML;
        }

        function showToast(message, type) {
            const el = document.getElementById(`${type}Toast`);
            document.getElementById(`${type}ToastMessage`).textContent = message;
            new bootstrap.Toast(el, { autohide: true, delay: type === 'error' ? 5000 : 3000 }).show();
        }

        function loadData() {
            Promise.all([
                fetch('/api/recipients').then(r => r.json()),
                fetch('/api/presents/all').then(r => r.json()),
                fetch('/api/presents/abandoned').then(r => r.json()).catch(() => ({ presents: [] }))
            ])
                .then(([recipients, allPresents, abandoned]) => {
                    allRecipients = Array.isArray(recipients) ? recipients : [];
                    // Only unverified (unidentified) people can be managed here
                    people = allRecipients.filter(r => !r.identified_by);
                    presents = Array.isArray(allPresents) ? allPresents : [];
                    abandonedPresents = (abandoned && abandoned.presents) || [];
                    abandonedSummary = (abandoned && abandoned.summary) || null;
                    render();
                })
                .catch(() => {
                    document.getElementById('peopleContent').innerHTML = `
                        <div class="text-center py-4">
                            <p>Nie udało się załadować danych.</p>
                            <button class="btn btn-outline-secondary btn-sm" onclick="loadData()">
                                <i class="fas fa-rotate-right me-1"></i>Spróbuj ponownie
                            </button>
                        </div>`;
                });
        }

        function render() {
            renderPeople();
            renderAbandoned();
        }

        function renderPeople() {
            const content = document.getElementById('peopleContent');

            if (people.length === 0) {
                content.innerHTML = `
                    <div class="text-center py-4">
                        <div style="font-size: 42px;">👥</div>
                        <p class="mt-2 mb-0" style="color:#6b7280;">Wszystkie osoby są zidentyfikowane - nie ma tu nic do zarządzania.</p>
                    </div>`;
                return;
            }

            content.innerHTML = people.map(person => {
                const theirPresents = presents.filter(p => p.recipient_id === person.id);
                return `
                    <div class="mt-4" data-person="${person.id}">
                        <div class="person-header">
                            <span class="person-name"><i class="fas fa-user me-2" style="color:#6b7280;"></i>${escapeHtml(person.name)}
                                <span style="font-weight:400; color:#6b7280; font-size:13px;">(${plCount(theirPresents.length, 'prezent', 'prezenty', 'prezentów')})</span>
                            </span>
                            <button class="btn btn-outline-danger btn-sm" onclick="deletePerson(${person.id}, ${PrezentyEscape.jsStringAttr(escapeHtml(person.name))})">
                                <i class="fas fa-user-xmark me-1"></i>Usuń osobę
                            </button>
                        </div>
                        ${theirPresents.map(p => presentRow(p)).join('')}
                        ${theirPresents.length === 0 ? '<div class="present-row muted">Brak prezentów</div>' : ''}
                    </div>`;
            }).join('');
        }

        // Presents nobody manages anymore (creator account deleted,
        // recipient row gone, or no recipient assigned at all). Served by
        // /api/presents/abandoned, which also masks the caller's own gifts
        // (still deletable, no spoiler). Presents of unidentified people
        // are excluded from THIS list - they show in the section above
        // with a "porzucony" badge instead.
        function renderAbandoned() {
            const card = document.getElementById('abandonedCard');
            const content = document.getElementById('abandonedContent');
            const unidentifiedIds = new Set(people.map(p => p.id));

            const abandoned = abandonedPresents.filter(p => !unidentifiedIds.has(p.recipient_id));

            // Always show the card with a diagnostic summary - a silent,
            // hidden card made it impossible to tell "no orphans" from
            // "something didn't load"
            card.style.display = '';
            const total = abandonedSummary && abandonedSummary.totalPresents != null
                ? abandonedSummary.totalPresents : null;
            const summaryLine = `<div class="muted mb-2" style="font-size:13px;">
                ${total != null ? `W bazie łącznie: <strong>${total}</strong> ${plPlural(total, 'prezent', 'prezenty', 'prezentów')}.` : ''}
                Znaleziono <strong>${abandonedPresents.length}</strong> ${plPlural(abandonedPresents.length, 'prezent', 'prezenty', 'prezentów')} bez opiekuna${abandoned.length !== abandonedPresents.length ? ` (${abandonedPresents.length - abandoned.length} z nich należy do niezidentyfikowanych osób i jest na liście powyżej)` : ''}.
            </div>`;

            if (abandoned.length === 0) {
                content.innerHTML = summaryLine +
                    '<div class="present-row muted">Brak porzuconych prezentów do pokazania.</div>';
                return;
            }

            // Group by recipient for readability
            const byRecipient = new Map();
            abandoned.forEach(p => {
                const key = p.recipient_missing
                    ? 'Osoba usunięta z listy'
                    : (p.recipient_name || 'Bez przypisanej osoby');
                if (!byRecipient.has(key)) byRecipient.set(key, []);
                byRecipient.get(key).push(p);
            });

            content.innerHTML = summaryLine + [...byRecipient.entries()].map(([name, list]) => `
                <div class="mt-3">
                    <div class="person-name" style="font-size: 15px;">
                        <i class="fas fa-user me-2" style="color:#6b7280;"></i>${escapeHtml(name)}
                        <span style="font-weight:400; color:#6b7280; font-size:13px;">(${list.length})</span>
                    </div>
                    ${list.map(p => abandonedRow(p)).join('')}
                </div>`).join('');
        }

        // Delete-only row: editing makes no sense here, and masked rows
        // (the caller's own gifts) never reveal the title
        function abandonedRow(p) {
            const flags = [];
            if (p.reserved) flags.push('zarezerwowany');
            if (p.bought) flags.push('kupiony');
            if (!p.creator_gone && p.creator_username) flags.push(`dodany przez: ${p.creator_username}`);
            return `
                <div class="present-row" data-abandoned="${p.id}">
                    <div class="d-flex justify-content-between gap-2 flex-wrap align-items-start">
                        <div class="flex-grow-1" style="min-width: 0;">
                            <div class="fw-semibold">${escapeHtml(p.title)}</div>
                            ${p.masked ? '<div class="muted">Prezent dla Ciebie - nazwa ukryta, żeby nie psuć niespodzianki</div>' : ''}
                            ${!p.masked && p.comments ? `<div class="muted">${escapeHtml(p.comments)}</div>` : ''}
                            ${flags.length ? `<div class="muted">${escapeHtml(flags.join(' · '))}</div>` : ''}
                        </div>
                        <button class="btn btn-outline-danger btn-sm" onclick="deleteAbandoned(${p.id})" title="Usuń">
                            <i class="fas fa-trash"></i>
                        </button>
                    </div>
                </div>`;
        }

        function deleteAbandoned(presentId) {
            const p = abandonedPresents.find(x => x.id === presentId);
            const label = p && !p.masked ? `"${p.title}"` : 'ten prezent';
            if (!confirm(`Usunąć ${label}? Tej operacji nie można cofnąć.`)) return;
            fetch(`/api/presents/${presentId}`, { method: 'DELETE' })
                .then(r => r.json())
                .then(d => {
                    if (d.success) {
                        abandonedPresents = abandonedPresents.filter(x => x.id !== presentId);
                        presents = presents.filter(x => x.id !== presentId);
                        render();
                        showToast('Prezent usunięty', 'success');
                    } else {
                        showToast(d.error || 'Nie udało się usunąć prezentu', 'error');
                    }
                })
                .catch(() => showToast('Błąd połączenia. Spróbuj ponownie.', 'error'));
        }

        // The delete button used to interpolate the title into its onclick as
        // a JS string literal. escapeHtml on this page is the textContent
        // idiom, which does NOT escape quotes, so a title containing a double
        // quote closed the attribute and could add arbitrary ones. The id is
        // all the handler ever needed - the title is looked up from the
        // presents array, exactly as deleteAbandoned already does.
        function presentRow(p) {
            const isAbandoned = abandonedPresents.some(a => a.id === p.id);
            return `
                <div class="present-row" data-present="${p.id}">
                    <div class="d-flex justify-content-between gap-2 flex-wrap align-items-start">
                        <div class="flex-grow-1" style="min-width: 0;">
                            <div class="fw-semibold">${escapeHtml(p.title)}
                                ${isAbandoned ? '<span class="badge text-bg-secondary ms-1" style="font-weight:500;"><i class="fas fa-ghost me-1"></i>porzucony</span>' : ''}
                            </div>
                            ${p.comments ? `<div class="muted">${escapeHtml(p.comments)}</div>` : ''}
                        </div>
                        <div class="d-flex gap-2">
                            <button class="btn btn-outline-primary btn-sm" onclick="startEdit(${p.id})" title="Edytuj">
                                <i class="fas fa-pen"></i>
                            </button>
                            <button class="btn btn-outline-danger btn-sm" data-delete-present="${p.id}" title="Usuń">
                                <i class="fas fa-trash"></i>
                            </button>
                        </div>
                    </div>
                </div>`;
        }

        function startEdit(presentId) {
            const p = presents.find(x => x.id === presentId);
            const row = document.querySelector(`[data-present="${presentId}"]`);
            if (!p || !row) return;

            row.innerHTML = `
                <div class="d-flex flex-column gap-2">
                    <input type="text" class="form-control form-control-sm" id="editTitle-${presentId}" value="${PrezentyEscape.escapeAttr(p.title)}" placeholder="Nazwa prezentu">
                    <textarea class="form-control form-control-sm" id="editComments-${presentId}" rows="2" placeholder="Komentarz (opcjonalnie)">${escapeHtml(p.comments || '')}</textarea>
                    <div class="d-flex gap-2">
                        <button class="btn btn-success btn-sm" onclick="saveEdit(${presentId})">
                            <i class="fas fa-check me-1"></i>Zapisz
                        </button>
                        <button class="btn btn-outline-secondary btn-sm" onclick="render()">Anuluj</button>
                    </div>
                </div>`;
        }

        function saveEdit(presentId) {
            const p = presents.find(x => x.id === presentId);
            const title = document.getElementById(`editTitle-${presentId}`).value.trim();
            const comments = document.getElementById(`editComments-${presentId}`).value.trim();
            if (!title) { showToast('Nazwa prezentu jest wymagana', 'error'); return; }

            fetch(`/api/presents/${presentId}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ title, recipient_id: p.recipient_id, comments })
            })
                .then(r => r.json())
                .then(d => {
                    if (d.success) {
                        p.title = title;
                        p.comments = comments;
                        render();
                        showToast('Prezent zaktualizowany', 'success');
                    } else {
                        showToast(d.error || 'Nie udało się zapisać zmian', 'error');
                    }
                })
                .catch(() => showToast('Błąd połączenia. Spróbuj ponownie.', 'error'));
        }

        // Delegated so the row markup never has to carry the title. The rows
        // are re-rendered on every change, hence a document-level listener.
        document.addEventListener('click', (e) => {
            const btn = e.target.closest && e.target.closest('[data-delete-present]');
            if (!btn) return;
            deletePresent(Number(btn.dataset.deletePresent));
        });

        function deletePresent(presentId) {
            const p = presents.find(x => x.id === presentId);
            const label = p ? `"${p.title}"` : 'ten prezent';
            if (!confirm(`Usunąć prezent ${label}?`)) return;
            fetch(`/api/presents/${presentId}`, { method: 'DELETE' })
                .then(r => r.json())
                .then(d => {
                    if (d.success) {
                        presents = presents.filter(p => p.id !== presentId);
                        abandonedPresents = abandonedPresents.filter(p => p.id !== presentId);
                        render();
                        showToast('Prezent usunięty', 'success');
                    } else {
                        showToast(d.error || 'Nie udało się usunąć prezentu', 'error');
                    }
                })
                .catch(() => showToast('Błąd połączenia. Spróbuj ponownie.', 'error'));
        }

        function addPerson() {
            const input = document.getElementById('newPersonName');
            const name = input.value.trim();
            if (!name) { showToast('Wpisz imię i nazwisko', 'error'); return; }

            fetch('/api/recipients', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name })
            })
                .then(r => r.json().then(data => ({ ok: r.ok, data })))
                .then(({ ok, data }) => {
                    if (ok && data.success) {
                        showToast(`Dodano: ${name} 🎉`, 'success');
                        input.value = '';
                        try { localStorage.removeItem('recipientsCache'); } catch (e) { /* ignore */ }
                        loadData(); // the new person appears in the list below
                    } else {
                        showToast(data.error || 'Nie udało się dodać osoby', 'error');
                    }
                })
                .catch(() => showToast('Błąd połączenia. Spróbuj ponownie.', 'error'));
        }

        function deletePerson(personId, name) {
            const count = presents.filter(p => p.recipient_id === personId).length;
            if (!confirm(`Usunąć osobę "${name}"?${count ? ` ${plPlural(count, 'Usunięty zostanie', 'Usunięte zostaną', 'Usuniętych zostanie')} też ${plCount(count, 'prezent', 'prezenty', 'prezentów')} tej osoby.` : ''}`)) return;
            fetch(`/api/recipients/${personId}`, { method: 'DELETE' })
                .then(r => r.json())
                .then(d => {
                    if (d.success) {
                        people = people.filter(p => p.id !== personId);
                        presents = presents.filter(p => p.recipient_id !== personId);
                        abandonedPresents = abandonedPresents.filter(p => p.recipient_id !== personId);
                        render();
                        showToast(`Usunięto: ${name}`, 'success');
                    } else {
                        showToast(d.error || 'Nie udało się usunąć osoby', 'error');
                    }
                })
                .catch(() => showToast('Błąd połączenia. Spróbuj ponownie.', 'error'));
        }
    