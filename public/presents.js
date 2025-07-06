document.addEventListener('DOMContentLoaded', function() {
    // Check authentication
    checkAuth();
    
    // Load recipients for dropdown
    loadRecipients();
    
    // Load presents
    loadPresents();
    
    // Form submission
    const presentForm = document.getElementById('presentForm');
    presentForm.addEventListener('submit', function(e) {
        e.preventDefault();
        addPresent();
    });
    
    // Search functionality
    const searchInput = document.getElementById('searchInput');
    searchInput.addEventListener('input', function() {
        filterAndDisplayPresents();
    });
    
    // Close dropdown when clicking outside
    document.addEventListener('click', function(event) {
        const dropdown = document.getElementById('sortDropdown');
        const sortButton = document.querySelector('.sort-button');
        
        if (!sortButton.contains(event.target) && !dropdown.contains(event.target)) {
            dropdown.style.display = 'none';
        }
    });
    
    // Initialize sort options
    initializeSortOptions();
});

// Global variable to store all presents
let allPresents = [];
let currentSortValue = 'status';

function checkAuth() {
    fetch('/api/auth')
    .then(response => response.json())
    .then(data => {
        if (!data.authenticated) {
            window.location.href = '/';
        }
    })
    .catch(error => {
        console.error('Auth check error:', error);
        window.location.href = '/';
    });
}

function loadRecipients() {
    console.log('Loading recipients for dropdown...');
    
    fetch('/api/recipients')
    .then(response => {
        console.log('Recipients response status:', response.status);
        if (!response.ok) {
            if (response.status === 401) {
                window.location.href = '/';
                throw new Error('Unauthorized');
            }
            throw new Error('Network response was not ok');
        }
        return response.json();
    })
    .then(recipients => {
        console.log('Recipients loaded for dropdown:', recipients.length, 'recipients');
        
        const select = document.getElementById('recipientSelect');
        select.innerHTML = '<option value="">Wybierz osobę</option>';
        
        recipients.forEach(recipient => {
            const option = document.createElement('option');
            option.value = recipient.id;
            option.textContent = recipient.name;
            select.appendChild(option);
        });
        
        // Dodaj opcję "Dodaj nową osobę" do głównego dropdowna
        const addNewOption = document.createElement('option');
        addNewOption.value = 'add-new';
        addNewOption.className = 'text-primary';
        addNewOption.innerHTML = '<i class="fas fa-plus"></i> + Dodaj nową osobę';
        select.appendChild(addNewOption);
        
        // Synchronizuj dropdowny
        syncDropdowns();
        
        // Dodaj event listener dla zmiany wyboru
        select.addEventListener('change', function() {
            if (this.value === 'add-new') {
                // Pokaż modal do dodawania osoby
                const modal = new bootstrap.Modal(document.getElementById('addRecipientModal'));
                modal.show();
                // Resetuj wybór
                this.value = '';
            }
        });
    })
    .catch(error => {
        console.error('Error loading recipients:', error);
        showFormMessage('Błąd podczas ładowania listy osób', 'danger');
    });
}

function loadPresents() {
    console.log('loadPresents called');
    fetch('/api/presents')
    .then(response => response.json())
    .then(presents => {
        console.log('Presents loaded from server:', presents);
        allPresents = presents;
        filterAndDisplayPresents();
        displayRecipientsOverview(presents);
    })
    .catch(error => {
        console.error('Error loading presents:', error);
        document.getElementById('presentsList').innerHTML = 
            '<div class="alert alert-danger">Błąd podczas ładowania prezentów</div>';
    });
}

function filterAndDisplayPresents() {
    console.log('filterAndDisplayPresents called');
    const searchInput = document.getElementById('searchInput');
    const searchTerm = searchInput.value.toLowerCase().trim();
    
    let filteredPresents = allPresents;
    
    // Filter by search term
    if (searchTerm) {
        filteredPresents = allPresents.filter(present => {
            const title = present.title.toLowerCase();
            const recipient = (present.recipient_name || '').toLowerCase();
            const comments = (present.comments || '').toLowerCase();
            
            return title.includes(searchTerm) || 
                   recipient.includes(searchTerm) || 
                   comments.includes(searchTerm);
        });
    }
    
    displayPresents(filteredPresents);
}

function toggleSortDropdown() {
    const dropdown = document.getElementById('sortDropdown');
    const currentDisplay = dropdown.style.display;
    dropdown.style.display = currentDisplay === 'none' || currentDisplay === '' ? 'block' : 'none';
}

function initializeSortOptions() {
    const sortOptions = document.querySelectorAll('.sort-option');
    sortOptions.forEach(option => {
        option.addEventListener('click', function() {
            const value = this.getAttribute('data-value');
            currentSortValue = value;
            
            // Update selected state
            sortOptions.forEach(opt => opt.classList.remove('selected'));
            this.classList.add('selected');
            
            // Update button text
            const sortButton = document.querySelector('.sort-button');
            const icon = this.querySelector('i').cloneNode(true);
            const text = this.textContent.trim();
            sortButton.innerHTML = '';
            sortButton.appendChild(icon);
            sortButton.appendChild(document.createTextNode(' ' + text.split(' ')[1]));
            sortButton.appendChild(document.createElement('i')).className = 'fas fa-chevron-down ms-1';
            
            // Set initial button text for status
            if (value === 'status') {
                sortButton.innerHTML = '<i class="fas fa-check-circle"></i> Status<i class="fas fa-chevron-down ms-1"></i>';
            }
            
            // Hide dropdown
            document.getElementById('sortDropdown').style.display = 'none';
            
            // Refresh display
            filterAndDisplayPresents();
        });
    });
    
    // Set default selected
    const defaultOption = document.querySelector('[data-value="status"]');
    if (defaultOption) {
        defaultOption.classList.add('selected');
    }
}

function displayRecipientsOverview(presents) {
    const overviewDiv = document.getElementById('recipientsOverview');
    
    // Group presents by recipient
    const recipientStats = {};
    presents.forEach(present => {
        const recipientName = present.recipient_name || 'Nie określono';
        if (!recipientStats[recipientName]) {
            recipientStats[recipientName] = { total: 0, checked: 0 };
        }
        recipientStats[recipientName].total++;
        if (present.is_checked) {
            recipientStats[recipientName].checked++;
        }
    });
    
    if (Object.keys(recipientStats).length === 0) {
        overviewDiv.innerHTML = '<p class="text-muted text-center">Brak prezentów do wyświetlenia</p>';
        return;
    }
    
    const overviewHTML = Object.entries(recipientStats).map(([name, stats]) => {
        const percentage = stats.total > 0 ? Math.round((stats.checked / stats.total) * 100) : 0;
        const progressColor = percentage === 100 ? 'success' : percentage > 50 ? 'warning' : 'danger';
        
        return `
            <div class="row align-items-center mb-3">
                <div class="col-md-4">
                    <h6 class="mb-0">
                        <i class="fas fa-user me-2"></i>${escapeHtml(name)}
                    </h6>
                </div>
                <div class="col-md-6">
                    <div class="progress" style="height: 8px;">
                        <div class="progress-bar bg-${progressColor}" style="width: ${percentage}%"></div>
                    </div>
                </div>
                <div class="col-md-2 text-end">
                    <small class="text-muted">${stats.checked}/${stats.total}</small>
                </div>
            </div>
        `;
    }).join('');
    
    overviewDiv.innerHTML = overviewHTML;
}

function displayPresents(presents) {
    const presentsList = document.getElementById('presentsList');
    const sortValue = currentSortValue;
    const searchInput = document.getElementById('searchInput');
    const searchTerm = searchInput.value.toLowerCase().trim();
    
    if (presents.length === 0) {
        if (searchTerm) {
            presentsList.innerHTML = `
                <div class="text-center text-muted">
                    <i class="fas fa-search fa-3x mb-3"></i>
                    <p>Nie znaleziono prezentów pasujących do wyszukiwania: "${searchTerm}"</p>
                    <button class="btn btn-outline-primary btn-sm" onclick="clearSearch()">
                        <i class="fas fa-times me-1"></i>Wyczyść wyszukiwanie
                    </button>
                </div>
            `;
        } else {
            presentsList.innerHTML = `
                <div class="text-center text-muted">
                    <i class="fas fa-gift fa-3x mb-3"></i>
                    <p>Brak prezentów na liście. Dodaj pierwszy prezent!</p>
                </div>
            `;
        }
        return;
    }
    
    // Sort presents based on selected criteria
    presents.sort((a, b) => {
        switch (sortValue) {
            case 'date-desc':
                return new Date(b.created_at) - new Date(a.created_at);
            case 'date-asc':
                return new Date(a.created_at) - new Date(b.created_at);
            case 'title-asc':
                return a.title.localeCompare(b.title, 'pl');
            case 'title-desc':
                return b.title.localeCompare(a.title, 'pl');
            case 'recipient-asc':
                const recipientA = a.recipient_name || 'Nie określono';
                const recipientB = b.recipient_name || 'Nie określono';
                return recipientA.localeCompare(recipientB, 'pl');
            case 'status':
                // Unchecked first, then checked, then by date
                if (a.is_checked !== b.is_checked) {
                    return a.is_checked ? 1 : -1;
                }
                return new Date(b.created_at) - new Date(a.created_at);
            default:
                return new Date(b.created_at) - new Date(a.created_at);
        }
    });
    
    presentsList.innerHTML = presents.map(present => {
        const commentsHTML = present.comments ? formatComments(present.comments) : '';
        const shareButtons = generateShareButtons(present);
        const recipientLink = present.recipient_name ? 
            `<a href="/recipients#${present.recipient_id}" class="recipient-link">${escapeHtml(present.recipient_name)}</a>` : 
            'Nie określono';
        
        return `
            <div class="present-item ${present.is_checked ? 'checked' : ''}" data-id="${present.id}">
                <div class="row align-items-center">
                    <div class="col-md-1 text-center">
                        <div class="form-check d-flex justify-content-center">
                            <input class="form-check-input" type="checkbox" 
                                   ${present.is_checked ? 'checked' : ''} 
                                   onchange="togglePresent(${present.id}, this.checked)">
                        </div>
                    </div>
                    <div class="col-md-3">
                        <h5 class="present-title mb-1">${escapeHtml(present.title)}</h5>
                        <small class="text-muted">
                            <i class="fas fa-user me-1"></i>
                            ${recipientLink}
                        </small>
                    </div>
                    <div class="col-md-4">
                        ${commentsHTML}
                        ${shareButtons}
                    </div>
                    <div class="col-md-2 text-center">
                        <small class="present-date">
                            ${new Date(present.created_at).toLocaleDateString('pl-PL')}
                        </small>
                    </div>
                    <div class="col-md-1">
                        <div class="btn-group-vertical btn-group-sm" role="group">
                            <button class="btn btn-outline-primary btn-sm mb-1" onclick="editPresent(${present.id}, '${escapeHtml(present.title)}', '${escapeHtml(present.comments || '')}', ${present.recipient_id || 'null'})" title="Edytuj">
                                <i class="fas fa-edit"></i>
                            </button>
                            <button class="btn btn-outline-danger btn-sm" onclick="deletePresent(${present.id})" title="Usuń">
                                <i class="fas fa-trash"></i>
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        `;
    }).join('');
}

function formatComments(comments) {
    if (!comments) return '';
    
    // Escape HTML first to prevent XSS
    let escapedComments = escapeHtml(comments);
    
    // Convert URLs to clickable links with better regex
    const urlRegex = /(https?:\/\/[^\s<>"{}|\\^`\[\]]+)/gi;
    const formattedComments = escapedComments.replace(urlRegex, function(url) {
        // Clean up the URL (remove trailing punctuation)
        const cleanUrl = url.replace(/[.,;:!?]+$/, '');
        const punctuation = url.match(/[.,;:!?]+$/);
        
        return `<a href="${cleanUrl}" target="_blank" rel="noopener noreferrer" class="comment-link">${cleanUrl}</a><i class="fas fa-external-link-alt ms-1" style="font-size: 0.8em; color: var(--ios-blue);"></i>${punctuation ? punctuation[0] : ''}`;
    });
    
    return `<div class="present-comments">${formattedComments}</div>`;
}

function generateShareButtons(present) {
    // Create detailed message with more information
    let message = `🎁 Prezent: ${present.title}`;
    
    if (present.recipient_name) {
        message += `\n👤 Dla: ${present.recipient_name}`;
    }
    
    if (present.comments && present.comments.trim()) {
        message += `\n💭 Komentarz: ${present.comments.trim()}`;
    }
    
    if (present.created_at) {
        const date = new Date(present.created_at);
        const formattedDate = date.toLocaleDateString('pl-PL', { 
            year: 'numeric', 
            month: 'long', 
            day: 'numeric' 
        });
        message += `\n📅 Dodano: ${formattedDate}`;
    }
    
    message += `\n\n🎄 Aplikacja Prezenty - zarządzanie pomysłami na prezenty świąteczne`;
    
    const encodedText = encodeURIComponent(message);
    
    return `
        <div class="share-buttons d-flex gap-1 flex-wrap">
            <a href="https://wa.me/?text=${encodedText}" target="_blank" class="share-btn whatsapp btn btn-sm btn-outline-success">
                <i class="fab fa-whatsapp"></i> WhatsApp
            </a>
            <a href="https://www.facebook.com/dialog/send?link=${encodeURIComponent(window.location.origin)}&app_id=966242223397117&redirect_uri=${encodeURIComponent(window.location.origin)}&quote=${encodedText}" target="_blank" class="share-btn messenger btn btn-sm btn-outline-primary">
                <i class="fab fa-facebook-messenger"></i> Messenger
            </a>
            <a href="mailto:?subject=🎁 Prezent: ${encodeURIComponent(present.title)}&body=${encodedText}" class="share-btn email btn btn-sm btn-outline-secondary">
                <i class="fas fa-envelope"></i> Email
            </a>
        </div>
    `;
}

function addPresent() {
    const title = document.getElementById('presentTitle').value.trim();
    const recipientId = document.getElementById('recipientSelect').value;
    const comments = document.getElementById('comments').value.trim();
    
    if (!title) {
        showFormMessage('Nazwa prezentu jest wymagana', 'danger');
        return;
    }
    
    if (!recipientId) {
        showFormMessage('Wybierz osobę dla której jest prezent', 'danger');
        return;
    }
    
    const submitBtn = document.querySelector('#presentForm button[type="submit"]');
    const originalText = submitBtn.innerHTML;
    submitBtn.innerHTML = '<span class="spinner-border spinner-border-sm me-2"></span>Dodawanie...';
    submitBtn.disabled = true;
    
    fetch('/api/presents', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            title: title,
            recipient_id: recipientId,
            comments: comments
        })
    })
    .then(response => response.json())
    .then(data => {
        if (data.id) {
            showFormMessage('Prezent został dodany pomyślnie!', 'success');
            document.getElementById('presentForm').reset();
            loadPresents();
        } else {
            showFormMessage(data.error || 'Błąd podczas dodawania prezentu', 'danger');
        }
    })
    .catch(error => {
        console.error('Error:', error);
        showFormMessage('Błąd połączenia z serwerem', 'danger');
    })
    .finally(() => {
        if (submitBtn) {
            submitBtn.innerHTML = originalText;
            submitBtn.disabled = false;
        }
    });
}

function togglePresent(id, isChecked) {
    console.log('togglePresent called with:', { id, isChecked });
    fetch(`/api/presents/${id}/check`, {
        method: 'PUT',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({ is_checked: isChecked })
    })
    .then(response => response.json())
    .then(data => {
        console.log('Toggle response:', data);
        if (data.success) {
            console.log('Toggle successful, adding animation...');
            
            // Add animation effect for checked presents
            const presentItem = document.querySelector(`[data-id="${id}"]`);
            if (presentItem) {
                console.log('Found present item:', presentItem);
                
                if (isChecked) {
                    // Add checking animation
                    presentItem.classList.add('checking');
                    setTimeout(() => {
                        presentItem.classList.remove('checking');
                        presentItem.classList.add('checked');
                    }, 250);
                } else {
                    // Add unchecking animation
                    presentItem.classList.add('unchecking');
                    setTimeout(() => {
                        presentItem.classList.remove('unchecking');
                        presentItem.classList.remove('checked');
                    }, 250);
                }
            } else {
                console.log('Present item not found in DOM');
            }
            
            // Refresh the display to update sorting after animation
            setTimeout(() => {
                console.log('Calling loadPresents to refresh data...');
                loadPresents();
            }, 300);
        } else {
            console.error('Toggle failed:', data.error);
            showErrorModal(data.error || 'Błąd podczas aktualizacji prezentu');
        }
    })
    .catch(error => {
        console.error('Error:', error);
        showErrorModal('Błąd połączenia z serwerem');
    });
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
            loadPresents();
        } else {
            console.error('Error deleting present:', data.error);
        }
    })
    .catch(error => {
        console.error('Error:', error);
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

function clearSearch() {
    document.getElementById('searchInput').value = '';
    filterAndDisplayPresents();
}

// Funkcja do dodawania nowej osoby przez modal
function addNewRecipient() {
    const name = document.getElementById('newRecipientName').value.trim();
    
    if (!name) {
        alert('Proszę wprowadzić imię osoby');
        return;
    }
    
    console.log('Adding new recipient from modal:', { name });
    
    fetch('/api/recipients', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({ name: name })
    })
    .then(response => {
        console.log('Add recipient response status:', response.status);
        return response.json();
    })
    .then(data => {
        console.log('Add recipient response data:', data);
        if (data.id) {
            // Zamknij modal
            const modal = bootstrap.Modal.getInstance(document.getElementById('addRecipientModal'));
            modal.hide();
            
            // Wyczyść formularz
            document.getElementById('addRecipientForm').reset();
            
            // Odśwież listę osób
            loadRecipients();
            
            // Pokaż komunikat sukcesu
            showFormMessage('Osoba została dodana pomyślnie!', 'success');
            
            // Automatycznie wybierz nowo dodaną osobę w obu dropdownach
            setTimeout(() => {
                const select = document.getElementById('recipientSelect');
                const editSelect = document.getElementById('editRecipientSelect');
                select.value = data.id;
                if (editSelect) {
                    editSelect.value = data.id;
                }
            }, 100);
        } else {
            alert('Błąd podczas dodawania osoby: ' + (data.error || 'Nieznany błąd'));
        }
    })
    .catch(error => {
        console.error('Error adding recipient:', error);
        alert('Błąd podczas dodawania osoby. Spróbuj ponownie.');
    });
}

function editPresent(id, title, comments, recipientId) {
    // Store the present ID for the update
    window.currentEditPresentId = id;
    
    // Populate the edit modal
    document.getElementById('editPresentTitle').value = title;
    document.getElementById('editPresentComments').value = comments;
    document.getElementById('editRecipientSelect').value = recipientId || '';
    
    // Show the edit modal
    const modal = new bootstrap.Modal(document.getElementById('editPresentModal'));
    modal.show();
}

function updatePresent() {
    const id = window.currentEditPresentId;
    const title = document.getElementById('editPresentTitle').value.trim();
    const comments = document.getElementById('editPresentComments').value.trim();
    const recipientId = document.getElementById('editRecipientSelect').value;
    
    const submitBtn = document.querySelector('#editPresentForm button[onclick*="updatePresent"]');
    const originalText = submitBtn ? submitBtn.innerHTML : '';
    
    if (!title) {
        showErrorModal('Nazwa prezentu jest wymagana');
        return;
    }
    
    if (!recipientId) {
        showErrorModal('Wybierz osobę dla której jest prezent');
        return;
    }
    
    if (!submitBtn) {
        showErrorModal('Nie można znaleźć przycisku zapisu');
        return;
    }
    submitBtn.innerHTML = '<span class="spinner-border spinner-border-sm me-2"></span>Zapisywanie...';
    submitBtn.disabled = true;
    
    fetch(`/api/presents/${id}`, {
        method: 'PUT',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            title: title,
            recipient_id: recipientId,
            comments: comments
        })
    })
    .then(response => response.json())
    .then(data => {
        if (data.success) {
            showSuccessMessage('Prezent został zaktualizowany pomyślnie!');
            loadPresents();
            
            // Close the modal
            const modal = bootstrap.Modal.getInstance(document.getElementById('editPresentModal'));
            modal.hide();
        } else {
            showErrorModal(data.error || 'Błąd podczas aktualizacji prezentu');
        }
    })
    .catch(error => {
        console.error('Error:', error);
        showErrorModal('Błąd połączenia z serwerem');
    })
    .finally(() => {
        if (submitBtn) {
            submitBtn.innerHTML = originalText;
            submitBtn.disabled = false;
        }
    });
}

function showErrorModal(message) {
    // Zamknij wszystkie otwarte modale Bootstrap przed pokazaniem errorModal
    document.querySelectorAll('.modal.show').forEach(modalEl => {
        const modalInstance = bootstrap.Modal.getInstance(modalEl);
        if (modalInstance) modalInstance.hide();
    });
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
    
    // Auto remove after 3 seconds
    setTimeout(() => {
        if (alertDiv.parentNode) {
            alertDiv.remove();
        }
    }, 3000);
}

// Funkcja do synchronizacji dropdownów
function syncDropdowns() {
    const mainSelect = document.getElementById('recipientSelect');
    const editSelect = document.getElementById('editRecipientSelect');
    
    if (mainSelect && editSelect) {
        // Skopiuj wszystkie opcje z głównego dropdowna do edycji
        editSelect.innerHTML = mainSelect.innerHTML;
    }
} 