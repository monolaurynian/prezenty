console.log('Formularz.js loading...');

let currentUser = null;
let authModal = null;
let loginModal = null;
let editPresentModal = null;

// Auto-select state: selection happens as soon as BOTH the identified
// name and the recipient options are available (no fixed timeouts).
let identifiedName = null;
let recipientsLoaded = false;
let identificationFetched = false;
let autoSelectedFromCache = false;

// Fast path: remember the identified name from the last visit so the
// dropdown can be pre-selected the moment recipients load, without
// waiting for /api/auth + /api/user/identification round trips.
try {
    identifiedName = localStorage.getItem('formularzIdentifiedName') || null;
    autoSelectedFromCache = !!identifiedName;
} catch (e) {}

document.addEventListener('DOMContentLoaded', function() {
    // Initialize Bootstrap modals
    authModal = new bootstrap.Modal(document.getElementById('authModal'));
    loginModal = new bootstrap.Modal(document.getElementById('loginModal'));
    editPresentModal = new bootstrap.Modal(document.getElementById('editPresentModal'));
    
    // Check if user is authenticated
    checkAuth();
    
    // Fetch identification in parallel with the auth check (not after it)
    fetchIdentification();
    
    // Setup form handlers
    setupFormHandlers();
    
    // Load recipients for dropdown
    loadRecipients();
    
    // Check for localStorage flag to open edit tab
    if (localStorage.getItem('openEditTab') === 'true') {
        localStorage.removeItem('openEditTab');
        console.log('[LocalStorage] Opening edit tab');
        // Hide add tab immediately
        document.getElementById('addTab').style.display = 'none';
        // Wait longer for auth to complete
        const checkAndSwitch = setInterval(() => {
            if (currentUser) {
                clearInterval(checkAndSwitch);
                switchTab('edit');
            }
        }, 100);
        // Timeout after 5 seconds
        setTimeout(() => clearInterval(checkAndSwitch), 5000);
    }
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
    
    // Login modal form
    const loginModalForm = document.getElementById('loginModalForm');
    if (loginModalForm) {
        loginModalForm.addEventListener('submit', function(e) {
            e.preventDefault();
            loginModalSubmit();
        });
    }
}

function openLoginModal() {
    loginModal.show();
}

function loginModalSubmit() {
    const username = document.getElementById('loginModalUsername').value.trim();
    const password = document.getElementById('loginModalPassword').value;
    
    if (!username || !password) {
        showLoginModalMessage('Proszę wypełnić wszystkie pola', 'danger');
        return;
    }
    
    const submitBtn = document.querySelector('#loginModalForm button[type="submit"]');
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
            // Redirect to recipients page
            window.location.href = '/recipients';
        } else {
            showLoginModalMessage(data.error || 'Błąd logowania', 'danger');
        }
    })
    .catch(error => {
        console.error('Login error:', error);
        showLoginModalMessage('Błąd połączenia z serwerem', 'danger');
    })
    .finally(() => {
        submitBtn.innerHTML = originalText;
        submitBtn.disabled = false;
    });
}

function showLoginModalMessage(message, type) {
    const loginModalMessage = document.getElementById('loginModalMessage');
    loginModalMessage.textContent = message;
    loginModalMessage.className = `alert alert-${type} mt-3`;
    loginModalMessage.style.display = 'block';
}

function checkAuth() {
    fetch('/api/auth')
        .then(response => response.json())
        .then(data => {
            if (data.authenticated) {
                currentUser = data.user;
                console.log('User authenticated:', currentUser);
                // Reveal the quiet "edit my presents" path under the form
                const editLink = document.getElementById('editMyPresentsLink');
                if (editLink) editLink.style.display = 'block';
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

function fetchIdentification() {
    if (identificationFetched) return;
    identificationFetched = true;
    fetch('/api/user/identification')
        .then(response => response.json())
        .then(data => {
            if (data.isIdentified && data.name) {
                console.log('User identified as:', data.name);
                identifiedName = data.name;
                try { localStorage.setItem('formularzIdentifiedName', data.name); } catch (e) {}
            } else {
                identifiedName = null;
                try { localStorage.removeItem('formularzIdentifiedName'); } catch (e) {}
                // Cached name was stale - undo a cache-based pre-selection
                if (autoSelectedFromCache && !window._osobaPreselected) {
                    const sel = document.getElementById('recipientSelect');
                    if (sel) sel.value = '';
                }
            }
            autoSelectedFromCache = false;
            tryAutoSelect();
        })
        .catch(error => {
            console.error('Error getting user identification:', error);
        });
}

// Runs whenever either recipients finish loading or the identification
// arrives - selects as soon as both pieces are ready.
function tryAutoSelect() {
    if (!identifiedName || !recipientsLoaded) return;
    // Don't override an explicit ?osoba= link selection
    if (window._osobaPreselected) return;
    const recipientSelect = document.getElementById('recipientSelect');
    if (!recipientSelect) return;
    for (let i = 0; i < recipientSelect.options.length; i++) {
        if (recipientSelect.options[i].dataset.name === identifiedName ||
            recipientSelect.options[i].textContent === identifiedName) {
            recipientSelect.value = recipientSelect.options[i].value;
            console.log('Auto-selected user name:', identifiedName, 'with ID:', recipientSelect.options[i].value);
            break;
        }
    }
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
                    option.value = recipient.id;
                    option.textContent = recipient.name;
                    option.dataset.name = recipient.name;
                    recipientSelect.appendChild(option);
                });
                
                // Ensure dropdown is enabled
                recipientSelect.disabled = false;
                
                console.log('Recipients loaded successfully. Total options:', recipientSelect.options.length);
                
                // Deep link support: /formularz?osoba=Babcia pre-selects that
                // person (used by the "share form" feature). Takes priority
                // over auto-selection based on the logged-in user.
                const osobaParam = new URLSearchParams(window.location.search).get('osoba');
                if (osobaParam) {
                    for (let i = 0; i < recipientSelect.options.length; i++) {
                        if (recipientSelect.options[i].dataset.name === osobaParam ||
                            recipientSelect.options[i].textContent === osobaParam) {
                            recipientSelect.value = recipientSelect.options[i].value;
                            window._osobaPreselected = true;
                            console.log('Pre-selected recipient from URL:', osobaParam);
                            break;
                        }
                    }
                    // Name not on the list yet - fill it in as a new name
                    if (!window._osobaPreselected) {
                        recipientSelect.value = '__new__';
                        recipientSelect.dispatchEvent(new Event('change'));
                        document.getElementById('recipientName').value = osobaParam;
                        window._osobaPreselected = true;
                    }
                }

                // Recipients ready - select the identified user's name
                // immediately (cached name makes this instant on repeat visits)
                recipientsLoaded = true;
                tryAutoSelect();
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
        // Get the text content (name) from the selected option
        const selectedOption = recipientSelect.options[recipientSelect.selectedIndex];
        recipientName = selectedOption ? selectedOption.textContent : recipientSelect.value;
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
            // Right after adding is when people want to review their list -
            // offer the edit view inline in the success message
            showFormMessage('Prezent został dodany pomyślnie! 🎁', 'success', true);
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

// Quick add on the "Edytuj Moje Prezenty" tab - adds a present for the
// identified user without leaving the edit view
function quickAddPresent() {
    const input = document.getElementById('quickAddTitle');
    const commentsInput = document.getElementById('quickAddComments');
    const title = input ? input.value.trim() : '';
    const comments = commentsInput ? commentsInput.value.trim() : '';

    if (!title) {
        showQuickAddMessage('Wpisz nazwę prezentu', 'danger');
        return;
    }
    if (!identifiedName) {
        showQuickAddMessage('Najpierw zidentyfikuj się w Ustawieniach, żeby dodawać prezenty do swojej listy', 'danger');
        return;
    }

    const btn = document.getElementById('quickAddBtn');
    const originalText = btn.innerHTML;
    btn.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span>Dodawanie...';
    btn.disabled = true;

    fetch('/api/formularz/present', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            recipientName: identifiedName,
            presentTitle: title,
            presentComments: comments
        })
    })
        .then(response => response.json())
        .then(data => {
            if (data.success) {
                input.value = '';
                if (commentsInput) commentsInput.value = '';
                showQuickAddMessage('Prezent dodany! 🎁', 'success');
                loadMyPresents();
            } else {
                showQuickAddMessage(data.error || 'Błąd podczas dodawania prezentu', 'danger');
            }
        })
        .catch(() => showQuickAddMessage('Błąd połączenia z serwerem', 'danger'))
        .finally(() => {
            btn.innerHTML = originalText;
            btn.disabled = false;
        });
}

function showQuickAddMessage(message, type) {
    const el = document.getElementById('quickAddMessage');
    if (!el) return;
    el.textContent = message;
    el.className = `alert alert-${type} mt-2`;
    el.style.display = 'block';
    if (type === 'success') {
        setTimeout(() => { el.style.display = 'none'; }, 4000);
    }
}

function showFormMessage(message, type, withEditLink = false) {
    const formMessage = document.getElementById('formMessage');
    formMessage.textContent = message;

    // Optional inline jump to the edit view (only for logged-in users)
    if (withEditLink && currentUser) {
        const link = document.createElement('a');
        link.href = '#';
        link.className = 'fw-semibold ms-2 text-decoration-none';
        link.style.whiteSpace = 'nowrap';
        link.innerHTML = '<i class="fas fa-edit me-1"></i>Edytuj moje prezenty';
        link.addEventListener('click', (e) => {
            e.preventDefault();
            formMessage.style.display = 'none';
            switchTab('edit');
        });
        formMessage.appendChild(link);
    }

    formMessage.className = `alert alert-${type} mt-3`;
    formMessage.style.display = 'block';
    
    // Auto-hide success messages after 5 seconds (longer when there's an
    // action link so it can actually be used)
    if (type === 'success') {
        setTimeout(() => {
            formMessage.style.display = 'none';
        }, withEditLink ? 8000 : 5000);
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
            console.log('[Load My Presents] Received data:', data);
            if (data.presents && data.presents.length > 0) {
                console.log('[Load My Presents] First present:', data.presents[0]);
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
                    <div class="flex-grow-1" style="min-width: 0; overflow-wrap: break-word; word-wrap: break-word; word-break: break-word;">
                        <h6 class="mb-1" style="overflow-wrap: break-word; word-wrap: break-word; word-break: break-word;">${makeLinksClickable(escapeHtml(present.title))}</h6>
                        ${present.comments ? `<p class="mb-1 text-muted small" style="overflow-wrap: break-word; word-wrap: break-word; word-break: break-word;">${makeLinksClickable(escapeHtml(present.comments))}</p>` : ''}
                        <small class="text-muted">
                            <i class="fas fa-calendar me-1"></i>${formatDate(present.created_at)}
                        </small>
                    </div>
                    <div class="btn-group-vertical ms-3">
                        <button class="btn btn-sm btn-outline-primary" onclick="openEditPresentModal(${present.id}, '${escapeHtml(present.title)}', '${escapeHtml(present.comments || '')}', ${present.recipient_id})">
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

function makeLinksClickable(text) {
    const urlPattern = /(https?:\/\/[^\s<>"{}|\\^`\[\]]+)/g;
    const urls = [];
    let match;
    while ((match = urlPattern.exec(text)) !== null) {
        urls.push(match[1]);
    }

    if (urls.length > 0) {
        // Remove URLs from text
        let textOnly = text;
        urls.forEach(url => {
            textOnly = textOnly.replace(url, '');
        });

        // Clean up extra whitespace
        textOnly = textOnly.trim().replace(/\s+/g, ' ');

        // Create links list with li style
        const linksList = urls.map(url => {
            let cleanUrl = url.replace(/[.,;:!?)]+$/, '');
            let displayText = cleanUrl;
            if (cleanUrl.length > 60) {
                displayText = cleanUrl.substring(0, 57) + '...';
            }
            return `<li style="margin: 4px 0; padding-left: 0; display: flex; align-items: flex-start;"><span style="margin-right: 4px; flex-shrink: 0;">🔗</span><a href="${cleanUrl}" target="_blank" rel="noopener noreferrer" style="color: #2196F3; text-decoration: underline; word-break: break-all;">${escapeHtml(displayText)}</a></li>`;
        }).join('');

        const urlList = `<ul style="margin: 8px 0 8px 0; padding-left: 0; list-style: none;">${linksList}</ul>`;

        if (textOnly) {
            return textOnly + '<br>' + urlList;
        } else {
            return urlList;
        }
    }

    return text;
}

function openEditPresentModal(id, title, comments, recipientId) {
    console.log('[Edit Modal] Opening with:', { id, title, comments, recipientId });
    document.getElementById('editPresentId').value = id;
    document.getElementById('editPresentTitle').value = title;
    document.getElementById('editPresentComments').value = comments;
    document.getElementById('editRecipientSelect').value = recipientId;
    console.log('[Edit Modal] Set recipientId to:', document.getElementById('editRecipientSelect').value);
    document.getElementById('editPresentMessage').style.display = 'none';
    editPresentModal.show();
}

function saveEditedPresent() {
    const id = document.getElementById('editPresentId').value;
    const title = document.getElementById('editPresentTitle').value.trim();
    const comments = document.getElementById('editPresentComments').value.trim();
    const recipientId = document.getElementById('editRecipientSelect').value;
    
    console.log('[Save Edit] Saving with recipientId:', recipientId);
    
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
            recipient_id: recipientId || null
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
