console.log('Formularz.js loading...');

let currentUser = null;
let authModal = null;
let editPresentModal = null;

document.addEventListener('DOMContentLoaded', function() {
    // Initialize Bootstrap modals
    authModal = new bootstrap.Modal(document.getElementById('authModal'));
    editPresentModal = new bootstrap.Modal(document.getElementById('editPresentModal'));
    
    // Check if user is authenticated
    checkAuth();
    
    // Setup form handlers
    setupFormHandlers();
    
    // Load recipients for dropdown
    loadRecipients();
});

function setupFormHandlers() {
    // Present form submission
    const presentForm = document.getElementById('presentForm');
    if (presentForm) {
        presentForm.addEventListener('submit', function(e) {
            e.preventDefault();
            submitPresent();
        });
    }
    
    // Recipient dropdown change handler
    const recipientSelect = document.getElementById('recipientSelect');
    if (recipientSelect) {
        recipientSelect.addEventListener('change', function() {
            const newNameInput = document.getElementById('newNameInput');
            if (this.value === '__new__') {
                newNameInput.style.display = 'block';
                document.getElementById('recipientName').required = true;
            } else {
                newNameInput.style.display = 'none';
                document.getElementById('recipientName').required = false;
            }
        });
    }
    
    // Modal login form
    const modalLoginForm = document.getElementById('modalLoginForm');
    if (modalLoginForm) {
        modalLoginForm.addEventListener('submit', function(e) {
            e.preventDefault();
            modalLogin();
        });
    }
    
    // Modal register form
    const modalRegisterForm = document.getElementById('modalRegisterForm');
    if (modalRegisterForm) {
        modalRegisterForm.addEventListener('submit', function(e) {
            e.preventDefault();
            modalRegister();
        });
    }
    
    // Edit present form
    const editPresentForm = document.getElementById('editPresentForm');
    if (editPresentForm) {
        editPresentForm.addEventListener('submit', function(e) {
            e.preventDefault();
            saveEditedPresent();
        });
    }
}

function checkAuth() {
    fetch('/api/auth')
        .then(response => response.json())
        .then(data => {
            if (data.authenticated) {
                currentUser = data.user;
                console.log('User authenticated:', currentUser);
            } else {
                currentUser = null;
                console.log('User not authenticated');
            }
        })
        .catch(error => {
            console.error('Auth check error:', error);
            currentUser = null;
        });
}

function switchTab(tab) {
    const addTab = document.getElementById('addTab');
    const editTab = document.getElementById('editTab');
    
    if (tab === 'add') {
        addTab.style.display = 'block';
        editTab.style.display = 'none';
    } else if (tab === 'edit') {
        // Check if user is authenticated
        if (!currentUser) {
            // Show authentication modal
            authModal.show();
        } else {
            addTab.style.display = 'none';
            editTab.style.display = 'block';
            loadMyPresents();
        }
    }
}

function loadRecipients() {
    fetch('/api/formularz/recipients')
        .then(response => response.json())
        .then(data => {
            const recipientSelect = document.getElementById('recipientSelect');
            if (recipientSelect && data.recipients) {
                console.log('Loading recipients:', data.recipients.length);
                
                // Clear existing options except the first two
                while (recipientSelect.options.length > 2) {
                    recipientSelect.remove(2);
                }
                
                // Add recipients to dropdown
                data.recipients.forEach(recipient => {
                    const option = document.createElement('option');
                    option.value = recipient.name;
                    option.textContent = recipient.name;
                    recipientSelect.appendChild(option);
                });
                
                // Ensure dropdown is enabled
                recipientSelect.disabled = false;
                
                console.log('Recipients loaded successfully. Total options:', recipientSelect.options.length);
            }
        })
        .catch(error => {
            console.error('Error loading recipients:', error);
        });
}

function submitPresent() {
    const recipientSelect = document.getElementById('recipientSelect');
    const recipientNameInput = document.getElementById('recipientName');
    const presentTitle = document.getElementById('presentTitle').value.trim();
    const presentComments = document.getElementById('presentComments').value.trim();
    const formMessage = document.getElementById('formMessage');
    
    console.log('Submit present - recipientSelect value:', recipientSelect.value);
    console.log('Submit present - recipientSelect disabled:', recipientSelect.disabled);
    
    // Determine recipient name
    let recipientName;
    if (recipientSelect.value === '__new__') {
        recipientName = recipientNameInput.value.trim();
        if (!recipientName) {
            showFormMessage('Proszę wprowadzić swoje imię i nazwisko', 'danger');
            return;
        }
    } else if (recipientSelect.value && recipientSelect.value !== '') {
        recipientName = recipientSelect.value;
    } else {
        showFormMessage('Proszę wybrać lub wprowadzić swoje imię', 'danger');
        return;
    }
    
    if (!presentTitle) {
        showFormMessage('Proszę wprowadzić nazwę prezentu', 'danger');
        return;
    }
    
    console.log('Submitting present for recipient:', recipientName);
    
    // Disable submit button
    const submitBtn = document.querySelector('#presentForm button[type="submit"]');
    const originalText = submitBtn.innerHTML;
    submitBtn.innerHTML = '<span class="spinner-border spinner-border-sm me-2"></span>Dodawanie...';
    submitBtn.disabled = true;
    
    // Submit to server
    fetch('/api/formularz/present', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            recipientName: recipientName,
            presentTitle: presentTitle,
            presentComments: presentComments
        })
    })
    .then(response => response.json())
    .then(data => {
        if (data.success) {
            showFormMessage('Prezent został dodany pomyślnie! 🎁', 'success');
            // Clear form
            document.getElementById('presentForm').reset();
            document.getElementById('newNameInput').style.display = 'none';
            // Reload recipients to include the new one if added
            loadRecipients();
        } else {
            showFormMessage(data.error || 'Błąd podczas dodawania prezentu', 'danger');
        }
    })
    .catch(error => {
        console.error('Error submitting present:', error);
        showFormMessage('Błąd połączenia z serwerem', 'danger');
    })
    .finally(() => {
        submitBtn.innerHTML = originalText;
        submitBtn.disabled = false;
    });
}

function showFormMessage(message, type) {
    const formMessage = document.getElementById('formMessage');
    formMessage.textContent = message;
    formMessage.className = `alert alert-${type} mt-3`;
    formMessage.style.display = 'block';
    
    // Auto-hide success messages after 5 seconds
    if (type === 'success') {
        setTimeout(() => {
            formMessage.style.display = 'none';
        }, 5000);
    }
}

function toggleAuthForm(event) {
    event.preventDefault();
    const loginSection = document.getElementById('loginSection');
    const registerSection = document.getElementById('registerSection');
    
    if (loginSection.style.display === 'none') {
        loginSection.style.display = 'block';
        registerSection.style.display = 'none';
    } else {
        loginSection.style.display = 'none';
        registerSection.style.display = 'block';
    }
    
    // Clear auth message
    document.getElementById('authMessage').style.display = 'none';
}

function modalLogin() {
    const username = document.getElementById('modalUsername').value.trim();
    const password = document.getElementById('modalPassword').value;
    const authMessage = document.getElementById('authMessage');
    
    if (!username || !password) {
        showAuthMessage('Proszę wypełnić wszystkie pola', 'danger');
        return;
    }
    
    const submitBtn = document.querySelector('#modalLoginForm button[type="submit"]');
    const originalText = submitBtn.innerHTML;
    submitBtn.innerHTML = '<span class="spinner-border spinner-border-sm me-2"></span>Logowanie...';
    submitBtn.disabled = true;
    
    fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
    })
    .then(response => response.json())
    .then(data => {
        if (data.success) {
            currentUser = data.user;
            authModal.hide();
            switchTab('edit');
        } else {
            showAuthMessage(data.error || 'Błąd logowania', 'danger');
        }
    })
    .catch(error => {
        console.error('Login error:', error);
        showAuthMessage('Błąd połączenia z serwerem', 'danger');
    })
    .finally(() => {
        submitBtn.innerHTML = originalText;
        submitBtn.disabled = false;
    });
}

function modalRegister() {
    const username = document.getElementById('modalRegUsername').value.trim();
    const password = document.getElementById('modalRegPassword').value;
    const confirmPassword = document.getElementById('modalConfirmPassword').value;
    
    if (!username || !password || !confirmPassword) {
        showAuthMessage('Proszę wypełnić wszystkie pola', 'danger');
        return;
    }
    
    if (password !== confirmPassword) {
        showAuthMessage('Hasła nie są identyczne', 'danger');
        return;
    }
    
    const submitBtn = document.querySelector('#modalRegisterForm button[type="submit"]');
    const originalText = submitBtn.innerHTML;
    submitBtn.innerHTML = '<span class="spinner-border spinner-border-sm me-2"></span>Rejestracja...';
    submitBtn.disabled = true;
    
    fetch('/api/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
    })
    .then(response => response.json())
    .then(data => {
        if (data.success) {
            // Auto-login after registration
            return fetch('/api/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username, password })
            }).then(r => r.json());
        } else {
            throw new Error(data.error || 'Błąd rejestracji');
        }
    })
    .then(data => {
        if (data.success) {
            currentUser = data.user;
            authModal.hide();
            switchTab('edit');
        } else {
            showAuthMessage(data.error || 'Błąd logowania', 'danger');
        }
    })
    .catch(error => {
        console.error('Register error:', error);
        showAuthMessage(error.message || 'Błąd połączenia z serwerem', 'danger');
    })
    .finally(() => {
        submitBtn.innerHTML = originalText;
        submitBtn.disabled = false;
    });
}

function showAuthMessage(message, type) {
    const authMessage = document.getElementById('authMessage');
    authMessage.textContent = message;
    authMessage.className = `alert alert-${type} mt-3`;
    authMessage.style.display = 'block';
}

function loadMyPresents() {
    const myPresentsList = document.getElementById('myPresentsList');
    myPresentsList.innerHTML = '<div class="text-center"><div class="spinner-border" role="status"><span class="visually-hidden">Ładowanie...</span></div></div>';
    
    fetch('/api/formularz/my-presents')
        .then(response => response.json())
        .then(data => {
            if (data.presents && data.presents.length > 0) {
                displayMyPresents(data.presents);
            } else {
                myPresentsList.innerHTML = `
                    <div class="text-center py-5">
                        <i class="fas fa-gift fa-3x text-muted mb-3"></i>
                        <h5 class="text-muted">Nie masz jeszcze żadnych prezentów</h5>
                        <p class="text-muted">Dodaj swój pierwszy prezent używając formularza powyżej</p>
                        <button class="btn btn-primary mt-3" onclick="switchTab('add')">
                            <i class="fas fa-plus me-2"></i>Dodaj Prezent
                        </button>
                    </div>
                `;
            }
        })
        .catch(error => {
            console.error('Error loading presents:', error);
            myPresentsList.innerHTML = `
                <div class="alert alert-danger">
                    <i class="fas fa-exclamation-circle me-2"></i>Błąd podczas ładowania prezentów
                </div>
            `;
        });
}

function displayMyPresents(presents) {
    const myPresentsList = document.getElementById('myPresentsList');
    
    let html = '<div class="list-group">';
    
    presents.forEach(present => {
        html += `
            <div class="list-group-item">
                <div class="d-flex justify-content-between align-items-start">
                    <div class="flex-grow-1">
                        <h6 class="mb-1">${escapeHtml(present.title)}</h6>
                        ${present.comments ? `<p class="mb-1 text-muted small">${escapeHtml(present.comments)}</p>` : ''}
                        <small class="text-muted">
                            <i class="fas fa-calendar me-1"></i>${formatDate(present.created_at)}
                        </small>
                    </div>
                    <div class="btn-group-vertical ms-3">
                        <button class="btn btn-sm btn-outline-primary" onclick="openEditPresentModal(${present.id}, '${escapeHtml(present.title)}', '${escapeHtml(present.comments || '')}')">
                            <i class="fas fa-edit"></i>
                        </button>
                        <button class="btn btn-sm btn-outline-danger" onclick="deletePresent(${present.id})">
                            <i class="fas fa-trash"></i>
                        </button>
                    </div>
                </div>
            </div>
        `;
    });
    
    html += '</div>';
    myPresentsList.innerHTML = html;
}

function openEditPresentModal(id, title, comments) {
    document.getElementById('editPresentId').value = id;
    document.getElementById('editPresentTitle').value = title;
    document.getElementById('editPresentComments').value = comments;
    document.getElementById('editPresentMessage').style.display = 'none';
    editPresentModal.show();
}

function saveEditedPresent() {
    const id = document.getElementById('editPresentId').value;
    const title = document.getElementById('editPresentTitle').value.trim();
    const comments = document.getElementById('editPresentComments').value.trim();
    
    if (!title) {
        showEditMessage('Nazwa prezentu jest wymagana', 'danger');
        return;
    }
    
    const submitBtn = document.querySelector('#editPresentModal .btn-success');
    const originalText = submitBtn.innerHTML;
    submitBtn.innerHTML = '<span class="spinner-border spinner-border-sm me-2"></span>Zapisywanie...';
    submitBtn.disabled = true;
    
    fetch(`/api/presents/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            title: title,
            comments: comments,
            recipient_id: null // Keep recipient_id unchanged
        })
    })
    .then(response => response.json())
    .then(data => {
        if (data.success) {
            editPresentModal.hide();
            loadMyPresents();
        } else {
            showEditMessage(data.error || 'Błąd podczas zapisywania', 'danger');
        }
    })
    .catch(error => {
        console.error('Error saving present:', error);
        showEditMessage('Błąd połączenia z serwerem', 'danger');
    })
    .finally(() => {
        submitBtn.innerHTML = originalText;
        submitBtn.disabled = false;
    });
}

function showEditMessage(message, type) {
    const editMessage = document.getElementById('editPresentMessage');
    editMessage.textContent = message;
    editMessage.className = `alert alert-${type} mt-3`;
    editMessage.style.display = 'block';
}

function deletePresent(id) {
    if (!confirm('Czy na pewno chcesz usunąć ten prezent?')) {
        return;
    }
    
    fetch(`/api/presents/${id}`, {
        method: 'DELETE'
    })
    .then(response => response.json())
    .then(data => {
        if (data.success) {
            loadMyPresents();
        } else {
            alert(data.error || 'Błąd podczas usuwania prezentu');
        }
    })
    .catch(error => {
        console.error('Error deleting present:', error);
        alert('Błąd połączenia z serwerem');
    });
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function formatDate(dateString) {
    const date = new Date(dateString);
    return date.toLocaleDateString('pl-PL', {
        year: 'numeric',
        month: 'long',
        day: 'numeric'
    });
}
