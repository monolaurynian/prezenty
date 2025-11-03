// Search Autocomplete System
console.log('Search autocomplete loading...');

let autocompleteTimeout = null;
let allRecipients = [];
let allPresents = [];

// Initialize search autocomplete
function initializeSearchAutocomplete() {
    const searchInput = document.getElementById('recipientSearch');
    if (!searchInput) return;

    // Create autocomplete dropdown
    const dropdown = document.createElement('div');
    dropdown.id = 'searchAutocomplete';
    dropdown.className = 'search-autocomplete-dropdown';
    document.body.appendChild(dropdown);

    // Handle input
    searchInput.addEventListener('input', function(e) {
        const query = e.target.value.trim();
        
        clearTimeout(autocompleteTimeout);
        
        if (query.length === 0) {
            hideAutocomplete();
            clearSearchHighlights();
            return;
        }

        autocompleteTimeout = setTimeout(() => {
            performSearchWithAutocomplete(query);
        }, 200);
    });

    // Handle focus
    searchInput.addEventListener('focus', function() {
        if (this.value.trim().length > 0) {
            performSearchWithAutocomplete(this.value.trim());
        }
    });

    // Close dropdown when clicking outside
    document.addEventListener('click', function(e) {
        if (!searchInput.contains(e.target) && !dropdown.contains(e.target)) {
            hideAutocomplete();
        }
    });

    // Reposition dropdown on scroll and resize
    window.addEventListener('scroll', function() {
        if (dropdown.classList.contains('show')) {
            positionDropdown();
        }
    }, true);

    window.addEventListener('resize', function() {
        if (dropdown.classList.contains('show')) {
            positionDropdown();
        }
    });

    // Handle keyboard navigation
    searchInput.addEventListener('keydown', function(e) {
        const items = dropdown.querySelectorAll('.autocomplete-item');
        const activeItem = dropdown.querySelector('.autocomplete-item.active');
        
        if (e.key === 'ArrowDown') {
            e.preventDefault();
            if (!activeItem) {
                items[0]?.classList.add('active');
            } else {
                const next = activeItem.nextElementSibling;
                if (next && next.classList.contains('autocomplete-item')) {
                    activeItem.classList.remove('active');
                    next.classList.add('active');
                    next.scrollIntoView({ block: 'nearest' });
                }
            }
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            if (activeItem) {
                const prev = activeItem.previousElementSibling;
                if (prev && prev.classList.contains('autocomplete-item')) {
                    activeItem.classList.remove('active');
                    prev.classList.add('active');
                    prev.scrollIntoView({ block: 'nearest' });
                }
            }
        } else if (e.key === 'Enter') {
            e.preventDefault();
            if (activeItem) {
                activeItem.click();
            }
        } else if (e.key === 'Escape') {
            hideAutocomplete();
            searchInput.blur();
        }
    });
}

// Collect all searchable data
function updateSearchData() {
    allRecipients = [];
    allPresents = [];

    const recipientItems = document.querySelectorAll('.recipient-item');
    
    recipientItems.forEach(item => {
        const recipientName = item.querySelector('.recipient-name')?.textContent?.trim() || '';
        const recipientId = item.getAttribute('data-id');
        
        if (recipientName && recipientId) {
            allRecipients.push({
                id: recipientId,
                name: recipientName,
                element: item
            });
        }

        // Get presents for this recipient
        const presentItems = item.querySelectorAll('.list-group-item');
        presentItems.forEach(present => {
            // Try multiple selectors for present name
            const presentNameEl = present.querySelector('.fw-semibold') || 
                                 present.querySelector('.present-name') ||
                                 present.querySelector('[data-present-title]');
            const presentName = presentNameEl?.textContent?.trim() || 
                               present.getAttribute('data-present-title') || '';
            
            // Get comment from text-muted small div
            const presentCommentEl = present.querySelector('.text-muted.small');
            const presentComment = presentCommentEl?.textContent?.trim() || '';
            
            if (presentName) {
                allPresents.push({
                    name: presentName,
                    comment: presentComment,
                    recipient: recipientName,
                    recipientId: recipientId,
                    element: present
                });
            }
        });
    });

    console.log(`Search data updated: ${allRecipients.length} recipients, ${allPresents.length} presents`);
}

// Perform search with autocomplete
function performSearchWithAutocomplete(query) {
    const lowerQuery = query.toLowerCase();
    const results = {
        recipients: [],
        presents: []
    };

    // Search recipients
    allRecipients.forEach(recipient => {
        if (recipient.name.toLowerCase().includes(lowerQuery)) {
            results.recipients.push(recipient);
        }
    });

    // Search presents
    allPresents.forEach(present => {
        const searchText = `${present.name} ${present.comment}`.toLowerCase();
        if (searchText.includes(lowerQuery)) {
            results.presents.push(present);
        }
    });

    // Show autocomplete dropdown
    showAutocomplete(results, query);

    // Highlight matching items in the list
    highlightSearchResults(query);
}

// Position dropdown relative to search input
function positionDropdown() {
    const searchInput = document.getElementById('recipientSearch');
    const dropdown = document.getElementById('searchAutocomplete');
    if (!searchInput || !dropdown) return;

    const rect = searchInput.getBoundingClientRect();
    dropdown.style.top = `${rect.bottom + 8}px`;
    dropdown.style.left = `${rect.left}px`;
    dropdown.style.width = `${Math.max(rect.width, 300)}px`;
}

// Show autocomplete dropdown
function showAutocomplete(results, query) {
    const dropdown = document.getElementById('searchAutocomplete');
    if (!dropdown) return;
    
    // Position the dropdown
    positionDropdown();

    const totalResults = results.recipients.length + results.presents.length;

    if (totalResults === 0) {
        dropdown.innerHTML = `
            <div class="autocomplete-empty">
                <i class="fas fa-search"></i>
                <p>Nie znaleziono wyników dla "${escapeHtml(query)}"</p>
            </div>
        `;
        dropdown.classList.add('show');
        return;
    }

    let html = '';

    // Recipients section
    if (results.recipients.length > 0) {
        html += '<div class="autocomplete-section">';
        html += '<div class="autocomplete-section-title"><i class="fas fa-user me-2"></i>Osoby</div>';
        
        results.recipients.slice(0, 5).forEach(recipient => {
            const highlighted = highlightText(recipient.name, query);
            html += `
                <div class="autocomplete-item" data-type="recipient" data-id="${recipient.id}">
                    <i class="fas fa-user-circle me-2"></i>
                    <span>${highlighted}</span>
                </div>
            `;
        });

        if (results.recipients.length > 5) {
            html += `<div class="autocomplete-more">+${results.recipients.length - 5} więcej</div>`;
        }
        html += '</div>';
    }

    // Presents section
    if (results.presents.length > 0) {
        html += '<div class="autocomplete-section">';
        html += '<div class="autocomplete-section-title"><i class="fas fa-gift me-2"></i>Prezenty</div>';
        
        results.presents.slice(0, 8).forEach(present => {
            const highlighted = highlightText(present.name, query);
            html += `
                <div class="autocomplete-item" data-type="present" data-name="${escapeHtml(present.name)}" data-recipient-id="${present.recipientId}">
                    <i class="fas fa-gift me-2"></i>
                    <div class="autocomplete-item-content">
                        <div class="autocomplete-item-title">${highlighted}</div>
                        <div class="autocomplete-item-subtitle">dla: ${escapeHtml(present.recipient)}</div>
                    </div>
                </div>
            `;
        });

        if (results.presents.length > 8) {
            html += `<div class="autocomplete-more">+${results.presents.length - 8} więcej</div>`;
        }
        html += '</div>';
    }

    dropdown.innerHTML = html;
    dropdown.classList.add('show');

    // Add click handlers
    dropdown.querySelectorAll('.autocomplete-item').forEach(item => {
        item.addEventListener('click', function() {
            const type = this.getAttribute('data-type');
            
            if (type === 'recipient') {
                const recipientId = this.getAttribute('data-id');
                scrollToRecipient(recipientId);
            } else if (type === 'present') {
                const presentName = this.getAttribute('data-name');
                const recipientId = this.getAttribute('data-recipient-id');
                scrollToPresent(presentName, recipientId);
            }
            
            hideAutocomplete();
        });

        // Hover effect
        item.addEventListener('mouseenter', function() {
            dropdown.querySelectorAll('.autocomplete-item').forEach(i => i.classList.remove('active'));
            this.classList.add('active');
        });
    });
}

// Hide autocomplete dropdown
function hideAutocomplete() {
    const dropdown = document.getElementById('searchAutocomplete');
    if (dropdown) {
        dropdown.classList.remove('show');
    }
}

// Highlight search results in the list
function highlightSearchResults(query) {
    const lowerQuery = query.toLowerCase();
    
    // Clear previous highlights
    clearSearchHighlights();

    // Highlight matching recipients and presents
    const recipientItems = document.querySelectorAll('.recipient-item');
    
    recipientItems.forEach(item => {
        const recipientName = item.querySelector('.recipient-name')?.textContent || '';
        const recipientMatches = recipientName.toLowerCase().includes(lowerQuery);
        
        if (recipientMatches) {
            item.classList.add('search-highlight');
        }

        // Check presents
        const presentItems = item.querySelectorAll('.list-group-item');
        let hasMatchingPresent = false;
        let visiblePresentCount = 0;

        presentItems.forEach(present => {
            const presentNameEl = present.querySelector('.fw-semibold') || 
                                 present.querySelector('.present-name');
            const presentName = presentNameEl?.textContent || '';
            
            const presentCommentEl = present.querySelector('.text-muted.small');
            const presentComment = presentCommentEl?.textContent || '';
            
            const searchText = `${presentName} ${presentComment}`.toLowerCase();
            
            if (searchText.includes(lowerQuery)) {
                present.classList.add('search-highlight');
                present.style.display = '';
                present.style.opacity = '1';
                hasMatchingPresent = true;
                visiblePresentCount++;
            } else if (recipientMatches) {
                // If recipient matches, show all presents but dimmed
                present.style.display = '';
                present.style.opacity = '0.4';
            } else {
                // Hide presents that don't match when recipient doesn't match
                present.style.display = 'none';
                present.style.opacity = '1';
            }
        });

        // Show recipient if either name matches OR has matching presents
        if (recipientMatches || hasMatchingPresent) {
            item.style.display = '';
            
            // Add a visual indicator if only presents match (not recipient name)
            if (!recipientMatches && hasMatchingPresent) {
                item.style.opacity = '1';
            }
        } else {
            item.style.display = 'none';
        }
    });
}

// Clear search highlights
function clearSearchHighlights() {
    document.querySelectorAll('.search-highlight').forEach(el => {
        el.classList.remove('search-highlight');
    });
    
    document.querySelectorAll('.list-group-item').forEach(el => {
        el.style.opacity = '';
        el.style.display = '';
    });
    
    document.querySelectorAll('.recipient-item').forEach(el => {
        el.style.display = '';
        el.style.opacity = '';
    });
}

// Scroll to recipient
function scrollToRecipient(recipientId) {
    const element = document.querySelector(`[data-id="${recipientId}"]`);
    if (element) {
        element.scrollIntoView({ behavior: 'smooth', block: 'center' });
        element.classList.add('highlight-flash');
        setTimeout(() => {
            element.classList.remove('highlight-flash');
        }, 2000);
    }
}

// Scroll to present
function scrollToPresent(presentName, recipientId) {
    const recipientElement = document.querySelector(`[data-id="${recipientId}"]`);
    if (!recipientElement) return;

    const presentItems = recipientElement.querySelectorAll('.list-group-item');
    
    for (let present of presentItems) {
        const nameEl = present.querySelector('.fw-semibold') || 
                      present.querySelector('.present-name');
        const name = nameEl?.textContent?.trim();
        if (name === presentName) {
            present.scrollIntoView({ behavior: 'smooth', block: 'center' });
            present.classList.add('highlight-flash');
            setTimeout(() => {
                present.classList.remove('highlight-flash');
            }, 2000);
            break;
        }
    }
}

// Highlight text with query
function highlightText(text, query) {
    if (!query) return escapeHtml(text);
    
    const regex = new RegExp(`(${escapeRegex(query)})`, 'gi');
    return escapeHtml(text).replace(regex, '<mark>$1</mark>');
}

// Escape HTML
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// Escape regex special characters
function escapeRegex(string) {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Initialize when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializeSearchAutocomplete);
} else {
    initializeSearchAutocomplete();
}

// Export functions for external use
window.updateSearchData = updateSearchData;
window.clearSearchHighlights = clearSearchHighlights;
