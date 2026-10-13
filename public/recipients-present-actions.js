function generatePresentsList(presents) {
    if (presents.length === 0) {
        return '<p class="text-muted mb-0">Brak prezentów dla tej osoby</p>';
    }

    // Separate presents into bought and not bought
    const boughtPresents = presents.filter(p => p.is_checked);
    const notBoughtPresents = presents.filter(p => !p.is_checked);

    // Sort not bought presents: reserved by current user first, then by creation date
    const sortedNotBought = notBoughtPresents.sort((a, b) => {
        const aReservedByMe = a.reserved_by === currentUserId;
        const bReservedByMe = b.reserved_by === currentUserId;
        if (aReservedByMe && !bReservedByMe) return -1;
        if (!aReservedByMe && bReservedByMe) return 1;
        return new Date(b.created_at) - new Date(a.created_at);
    });

    // Sort bought presents by creation date (newer first)
    const sortedBought = boughtPresents.sort((a, b) => {
        return new Date(b.created_at) - new Date(a.created_at);
    });

    // Homepage-style row: gift icon + title/comments on the left,
    // action buttons stacked in a column on the right
    const generatePresentItem = (present, index) => `
        <div class="present-item ${present.is_checked ? 'checked' : ''} ${present.reserved_by && present.reserved_by !== currentUserId ? 'reserved-by-other' : ''} ${present.reserved_by === currentUserId ? 'reserved-by-me' : ''}" data-id="${present.id}" style="transition-delay: ${index * 50}ms;">
            <div class="d-flex align-items-start justify-content-between w-100" style="gap: 12px;">
                <div class="d-flex present-details" style="gap: 8px; flex: 1 1 auto; min-width: 0;">
                    <i class="fas fa-gift present-gift-icon" style="margin-top: 4px; flex-shrink: 0;"></i>
                    <div class="present-title-block" style="flex: 1; min-width: 0;">
                        <h6 class="present-title mb-1">${convertUrlsToLinks(escapeHtml(present.title))}</h6>
                        ${present.comments ? `<div class="present-comments mb-1">${formatCommentsPreview(present.comments)}</div>` : ''}
                        <small class="text-muted">${present.created_at ? new Date(present.created_at).toLocaleDateString('pl-PL') : ''}</small>
                    </div>
                </div>
                <div class="present-actions d-flex flex-column" style="gap: 6px; flex-shrink: 0;">
                    ${generateReservationButton(present)}
                </div>
            </div>
        </div>
    `;

    let html = `<div class="presents-list presents-list-container">`;

    // Add not bought presents
    html += sortedNotBought.map((present, index) => generatePresentItem(present, index)).join('');

    // Add bought presents in accordion if there are any
    if (sortedBought.length > 0) {
        const accordionId = `accordion-bought-${Math.random().toString(36).substr(2, 9)}`;
        html += `
            <div class="accordion mt-3" id="${accordionId}">
                <div class="accordion-item">
                    <h2 class="accordion-header">
                        <button class="accordion-button" type="button" data-bs-toggle="collapse" data-bs-target="#${accordionId}-collapse" aria-expanded="true" aria-controls="${accordionId}-collapse" style="background-color: #f8f9fa; color: #28a745; font-weight: 600;">
                            <i class="fas fa-check-circle me-2" style="color: #28a745;"></i>Kupione (${sortedBought.length})
                        </button>
                    </h2>
                    <div id="${accordionId}-collapse" class="accordion-collapse collapse show" data-bs-parent="#${accordionId}">
                        <div class="accordion-body p-0">
                            ${sortedBought.map((present, index) => generatePresentItem(present, index)).join('')}
                        </div>
                    </div>
                </div>
            </div>
        `;
    }

    html += `</div>`;

    // Calculate container height after rendering
    setTimeout(() => {
        calculateContainerHeight();
    }, 100);

    return html;
}

function togglePresentFromRecipients(id, isChecked) {
    const presentItem = document.querySelector(`[data-id="${id}"]`);
    if (!presentItem) {
        console.error('Present item not found:', id);
        return;
    }

    // Prevent multiple clicks during animation
    if (presentItem.classList.contains('animating')) {
        return;
    }

    // Add animating state to prevent multiple animations
    presentItem.classList.add('animating');

    // Update the server and state immediately
    updatePresentCheckStatus(id, isChecked, presentItem);

    // Animate the visual movement, then reorder after animation completes
    animatePresentTransition(presentItem, isChecked, () => {
        // Reorder the list after animation completes
        reorderPresentsList();
        // Remove animating state
        presentItem.classList.remove('animating');
    });
}

// Separate function to update the server after animation
function updatePresentCheckStatus(id, isChecked, presentItem) {
    // Optimistically update the cached data
    if (window._dataCache && window._dataCache.presents) {
        const present = window._dataCache.presents.find(p => p.id === id);
        if (present) {
            present.is_checked = isChecked;
        }
    }

    // Update the UI immediately
    if (isChecked) {
        presentItem.classList.add('checked');
    } else {
        presentItem.classList.remove('checked');
    }

    fetch(`/api/presents/${id}/check`, {
        method: 'PUT',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({ is_checked: isChecked })
    })
        .then(response => response.json())
        .then(data => {
            if (data.success) {
                // Update progress bar without full reload
                updateProgressBar(presentItem);
                presentItem.classList.remove('updating');
                presentItem.classList.remove('animating');

                // Confirmation with undo (only when marking as bought -
                // unchecking is usually itself the correction)
                if (isChecked) {
                    showToast('Oznaczono jako kupione 🛍️', 'success', {
                        label: 'Cofnij',
                        onClick: () => undoCheck(id)
                    });
                }

                // Trigger soft reload to update cache
                if (typeof softReloadRecipients === 'function') {
                    softReloadRecipients();
                }
            } else {
                console.error('Failed to toggle present:', data.error);
                // Revert optimistic update on error
                if (window._dataCache && window._dataCache.presents) {
                    const present = window._dataCache.presents.find(p => p.id === id);
                    if (present) {
                        present.is_checked = !isChecked;
                    }
                }
                // Revert UI
                if (isChecked) {
                    presentItem.classList.remove('checked');
                } else {
                    presentItem.classList.add('checked');
                }
                // Revert checkbox
                const checkbox = presentItem.querySelector('input[type="checkbox"]');
                if (checkbox) {
                    checkbox.checked = !isChecked;
                }
                presentItem.classList.remove('updating');
                presentItem.classList.remove('animating');
            }
        })
        .catch(error => {
            console.error('Error toggling present:', error);
            // Revert optimistic update on error
            if (window._dataCache && window._dataCache.presents) {
                const present = window._dataCache.presents.find(p => p.id === id);
                if (present) {
                    present.is_checked = !isChecked;
                }
            }
            // Revert UI
            if (isChecked) {
                presentItem.classList.remove('checked');
            } else {
                presentItem.classList.add('checked');
            }
            // Revert checkbox
            const checkbox = presentItem.querySelector('input[type="checkbox"]');
            if (checkbox) {
                checkbox.checked = !isChecked;
            }
            presentItem.classList.remove('updating');
            presentItem.classList.remove('animating');
        });
}

// Update progress bar for a specific recipient
function updateProgressBar(presentItem) {
    // Find the recipient container
    const recipientItem = presentItem.closest('.recipient-item');
    if (!recipientItem) return;

    const recipientId = recipientItem.getAttribute('data-id');
    if (!recipientId) return;

    // Get all presents for this recipient from cache
    if (!window._dataCache || !window._dataCache.presents) return;

    const recipientPresents = window._dataCache.presents.filter(p => p.recipient_id == recipientId);
    const checkedPresents = recipientPresents.filter(p => p.is_checked).length;
    const totalPresents = recipientPresents.length;

    // Update the progress bar
    const progressBar = recipientItem.querySelector('.progress-bar');
    if (progressBar && totalPresents > 0) {
        const percentage = (checkedPresents / totalPresents) * 100;
        progressBar.style.width = `${percentage}%`;
    }

    // Update the text
    const progressText = recipientItem.querySelector('.text-muted');
    if (progressText) {
        const icon = progressText.querySelector('i');
        const iconHTML = icon ? icon.outerHTML : '<i class="fas fa-gift me-1"></i>';
        progressText.innerHTML = `${iconHTML}Prezenty: ${checkedPresents}/${totalPresents} zakupione`;
    }

    // Update accordion "Kupione" count
    updateAccordionBoughtCount(recipientItem, checkedPresents);
}

// Update the "Kupione" accordion count
function updateAccordionBoughtCount(recipientItem, checkedPresents) {
    const accordion = recipientItem.querySelector('.accordion-button');
    if (accordion) {
        // Update the count in the accordion button text
        accordion.innerHTML = accordion.innerHTML.replace(/Kupione \(\d+\)/, `Kupione (${checkedPresents})`);
    }
}

// Helper function to animate present transitions
function animatePresentTransition(presentItem, isChecked, callback) {
    const container = presentItem.closest('.presents-list');
    if (!container) {
        if (callback) callback();
        return;
    }

    // Get current position and dimensions
    const rect = presentItem.getBoundingClientRect();
    const containerRect = container.getBoundingClientRect();
    const itemHeight = rect.height;
    const itemTop = rect.top - containerRect.top;

    // Create a clone for the animation
    const clone = presentItem.cloneNode(true);
    clone.style.position = 'absolute';
    clone.style.top = itemTop + 'px';
    clone.style.left = '0';
    clone.style.right = '0';
    clone.style.zIndex = '1000';
    clone.style.pointerEvents = 'none';
    clone.style.opacity = '1'; // Keep the animated item fully opaque
    clone.classList.remove('updating', 'animating');

    // Add to container
    container.style.position = 'relative';
    container.appendChild(clone);

    // Animate the clone
    const targetY = isChecked ? containerRect.height : -itemHeight;
    clone.style.transition = 'all 0.8s ease-out'; // Updated to 0.8s

    // Trigger animation
    setTimeout(() => {
        clone.style.transform = `translateY(${targetY}px)`;
        clone.style.opacity = '0'; // Only fade out at the end
    }, 10);

    // Remove clone after animation and call callback
    setTimeout(() => {
        if (clone.parentNode) {
            clone.parentNode.removeChild(clone);
        }
        // Call the callback function after animation completes
        if (callback) callback();
    }, 800); // Updated to 800ms
}

// Helper function to calculate container height for smooth animations
function calculateContainerHeight() {
    const containers = document.querySelectorAll('.presents-list');
    containers.forEach(container => {
        const items = container.querySelectorAll('.present-item');
        if (items.length > 0) {
            const firstItem = items[0];
            const itemHeight = firstItem.offsetHeight;
            const totalHeight = items.length * itemHeight + (items.length - 1) * 8; // 8px margin
            container.style.minHeight = totalHeight + 'px';
        }
    });
}

// Action buttons implementing the full flow:
// Zarezerwuj -> [Zakupione | Anuluj] -> Anuluj zakup (back to reserved)
function generateReservationButton(present) {
    const uid = Number(window._currentUserId || currentUserId);
    const mine = present.reserved_by != null && Number(present.reserved_by) === uid;

    if (present.is_checked) {
        if (mine) {
            return `
                <button class="btn btn-outline-secondary btn-sm w-100 w-md-auto reserve-btn"
                        onclick="handleBoughtClick(event, ${present.id}, false)"
                        title="Cofnij zakup - wraca do rezerwacji">
                    <i class="fas fa-rotate-left"></i>
                    <span class="ms-1">Anuluj zakup</span>
                </button>
            `;
        }
        return `<span class="badge bg-success align-self-center" style="font-size: 12px;"><i class="fas fa-check me-1"></i>Kupione</span>`;
    }

    if (present.reserved_by) {
        if (mine) {
            // Stacked like the homepage rows - the parent .present-actions
            // column lays these out vertically with equal widths
            return `
                <button class="btn btn-success btn-sm reserve-btn"
                        onclick="handleBoughtClick(event, ${present.id}, true)"
                        title="Oznacz jako kupione"
                        style="white-space: nowrap;">
                    <i class="fas fa-check"></i>
                    <span class="ms-1">Kupione</span>
                </button>
                <button class="btn btn-outline-danger btn-sm"
                        onclick="handleReserveClick(event, ${present.id}, 'cancel')"
                        title="Usuń rezerwację"
                        style="white-space: nowrap;">
                    <i class="fas fa-xmark"></i>
                    <span class="ms-1">Anuluj</span>
                </button>
            `;
        }
        return `
            <button class="btn btn-secondary btn-sm w-100 w-md-auto reserve-btn" 
                    onclick="showReservedByOtherModal(${PrezentyEscape.jsStringAttr(escapeHtml(present.reserved_by_username || 'Nieznany użytkownik'))})" 
                    title="Zarezerwowane przez: ${escapeAttr(present.reserved_by_username || 'Nieznany użytkownik')}">
                <i class="fas fa-bookmark"></i>
                <span class="d-inline d-md-none ms-1">Niedostępne</span>
            </button>
        `;
    }

    return `
        <button class="btn btn-reserve btn-sm w-100 w-md-auto reserve-btn" 
                onclick="handleReserveClick(event, ${present.id}, 'reserve')" 
                title="Zarezerwuj prezent">
            <i class="fas fa-bookmark"></i>
            <span class="ms-1">Zarezerwuj</span>
        </button>
    `;
}

// Re-render one present's action buttons from the current cache state
function refreshPresentButtons(presentId) {
    const item = document.querySelector(`[data-id="${presentId}"]`);
    if (!item || !window._dataCache || !window._dataCache.presents) return;
    const present = window._dataCache.presents.find(p => p.id === presentId);
    if (!present) return;
    const cell = item.querySelector('.present-actions');
    if (cell) cell.innerHTML = generateReservationButton(present);
}

// "Zakupione" / "Anuluj zakup" button flow (replaces the old checkbox).
// Optimistic: cache + item state + buttons update instantly, server syncs
// in the background with a full rollback on failure.
function handleBoughtClick(event, presentId, isChecked) {
    event.preventDefault();
    event.stopPropagation();

    const item = document.querySelector(`[data-id="${presentId}"]`);

    const applyState = (checked) => {
        if (window._dataCache && window._dataCache.presents) {
            const p = window._dataCache.presents.find(x => x.id === presentId);
            if (p) p.is_checked = checked;
        }
        if (item) item.classList.toggle('checked', checked);
        refreshPresentButtons(presentId);
    };

    beginPresentOp();
    applyState(isChecked);
    if (isChecked) {
        showToast('Oznaczono jako kupione 🛍️', 'success', {
            label: 'Cofnij',
            onClick: () => undoCheck(presentId)
        });
    }

    fetch(`/api/presents/${presentId}/check`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_checked: isChecked })
    })
        .then(r => r.json())
        .then(d => {
            if (d.success) {
                if (item && typeof updateProgressBar === 'function') updateProgressBar(item);
                if (typeof reorderPresentsList === 'function') reorderPresentsList();
                if (typeof softReloadRecipients === 'function') softReloadRecipients();
            } else {
                applyState(!isChecked);
                showErrorToast(d.error || 'Nie udało się zapisać zmiany');
            }
        })
        .catch(() => {
            applyState(!isChecked);
            showErrorToast('Błąd połączenia. Zmiana została cofnięta.');
        })
        .finally(() => endPresentOp());
}

// Handle reserve button click with optimistic updates
function handleReserveClick(event, presentId, action) {
    event.preventDefault();
    event.stopPropagation();

    const button = event.currentTarget;
    const presentItem = document.querySelector(`[data-id="${presentId}"]`);

    // Store previous state for potential rollback
    const previousState = {
        reserved_by: null,
        reserved_by_username: null,
        buttonHTML: button.outerHTML,
        itemClasses: presentItem ? presentItem.className : ''
    };

    // Get current state from cache
    if (window._dataCache && window._dataCache.presents) {
        const present = window._dataCache.presents.find(p => p.id === presentId);
        if (present) {
            previousState.reserved_by = present.reserved_by;
            previousState.reserved_by_username = present.reserved_by_username;
        }
    }

    // Count as a pending op BEFORE the optimistic update so any in-flight
    // reload snapshot is invalidated and can't revert what we render now
    beginPresentOp();

    // Perform optimistic updates immediately
    if (presentItem) {
        updatePresentItemOptimistically(presentItem, action);
    }
    updateCacheOptimistically(presentId, action, window._currentUserId);
    // Render the buttons for the new state right away
    refreshPresentButtons(presentId);

    // Make API call with rollback capability (each ends its op when the
    // request settles - see .finally in those functions)
    if (action === 'reserve') {
        reservePresentFromRecipients(presentId, button, previousState);
    } else if (action === 'cancel') {
        cancelReservationFromRecipients(presentId, button, previousState);
    }
}

