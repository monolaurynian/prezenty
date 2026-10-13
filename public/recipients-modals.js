// Modal functions
function openAddPresentModal() {
    // The add-present modal was retired - adding presents lives in the
    // formularz (single, consistent flow on every page). Kept as the
    // target of legacy callers (Ctrl+K shortcut etc.).
    window.location.href = '/formularz';
}

function populateAddPresentModal(recipients, identificationStatus) {
    const select = document.getElementById('recipientSelect');

    // Clear select
    select.innerHTML = '<option value="">Wybierz osobę</option>';

    // Add existing recipients to select
    recipients.forEach(recipient => {
        const option = document.createElement('option');
        option.value = recipient.id;
        option.textContent = recipient.name;
        select.appendChild(option);
    });

    // Add "Add person" option at the end
    const addOption = document.createElement('option');
    addOption.value = 'add_new';
    addOption.textContent = '➕ Dodaj nową osobę';
    select.appendChild(addOption);

    // Default set identified person if user is identified
    if (identificationStatus.isIdentified && identificationStatus.identifiedRecipient) {
        const identifiedId = identificationStatus.identifiedRecipient.id.toString();

        for (let i = 0; i < select.options.length; i++) {
            if (select.options[i].value === identifiedId) {
                select.selectedIndex = i;
                break;
            }
        }
    } else {
        select.selectedIndex = 0; // Select "Wybierz osobę"
    }
}

function addPresentFromModal() {
    const title = document.getElementById('presentTitle').value.trim();
    const recipientId = document.getElementById('recipientSelect').value;
    const comments = document.getElementById('presentComments').value.trim();

    if (!title) {
        showModalMessage('addPresentMessage', 'Nazwa prezentu jest wymagana', 'danger');
        return;
    }

    if (!recipientId) {
        showModalMessage('addPresentMessage', 'Wybierz osobę dla prezentu', 'danger');
        return;
    }

    // Check if user wants to add new person
    if (recipientId === 'add_new') {
        // Close current modal and open add recipient modal
        const addPresentModal = bootstrap.Modal.getInstance(document.getElementById('addPresentModal'));
        addPresentModal.hide();

        // Store form data for later use
        window.pendingPresentData = {
            title: title,
            comments: comments
        };

        // Open add recipient modal
        openAddRecipientModal();
        return;
    }

    // Add the present with existing recipient
    fetch('/api/presents', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            title,
            recipient_id: recipientId,
            comments
        })
    })
        .then(response => response.json())
        .then(data => {
            if (data.id) {
                showModalMessage('addPresentMessage', 'Prezent został dodany!', 'success');
                document.getElementById('addPresentForm').reset();

                // Add the present to DOM immediately
                const newPresent = {
                    id: data.id,
                    title: title,
                    comments: comments,
                    recipient_id: recipientId,
                    reserved_by: null,
                    reserved_by_username: null,
                    is_checked: false,
                    created_by: window._currentUserId
                };

                addPresentToDOM(recipientId, newPresent);

                // Update cache
                if (window._dataCache && window._dataCache.presents) {
                    window._dataCache.presents.push(newPresent);
                }

                // Refresh cache in background
                softReloadRecipients();

                // Close modal after 1 second
                setTimeout(() => {
                    const modal = bootstrap.Modal.getInstance(document.getElementById('addPresentModal'));
                    modal.hide();
                }, 1000);
            } else {
                showModalMessage('addPresentMessage', data.error || 'Błąd podczas dodawania prezentu', 'danger');
            }
        })
        .catch(error => {
            console.error('Error:', error);
            showModalMessage('addPresentMessage', 'Błąd połączenia z serwerem', 'danger');
        });
}

function openReservedPresentsModal() {
    // Load reserved presents
    fetch('/api/presents/all')
        .then(response => response.json())
        .then(presents => {
            const reservedPresents = presents.filter(present => present.reserved_by === currentUserId);
            displayReservedPresentsInModal(reservedPresents);

            // Show modal
            const modal = new bootstrap.Modal(document.getElementById('reservedPresentsModal'));
            modal.show();
        })
        .catch(error => {
            console.error('Error loading presents:', error);
            showErrorModal('Błąd podczas ładowania prezentów');
        });
}

function displayReservedPresentsInModal(presents) {
    const container = document.getElementById('reservedPresentsList');

    if (presents.length === 0) {
        container.innerHTML = `
            <div class="text-center text-muted">
                <i class="fas fa-bookmark fa-3x mb-3"></i>
                <p>Nie masz żadnych zarezerwowanych prezentów</p>
            </div>
        `;
        return;
    }

    // Separate presents into two categories
    const uncheckedPresents = presents.filter(present => !present.is_checked);
    const checkedPresents = presents.filter(present => present.is_checked);

    container.innerHTML = `
        <div class="row g-3">
            <!-- Do kupienia -->
            <div class="col-md-6">
                <div class="card">
                    <div class="card-header d-flex justify-content-between align-items-center" style="background-color: #fff3cd; border-color: #ffeaa7;">
                        <div>
                            <i class="fas fa-shopping-cart me-2"></i>
                            <strong>Do kupienia</strong>
                        </div>
                        <span class="badge bg-warning text-dark">${uncheckedPresents.length}</span>
                    </div>
                    <div class="card-body">
                        ${uncheckedPresents.length === 0 ?
            '<p class="text-muted text-center">Brak prezentów do kupienia</p>' :
            uncheckedPresents.map(present => `
                                <div class="present-item-modal card mb-2" data-id="${present.id}">
                                    <div class="card-body p-3">
                                        <div class="row align-items-center">
                                            <div class="col-1">
                                                <div class="form-check">
                                                    <input class="form-check-input" type="checkbox" 
                                                           ${present.is_checked ? 'checked' : ''} 
                                                           onchange="togglePresentFromModal(${present.id}, this.checked)">
                                                </div>
                                            </div>
                                            <div class="col-11">
                                                <h6 class="mb-1">${convertUrlsToLinks(escapeHtml(present.title))}</h6>
                                                <small class="text-muted">Dla: ${escapeHtml(present.recipient_name)}</small>
                                                ${typeof present.comments === 'string' && present.comments.trim().length > 0
                    ? `
                                                    <div class="mt-2">
                                                        <div class="card card-body p-2" style="background: #f8f9fa; min-height: 80px; max-height: 220px; overflow-y: auto;">
                                                            <small class="text-muted" style="white-space: pre-line;">${escapeHtml(present.comments)}</small>
                                                        </div>
                                                    </div>
                                                `
                    : ''
                }
                                                ${present.comments && typeof present.comments !== 'string'
                    ? `<div class="alert alert-danger mt-2 p-2">Błąd: nieprawidłowy format komentarza</div>`
                    : ''
                }
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            `).join('')
        }
                    </div>
                </div>
            </div>
            
            <!-- Kupione -->
            <div class="col-md-6">
                <div class="card">
                    <div class="card-header d-flex justify-content-between align-items-center" style="background-color: #d4edda; border-color: #c3e6cb;">
                        <div>
                            <i class="fas fa-check-circle me-2"></i>
                            <strong>Kupione</strong>
                        </div>
                        <span class="badge bg-success">${checkedPresents.length}</span>
                    </div>
                    <div class="card-body">
                        ${checkedPresents.length === 0 ?
            '<p class="text-muted text-center">Brak kupionych prezentów</p>' :
            checkedPresents.map(present => `
                                <div class="present-item-modal card mb-2 checked" data-id="${present.id}">
                                    <div class="card-body p-3">
                                        <div class="row align-items-center">
                                            <div class="col-1">
                                                <div class="form-check">
                                                    <input class="form-check-input" type="checkbox" 
                                                           ${present.is_checked ? 'checked' : ''} 
                                                           onchange="togglePresentFromModal(${present.id}, this.checked)">
                                                </div>
                                            </div>
                                            <div class="col-11">
                                                <h6 class="mb-1">${convertUrlsToLinks(escapeHtml(present.title))}</h6>
                                                <small class="text-muted">Dla: ${escapeHtml(present.recipient_name)}</small>
                                                ${present.comments ? `<br><small class="text-muted">${escapeHtml(present.comments)}</small>` : ''}
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            `).join('')
        }
                    </div>
                </div>
            </div>
        </div>
    `;
}

function togglePresentFromModal(id, isChecked) {
    const presentItem = document.querySelector(`.present-item-modal[data-id="${id}"]`);
    if (!presentItem) {
        console.error('Present item not found in modal:', id);
        return;
    }

    // Prevent multiple clicks during animation
    if (presentItem.classList.contains('animating')) {
        return;
    }

    // Add animating state to prevent multiple animations
    presentItem.classList.add('animating');

    // Update the server and state immediately
    updateModalPresentCheckStatus(id, isChecked, presentItem);

    // Animate the visual movement, then reorder after animation completes
    animateModalPresentTransition(presentItem, isChecked, () => {
        // Reorder the modal list after animation completes
        reorderModalPresentsList();
        // Remove animating state
        presentItem.classList.remove('animating');
    });
}

// Separate function to update the server after modal animation
function updateModalPresentCheckStatus(id, isChecked, presentItem) {
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
                // Remove updating state
                presentItem.classList.remove('updating');
                presentItem.classList.remove('animating');

                // Update badge counts without full reload
                updateModalBadgeCounts();
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

// Update badge counts in modal without full reload
function updateModalBadgeCounts() {
    if (!window._dataCache || !window._dataCache.presents) return;

    const currentUserId = window._currentUserId;
    const reservedPresents = window._dataCache.presents.filter(p => p.reserved_by === currentUserId);
    const uncheckedPresents = reservedPresents.filter(p => !p.is_checked);
    const checkedPresents = reservedPresents.filter(p => p.is_checked);

    // Update badges
    const uncheckedBadge = document.querySelector('#reservedPresentsModal .card-header .badge.bg-warning');
    const checkedBadge = document.querySelector('#reservedPresentsModal .card-header .badge.bg-success');

    if (uncheckedBadge) {
        uncheckedBadge.textContent = uncheckedPresents.length;
    }
    if (checkedBadge) {
        checkedBadge.textContent = checkedPresents.length;
    }
}

// Helper function to animate present transitions in modal
function animateModalPresentTransition(presentItem, isChecked, callback) {
    const container = presentItem.closest('.card-body');
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

function cancelReservationFromModal(presentId) {
    if (confirm('Czy na pewno chcesz anulować rezerwację tego prezentu?')) {
        fetch(`/api/presents/${presentId}/reserve`, {
            method: 'DELETE'
        })
            .then(response => response.json())
            .then(data => {
                if (data.success) {
                    // Refresh the reserved presents list
                    openReservedPresentsModal();
                } else {
                    showErrorModal(data.error || 'Błąd podczas anulowania rezerwacji');
                }
            })
            .catch(error => {
                console.error('Error:', error);
                showErrorModal('Błąd połączenia z serwerem');
            });
    }
}

function openAddRecipientModal() {
    // Clear form
    document.getElementById('addRecipientForm').reset();
    document.getElementById('addRecipientMessage').style.display = 'none';

    // Show modal
    const modal = new bootstrap.Modal(document.getElementById('addRecipientModal'));
    modal.show();

    // Auto-focus on name input after modal is shown
    document.getElementById('addRecipientModal').addEventListener('shown.bs.modal', function () {
        document.getElementById('recipientName').focus();
    }, { once: true });
}

function addRecipientFromModal() {
    const name = document.getElementById('recipientName').value.trim();

    if (!name) {
        showModalMessage('addRecipientMessage', 'Nazwa jest wymagana', 'danger');
        return;
    }

    fetch('/api/recipients', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({ name })
    })
        .then(response => response.json())
        .then(data => {
            if (data.success && data.recipient) {
                // Close add recipient modal
                const addRecipientModal = bootstrap.Modal.getInstance(document.getElementById('addRecipientModal'));
                addRecipientModal.hide();

                // Check if we have pending present data
                if (window.pendingPresentData) {
                    // Return to add present modal with the new recipient selected
                    returnToAddPresentModalWithNewRecipient(data.recipient.id, name);
                } else {
                    // Normal flow - just show success message and refresh list
                    showModalMessage('addRecipientMessage', 'Osoba została dodana!', 'success');
                    document.getElementById('addRecipientForm').reset();

                    // Clear cache and refresh the recipients list to show the new person
                    clearRecipientsCache();
                    softReloadRecipients();

                    // Close modal after 1 second
                    setTimeout(() => {
                        const modal = bootstrap.Modal.getInstance(document.getElementById('addRecipientModal'));
                        modal.hide();
                    }, 1000);
                }
            } else {
                showModalMessage('addRecipientMessage', data.error || 'Błąd podczas dodawania osoby', 'danger');
            }
        })
        .catch(error => {
            console.error('Error:', error);
            showModalMessage('addRecipientMessage', 'Błąd połączenia z serwerem', 'danger');
        });
}

function returnToAddPresentModalWithNewRecipient(recipientId, recipientName) {
    // Reload recipients and open add present modal
    Promise.all([
        fetch('/api/recipients').then(response => response.json()),
        fetch('/api/user/identification').then(response => response.json())
    ])
        .then(([recipients, identificationStatus]) => {
            const select = document.getElementById('recipientSelect');

            // Clear select
            select.innerHTML = '<option value="">Wybierz osobę</option>';

            // Add existing recipients to select
            recipients.forEach(recipient => {
                const option = document.createElement('option');
                option.value = recipient.id;
                option.textContent = recipient.name;
                select.appendChild(option);
            });

            // Add "Add person" option at the end
            const addOption = document.createElement('option');
            addOption.value = 'add_new';
            addOption.textContent = '➕ Dodaj nową osobę';
            select.appendChild(addOption);

            // Restore form data
            document.getElementById('presentTitle').value = window.pendingPresentData.title;
            document.getElementById('presentComments').value = window.pendingPresentData.comments;

            // Select the newly added recipient
            for (let i = 0; i < select.options.length; i++) {
                if (select.options[i].value === recipientId.toString()) {
                    select.selectedIndex = i;
                    break;
                }
            }

            // Clear pending data
            delete window.pendingPresentData;

            // Clear any previous messages
            document.getElementById('addPresentMessage').style.display = 'none';

            // Show modal
            const modal = new bootstrap.Modal(document.getElementById('addPresentModal'));
            modal.show();
        })
        .catch(error => {
            console.error('Error loading recipients:', error);
            showErrorModal('Błąd podczas ładowania listy osób');
        });
}

function showModalMessage(elementId, message, type) {
    const element = document.getElementById(elementId);
    element.textContent = message;
    element.className = `alert alert-${type} mt-3`;
    element.style.display = 'block';
}

