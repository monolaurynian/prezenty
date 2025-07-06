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
let currentSortValue = 'date-desc';

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
    fetch('/api/recipients')
    .then(response => response.json())
    .then(recipients => {
        const select = document.getElementById('recipientSelect');
        select.innerHTML = '<option value="">Wybierz osobę</option>';
        
        recipients.forEach(recipient => {
            const option = document.createElement('option');
            option.value = recipient.id;
            option.textContent = recipient.name;
            select.appendChild(option);
        });
        
        // Dodaj opcję "Dodaj nową osobę"
        const addNewOption = document.createElement('option');
        addNewOption.value = 'add-new';
        addNewOption.className = 'text-primary';
        addNewOption.innerHTML = '<i class="fas fa-plus"></i> + Dodaj nową osobę';
        select.appendChild(addNewOption);
        
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
    fetch('/api/presents')
    .then(response => response.json())
    .then(presents => {
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
    dropdown.style.display = dropdown.style.display === 'none' ? 'block' : 'none';
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
            
            // Hide dropdown
            document.getElementById('sortDropdown').style.display = 'none';
            
            // Refresh display
            filterAndDisplayPresents();
        });
    });
    
    // Set default selected
    const defaultOption = document.querySelector('[data-value="date-desc"]');
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
                    <div class="col-md-1">
                        <div class="form-check">
                            <input class="form-check-input" type="checkbox" 
                                   ${present.is_checked ? 'checked' : ''} 
                                   onchange="togglePresent(${present.id}, this.checked)">
                        </div>
                    </div>
                    <div class="col-md-4">
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
                    <div class="col-md-2">
                        <small class="present-date">
                            ${new Date(present.created_at).toLocaleDateString('pl-PL')}
                        </small>
                    </div>
                    <div class="col-md-1">
                        <button class="btn btn-outline-danger btn-sm" onclick="deletePresent(${present.id})">
                            <i class="fas fa-trash"></i>
                        </button>
                    </div>
                </div>
            </div>
        `;
    }).join('');
}

function formatComments(comments) {
    // Convert URLs to clickable links
    const urlRegex = /(https?:\/\/[^\s]+)/g;
    const formattedComments = comments.replace(urlRegex, '<a href="$1" target="_blank" rel="noopener noreferrer">$1 <i class="fas fa-external-link-alt"></i></a>');
    
    return `<div class="present-comments">${formattedComments}</div>`;
}

function generateShareButtons(present) {
    const text = `Prezent: ${present.title}${present.recipient_name ? ` dla ${present.recipient_name}` : ''}`;
    const encodedText = encodeURIComponent(text);
    
    return `
        <div class="share-buttons">
            <a href="https://wa.me/?text=${encodedText}" target="_blank" class="share-btn whatsapp">
                <i class="fab fa-whatsapp"></i> WhatsApp
            </a>
            <a href="https://www.facebook.com/dialog/send?link=${encodeURIComponent(window.location.origin)}&app_id=966242223397117&redirect_uri=${encodeURIComponent(window.location.origin)}&quote=${encodedText}" target="_blank" class="share-btn messenger">
                <i class="fab fa-facebook-messenger"></i> Messenger
            </a>
            <a href="mailto:?subject=Prezent&body=${encodedText}" class="share-btn email">
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
        submitBtn.innerHTML = originalText;
        submitBtn.disabled = false;
    });
}

function togglePresent(id, isChecked) {
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
            loadPresents();
        } else {
            console.error('Error toggling present:', data.error);
        }
    })
    .catch(error => {
        console.error('Error:', error);
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
    const email = document.getElementById('newRecipientEmail').value.trim();
    const phone = document.getElementById('newRecipientPhone').value.trim();
    const notes = document.getElementById('newRecipientNotes').value.trim();
    
    if (!name) {
        alert('Proszę wprowadzić imię i nazwisko osoby');
        return;
    }
    
    const recipientData = {
        name: name,
        email: email || null,
        phone: phone || null,
        notes: notes || null
    };
    
    fetch('/api/recipients', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(recipientData)
    })
    .then(response => response.json())
    .then(data => {
        if (data.success) {
            // Zamknij modal
            const modal = bootstrap.Modal.getInstance(document.getElementById('addRecipientModal'));
            modal.hide();
            
            // Wyczyść formularz
            document.getElementById('addRecipientForm').reset();
            
            // Odśwież listę osób
            loadRecipients();
            
            // Pokaż komunikat sukcesu
            showFormMessage('Osoba została dodana pomyślnie!', 'success');
            
            // Automatycznie wybierz nowo dodaną osobę
            setTimeout(() => {
                const select = document.getElementById('recipientSelect');
                select.value = data.recipient.id;
            }, 100);
        } else {
            alert('Błąd podczas dodawania osoby: ' + (data.message || 'Nieznany błąd'));
        }
    })
    .catch(error => {
        console.error('Error adding recipient:', error);
        alert('Błąd podczas dodawania osoby. Spróbuj ponownie.');
    });
} 