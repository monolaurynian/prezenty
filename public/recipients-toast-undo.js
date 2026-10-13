// Toast notification system
// Optional third argument adds an action button, e.g. an undo:
//   showToast('Zarezerwowano', 'success', { label: 'Cofnij', onClick: () => ... })
function showToast(message, type = 'success', action = null) {
    const toastId = `${type}Toast`;
    const messageId = `${type}ToastMessage`;

    const toastElement = document.getElementById(toastId);
    const messageElement = document.getElementById(messageId);

    if (toastElement && messageElement) {
        messageElement.textContent = message;

        // Remove any action button left over from a previous toast
        const oldBtn = toastElement.querySelector('.toast-action-btn');
        if (oldBtn) oldBtn.remove();

        const closeBtn = toastElement.querySelector('.btn-close');
        if (action) {
            const btn = document.createElement('button');
            btn.type = 'button';
            // Ghost pill look comes from .toast-action-btn in app-theme.css
            btn.className = 'toast-action-btn ms-2';
            // margin-left auto pushes the action to the right edge of the toast
            btn.style.cssText = 'align-self: center; white-space: nowrap; margin-left: auto !important; cursor: pointer;';
            btn.textContent = action.label;
            btn.addEventListener('click', () => {
                const instance = bootstrap.Toast.getInstance(toastElement);
                if (instance) instance.hide();
                action.onClick();
            });
            // Insert inside the flex container, before the close button
            closeBtn.parentElement.insertBefore(btn, closeBtn);
            // The close button's m-auto would split the free space with the
            // action button's auto margin, leaving a gap on the right.
            // Keep only vertical centering so the action hugs the right edge.
            closeBtn.classList.remove('m-auto');
            closeBtn.classList.add('my-auto');
        } else if (closeBtn) {
            // Restore default centering for plain toasts
            closeBtn.classList.add('m-auto');
            closeBtn.classList.remove('my-auto');
        }

        const toast = new bootstrap.Toast(toastElement, {
            autohide: true,
            // Give people more time to hit "Cofnij" when there's an action
            delay: action ? 6000 : (type === 'error' ? 5000 : 3000)
        });
        toast.show();
    }
}

// Share a wishlist form link with the recipient pre-selected, so family
// members can add their wishes without navigating anything
function shareFormularzLink(recipientName) {
    const url = `${window.location.origin}/formularz?osoba=${encodeURIComponent(recipientName)}`;

    if (navigator.share) {
        navigator.share({
            title: 'Życzenia Prezentowe 🎁',
            text: `Wpisz swoje życzenia prezentowe (${recipientName}):`,
            url: url
        }).catch(() => { /* user cancelled the share sheet - not an error */ });
    } else if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(url)
            .then(() => showSuccessToast(`Link skopiowany! Wyślij go: ${recipientName}`))
            .catch(() => window.prompt('Skopiuj link do formularza:', url));
    } else {
        window.prompt('Skopiuj link do formularza:', url);
    }
}

// Undo helpers - reverse the last action. Optimistic (instant UI) and
// counted as pending ops so they can't be reverted by stale reloads.

// Apply a partial present state to cache + item classes + buttons,
// returning the previous values for rollback
function applyPresentState(presentId, changes) {
    const previous = {};
    if (window._dataCache && window._dataCache.presents) {
        const p = window._dataCache.presents.find(x => x.id === presentId);
        if (p) {
            Object.keys(changes).forEach(k => { previous[k] = p[k]; });
            Object.assign(p, changes);
        }
    }
    const item = document.querySelector(`[data-id="${presentId}"]`);
    if (item) {
        if ('is_checked' in changes) item.classList.toggle('checked', !!changes.is_checked);
        if ('reserved_by' in changes) {
            item.classList.toggle('reserved-by-me',
                changes.reserved_by != null && changes.reserved_by === window._currentUserId);
            if (changes.reserved_by == null) item.classList.remove('reserved-by-other');
        }
    }
    refreshPresentButtons(presentId);
    return previous;
}

function undoPresentAction(presentId, changes, request, successMsg, errorMsg) {
    beginPresentOp();
    const previous = applyPresentState(presentId, changes);

    request()
        .then(r => r.json())
        .then(d => {
            if (d.success) {
                showSuccessToast(successMsg);
                softReloadRecipients();
            } else {
                applyPresentState(presentId, previous);
                showErrorToast(d.error || errorMsg);
            }
        })
        .catch(() => {
            applyPresentState(presentId, previous);
            showErrorToast(errorMsg);
        })
        .finally(() => endPresentOp());
}

function undoReservation(presentId) {
    undoPresentAction(presentId,
        { reserved_by: null, reserved_by_username: null },
        () => fetch(`/api/presents/${presentId}/reserve`, { method: 'DELETE' }),
        'Cofnięto rezerwację', 'Nie udało się cofnąć rezerwacji');
}

function undoCancelReservation(presentId) {
    undoPresentAction(presentId,
        { reserved_by: window._currentUserId, reserved_by_username: 'Ty' },
        () => fetch(`/api/presents/${presentId}/reserve`, { method: 'POST', headers: { 'Content-Type': 'application/json' } }),
        'Przywrócono rezerwację', 'Nie udało się przywrócić rezerwacji');
}

function undoCheck(presentId) {
    undoPresentAction(presentId,
        { is_checked: false },
        () => fetch(`/api/presents/${presentId}/check`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ is_checked: false })
        }),
        'Cofnięto oznaczenie', 'Nie udało się cofnąć');
}

function showSuccessToast(message) {
    showToast(message, 'success');
}

function showErrorToast(message) {
    showToast(message, 'error');
}

function showInfoToast(message) {
    showToast(message, 'info');
}

// Add missing loadRecipients function for the refresh button
function loadRecipients() {
    console.log('Refreshing recipients data...');
    showInfoToast('Odświeżanie danych...');
    // Clear all caches when refreshing
    clearRecipientsCache();
    loadRecipientsWithPresents(true); // Force reload
}

// Cache management functions
function clearRecipientsCache() {
    window._cachedRecipients = null;
    window._cachedIdentificationStatus = null;
    window._dataCache = null;
    window._dataCacheTimestamp = null;
    clearPersistentCache();
}

function displayRecipientsData(recipients, presents, identificationStatus) {
    // Add instant load class for smooth fade-in
    const recipientsList = document.getElementById('recipientsList');
    if (recipientsList) {
        recipientsList.classList.add('instant-load');
    }

    // Store identification status for later use
    window._cachedIdentificationStatus = identificationStatus;

    // Store data globally for other functions
    window._allPresentsByRecipient = {};
    presents.forEach(present => {
        if (!window._allPresentsByRecipient[present.recipient_id]) {
            window._allPresentsByRecipient[present.recipient_id] = [];
        }
        window._allPresentsByRecipient[present.recipient_id].push(present);
    });

    // Display the recipients
    displayRecipientsWithPresents(recipients, presents);

    // PRIVACY FIX: If user is identified in cache, hide their presents immediately
    if (identificationStatus && identificationStatus.isIdentified && identificationStatus.userId) {
        console.log('[Privacy] Applying privacy filter from cache');
        // Find the identified recipient and hide their presents
        const identifiedRecipient = recipients.find(r => r.identified_by === identificationStatus.userId);
        if (identifiedRecipient) {
            // Hide presents for this recipient immediately
            const recipientCard = document.querySelector(`[data-recipient-id="${identifiedRecipient.id}"]`);
            if (recipientCard) {
                const presentsContainer = recipientCard.querySelector('.presents-list, .recipient-presents');
                if (presentsContainer) {
                    // Temporarily hide until auth completes
                    presentsContainer.style.opacity = '0.3';
                    presentsContainer.style.pointerEvents = 'none';
                    console.log('[Privacy] Temporarily hiding presents for recipient:', identifiedRecipient.name);
                }
            }
        }
    }
}

function handleIdentificationLogic(recipients, identificationStatus) {
    console.log('handleIdentificationLogic called with:', {
        currentUserId,
        recipients: recipients.map(r => ({ id: r.id, name: r.name, identified_by: r.identified_by })),
        identificationStatus
    });

    // Ensure currentUserId is set
    if (!currentUserId) {
        console.warn('currentUserId not set, skipping identification logic');
        return;
    }

    // First check the identification status from the API
    if (identificationStatus.isIdentified && identificationStatus.identifiedRecipient) {
        console.log('User is already identified according to API:', identificationStatus.identifiedRecipient.name, '- skipping identification flow');
        return;
    }

    // Also check if user is already identified as any recipient in the recipients list
    const alreadyIdentified = recipients.find(recipient =>
        recipient.identified_by === currentUserId
    );

    console.log('Already identified check:', { currentUserId, alreadyIdentified });

    if (alreadyIdentified) {
        console.log('User is already identified as:', alreadyIdentified.name, '- skipping identification flow');
        return; // Don't show any identification modals
    }

    // Only show identification flow if user is not identified at all
    console.log('User is not identified, checking for identification options...');

    // Find matching recipient by username (for first-time identification)
    const matchingRecipient = recipients.find(recipient =>
        recipient.name.toLowerCase() === identificationStatus.username?.toLowerCase() &&
        !recipient.identified_by
    );

    if (matchingRecipient) {
        console.log('Found matching unidentified recipient:', matchingRecipient.name);
        setTimeout(() => {
            identifyAsRecipient(matchingRecipient.id, matchingRecipient.name, true);
        }, 500);
    } else {
        console.log('No matching recipient found, showing selection modal');
        setTimeout(() => {
            showRecipientSelectionModal();
        }, 500);
    }
}

function refreshRecipientsCache() {
    return Promise.all([
        fetch('/api/recipients').then(response => response.json()),
        fetch('/api/user/identification').then(response => response.json())
    ])
        .then(([recipients, identificationStatus]) => {
            window._cachedRecipients = recipients;
            window._cachedIdentificationStatus = identificationStatus;
            return { recipients, identificationStatus };
        });
}

// PWA functionality is now handled in recipients.html

// PWA helper functions removed - functionality moved to recipients.html


// Filter recipients and presents by search term
function filterRecipients(searchTerm) {
    const term = searchTerm.toLowerCase().trim();
    const recipientCards = document.querySelectorAll('.recipient-card');

    recipientCards.forEach(card => {
        const recipientName = card.querySelector('.recipient-name')?.textContent.toLowerCase() || '';
        const presents = card.querySelectorAll('.present-item');
        let hasVisiblePresent = false;

        // Check each present
        presents.forEach(present => {
            const presentTitle = present.querySelector('.present-title')?.textContent.toLowerCase() || '';
            const presentComments = present.querySelector('.present-comments')?.textContent.toLowerCase() || '';

            if (presentTitle.includes(term) || presentComments.includes(term)) {
                present.style.display = '';
                hasVisiblePresent = true;
            } else {
                present.style.display = term ? 'none' : '';
            }
        });

        // Show card if recipient name matches or has visible presents
        if (recipientName.includes(term) || hasVisiblePresent || !term) {
            card.style.display = '';
            // If recipient name matches, show all presents
            if (recipientName.includes(term) || !term) {
                presents.forEach(present => present.style.display = '');
            }
        } else {
            card.style.display = 'none';
        }
    });
}

// Initialize search functionality when DOM is ready
document.addEventListener('DOMContentLoaded', function () {
    const searchInput = document.getElementById('recipientSearch');
    if (searchInput) {
        searchInput.addEventListener('keyup', function () {
            filterRecipients(this.value);
        });
    }
});
