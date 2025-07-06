let currentUserId = null;
let currentRecipientId = null;
let pendingIdentificationRecipientId = null;

document.addEventListener('DOMContentLoaded', function() {
    // Check authentication
    checkAuth();
    
    // Load recipients with their presents
    loadRecipientsWithPresents();
    
    // Form submission
    const recipientForm = document.getElementById('recipientForm');
    recipientForm.addEventListener('submit', function(e) {
        e.preventDefault();
        addRecipient();
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
    fetch('/api/auth')
    .then(response => response.json())
    .then(data => {
        if (!data.authenticated) {
            window.location.href = '/';
        } else {
            currentUserId = data.user.id;
        }
    })
    .catch(error => {
        console.error('Auth check error:', error);
        window.location.href = '/';
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
        fetch('/api/presents').then(response => {
            console.log('Presents response status:', response.status);
            if (!response.ok) {
                if (response.status === 401) {
                    window.location.href = '/';
                    throw new Error('Unauthorized');
                }
                throw new Error('Network response was not ok');
            }
            return response.json();
        })
    ])
    .then(([recipients, presents]) => {
        console.log('Data loaded successfully:', { recipients: recipients.length, presents: presents.length });
        displayRecipientsWithPresents(recipients, presents);
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
    
    if (recipients.length === 0) {
        recipientsList.innerHTML = `
            <div class="text-center text-muted">
                <i class="fas fa-users fa-3x mb-3"></i>
                <p>Brak osób na liście. Dodaj pierwszą osobę!</p>
            </div>
        `;
        return;
    }
    
    // Group presents by recipient
    const presentsByRecipient = {};
    presents.forEach(present => {
        const recipientId = present.recipient_id;
        if (!presentsByRecipient[recipientId]) {
            presentsByRecipient[recipientId] = [];
        }
        presentsByRecipient[recipientId].push(present);
    });
    
    recipientsList.innerHTML = recipients.map(recipient => {
        const recipientPresents = presentsByRecipient[recipient.id] || [];
        const checkedPresents = recipientPresents.filter(p => p.is_checked).length;
        const totalPresents = recipientPresents.length;
        const isIdentified = recipient.identified_by === currentUserId;
        const isIdentifiedByOther = recipient.identified_by && recipient.identified_by !== currentUserId;
        
        const presentsHTML = recipientPresents.length > 0 ? 
            generatePresentsList(recipientPresents) : 
            '<p class="text-muted mb-0">Brak prezentów dla tej osoby</p>';
        
        const profilePictureHTML = generateProfilePictureHTML(recipient, isIdentified);
        
        return `
            <div class="recipient-item" data-id="${recipient.id}" id="recipient-${recipient.id}">
                <div class="row">
                    <div class="col-md-2 text-center">
                        ${profilePictureHTML}
                    </div>
                    <div class="col-md-6">
                        <div class="d-flex align-items-center mb-2">
                            <h5 class="recipient-name mb-0 me-3">
                                <i class="fas fa-user me-2"></i>
                                ${escapeHtml(recipient.name)}
                            </h5>
                            ${isIdentified ? `
                                <button class="btn btn-outline-success btn-sm" onclick="cancelIdentification(${recipient.id}, '${escapeHtml(recipient.name)}')">
                                    <i class="fas fa-check-circle me-1"></i>To jest Twój profil
                                </button>
                            ` : ''}
                        </div>
                        ${isIdentifiedByOther ? `
                            <div class="alert alert-warning py-2 px-3 mb-3">
                                <i class="fas fa-user-check me-1"></i>
                                <small>Zidentyfikowane przez: ${escapeHtml(recipient.identified_by_username || 'nieznany użytkownik')}</small>
                            </div>
                        ` : !isIdentified ? `
                            <div class="d-flex align-items-center mb-3">
                                <button class="btn btn-outline-success btn-sm me-2" onclick="identifyAsRecipient(${recipient.id}, '${escapeHtml(recipient.name)}')">
                                    <i class="fas fa-user-check me-1"></i>To jestem ja
                                </button>
                            </div>
                        ` : ''}
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
                        <div class="presents-preview">
                            ${presentsHTML}
                        </div>
                    </div>
                    <div class="col-md-4 text-end">
                        <div class="mb-3">
                            <small class="text-muted">
                                Dodano: ${new Date(recipient.created_at).toLocaleDateString('pl-PL')}
                            </small>
                        </div>
                        <div class="btn-group-vertical w-100">
                            ${isIdentified ? `
                                <button class="btn btn-outline-primary btn-sm mb-2" onclick="openProfilePictureModal(${recipient.id})">
                                    <i class="fas fa-camera me-1"></i>Zmień zdjęcie
                                </button>
                            ` : ''}
                            <button class="btn btn-outline-danger btn-sm ${isIdentified ? '' : 'mt-2'}" onclick="deleteRecipient(${recipient.id}, '${escapeHtml(recipient.name)}')">
                                <i class="fas fa-trash me-1"></i>Usuń
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        `;
    }).join('');
}

function generateProfilePictureHTML(recipient, isIdentified) {
    if (recipient.profile_picture) {
        return `
            <div class="profile-picture-wrapper position-relative mb-2 ${isIdentified ? 'identified' : ''}" style="display: inline-block;">
                <img src="${escapeHtml(recipient.profile_picture)}" 
                     alt="Zdjęcie profilowe" 
                     class="img-fluid rounded-circle"
                     style="width: 80px; height: 80px; object-fit: cover; border: 3px solid var(--border-light);">
            </div>
        `;
    } else {
        return `
            <div class="profile-picture-wrapper position-relative mb-2 ${isIdentified ? 'identified' : ''}" style="width: 80px; height: 80px; border-radius: 50%; background: var(--border-light); display: flex; align-items: center; justify-content: center; margin: 0 auto; border: 3px solid var(--border-light);">
                <i class="fas fa-user fa-2x text-muted"></i>
            </div>
        `;
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

function openProfilePictureModal(recipientId) {
    currentRecipientId = recipientId;
    document.getElementById('profilePictureUrl').value = '';
    document.getElementById('profilePictureFile').value = '';
    document.getElementById('profilePicturePreview').style.display = 'none';
    
    // Get current profile picture if exists
    fetch(`/api/recipients/${recipientId}`)
    .then(response => response.json())
    .then(recipient => {
        if (recipient.profile_picture) {
            document.getElementById('profilePictureUrl').value = recipient.profile_picture;
            const preview = document.getElementById('profilePicturePreview');
            preview.src = recipient.profile_picture;
            preview.style.display = 'block';
        }
    })
    .catch(error => {
        console.error('Error loading recipient:', error);
    });
    
    const modal = new bootstrap.Modal(document.getElementById('profilePictureModal'));
    modal.show();
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
    
    // Sort presents: unchecked first, then checked
    const sortedPresents = presents.sort((a, b) => {
        if (a.is_checked !== b.is_checked) {
            return a.is_checked ? 1 : -1;
        }
        return new Date(b.created_at) - new Date(a.created_at);
    });
    
    return `
        <div class="presents-list">
            ${sortedPresents.map(present => `
                <div class="present-item ${present.is_checked ? 'checked' : ''}" data-id="${present.id}">
                    <div class="d-flex align-items-center justify-content-between">
                        <div class="d-flex align-items-center">
                            <div class="form-check me-2">
                                <input class="form-check-input" type="checkbox" 
                                       ${present.is_checked ? 'checked' : ''} 
                                       onchange="togglePresentFromRecipients(${present.id}, this.checked)">
                            </div>
                            <div>
                                <h6 class="present-title mb-1">${escapeHtml(present.title)}</h6>
                                ${present.comments ? `
                                    <small class="text-muted">${formatCommentsPreview(present.comments)}</small>
                                ` : ''}
                            </div>
                        </div>
                        <small class="text-muted">
                            ${new Date(present.created_at).toLocaleDateString('pl-PL')}
                        </small>
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
            // Refresh the recipients list to show updated state
            loadRecipientsWithPresents();
        } else {
            showErrorModal(data.error || 'Błąd podczas aktualizacji prezentu');
        }
    })
    .catch(error => {
        console.error('Error:', error);
        showErrorModal('Błąd połączenia z serwerem');
    });
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
    if (confirm(`Czy na pewno chcesz usunąć osobę "${name}"? Ta akcja nie może być cofnięta.`)) {
        fetch(`/api/recipients/${id}`, {
            method: 'DELETE'
        })
        .then(response => response.json())
        .then(data => {
            if (data.success) {
                showSuccessMessage('Osoba została usunięta!');
                loadRecipientsWithPresents();
            } else {
                showErrorModal(data.error || 'Błąd podczas usuwania osoby');
            }
        })
        .catch(error => {
            console.error('Error:', error);
            showErrorModal('Błąd połączenia z serwerem');
        });
    }
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