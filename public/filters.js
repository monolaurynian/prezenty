// Filters System
console.log('Filters loading...');

let allRecipients = [];
let allPresents = [];

// Filter functionality - Define globally
let activeStatusFilter = 'all';
let activePersonFilter = 'all';

function populatePersonFilter() {
    const select = document.getElementById('personFilter');
    if (!select) return;
    
    // Keep the "all" option and clear others
    select.innerHTML = '<option value="all">Wszystkie osoby</option>';
    
    // Add each recipient
    allRecipients.forEach(recipient => {
        const option = document.createElement('option');
        option.value = recipient.id;
        option.textContent = recipient.name;
        select.appendChild(option);
    });
    
    console.log('[Filter] Populated person filter with', allRecipients.length, 'recipients');
}

function applyPersonFilter(personId) {
    activePersonFilter = personId;
    applyAllFilters();
}

function applyStatusFilter(filterType) {
    activeStatusFilter = filterType;
    
    // Update active button
    document.querySelectorAll('.filter-option').forEach(btn => {
        btn.classList.remove('active');
    });
    const activeBtn = document.querySelector(`[data-filter="${filterType}"]`);
    if (activeBtn) {
        activeBtn.classList.add('active');
    }
    
    applyAllFilters();
}

function applyAllFilters() {
    const recipientItems = document.querySelectorAll('.recipient-item');
    
    console.log('[Filter] Applying filters - Person:', activePersonFilter, 'Status:', activeStatusFilter);
    console.log('[Filter] Found recipient items:', recipientItems.length);
    
    recipientItems.forEach(item => {
        const recipientId = item.getAttribute('data-id');
        
        // Check person filter
        const personMatches = activePersonFilter === 'all' || activePersonFilter === recipientId;
        
        if (!personMatches) {
            item.style.display = 'none';
            return;
        }
        
        // Check status filter for presents
        const presentItems = item.querySelectorAll('.present-item');
        console.log('[Filter] Recipient', recipientId, 'has', presentItems.length, 'presents');
        
        // If no presents, show recipient only if filter is "all"
        if (presentItems.length === 0) {
            item.style.display = activeStatusFilter === 'all' ? '' : 'none';
            console.log('[Filter] Recipient', recipientId, 'has no presents, showing:', activeStatusFilter === 'all');
            return;
        }
        
        let hasVisiblePresent = false;
        
        presentItems.forEach(present => {
            let shouldShow = true;
            
            // If status filter is "all", show everything
            if (activeStatusFilter === 'all') {
                present.style.display = '';
                present.style.height = '';
                present.style.margin = '';
                present.style.padding = '';
                present.style.opacity = '';
                hasVisiblePresent = true;
                return;
            }
            
            // Check for CSS classes first (most reliable)
            const hasReservedByMeClass = present.classList.contains('reserved-by-me');
            const hasReservedByOtherClass = present.classList.contains('reserved-by-other');
            const hasCheckedClass = present.classList.contains('checked');
            
            // Check for buttons as secondary method
            const hasUnreserveButton = present.querySelector('button[onclick*="unreservePresent"]') !== null;
            const hasUncheckButton = present.querySelector('button[onclick*="uncheckPresent"]') !== null;
            
            // A present is reserved if it has reserved classes OR unreserve button
            const isReserved = hasReservedByMeClass || hasReservedByOtherClass || hasUnreserveButton;
            
            // A present is checked if it has checked class OR uncheck button
            const isChecked = hasCheckedClass || hasUncheckButton;
            
            const presentTitle = present.querySelector('.fw-semibold')?.textContent || 'unknown';
            console.log('[Filter] Present:', presentTitle, 
                       'Reserved:', isReserved, '(classes:', hasReservedByMeClass, hasReservedByOtherClass, 'button:', hasUnreserveButton + ')',
                       'Checked:', isChecked, '(class:', hasCheckedClass, 'button:', hasUncheckButton + ')',
                       'Filter:', activeStatusFilter);
            
            switch(activeStatusFilter) {
                case 'unreserved':
                    shouldShow = !isReserved;
                    break;
                case 'reserved':
                    shouldShow = isReserved;
                    break;
                case 'checked':
                    shouldShow = isChecked;
                    break;
                case 'unchecked':
                    shouldShow = !isChecked;
                    break;
                default:
                    shouldShow = true;
            }
            
            console.log('[Filter] Should show:', shouldShow);
            
            if (shouldShow) {
                present.style.display = '';
                present.style.height = '';
                present.style.margin = '';
                present.style.padding = '';
                present.style.opacity = '';
                hasVisiblePresent = true;
            } else {
                present.style.display = 'none';
            }
        });
        
        // Show recipient if has visible presents
        const shouldShowRecipient = hasVisiblePresent;
        item.style.display = shouldShowRecipient ? '' : 'none';
        
        console.log('[Filter] Recipient', recipientId, 'visible:', shouldShowRecipient, 
                   'has visible presents:', hasVisiblePresent);
    });
    
    console.log('[Filter] Filtering complete');
}

// Make functions globally available immediately
window.applyPersonFilter = applyPersonFilter;
window.applyStatusFilter = applyStatusFilter;
window.applyAllFilters = applyAllFilters;
window.populatePersonFilter = populatePersonFilter;

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
            applySearchFilter('', []); // Clear filter
            return;
        }

        autocompleteTimeout = setTimeout(() => {
            performSearchWithAutocomplete(query);
        }, 200);
    });

    // Handle focus - show dropdown if there's text
    searchInput.addEventListener('focus', function() {
        const query = this.value.trim();
        if (query.length > 0) {
            performSearchWithAutocomplete(query);
        }
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
    console.log('[Search] Found recipient items:', recipientItems.length);
    
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
        const presentItems = item.querySelectorAll('.present-item');
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

    console.log(`[Search] Data updated: ${allRecipients.length} recipients, ${allPresents.length} presents`);
    
    // Populate person filter dropdown
    populatePersonFilter();
}

// Perform search with autocomplete
function performSearchWithAutocomplete(query) {
    const lowerQuery = query.toLowerCase();
    const results = [];

    console.log('[Search] Searching for:', query);
    console.log('[Search] Available recipients:', allRecipients.length);
    console.log('[Search] Available presents:', allPresents.length);

    // Search through all recipients and their presents
    allRecipients.forEach(recipient => {
        const recipientNameMatches = recipient.name.toLowerCase().includes(lowerQuery);
        
        // Find matching presents for this recipient
        const matchingPresents = allPresents.filter(present => {
            if (present.recipientId !== recipient.id) return false;
            const searchText = `${present.name} ${present.comment}`.toLowerCase();
            return searchText.includes(lowerQuery);
        });

        // Add to results if recipient name matches OR has matching presents
        if (recipientNameMatches || matchingPresents.length > 0) {
            results.push({
                recipient: recipient,
                nameMatches: recipientNameMatches,
                matchingPresents: matchingPresents,
                allPresents: allPresents.filter(p => p.recipientId === recipient.id)
            });
        }
    });

    console.log('[Search] Found results:', results.length);

    // Show autocomplete dropdown with hierarchical structure
    showAutocomplete(results, query);
    
    // Apply filtering to the main list
    applySearchFilter(query, results);
}

// Apply search filter to main list
function applySearchFilter(query, results) {
    if (!query || query.length === 0) {
        // Clear filter - show everything
        document.querySelectorAll('.recipient-item').forEach(item => {
            item.style.display = '';
        });
        document.querySelectorAll('.list-group-item').forEach(item => {
            item.style.display = '';
            item.style.opacity = '';
        });
        return;
    }

    const lowerQuery = query.toLowerCase();
    const recipientItems = document.querySelectorAll('.recipient-item');
    
    recipientItems.forEach(item => {
        const recipientId = item.getAttribute('data-id');
        const result = results.find(r => r.recipient.id === recipientId);
        
        if (result) {
            // Show this recipient
            item.style.display = '';
            
            // Handle presents
            const presentItems = item.querySelectorAll('.list-group-item');
            presentItems.forEach(present => {
                const presentNameEl = present.querySelector('.fw-semibold');
                const presentName = presentNameEl?.textContent?.trim() || '';
                
                // Check if this present matches
                const isMatching = result.matchingPresents.some(p => p.name === presentName);
                
                if (isMatching) {
                    present.style.display = '';
                    present.style.opacity = '1';
                } else if (result.nameMatches) {
                    // Recipient matches, show all presents dimmed
                    present.style.display = '';
                    present.style.opacity = '0.5';
                } else {
                    // Hide non-matching presents
                    present.style.display = 'none';
                }
            });
        } else {
            // Hide this recipient
            item.style.display = 'none';
        }
    });
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

    if (results.length === 0) {
        dropdown.innerHTML = `
            <div class="autocomplete-empty">
                <i class="fas fa-search"></i>
                <p>Nie znaleziono wyników dla "${escapeHtml(query)}"</p>
            </div>
        `;
        dropdown.classList.add('show');
        return;
    }

    let html = '<div class="autocomplete-section">';
    html += '<div class="autocomplete-section-title"><i class="fas fa-list me-2"></i>Wyniki wyszukiwania</div>';

    // Show up to 10 recipients with their presents
    results.slice(0, 10).forEach(result => {
        const recipient = result.recipient;
        const nameMatches = result.nameMatches;
        const matchingPresents = result.matchingPresents;
        const allPresents = result.allPresents;

        // Recipient item
        const recipientNameHighlighted = nameMatches ? 
            highlightText(recipient.name, query) : 
            escapeHtml(recipient.name);
        
        html += `
            <div class="autocomplete-recipient-group">
                <div class="autocomplete-item autocomplete-recipient ${nameMatches ? 'match' : ''}" 
                     data-type="recipient" 
                     data-id="${recipient.id}">
                    <i class="fas fa-user-circle me-2"></i>
                    <span>${recipientNameHighlighted}</span>
                    ${matchingPresents.length > 0 ? `<span class="badge bg-danger ms-2">${matchingPresents.length}</span>` : ''}
                </div>
        `;

        // Show matching presents as children
        if (matchingPresents.length > 0) {
            html += '<div class="autocomplete-presents-list">';
            matchingPresents.slice(0, 5).forEach(present => {
                const presentHighlighted = highlightText(present.name, query);
                html += `
                    <div class="autocomplete-item autocomplete-present match" 
                         data-type="present" 
                         data-name="${escapeHtml(present.name)}" 
                         data-recipient-id="${recipient.id}">
                        <i class="fas fa-gift me-2"></i>
                        <div class="autocomplete-item-content">
                            <div class="autocomplete-item-title">${presentHighlighted}</div>
                        </div>
                    </div>
                `;
            });
            if (matchingPresents.length > 5) {
                html += `<div class="autocomplete-more-presents">+${matchingPresents.length - 5} więcej prezentów</div>`;
            }
            html += '</div>';
        }

        html += '</div>';
    });

    if (results.length > 10) {
        html += `<div class="autocomplete-more">+${results.length - 10} więcej osób</div>`;
    }

    html += '</div>';

    dropdown.innerHTML = html;
    dropdown.classList.add('show');

    // Add click handlers
    dropdown.querySelectorAll('.autocomplete-item').forEach(item => {
        item.addEventListener('click', function(e) {
            e.stopPropagation();
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

// Note: We don't filter the main list anymore - just show autocomplete suggestions
// Users click on suggestions to navigate to specific items

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
    
    // Clear search input after selection
    const searchInput = document.getElementById('recipientSearch');
    if (searchInput) {
        searchInput.value = '';
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
    
    // Clear search input after selection
    const searchInput = document.getElementById('recipientSearch');
    if (searchInput) {
        searchInput.value = '';
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
