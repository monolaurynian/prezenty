let currentUserId = null;
let currentRecipientId = null;
let pendingIdentificationRecipientId = null;

document.addEventListener('DOMContentLoaded', function() {
    // Check authentication first, then load data
    checkAuth().then(() => {
        // Load recipients with their presents after auth is confirmed
    loadRecipientsWithPresents();
    }).catch(error => {
        console.error('Auth failed:', error);
        window.location.href = '/';
    });
    

    
    // Profile picture preview
    const profilePictureUrl = document.getElementById('profilePictureUrl');
    profilePictureUrl.addEventListener('input', function() {
        const preview = document.getElementById('profilePicturePreview');
        const url = this.value.trim();
        
        if (url) {
            preview.src = url;
            preview.style.display = 'block';
            preview.onerror = function() {
                preview.style.display = 'none';
            };
        } else {
            preview.style.display = 'none';
        }
    });
});

function checkAuth() {
    return fetch('/api/auth')
    .then(response => response.json())
    .then(data => {
        if (!data.authenticated) {
            throw new Error('Not authenticated');
        } else {
            currentUserId = data.user.id;
            console.log('Auth successful, currentUserId set to:', currentUserId);
        }
    })
    .catch(error => {
        console.error('Auth check error:', error);
        throw error;
    });
}

function loadRecipientsWithPresents() {
    console.log('Loading recipients and presents...');
    
    // Load both recipients and presents
    Promise.all([
        fetch('/api/recipients').then(response => {
            console.log('Recipients response status:', response.status);
            if (!response.ok) {
                if (response.status === 401) {
                    window.location.href = '/';
                    throw new Error('Unauthorized');
                }
                throw new Error('Network response was not ok');
            }
            return response.json();
        }),
        // Load presents directly without identification logic
        fetch('/api/presents/all').then(response => {
            console.log('Presents response status:', response.status);
            if (!response.ok) {
                if (response.status === 401) {
                    window.location.href = '/';
                    throw new Error('Unauthorized');
                }
                throw new Error('Network response was not ok');
            }
            return response.json();
        }),
        // Check identification status
        fetch('/api/user/identification-status').then(response => {
            if (!response.ok) {
                throw new Error('Failed to check identification status');
            }
            return response.json();
        })
    ])
    .then(([recipientsResponse, presentsResponse, identificationStatus]) => {
        console.log('Data loaded successfully:', { 
            recipientsResponse: recipientsResponse, 
            presentsResponse: presentsResponse,
            identificationStatus: identificationStatus
        });
        
        // Check for error responses
        if (recipientsResponse.error) {
            console.error('Recipients API error:', recipientsResponse.error);
            throw new Error('Error loading recipients: ' + recipientsResponse.error);
        }
        
        if (presentsResponse.error) {
            console.error('Presents API error:', presentsResponse.error);
            throw new Error('Error loading presents: ' + presentsResponse.error);
        }
        
        // Extract arrays from responses
        const recipients = Array.isArray(recipientsResponse) ? recipientsResponse : (recipientsResponse.recipients || []);
        const presents = Array.isArray(presentsResponse) ? presentsResponse : [];
        
        console.log('Extracted data:', { 
            recipients: recipients.length, 
            presents: presents.length 
        });
        
        // Additional validation
        if (!recipients || !presents) {
            console.error('Invalid data received:', { recipients, presents });
            throw new Error('Invalid data received from server');
        }
        
        displayRecipientsWithPresents(recipients, presents);
        
        // Check if user needs to identify themselves
        console.log('Checking identification status:', {
            isIdentified: identificationStatus.isIdentified,
            username: identificationStatus.username,
            recipientsLength: recipients.length
        });
        
        if (!identificationStatus.isIdentified) {
            console.log('User is not identified, checking for matching recipient...');
            
            // Find the first recipient that matches the user's username
            const matchingRecipient = recipients.find(recipient => 
                recipient.name.toLowerCase() === identificationStatus.username?.toLowerCase()
            );
            
            console.log('Matching recipient found:', matchingRecipient);
            
            if (matchingRecipient) {
                console.log('Found matching recipient, showing identification modal...');
                // Auto-show identification modal
                setTimeout(() => {
                    identifyAsRecipient(matchingRecipient.id, matchingRecipient.name);
                }, 1000); // Small delay to ensure page is loaded
            } else {
                // No matching recipient found - show selection modal immediately
                console.log('No matching recipient found, showing selection modal...');
                setTimeout(() => {
                    console.log('About to call showRecipientSelectionModal()');
                    showRecipientSelectionModal();
                }, 1000); // Small delay to ensure page is loaded
            }
        } else {
            console.log('User is already identified, no modal needed');
        }
    })
    .catch(error => {
        console.error('Error loading data:', error);
        if (error.message !== 'Unauthorized') {
            document.getElementById('recipientsList').innerHTML = 
                '<div class="alert alert-danger">Błąd podczas ładowania danych. Spróbuj odświeżyć stronę.</div>';
        }
    });
}

function displayRecipientsWithPresents(recipients, presents) {
    const recipientsList = document.getElementById('recipientsList');
    
    console.log('displayRecipientsWithPresents called with:', { 
        recipients: recipients, 
        presents: presents,
        recipientsLength: recipients?.length,
        presentsLength: presents?.length
    });
    
    // Ensure both recipients and presents are arrays
    if (!Array.isArray(recipients)) {
        console.error('recipients is not an array:', recipients);
        recipients = [];
    }
    
    if (!Array.isArray(presents)) {
        console.error('presents is not an array:', presents);
        presents = [];
    }
    
    if (recipients.length === 0) {
        recipientsList.innerHTML = `
            <div class="text-center text-muted">
                <i class="fas fa-users fa-3x mb-3"></i>
                <p>Brak osób na liście. Dodaj pierwszą osobę!</p>
            </div>
        `;
        return;
    }
    
    // Sort recipients: identified users first, then alphabetically
    const sortedRecipients = recipients.sort((a, b) => {
        const aIsIdentified = currentUserId && a.identified_by === currentUserId;
        const bIsIdentified = currentUserId && b.identified_by === currentUserId;
        
        if (aIsIdentified && !bIsIdentified) return -1;
        if (!aIsIdentified && bIsIdentified) return 1;
        
        // If both are identified or both are not identified, sort alphabetically
        return a.name.localeCompare(b.name);
    });
    
    // Check if anyone is identified
    const hasAnyIdentification = recipients.some(recipient => recipient.identified_by !== null);
    
    // Group presents by recipient
    const presentsByRecipient = {};
    presents.forEach(present => {
        const recipientId = present.recipient_id;
        if (!presentsByRecipient[recipientId]) {
            presentsByRecipient[recipientId] = [];
        }
        presentsByRecipient[recipientId].push(present);
    });
    
    recipientsList.innerHTML = sortedRecipients.map(recipient => {
        const recipientPresents = presentsByRecipient[recipient.id] || [];
        const checkedPresents = recipientPresents.filter(p => p.is_checked).length;
        const totalPresents = recipientPresents.length;
        
        console.log('Processing recipient:', {
            id: recipient.id,
            name: recipient.name,
            identified_by: recipient.identified_by,
            currentUserId: currentUserId,
            isIdentified: recipient.identified_by === currentUserId
        });
        
        const isIdentified = currentUserId && recipient.identified_by === currentUserId;
        const isIdentifiedByOther = recipient.identified_by && currentUserId && recipient.identified_by !== currentUserId;
        
        // Show surprise note for identified user, otherwise show presents
        const presentsHTML = isIdentified ? 
            `<div class="alert alert-info mb-0">
                <i class="fas fa-gift me-2"></i>
                <strong>Nie mogę Ci pokazać czy prezenty dla Ciebie już zostały kupione. Chyba nie chcesz sobie zepsuć niespodzianki? 🤔</strong>
            </div>` :
            (recipientPresents.length > 0 ? 
            generatePresentsList(recipientPresents) : 
                '<p class="text-muted mb-0">Brak prezentów dla tej osoby</p>'
            );
        
        const profilePictureHTML = generateProfilePictureHTML(recipient, isIdentified);
        
        return `
            <div class="recipient-item" data-id="${recipient.id}" id="recipient-${recipient.id}">
                <div class="row">
                    <div class="col-md-2 text-center">
                        <div class="recipient-avatar">
                            ${recipient.profile_picture && recipient.profile_picture.trim() !== '' ? 
                                `<img src="${escapeHtml(recipient.profile_picture)}" alt="Zdjęcie profilowe" class="img-fluid" onclick="openProfilePicturePreview(${recipient.id})" style="cursor: pointer;">` :
                                `<div class="profile-picture-placeholder" onclick="openProfileModal(${recipient.id})" style="cursor: pointer;">
                                    <i class="fas fa-user"></i>
                                </div>`
                            }
                        </div>
                    </div>
                    <div class="col-md-6">
                        <div class="d-flex align-items-center mb-2">
                            <h5 class="recipient-name mb-0 me-3">
                                <i class="fas fa-user me-2"></i>
                                ${escapeHtml(recipient.name)}
                            </h5>
                            ${isIdentified ? `
                                <button class="btn btn-outline-success btn-sm w-100" onclick="cancelIdentification(${recipient.id}, '${escapeHtml(recipient.name)}')">
                                    <i class="fas fa-check-circle me-1"></i>To jest Twój profil
                                </button>
                            ` : ''}
                        </div>
                        ${isIdentifiedByOther ? `
                            <div class="alert alert-warning py-2 px-3 mb-3">
                                <i class="fas fa-user-check me-1"></i>
                                <small>Zidentyfikowane przez: ${escapeHtml(recipient.identified_by_username || 'nieznany użytkownik')}</small>
                            </div>
                        ` : !isIdentified && !hasAnyIdentification ? `
                            <div class="d-flex align-items-center mb-3">
                                <button class="btn btn-outline-success btn-sm w-100" onclick="identifyAsRecipient(${recipient.id}, '${escapeHtml(recipient.name)}')">
                                    <i class="fas fa-user-check me-1"></i>To jestem ja
                                </button>
                            </div>
                        ` : ''}
                        ${!isIdentified ? `
                        <div class="mb-3">
                            <small class="text-muted">
                                <i class="fas fa-gift me-1"></i>
                                Prezenty: ${checkedPresents}/${totalPresents} zakupione
                            </small>
                            ${totalPresents > 0 ? `
                                <div class="progress mt-2" style="height: 6px;">
                                    <div class="progress-bar bg-success" style="width: ${(checkedPresents / totalPresents) * 100}%"></div>
                                </div>
                            ` : ''}
                        </div>
                        ` : ''}
                        <div class="presents-preview">
                            ${presentsHTML}
                        </div>
                    </div>
                    <div class="col-md-4 text-end">
                        <div class="btn-group-vertical w-100">
                            ${!isIdentifiedByOther ? `
                                <button class="btn btn-outline-primary btn-sm" onclick="openChangePictureModal(${recipient.id})">
                                    <i class="fas fa-camera me-1"></i>Zmień zdjęcie
                                </button>
                            ` : ''}
                        </div>
                    </div>
                </div>
            </div>
        `;
    }).join('');
}

function generateProfilePictureHTML(recipient, isIdentified) {
    const presents = window._allPresentsByRecipient && window._allPresentsByRecipient[recipient.id] ? window._allPresentsByRecipient[recipient.id] : [];
    const clickHandler = `onclick="showRecipientDetailsFromList(${recipient.id})" style="cursor:pointer;"`;
    if (recipient.profile_picture && recipient.profile_picture.trim() !== '') {
        return `<div class="profile-picture-wrapper mb-2 ${isIdentified ? 'identified' : ''}" ${clickHandler}>
            <img src="${escapeHtml(recipient.profile_picture)}" alt="Zdjęcie profilowe" class="img-fluid">
        </div>`;
    } else {
        return `<div class="profile-picture-wrapper mb-2 ${isIdentified ? 'identified' : ''}" ${clickHandler}>
            <div class="profile-picture-placeholder">
                <i class="fas fa-user"></i>
            </div>
        </div>`;
    }
}

function identifyAsRecipient(recipientId, recipientName) {
    pendingIdentificationRecipientId = recipientId;
    document.getElementById('identificationRecipientName').textContent = recipientName;
    
    const modal = new bootstrap.Modal(document.getElementById('selfIdentificationModal'));
    modal.show();
}

function confirmSelfIdentification() {
    if (!pendingIdentificationRecipientId) return;
    
    fetch(`/api/recipients/${pendingIdentificationRecipientId}/identify`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        }
    })
    .then(response => response.json())
    .then(data => {
        if (data.success) {
            showSuccessMessage('Pomyślnie zidentyfikowano!');
            loadRecipientsWithPresents();
            
            // Close the modal
            const modal = bootstrap.Modal.getInstance(document.getElementById('selfIdentificationModal'));
            modal.hide();
        } else {
            showErrorModal(data.error || 'Błąd podczas identyfikacji');
        }
    })
    .catch(error => {
        console.error('Error:', error);
        showErrorModal('Błąd połączenia z serwerem');
    });
}

function deleteRecipientFromModal() {
    if (!pendingIdentificationRecipientId) return;
    
    // Get the recipient name from the modal
    const recipientName = document.getElementById('identificationRecipientName').textContent;
    
    // Close the self-identification modal
    const modal = bootstrap.Modal.getInstance(document.getElementById('selfIdentificationModal'));
    modal.hide();
    
    // Show the confirmation modal
    document.getElementById('confirmDeleteRecipientModalBody').innerHTML = `
        <p>Czy na pewno chcesz usunąć osobę <strong>${escapeHtml(recipientName)}</strong>?</p>
        <p class="text-muted">Ta operacja jest nieodwracalna i usunie wszystkie prezenty tej osoby.</p>
    `;
    
    // Store the recipient ID for deletion
    window.pendingDeleteRecipientId = pendingIdentificationRecipientId;
    window.pendingDeleteRecipientName = recipientName;
    
    const confirmModal = new bootstrap.Modal(document.getElementById('confirmDeleteRecipientModal'));
    confirmModal.show();
}

function showRecipientSelectionModal() {
    console.log('showRecipientSelectionModal() called');
    
    // Close the self-identification modal and move focus out
    const selfIdentificationModal = bootstrap.Modal.getInstance(document.getElementById('selfIdentificationModal'));
    if (selfIdentificationModal) {
        console.log('Closing self-identification modal');
        // Move focus to body before hiding modal to prevent aria-hidden issues
        document.body.focus();
        selfIdentificationModal.hide();
    }
    
    // Load available recipients and show selection modal
    console.log('Fetching recipients for selection modal...');
    fetch('/api/recipients')
    .then(response => response.json())
    .then(recipients => {
        console.log('Recipients loaded for selection modal:', recipients);
        const availableRecipientsList = document.getElementById('availableRecipientsList');
        
        // Filter out already identified recipients
        const availableRecipients = recipients.filter(recipient => !recipient.identified_by);
        console.log('Available recipients (not identified):', availableRecipients);
        
        if (availableRecipients.length === 0) {
            availableRecipientsList.innerHTML = `
                <div class="alert alert-info">
                    <i class="fas fa-info-circle me-2"></i>
                    Wszystkie osoby są już zidentyfikowane. Dodaj nową osobę poniżej.
                </div>
            `;
        } else {
            availableRecipientsList.innerHTML = availableRecipients.map(recipient => `
                <div class="list-group-item list-group-item-action d-flex justify-content-between align-items-center">
                    <div>
                        <i class="fas fa-user me-2"></i>
                        <strong>${escapeHtml(recipient.name)}</strong>
                    </div>
                    <button class="btn btn-outline-success btn-sm" onclick="identifyAsRecipientFromSelection(${recipient.id}, '${escapeHtml(recipient.name)}')">
                        <i class="fas fa-check me-1"></i>To jestem ja
                    </button>
                </div>
            `).join('');
        }
        
        // Show the selection modal
        console.log('Showing recipient selection modal...');
        const selectionModal = new bootstrap.Modal(document.getElementById('recipientSelectionModal'));
        selectionModal.show();
        console.log('Recipient selection modal should be visible now');
    })
    .catch(error => {
        console.error('Error loading recipients:', error);
        showErrorModal('Błąd podczas ładowania listy osób');
    });
}

function identifyAsRecipientFromSelection(recipientId, recipientName) {
    // Close the selection modal and move focus out
    const selectionModal = bootstrap.Modal.getInstance(document.getElementById('recipientSelectionModal'));
    // Move focus to body before hiding modal to prevent aria-hidden issues
    document.body.focus();
    selectionModal.hide();
    
    // Identify as the selected recipient
    fetch(`/api/recipients/${recipientId}/identify`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        }
    })
    .then(response => response.json())
    .then(data => {
        if (data.success) {
            showSuccessMessage(`Pomyślnie zidentyfikowano jako ${recipientName}!`);
            loadRecipientsWithPresents();
        } else {
            showErrorModal(data.error || 'Błąd podczas identyfikacji');
        }
    })
    .catch(error => {
        console.error('Error:', error);
        showErrorModal('Błąd połączenia z serwerem');
    });
}

function addNewRecipientAndIdentify() {
    const newRecipientName = document.getElementById('newRecipientName').value.trim();
    
    if (!newRecipientName) {
        showModalMessage('recipientSelectionMessage', 'Wprowadź imię i nazwisko', 'danger');
        return;
    }
    
    // Add new recipient
    fetch('/api/recipients', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({ name: newRecipientName })
    })
    .then(response => response.json())
    .then(data => {
        if (data.success) {
            // Close the selection modal and move focus out
            const selectionModal = bootstrap.Modal.getInstance(document.getElementById('recipientSelectionModal'));
            // Move focus to body before hiding modal to prevent aria-hidden issues
            document.body.focus();
            selectionModal.hide();
            
            // Identify as the newly created recipient
            return fetch(`/api/recipients/${data.recipient.id}/identify`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                }
            });
        } else {
            throw new Error(data.error || 'Błąd podczas dodawania osoby');
        }
    })
    .then(response => response.json())
    .then(data => {
        if (data.success) {
            showSuccessMessage(`Pomyślnie dodano i zidentyfikowano jako ${newRecipientName}!`);
            loadRecipientsWithPresents();
        } else {
            showErrorModal(data.error || 'Błąd podczas identyfikacji');
        }
    })
    .catch(error => {
        console.error('Error:', error);
        showModalMessage('recipientSelectionMessage', error.message || 'Błąd połączenia z serwerem', 'danger');
    });
}

function cancelIdentification(recipientId, recipientName) {
    pendingIdentificationRecipientId = recipientId;
    document.getElementById('cancelIdentificationRecipientName').textContent = recipientName;
    
    const modal = new bootstrap.Modal(document.getElementById('cancelIdentificationModal'));
    modal.show();
}

function confirmCancelIdentification() {
    if (!pendingIdentificationRecipientId) return;
    
    fetch(`/api/recipients/${pendingIdentificationRecipientId}/identify`, {
        method: 'DELETE',
        headers: {
            'Content-Type': 'application/json',
        }
    })
    .then(response => response.json())
    .then(data => {
        if (data.success) {
            showSuccessMessage('Identyfikacja została anulowana!');
            loadRecipientsWithPresents();
            
            // Close the modal
            const modal = bootstrap.Modal.getInstance(document.getElementById('cancelIdentificationModal'));
            modal.hide();
        } else {
            showErrorModal(data.error || 'Błąd podczas anulowania identyfikacji');
        }
    })
    .catch(error => {
        console.error('Error:', error);
        showErrorModal('Błąd połączenia z serwerem');
    });
}

function showErrorModal(message) {
    document.getElementById('errorModalMessage').textContent = message;
    const modal = new bootstrap.Modal(document.getElementById('errorModal'));
    modal.show();
}

function showSuccessMessage(message) {
    // Show success message as a temporary alert
    const alertDiv = document.createElement('div');
    alertDiv.className = 'alert alert-success alert-dismissible fade show position-fixed';
    alertDiv.style.cssText = 'top: 20px; right: 20px; z-index: 9999; min-width: 300px;';
    alertDiv.innerHTML = `
        <i class="fas fa-check-circle me-2"></i>${message}
        <button type="button" class="btn-close" data-bs-dismiss="alert"></button>
    `;
    document.body.appendChild(alertDiv);
    
    // Auto-remove after 3 seconds
    setTimeout(() => {
        if (alertDiv.parentNode) {
            alertDiv.remove();
        }
    }, 3000);
}

function openProfileModal(recipientId) {
    const recipient = window._allRecipients.find(r => r.id === recipientId);
    if (!recipient) return;
    
    const profileImg = document.getElementById('profileModalImage');
    const profileName = document.getElementById('profileModalName');
    
    if (profileImg && profileName) {
        profileName.textContent = recipient.name;
        
        if (recipient.profile_picture && recipient.profile_picture.trim() !== '') {
            profileImg.src = recipient.profile_picture;
            profileImg.style.display = 'block';
        } else {
            // Show placeholder instead of image
            profileImg.style.display = 'none';
            const placeholder = document.createElement('div');
            placeholder.className = 'profile-picture-placeholder-large';
            placeholder.innerHTML = '<i class="fas fa-user"></i>';
            placeholder.style.width = '200px';
            placeholder.style.height = '200px';
            placeholder.style.fontSize = '4rem';
            placeholder.style.margin = '0 auto';
            
            const container = profileImg.parentElement;
            // Remove any existing placeholder
            const existingPlaceholder = container.querySelector('.profile-picture-placeholder-large');
            if (existingPlaceholder) {
                existingPlaceholder.remove();
            }
            container.appendChild(placeholder);
        }
        
        const modal = new bootstrap.Modal(document.getElementById('profileModal'));
        modal.show();
    }
}

function previewImage(input) {
    const preview = document.getElementById('profilePicturePreview');
    const file = input.files[0];
    
    if (file) {
        const reader = new FileReader();
        reader.onload = function(e) {
            preview.src = e.target.result;
            preview.style.display = 'block';
        };
        reader.readAsDataURL(file);
    } else {
        preview.style.display = 'none';
    }
}

function saveProfilePicture() {
    if (!currentRecipientId) return;
    
    const url = document.getElementById('profilePictureUrl').value.trim();
    const file = document.getElementById('profilePictureFile').files[0];
    
    if (!url && !file) {
        showErrorModal('Wybierz plik lub wprowadź URL zdjęcia');
        return;
    }
    
    if (file) {
        // Check file size (10MB limit)
        const maxSize = 10 * 1024 * 1024; // 10MB in bytes
        if (file.size > maxSize) {
            showErrorModal('Plik jest zbyt duży. Maksymalny rozmiar to 10MB.');
            return;
        }
        
        // Handle file upload
        const reader = new FileReader();
        reader.onload = function(e) {
            saveImageToServer(e.target.result);
        };
        reader.readAsDataURL(file);
    } else if (url) {
        // Handle URL
        saveImageToServer(url);
    }
}

function saveImageToServer(imageData) {
    fetch(`/api/recipients/${currentRecipientId}/profile-picture`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({ profile_picture: imageData })
    })
    .then(response => {
        if (!response.ok) {
            if (response.status === 413) {
                throw new Error('Plik jest zbyt duży. Maksymalny rozmiar to 10MB.');
            }
            return response.json().then(data => {
                throw new Error(data.error || 'Błąd podczas zapisywania zdjęcia');
            });
        }
        return response.json();
    })
    .then(data => {
        if (data.success) {
            showSuccessMessage('Zdjęcie profilowe zostało zapisane!');
            loadRecipientsWithPresents();
            
            // Close the modal
            const modal = bootstrap.Modal.getInstance(document.getElementById('profilePictureModal'));
            modal.hide();
        } else {
            showErrorModal(data.error || 'Błąd podczas zapisywania zdjęcia');
        }
    })
    .catch(error => {
        console.error('Error:', error);
        showErrorModal(error.message || 'Błąd połączenia z serwerem');
    });
}

function generatePresentsList(presents) {
    if (presents.length === 0) {
        return '<p class="text-muted mb-0">Brak prezentów dla tej osoby</p>';
    }
    
    // Sort presents: reserved by current user first, then unchecked, then checked at bottom
    const sortedPresents = presents.sort((a, b) => {
        // First, move checked items to the bottom regardless of reservation status
        if (a.is_checked !== b.is_checked) {
            return a.is_checked ? 1 : -1;
        }
        
        // Then sort by reservation status (reserved by current user first)
        const aReservedByMe = a.reserved_by === currentUserId;
        const bReservedByMe = b.reserved_by === currentUserId;
        
        if (aReservedByMe && !bReservedByMe) return -1;
        if (!aReservedByMe && bReservedByMe) return 1;
        
        // Finally by creation date (newer first)
        return new Date(b.created_at) - new Date(a.created_at);
    });
    
    return `
        <div class="presents-list">
            ${sortedPresents.map(present => `
                <div class="present-item ${present.is_checked ? 'checked' : ''} ${present.reserved_by && present.reserved_by !== currentUserId ? 'reserved-by-other' : ''} ${present.reserved_by === currentUserId ? 'reserved-by-me' : ''}" data-id="${present.id}">
                    <div class="d-flex align-items-center justify-content-between">
                        <div class="d-flex align-items-center">
                            <div class="form-check me-2">
                                <input class="form-check-input" type="checkbox" 
                                       ${present.is_checked ? 'checked' : ''} 
                                       onchange="togglePresentFromRecipients(${present.id}, this.checked)">
                            </div>
                            <div class="flex-grow-1">
                                <h6 class="present-title mb-1">${convertUrlsToLinks(escapeHtml(present.title))}</h6>
                                ${present.comments ? `
                                    <small class="text-muted">${formatCommentsPreview(present.comments)}</small>
                                ` : ''}
                            </div>
                        </div>
                        <div class="d-flex align-items-center">
                            <small class="text-muted me-2 d-none d-md-inline">
                            ${new Date(present.created_at).toLocaleDateString('pl-PL')}
                        </small>
                            ${generateReservationButton(present)}
                        </div>
                    </div>
                </div>
            `).join('')}
        </div>
    `;
}

function togglePresentFromRecipients(id, isChecked) {
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
            // Add slide animation class to the present item
            const presentItem = document.querySelector(`[data-id="${id}"]`);
            if (presentItem) {
                // Use slide-down for checking (moving to bottom), slide-up for unchecking (moving up)
                const animationClass = isChecked ? 'slide-down' : 'slide-up';
                presentItem.classList.add(animationClass);
                // Remove animation class after animation completes
                setTimeout(() => {
                    presentItem.classList.remove(animationClass);
                }, 400);
            }
            // Refresh the recipients list to show updated state
            loadRecipientsWithPresents();
        } else {
            console.error('Failed to toggle present:', data.error);
        }
    })
    .catch(error => {
        console.error('Error toggling present:', error);
    });
}

function generateReservationButton(present) {
    if (present.reserved_by) {
        if (present.reserved_by === currentUserId) {
            return `
                <button class="btn btn-danger btn-sm w-100 w-md-auto" onclick="cancelReservationFromRecipients(${present.id})" title="Usuń rezerwację">
                    <i class="fas fa-xmark"></i>
                    <span class="d-inline d-md-none ms-1">Usuń rezerwację</span>
                </button>
            `;
        } else {
            return `
                <button class="btn btn-secondary btn-sm w-100 w-md-auto" onclick="showReservedByOtherModal('${escapeHtml(present.reserved_by_username || 'Nieznany użytkownik')}')" title="Zarezerwowane przez: ${escapeHtml(present.reserved_by_username || 'Nieznany użytkownik')}">
                    <i class="fas fa-bookmark"></i>
                    <span class="d-inline d-md-none ms-1">Niedostępne</span>
                </button>
            `;
        }
    } else {
        return `
            <button class="btn btn-outline-warning btn-sm w-100 w-md-auto" onclick="reservePresentFromRecipients(${present.id})" title="Zarezerwuj prezent">
                <i class="fas fa-bookmark"></i>
                <span class="d-inline d-md-none ms-1">Zarezerwuj prezent</span>
            </button>
        `;
    }
}

function formatCommentsPreview(comments) {
    // Truncate long comments and make URLs clickable
    const maxLength = 50;
    let truncated = comments.length > maxLength ? 
        comments.substring(0, maxLength) + '...' : comments;
    
    // Convert URLs to clickable links
    const urlRegex = /(https?:\/\/[^\s]+)/g;
    return truncated.replace(urlRegex, '<a href="$1" target="_blank" rel="noopener noreferrer">$1</a>');
}

function convertUrlsToLinks(text) {
    if (!text) return text;
    
    // Convert URLs to clickable links
    const urlRegex = /(https?:\/\/[^\s]+)/g;
    return text.replace(urlRegex, '<a href="$1" target="_blank" rel="noopener noreferrer">$1</a>');
}

function addRecipient() {
    const name = document.getElementById('recipientName').value.trim();
    
    if (!name) {
        showErrorModal('Nazwa jest wymagana');
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
        if (data.id) {
            showSuccessMessage('Osoba została dodana!');
            document.getElementById('recipientForm').reset();
            loadRecipientsWithPresents();
        } else {
            showErrorModal(data.error || 'Błąd podczas dodawania osoby');
        }
    })
    .catch(error => {
        console.error('Error:', error);
        showErrorModal('Błąd połączenia z serwerem');
    });
}

function deleteRecipient(id, name) {
    // Pokaż modal potwierdzenia
    const modal = new bootstrap.Modal(document.getElementById('confirmDeleteRecipientModal'));
    document.getElementById('confirmDeleteRecipientModal').setAttribute('data-recipient-id', id);
    document.getElementById('confirmDeleteRecipientModal').setAttribute('data-recipient-name', name);
    document.getElementById('confirmDeleteRecipientModalBody').textContent = `Czy na pewno chcesz usunąć osobę "${name}"? Ta akcja nie może być cofnięta.`;
    modal.show();
}

// Funkcja do usunięcia osoby po potwierdzeniu
function deleteRecipientConfirmed() {
    const id = document.getElementById('confirmDeleteRecipientModal').getAttribute('data-recipient-id');
    const modal = bootstrap.Modal.getInstance(document.getElementById('confirmDeleteRecipientModal'));
    
    fetch(`/api/recipients/${id}`, {
        method: 'DELETE'
    })
    .then(response => response.json())
    .then(data => {
        if (data.success) {
            modal.hide();
            showSuccessMessage('Osoba została usunięta!');
            loadRecipientsWithPresents();
        } else {
            modal.hide();
            showErrorModal(data.error || 'Błąd podczas usuwania osoby');
        }
    })
    .catch(error => {
        console.error('Error:', error);
        modal.hide();
        showErrorModal('Błąd połączenia z serwerem');
    });
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function logout() {
    fetch('/api/logout', {
        method: 'POST'
    })
    .then(response => response.json())
    .then(data => {
        if (data.success) {
            window.location.href = '/';
        }
    })
    .catch(error => {
        console.error('Logout error:', error);
        window.location.href = '/';
    });
} 

// Modal functions
function openAddPresentModal() {
    // Load recipients for dropdown and check identification status
    Promise.all([
        fetch('/api/recipients').then(response => response.json()),
        fetch('/api/user/identification-status').then(response => response.json())
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
        
        // Clear form
        document.getElementById('addPresentForm').reset();
        document.getElementById('addPresentMessage').style.display = 'none';
        
        // Debug identification status
        console.log('Full identification status:', identificationStatus);
        console.log('isIdentified:', identificationStatus.isIdentified);
        console.log('identifiedRecipient:', identificationStatus.identifiedRecipient);
        
        // Default set identified person if user is identified
        if (identificationStatus.isIdentified && identificationStatus.identifiedRecipient) {
            // Find the index of the identified person in the options
            const identifiedId = identificationStatus.identifiedRecipient.id.toString();
            console.log('User is identified as:', identificationStatus.identifiedRecipient.name, 'with ID:', identifiedId);
            console.log('Dropdown options:', Array.from(select.options).map(opt => ({value: opt.value, text: opt.textContent})));
            
            for (let i = 0; i < select.options.length; i++) {
                console.log('Checking option', i, ':', select.options[i].value, 'vs', identifiedId);
                if (select.options[i].value === identifiedId) {
                    console.log('Found match at index:', i);
                    select.selectedIndex = i;
                    break;
                }
            }
            console.log('Final selected index:', select.selectedIndex);
        } else {
            console.log('User is not identified - condition failed');
            console.log('isIdentified check:', identificationStatus.isIdentified);
            console.log('identifiedRecipient check:', !!identificationStatus.identifiedRecipient);
            select.selectedIndex = 0; // Select "Wybierz osobę"
        }
        
        // Show modal
        const modal = new bootstrap.Modal(document.getElementById('addPresentModal'));
        modal.show();
    })
    .catch(error => {
        console.error('Error loading recipients:', error);
        showErrorModal('Błąd podczas ładowania listy osób');
    });
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
            
            // Refresh the recipients list to show the new present
            loadRecipientsWithPresents();
            
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
        <div class="row">
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
                                <div class="present-item-modal card mb-2">
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
                                <div class="present-item-modal card mb-2 checked">
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
            // Refresh the reserved presents modal to show updated categories
            openReservedPresentsModal();
            
            // Also refresh the main recipients list to sync checkboxes
            loadRecipientsWithPresents();
        } else {
            console.error('Failed to toggle present:', data.error);
        }
    })
    .catch(error => {
        console.error('Error toggling present:', error);
    });
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
        if (data.id) {
            // Close add recipient modal
            const addRecipientModal = bootstrap.Modal.getInstance(document.getElementById('addRecipientModal'));
            addRecipientModal.hide();
            
            // Check if we have pending present data
            if (window.pendingPresentData) {
                // Return to add present modal with the new recipient selected
                returnToAddPresentModalWithNewRecipient(data.id, name);
            } else {
                // Normal flow - just show success message and refresh list
                showModalMessage('addRecipientMessage', 'Osoba została dodana!', 'success');
                document.getElementById('addRecipientForm').reset();
                
                // Refresh the recipients list to show the new person
                loadRecipientsWithPresents();
                
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
        fetch('/api/user/identification-status').then(response => response.json())
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

function reservePresentFromRecipients(presentId) {
    fetch(`/api/presents/${presentId}/reserve`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        }
    })
    .then(response => response.json())
    .then(data => {
        if (data.success) {
            const presentItem = document.querySelector(`[data-id="${presentId}"]`);
            if (presentItem) {
                presentItem.classList.add('smooth-slide-up');
                // Find the card that will be overlapped (the new top card)
                const presentsList = presentItem.parentElement;
                if (presentsList) {
                    const overlappedCard = presentsList.children[0];
                    if (overlappedCard && overlappedCard !== presentItem) {
                        overlappedCard.classList.add('fading');
                        setTimeout(() => {
                            overlappedCard.classList.remove('fading');
                        }, 400);
                    }
                }
                setTimeout(() => {
                    presentItem.classList.remove('smooth-slide-up');
                }, 400);
            }
            // Refresh the recipients list to show updated state
            loadRecipientsWithPresents();
        }
    });
}

function cancelReservationFromRecipients(presentId) {
    fetch(`/api/presents/${presentId}/reserve`, {
        method: 'DELETE',
        headers: {
            'Content-Type': 'application/json',
        }
    })
    .then(response => response.json())
    .then(data => {
        if (data.success) {
            const presentItem = document.querySelector(`[data-id="${presentId}"]`);
            if (presentItem) {
                presentItem.classList.add('smooth-slide-down');
                // Find the card that will be overlapped (the new card below)
                const presentsList = presentItem.parentElement;
                if (presentsList) {
                    const siblings = Array.from(presentsList.children);
                    const idx = siblings.indexOf(presentItem);
                    if (idx < siblings.length - 1) {
                        const overlappedCard = siblings[idx + 1];
                        if (overlappedCard) {
                            overlappedCard.classList.add('fading');
                            setTimeout(() => {
                                overlappedCard.classList.remove('fading');
                            }, 400);
                        }
                    }
                }
                setTimeout(() => {
                    presentItem.classList.remove('smooth-slide-down');
                }, 400);
            }
            // Refresh the recipients list to show updated state
            loadRecipientsWithPresents();
        }
    });
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
        img.src = recipient.profile_picture;
        img.style.display = 'block';
    } else {
        img.src = '';
        img.style.display = 'none';
    }
    const contentDiv = document.getElementById('recipientDetailsContent');
    if (isIdentified) {
        contentDiv.innerHTML = `<div class="alert alert-warning text-center"><b>Co korci Cię żeby zobaczyć czy już ktoś kupił Twoje prezenty??? Wynocha!</b></div>`;
    } else {
        // Sortowanie prezentów: najpierw niekupione i niezarezerwowane, potem zarezerwowane, potem kupione
        const notBought = presents.filter(p => !p.is_checked && !p.reserved_by);
        const reserved = presents.filter(p => !p.is_checked && p.reserved_by);
        const bought = presents.filter(p => p.is_checked);
        function presentRow(p, extraClass = '') {
            return `<div class="present-item ${extraClass}" style="opacity:${extraClass ? '0.5' : '1'};">` +
                `<div class="d-flex align-items-center justify-content-between">` +
                `<div><b>${escapeHtml(p.title)}</b>${p.comments ? `<br><small class='text-muted'>${escapeHtml(p.comments)}</small>` : ''}</div>` +
                `<div><small>${new Date(p.created_at).toLocaleDateString('pl-PL')}</small></div>` +
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
displayRecipientsWithPresents = function(recipients, presents) {
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
document.addEventListener('DOMContentLoaded', function() {
    // Handle modal hidden events to ensure proper focus management
    const modals = document.querySelectorAll('.modal');
    modals.forEach(modal => {
        modal.addEventListener('hidden.bs.modal', function() {
            // Move focus to body when modal is hidden to prevent aria-hidden issues
            document.body.focus();
        });
        
        modal.addEventListener('show.bs.modal', function() {
            // Ensure modal is properly accessible when shown
            this.removeAttribute('aria-hidden');
        });
    });
});

function openChangePictureModal(recipientId) {
    // Store the recipient ID for later use
    window.currentChangingRecipientId = recipientId;
    
    const modal = document.getElementById('changePictureModal');
    if (!modal) {
        console.error('Change picture modal not found');
        return;
    }
    
    // Clear previous form
    document.getElementById('changePictureForm').reset();
    document.getElementById('imagePreview').style.display = 'none';
    
    // Show the modal
    const bootstrapModal = new bootstrap.Modal(modal);
    bootstrapModal.show();
    
    // Add event listener for file input
    const fileInput = document.getElementById('newProfilePicture');
    fileInput.onchange = function() {
        const file = this.files[0];
        if (file) {
            const reader = new FileReader();
            reader.onload = function(e) {
                document.getElementById('previewImage').src = e.target.result;
                document.getElementById('imagePreview').style.display = 'block';
            };
            reader.readAsDataURL(file);
        }
    };
}

function saveNewProfilePicture() {
    const fileInput = document.getElementById('newProfilePicture');
    const file = fileInput.files[0];
    const recipientId = window.currentChangingRecipientId;
    
    if (!file || !recipientId) {
        alert('Proszę wybrać zdjęcie');
        return;
    }
    
    const formData = new FormData();
    formData.append('profile_picture', file);
    
    fetch(`/api/recipients/${recipientId}/profile-picture`, {
        method: 'POST',
        body: formData
    })
    .then(response => response.json())
    .then(data => {
        if (data.success) {
            // Close the modal
            const modal = document.getElementById('changePictureModal');
            const bootstrapModal = bootstrap.Modal.getInstance(modal);
            bootstrapModal.hide();
            
            // Refresh the recipients list
            loadRecipientsWithPresents();
            
            // Show success message
            alert('Zdjęcie profilowe zostało zaktualizowane');
        } else {
            alert('Błąd podczas aktualizacji zdjęcia: ' + (data.error || 'Nieznany błąd'));
        }
    })
    .catch(error => {
        console.error('Error:', error);
        alert('Błąd podczas aktualizacji zdjęcia');
    });
}

function openProfilePicturePreview(recipientId) {
    const recipient = window._allRecipients.find(r => r.id === recipientId);
    if (!recipient || !recipient.profile_picture || recipient.profile_picture.trim() === '') {
        return; // Don't open modal for placeholders
    }
    
    const modal = document.getElementById('profilePreviewModal');
    const previewImage = document.getElementById('profilePreviewImage');
    const previewName = document.getElementById('profilePreviewName');
    
    if (modal && previewImage && previewName) {
        previewImage.src = recipient.profile_picture;
        previewName.textContent = recipient.name;
        
        const bootstrapModal = new bootstrap.Modal(modal);
        bootstrapModal.show();
    }
} 