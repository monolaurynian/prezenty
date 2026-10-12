
        let currentUserId = null;

        document.addEventListener('DOMContentLoaded', () => {
            fetch('/api/auth')
                .then(r => r.json())
                .then(data => {
                    if (!data.authenticated) { window.location.href = '/'; return; }
                    currentUserId = data.user.id;
                    loadReserved();
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

        // Kept in memory so actions can update the list optimistically
        let myPresents = [];

        function loadReserved() {
            fetch('/api/presents/all')
                .then(r => r.json())
                .then(presents => {
                    myPresents = presents.filter(p => p.reserved_by === currentUserId);
                    render(myPresents);
                })
                .catch(() => {
                    document.getElementById('reservedContent').innerHTML = `
                        <div class="text-center py-4">
                            <p>Nie udało się załadować rezerwacji.</p>
                            <button class="btn btn-outline-secondary btn-sm" onclick="loadReserved()">
                                <i class="fas fa-rotate-right me-1"></i>Spróbuj ponownie
                            </button>
                        </div>`;
                });
        }

        function render(presents) {
            const content = document.getElementById('reservedContent');

            if (presents.length === 0) {
                content.innerHTML = `
                    <div class="text-center py-5">
                        <div style="font-size: 48px;">🔖</div>
                        <h5 class="mt-2">Nie masz żadnych rezerwacji</h5>
                        <p style="opacity: 0.85;">Zarezerwuj prezenty na liście, żeby nikt Cię nie ubiegł!</p>
                        <a href="/recipients.html" class="btn btn-light mt-2 fw-semibold" style="text-shadow: none; color: #212529;">
                            <i class="fas fa-gifts me-1"></i>Przeglądaj prezenty
                        </a>
                    </div>`;
                return;
            }

            const toBuy = presents.filter(p => !p.is_checked);
            const bought = presents.filter(p => p.is_checked);

            const presentHTML = (p) => `
                <div class="reserved-present ${p.is_checked ? 'bought' : ''}" data-id="${p.id}">
                    <div class="d-flex justify-content-between align-items-start gap-2 flex-wrap">
                        <div class="flex-grow-1">
                            <div class="fw-semibold">${p.is_checked ? '<i class="fas fa-check-circle me-1" style="color:#2e7d32;"></i>' : ''}${escapeHtml(p.title)}</div>
                            <div class="for-whom"><i class="fas fa-user me-1"></i>dla: ${escapeHtml(p.recipient_name || 'nieznana osoba')}</div>
                            ${p.comments ? `<div style="font-size:13px; opacity:0.8;"><i class="fas fa-info-circle me-1"></i>${escapeHtml(p.comments)}</div>` : ''}
                        </div>
                        <div class="d-flex gap-2 flex-wrap">
                            ${p.is_checked
                                ? `<button class="btn btn-sm btn-unbuy" onclick="setBought(${p.id}, false)"><i class="fas fa-rotate-left me-1"></i>Cofnij kupione</button>`
                                : `<button class="btn btn-sm btn-buy" onclick="setBought(${p.id}, true)"><i class="fas fa-shopping-bag me-1"></i>Kupione</button>
                                   <button class="btn btn-sm btn-cancel-res" onclick="cancelReservation(${p.id})"><i class="fas fa-xmark me-1"></i>Anuluj</button>`}
                        </div>
                    </div>
                </div>`;

            content.innerHTML = `
                ${toBuy.length ? `<div class="section-header"><i class="fas fa-cart-shopping" style="color:#EF6C00;"></i>Do kupienia (${toBuy.length})</div>` : ''}
                ${toBuy.map(presentHTML).join('')}
                ${bought.length ? `<div class="section-header"><i class="fas fa-check-circle" style="color:#2e7d32;"></i>Kupione (${bought.length})</div>` : ''}
                ${bought.map(presentHTML).join('')}`;
        }

        function setBought(id, isChecked) {
            // Optimistic: move between "Do kupienia" / "Kupione" instantly,
            // then sync with the server (rollback on failure)
            const present = myPresents.find(p => p.id === id);
            if (!present) return;
            const prevChecked = present.is_checked;
            present.is_checked = isChecked;
            render(myPresents);
            showToast(isChecked ? 'Oznaczono jako kupione 🛍️' : 'Cofnięto oznaczenie', 'success');

            fetch(`/api/presents/${id}/check`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ is_checked: isChecked })
            })
                .then(r => r.json())
                .then(d => {
                    if (!d.success) {
                        present.is_checked = prevChecked;
                        render(myPresents);
                        showToast(d.error || 'Nie udało się zapisać zmiany', 'error');
                    }
                })
                .catch(() => {
                    present.is_checked = prevChecked;
                    render(myPresents);
                    showToast('Błąd połączenia. Zmiana została cofnięta.', 'error');
                });
        }

        function logout() {
            fetch('/api/logout', { method: 'POST' })
                .finally(() => { window.location.href = '/'; });
        }

        function cancelReservation(id) {
            // Optimistic: remove from the list instantly, restore on failure
            const index = myPresents.findIndex(p => p.id === id);
            if (index === -1) return;
            const removed = myPresents.splice(index, 1)[0];
            render(myPresents);
            showToast('Rezerwacja anulowana', 'success');

            fetch(`/api/presents/${id}/reserve`, { method: 'DELETE' })
                .then(r => r.json())
                .then(d => {
                    if (!d.success) {
                        myPresents.splice(index, 0, removed);
                        render(myPresents);
                        showToast(d.error || 'Nie udało się anulować rezerwacji', 'error');
                    }
                })
                .catch(() => {
                    myPresents.splice(index, 0, removed);
                    render(myPresents);
                    showToast('Błąd połączenia. Rezerwacja została przywrócona.', 'error');
                });
        }
    