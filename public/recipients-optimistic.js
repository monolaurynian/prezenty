// ---- Race guards for fast consecutive actions ----
// softReloadRecipients() snapshots the server state at REQUEST time. If
// the user acts again while that snapshot is in flight, applying it would
// revert the newer optimistic state (buttons "snapping back", lost
// clicks). Every action counts as a pending op and bumps a token; a
// snapshot only applies when nothing changed since it was requested.
// Otherwise it's discarded and ONE fresh reload runs once all ops settle.
let _pendingPresentOps = 0;
let _presentOpToken = 0;
let _softReloadQueued = false;

function beginPresentOp() {
    _pendingPresentOps++;
    _presentOpToken++;
}

function endPresentOp() {
    _pendingPresentOps = Math.max(0, _pendingPresentOps - 1);
    if (_pendingPresentOps === 0 && _softReloadQueued) {
        _softReloadQueued = false;
        softReloadRecipients();
    }
}

// Optimistic update helper functions
function fetchWithTimeout(url, options, timeout = 10000) {
    return Promise.race([
        fetch(url, options),
        new Promise((_, reject) =>
            setTimeout(() => reject(new Error('Request timeout')), timeout)
        )
    ]);
}

function updateButtonOptimistically(button, action) {
    if (action === 'reserve') {
        button.className = 'btn btn-danger btn-sm w-100 w-md-auto reserve-btn updating';
        button.innerHTML = '<i class="fas fa-xmark"></i> <span class="d-inline d-md-none ms-1">Usuń rezerwację</span>';
    } else {
        button.className = 'btn btn-reserve btn-sm w-100 w-md-auto reserve-btn updating';
        button.innerHTML = '<i class="fas fa-bookmark"></i> <span class="ms-1">Zarezerwuj</span>';
    }
    button.disabled = true;
}

function updatePresentItemOptimistically(presentItem, action) {
    if (action === 'reserve') {
        presentItem.classList.remove('reserved-by-other');
        presentItem.classList.add('reserved-by-me');
    } else {
        presentItem.classList.remove('reserved-by-me');
    }
}

function updateCacheOptimistically(presentId, action, userId) {
    if (window._dataCache && window._dataCache.presents) {
        const present = window._dataCache.presents.find(p => p.id === presentId);
        if (present) {
            if (action === 'reserve') {
                present.reserved_by = userId;
                present.reserved_by_username = 'Ty';
            } else {
                present.reserved_by = null;
                present.reserved_by_username = null;
            }
        }
    }
}

function rollbackOptimisticUpdate(presentId, previousState) {
    // Restore cache
    if (window._dataCache && window._dataCache.presents) {
        const present = window._dataCache.presents.find(p => p.id === presentId);
        if (present) {
            present.reserved_by = previousState.reserved_by;
            present.reserved_by_username = previousState.reserved_by_username;
        }
    }

    // Restore present item classes
    const presentItem = document.querySelector(`[data-id="${presentId}"]`);
    if (presentItem) {
        presentItem.className = previousState.itemClasses;
    }

    // Re-render buttons from the restored cache state
    refreshPresentButtons(presentId);
}

function reservePresentFromRecipients(presentId, button, previousState) {
    fetchWithTimeout(`/api/presents/${presentId}/reserve`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        }
    }, 10000)
        .then(response => {
            if (!response.ok) {
                return response.json().then(data => {
                    throw new Error(data.error || 'Server error');
                });
            }
            return response.json();
        })
        .then(data => {
            if (data.success) {
                // Success - optimistic update is confirmed
                showToast('Prezent zarezerwowany! 🎁', 'success', {
                    label: 'Cofnij',
                    onClick: () => undoReservation(presentId)
                });

                // Render the reserved-state buttons (Zakupione | Anuluj)
                refreshPresentButtons(presentId);

                // Trigger soft reload to update cache
                if (typeof softReloadRecipients === 'function') {
                    softReloadRecipients();
                }
            } else {
                // Server returned success: false - rollback
                const errorMsg = data.error || 'Błąd podczas rezerwacji';
                showErrorToast(errorMsg);
                rollbackOptimisticUpdate(presentId, previousState);
            }
        })
        .catch(error => {
            console.error('Error reserving present:', error);

            // Determine error type for better messaging
            let errorMsg = 'Błąd podczas rezerwacji';
            if (error.message === 'Request timeout') {
                errorMsg = 'Przekroczono limit czasu żądania. Spróbuj ponownie.';
            } else if (error.message.includes('already reserved')) {
                errorMsg = 'Ten prezent został już zarezerwowany przez kogoś innego';
            } else if (!navigator.onLine) {
                errorMsg = 'Brak połączenia z internetem';
            } else if (error.message) {
                errorMsg = error.message;
            }

            showErrorToast(errorMsg);
            rollbackOptimisticUpdate(presentId, previousState);
        })
        .finally(() => endPresentOp());
}

function cancelReservationFromRecipients(presentId, button, previousState) {
    fetchWithTimeout(`/api/presents/${presentId}/reserve`, {
        method: 'DELETE',
        headers: {
            'Content-Type': 'application/json',
        }
    }, 10000)
        .then(response => {
            if (!response.ok) {
                return response.json().then(data => {
                    throw new Error(data.error || 'Server error');
                });
            }
            return response.json();
        })
        .then(data => {
            if (data.success) {
                // Success - optimistic update is confirmed
                showToast('Rezerwacja anulowana', 'success', {
                    label: 'Cofnij',
                    onClick: () => undoCancelReservation(presentId)
                });

                // Render the available-state button (Zarezerwuj)
                refreshPresentButtons(presentId);

                // Trigger soft reload to update cache
                if (typeof softReloadRecipients === 'function') {
                    softReloadRecipients();
                }
            } else {
                // Server returned success: false - rollback
                const errorMsg = data.error || 'Błąd podczas anulowania rezerwacji';
                showErrorToast(errorMsg);
                rollbackOptimisticUpdate(presentId, previousState);
            }
        })
        .catch(error => {
            console.error('Error canceling reservation:', error);

            // Determine error type for better messaging
            let errorMsg = 'Błąd podczas anulowania rezerwacji';
            if (error.message === 'Request timeout') {
                errorMsg = 'Przekroczono limit czasu żądania. Spróbuj ponownie.';
            } else if (error.message.includes('not reserved')) {
                errorMsg = 'Ten prezent nie jest zarezerwowany';
            } else if (!navigator.onLine) {
                errorMsg = 'Brak połączenia z internetem';
            } else if (error.message) {
                errorMsg = error.message;
            }

            showErrorToast(errorMsg);
            rollbackOptimisticUpdate(presentId, previousState);
        })
        .finally(() => endPresentOp());
}

function showReservedByOtherModal(username) {
    // Show modal with the message
    const modal = new bootstrap.Modal(document.getElementById('reservedByOtherModal'));
    document.getElementById('reservedByOtherMessage').textContent = "Sorry, teraz to już po ptokach! Już ktoś inny to zarezerwował. Trzeba było szybciej rezerwować matole! Wybierz coś innego.";
    modal.show();
}

function redirectIfAuthenticated() {
    fetch('/api/auth')
        .then(response => response.json())
        .then(data => {
            if (data.authenticated) {
                window.location.href = '/recipients';
            }
        });
}

function openRecipientDetailsModal(recipient, presents, isIdentified) {
    // Ustaw dane w modalu
    document.getElementById('recipientDetailsName').textContent = recipient.name;
    document.getElementById('recipientDetailsName2').textContent = recipient.name;
    const img = document.getElementById('recipientDetailsImage');
    if (recipient.profile_picture) {
        img.src = getFullProfilePictureUrl(recipient.profile_picture);
        img.style.display = 'block';
    } else {
        img.src = '';
        img.style.display = 'none';
    }
    const contentDiv = document.getElementById('recipientDetailsContent');
    if (isIdentified) {
        contentDiv.innerHTML = `<div class="alert alert-warning text-center"><b>Co, korci Cię, żeby zobaczyć, czy już ktoś kupił Twoje prezenty??? Wynocha!</b></div>`;
    } else {
        // Sortowanie prezentów: najpierw niekupione i niezarezerwowane, potem zarezerwowane, potem kupione
        const notBought = presents.filter(p => !p.is_checked && !p.reserved_by);
        const reserved = presents.filter(p => !p.is_checked && p.reserved_by);
        const bought = presents.filter(p => p.is_checked);
        function presentRow(p, extraClass = '') {
            return `<div class="present-item ${extraClass}" style="opacity:${extraClass ? '0.5' : '1'};">` +
                `<div class="d-flex align-items-center justify-content-between">` +
                `<div><b>${escapeHtml(p.title)}</b>${p.comments ? `<br><small class='text-muted'>${escapeHtml(p.comments)}</small>` : ''}</div>` +
                `<div><small>${p.created_at ? new Date(p.created_at).toLocaleDateString('pl-PL') : ''}</small></div>` +
                `</div></div>`;
        }
        let html = '';
        if (notBought.length) {
            html += `<div class='mb-2'><b>Do kupienia:</b></div>` + notBought.map(p => presentRow(p)).join('');
        }
        if (reserved.length) {
            html += `<div class='mb-2 mt-3'><b>Zarezerwowane:</b></div>` + reserved.map(p => presentRow(p, 'reserved-by-other')).join('');
        }
        if (bought.length) {
            html += `<div class='mb-2 mt-3'><b>Kupione:</b></div>` + bought.map(p => presentRow(p, 'checked')).join('');
        }
        if (!html) html = '<p class="text-muted">Brak prezentów dla tej osoby</p>';
        contentDiv.innerHTML = html;
    }
    const modal = new bootstrap.Modal(document.getElementById('recipientDetailsModal'));
    modal.show();
}

// Funkcja pomocnicza do wywołania modalu po kliknięciu
function showRecipientDetailsFromList(recipientId) {
    // Pobierz dane z listy już załadowanej na stronie
    const recipients = window._allRecipients || [];
    const presentsByRecipient = window._allPresentsByRecipient || {};
    const recipient = recipients.find(r => r.id === recipientId);
    const presents = presentsByRecipient[recipientId] || [];
    const isIdentified = currentUserId && recipient.identified_by === currentUserId;
    openRecipientDetailsModal(recipient, presents, isIdentified);
}

// Zmodyfikuj displayRecipientsWithPresents by zapisać dane globalnie
const oldDisplayRecipientsWithPresents = displayRecipientsWithPresents;
displayRecipientsWithPresents = function (recipients, presents) {
    // Zbuduj mapę prezentów po recipientId
    const presentsByRecipient = {};
    presents.forEach(p => {
        if (!presentsByRecipient[p.recipient_id]) presentsByRecipient[p.recipient_id] = [];
        presentsByRecipient[p.recipient_id].push(p);
    });
    window._allRecipients = recipients;
    window._allPresentsByRecipient = presentsByRecipient;
    oldDisplayRecipientsWithPresents(recipients, presents);
};

// Add proper focus management for modals to prevent aria-hidden accessibility issues
document.addEventListener('DOMContentLoaded', function () {
    let scrollPosition = 0;

    // Handle modal events to ensure proper focus management and scroll position
    const modals = document.querySelectorAll('.modal');
    modals.forEach(modal => {
        modal.addEventListener('show.bs.modal', function (e) {
            // Save current scroll position once
            scrollPosition = window.pageYOffset || document.documentElement.scrollTop;

            // Ensure modal is properly accessible when shown
            this.removeAttribute('aria-hidden');
        });

        modal.addEventListener('hidden.bs.modal', function () {
            // Move focus to body when modal is hidden to prevent aria-hidden issues
            document.body.focus();

            // Restore scroll position once after modal closes
            window.scrollTo(0, scrollPosition);
        });
    });
});

