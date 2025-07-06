let currentUserId = null;
let currentRecipientId = null;

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
    // Load both recipients and presents
    Promise.all([
        fetch('/api/recipients').then(response => {
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
        
        const identificationHTML = generateIdentificationHTML(recipient, isIdentified, isIdentifiedByOther);
        const profilePictureHTML = generateProfilePictureHTML(recipient, isIdentified);
        
        return `
            <div class="recipient-item" data-id="${recipient.id}" id="recipient-${recipient.id}">
                <div class="row">
                    <div class="col-md-2 text-center">
                        ${profilePictureHTML}
                    </div>
                    <div class="col-md-6">
                        <h5 class="recipient-name mb-2">
                            <i class="fas fa-user me-2"></i>
                            ${escapeHtml(recipient.name)}
                        </h5>
                        ${identificationHTML}
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
                            <button class="btn btn-outline-danger btn-sm" onclick="deleteRecipient(${recipient.id}, '${escapeHtml(recipient.name)}')">
                                <i class="fas fa-trash me-1"></i>Usuń
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        `;
    }).join('');
}

function generateIdentificationHTML(recipient, isIdentified, isIdentifiedByOther) {
    if (isIdentified) {
        return `
            <div class="alert alert-success py-2 px-3 mb-3">
                <i class="fas fa-check-circle me-1"></i>
                <small>To jest Twój profil</small>
            </div>
        `;
    } else if (isIdentifiedByOther) {
        return `
            <div class="alert alert-warning py-2 px-3 mb-3">
                <i class="fas fa-user-check me-1"></i>
                <small>Zidentyfikowane przez: ${escapeHtml(recipient.identified_by_username || 'nieznany użytkownik')}</small>
            </div>
        `;
    } else {
        return `
            <div class="mb-3">
                <button class="btn btn-outline-success btn-sm" onclick="identifyAsRecipient(${recipient.id})">
                    <i class="fas fa-user-check me-1"></i>To jestem ja
                </button>
            </div>
        `;
    }
}

function generateProfilePictureHTML(recipient, isIdentified) {
    if (recipient.profile_picture) {
        return `
            <img src="${escapeHtml(recipient.profile_picture)}" 
                 alt="Zdjęcie profilowe" 
                 class="img-fluid rounded-circle mb-2" 
                 style="width: 80px; height: 80px; object-fit: cover; border: 3px solid ${isIdentified ? 'var(--christmas-green)' : 'var(--border-light)'};">
        `;
    } else {
        return `
            <div class="profile-placeholder mb-2" style="width: 80px; height: 80px; border-radius: 50%; background: var(--border-light); display: flex; align-items: center; justify-content: center; margin: 0 auto; border: 3px solid ${isIdentified ? 'var(--christmas-green)' : 'var(--border-light)'};">
                <i class="fas fa-user fa-2x text-muted"></i>
            </div>
        `;
    }
}

function identifyAsRecipient(recipientId) {
    if (!confirm('Czy na pewno chcesz zidentyfikować się jako ta osoba? Ta akcja nie może być cofnięta.')) {
        return;
    }
    
    fetch(`/api/recipients/${recipientId}/identify`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        }
    })
    .then(response => response.json())
    .then(data => {
        if (data.success) {
            showFormMessage('Pomyślnie zidentyfikowano!', 'success');
            loadRecipientsWithPresents();
        } else {
            showFormMessage(data.error || 'Błąd podczas identyfikacji', 'danger');
        }
    })
    .catch(error => {
        console.error('Error:', error);
        showFormMessage('Błąd połączenia z serwerem', 'danger');
    });
}

function openProfilePictureModal(recipientId) {
    currentRecipientId = recipientId;
    document.getElementById('profilePictureUrl').value = '';
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

function saveProfilePicture() {
    const profilePictureUrl = document.getElementById('profilePictureUrl').value.trim();
    
    if (!profilePictureUrl) {
        showFormMessage('URL zdjęcia jest wymagany', 'danger');
        return;
    }
    
    fetch(`/api/recipients/${currentRecipientId}/profile-picture`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({ profile_picture: profilePictureUrl })
    })
    .then(response => response.json())
    .then(data => {
        if (data.success) {
            showFormMessage('Zdjęcie profilowe zostało zaktualizowane!', 'success');
            const modal = bootstrap.Modal.getInstance(document.getElementById('profilePictureModal'));
            modal.hide();
            loadRecipientsWithPresents();
        } else {
            showFormMessage(data.error || 'Błąd podczas aktualizacji zdjęcia', 'danger');
        }
    })
    .catch(error => {
        console.error('Error:', error);
        showFormMessage('Błąd połączenia z serwerem', 'danger');
    });
}

function generatePresentsList(presents) {
    if (presents.length === 0) return '';
    
    // Sort presents: unchecked first, then checked
    presents.sort((a, b) => {
        if (a.is_checked === b.is_checked) {
            return new Date(b.created_at) - new Date(a.created_at);
        }
        return a.is_checked ? 1 : -1;
    });
    
    const presentsList = presents.map(present => {
        const statusIcon = present.is_checked ? 
            '<i class="fas fa-check-circle text-success me-1"></i>' : 
            '<i class="fas fa-circle text-muted me-1"></i>';
        
        return `
            <div class="present-preview-item ${present.is_checked ? 'checked' : ''}">
                <div class="d-flex align-items-center">
                    ${statusIcon}
                    <span class="present-preview-title">${escapeHtml(present.title)}</span>
                </div>
                ${present.comments ? `
                    <small class="text-muted ms-3">
                        ${formatCommentsPreview(present.comments)}
                    </small>
                ` : ''}
            </div>
        `;
    }).join('');
    
    return `
        <div class="presents-list">
            ${presentsList}
        </div>
    `;
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
        showFormMessage('Imię i nazwisko jest wymagane', 'danger');
        return;
    }
    
    const submitBtn = document.querySelector('#recipientForm button[type="submit"]');
    const originalText = submitBtn.innerHTML;
    submitBtn.innerHTML = '<span class="spinner-border spinner-border-sm me-2"></span>Dodawanie...';
    submitBtn.disabled = true;
    
    fetch('/api/recipients', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({ name: name })
    })
    .then(response => response.json())
    .then(data => {
        if (data.id) {
            showFormMessage('Osoba została dodana pomyślnie!', 'success');
            document.getElementById('recipientForm').reset();
            loadRecipientsWithPresents();
        } else {
            showFormMessage(data.error || 'Błąd podczas dodawania osoby', 'danger');
        }
    })
    .catch(error => {
        console.error('Error:', error);
        showFormMessage('Błąd połączenia z serwerem', 'danger');
    })
    .finally(() => {
        submitBtn.innerHTML = originalText;
        submitBtn.disabled = false;
    });
}

function deleteRecipient(id, name) {
    if (!confirm(`Czy na pewno chcesz usunąć osobę "${name}"? Wszystkie prezenty dla tej osoby zostaną również usunięte.`)) {
        return;
    }
    
    fetch(`/api/recipients/${id}`, {
        method: 'DELETE'
    })
    .then(response => response.json())
    .then(data => {
        if (data.success) {
            showFormMessage('Osoba została usunięta pomyślnie!', 'success');
            loadRecipientsWithPresents();
        } else {
            showFormMessage(data.error || 'Błąd podczas usuwania osoby', 'danger');
        }
    })
    .catch(error => {
        console.error('Error:', error);
        showFormMessage('Błąd połączenia z serwerem', 'danger');
    });
}

function showFormMessage(message, type) {
    const messageDiv = document.getElementById('formMessage');
    messageDiv.textContent = message;
    messageDiv.className = `alert alert-${type} mt-3`;
    messageDiv.style.display = 'block';
    
    setTimeout(() => {
        messageDiv.style.display = 'none';
    }, 5000);
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