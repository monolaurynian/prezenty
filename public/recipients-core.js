console.log('Recipients.js loading... v7.0 - Reverted to separate API calls');

// Handle scrolling to present from notification
function handleScrollToPresentFromNotification() {
    // Don't run if we're in the process of logging out
    if (window._isLoggingOut) return;

    const presentId = sessionStorage.getItem('scrollToPresentId');
    if (presentId) {
        sessionStorage.removeItem('scrollToPresentId');

        // Wait for page to load, then scroll to the present
        setTimeout(() => {
            scrollToPresentById(presentId);
        }, 500);
    }
}

// Scroll to a specific present
function scrollToPresentById(presentId) {
    console.log('[Notification] Scrolling to present:', presentId);

    // Function to find and scroll to present
    const findAndScroll = () => {
        // Find the present element
        const presentElement = document.querySelector(`.present-item[data-id="${presentId}"]`);

        if (presentElement) {
            // Check if it's inside a collapsed accordion (identified user's presents)
            const accordion = presentElement.closest('.accordion-collapse');
            if (accordion && !accordion.classList.contains('show')) {
                // Expand the accordion first
                const accordionButton = document.querySelector(`[data-bs-target="#${accordion.id}"]`);
                if (accordionButton) {
                    accordionButton.click();
                    // Wait for accordion to expand, then scroll
                    setTimeout(() => {
                        scrollAndHighlight(presentElement);
                    }, 350); // Bootstrap accordion transition time
                    return;
                }
            }

            // Check if it's inside a collapsed recipient card
            const recipientCard = presentElement.closest('.recipient-card');
            if (recipientCard) {
                const collapseElement = recipientCard.querySelector('.collapse');
                if (collapseElement && !collapseElement.classList.contains('show')) {
                    // Expand the recipient card first
                    const cardButton = recipientCard.querySelector('[data-bs-toggle="collapse"]');
                    if (cardButton) {
                        cardButton.click();
                        // Wait for card to expand, then scroll
                        setTimeout(() => {
                            scrollAndHighlight(presentElement);
                        }, 350);
                        return;
                    }
                }
            }

            // Scroll immediately if not in accordion or already expanded
            scrollAndHighlight(presentElement);
        } else {
            console.warn('[Notification] Present element not found:', presentId);
        }
    };

    // Try immediately
    findAndScroll();

    // If not found, wait for data to load and try again
    if (!document.querySelector(`.present-item[data-id="${presentId}"]`)) {
        console.log('[Notification] Present not found yet, waiting for data to load...');
        setTimeout(findAndScroll, 1000);
        setTimeout(findAndScroll, 2000);
    }
}

// Helper function to scroll and highlight
function scrollAndHighlight(presentElement) {
    // Scroll to the element
    presentElement.scrollIntoView({ behavior: 'smooth', block: 'center' });

    // Highlight the present
    presentElement.style.transition = 'background-color 0.3s ease';
    const originalBg = presentElement.style.backgroundColor;
    presentElement.style.backgroundColor = 'rgba(33, 150, 243, 0.2)';
    setTimeout(() => {
        presentElement.style.backgroundColor = originalBg;
    }, 3000);

    console.log('[Notification] Scrolled to present successfully');
}



// Call on page load
document.addEventListener('DOMContentLoaded', handleScrollToPresentFromNotification);
window.addEventListener('load', handleScrollToPresentFromNotification);

// Global logout function - ensure it's always available
function logout() {
    console.log('[Logout] Clearing all caches...');

    // Set flag to prevent scroll handler from interfering
    window._isLoggingOut = true;

    // Clear localStorage cache
    try {
        localStorage.removeItem('recipientsCache');
        localStorage.removeItem('app_data_cache');
        localStorage.removeItem('app_data_cache_timestamp');
        localStorage.removeItem('last_update_timestamp');
        localStorage.removeItem('app_version');
        console.log('[Logout] localStorage cleared');
    } catch (e) {
        console.error('[Logout] Error clearing localStorage:', e);
    }

    // Clear sessionStorage
    try {
        sessionStorage.clear();
        console.log('[Logout] sessionStorage cleared');
    } catch (e) {
        console.error('[Logout] Error clearing sessionStorage:', e);
    }

    // Clear service worker caches
    if ('caches' in window) {
        caches.keys().then(keys => {
            keys.forEach(key => {
                caches.delete(key);
                console.log('[Logout] Deleted cache:', key);
            });
        }).catch(e => {
            console.error('[Logout] Error clearing caches:', e);
        });
    }

    // Perform logout
    fetch('/api/logout', {
        method: 'POST'
    })
        .then(response => response.json())
        .then(data => {
            if (data.success) {
                console.log('[Logout] Logout successful, redirecting...');
                window.location.href = '/';
            }
        })
        .catch(error => {
            console.error('Logout error:', error);
            window.location.href = '/';
        });
}

let currentUserId = null;
let currentRecipientId = null;
let pendingIdentificationRecipientId = null;

// Register service worker
if ('serviceWorker' in navigator) {
    window.addEventListener('load', function () {
        navigator.serviceWorker.register('/sw.js')
            .then(function (registration) {
                console.log('ServiceWorker registration successful');
            })
            .catch(function (err) {
                console.log('ServiceWorker registration failed: ', err);
            });
    });
}

// Search and filter functionality
let currentFilter = 'all';
let searchTimeout = null;

function initializeSearchAndFilter() {
    const searchInput = document.getElementById('searchInput');
    const clearSearch = document.getElementById('clearSearch');
    const closeSearch = document.getElementById('closeSearch');
    const searchToggle = document.getElementById('searchToggle');
    const searchContainer = document.getElementById('searchContainer');
    const filterButtons = document.querySelectorAll('.filter-btn');

    // Mobile search toggle
    if (searchToggle && searchContainer) {
        searchToggle.addEventListener('click', function () {
            searchContainer.classList.add('expanded');
            if (searchInput) {
                setTimeout(() => {
                    searchInput.focus();
                }, 300);
            }
        });
    }

    // Close search on mobile
    if (closeSearch && searchContainer) {
        closeSearch.addEventListener('click', function () {
            searchContainer.classList.remove('expanded');
            if (searchInput) {
                searchInput.value = '';
                performSearch('');
            }
            hideSearchDropdown();
        });
    }

    if (searchInput) {
        searchInput.addEventListener('input', function (e) {
            const query = e.target.value;

            // Show/hide clear button
            if (clearSearch) {
                clearSearch.style.display = query ? 'block' : 'none';
            }

            // Debounce search
            clearTimeout(searchTimeout);
            searchTimeout = setTimeout(() => {
                performSearch(query);
            }, 300);
        });

        // Keep dropdown open when clicking inside search box
        searchInput.addEventListener('focus', function () {
            if (this.value) {
                performSearch(this.value);
            }
        });
    }

    if (clearSearch) {
        clearSearch.addEventListener('click', function () {
            searchInput.value = '';
            clearSearch.style.display = 'none';
            performSearch('');
        });
    }

    filterButtons.forEach(btn => {
        btn.addEventListener('click', function () {
            filterButtons.forEach(b => b.classList.remove('active'));
            this.classList.add('active');
            currentFilter = this.dataset.filter;
            applyFilter();
        });
    });

    // Close dropdown when clicking outside
    document.addEventListener('click', function (e) {
        const searchBox = document.querySelector('.search-box');
        const dropdown = document.getElementById('searchResults');
        const searchContainer = document.getElementById('searchContainer');

        if (searchBox && dropdown && !searchBox.contains(e.target)) {
            hideSearchDropdown();
        }

        // Close mobile search when clicking outside
        if (searchContainer && !searchContainer.contains(e.target) && !e.target.closest('#searchToggle')) {
            searchContainer.classList.remove('expanded');
        }
    });
}

function performSearch(query) {
    const recipientItems = document.querySelectorAll('.recipient-item');
    const lowerQuery = query.toLowerCase();
    const searchResults = [];

    if (!query) {
        // Clear search - show everything
        recipientItems.forEach(item => {
            item.style.display = '';
            const presents = Array.from(item.querySelectorAll('.present-item'));
            presents.forEach(present => {
                present.style.display = '';
            });
        });
        hideSearchDropdown();
        hideNoResultsMessage();
        return;
    }

    recipientItems.forEach(item => {
        const recipientName = item.querySelector('.recipient-name')?.textContent || '';
        const recipientId = item.getAttribute('data-id');
        const lowerRecipientName = recipientName.toLowerCase();
        const presents = Array.from(item.querySelectorAll('.present-item'));

        let hasMatch = lowerRecipientName.includes(lowerQuery);

        // Check if recipient name matches
        if (hasMatch) {
            searchResults.push({
                type: 'recipient',
                name: recipientName,
                id: recipientId,
                element: item
            });
        }

        // Check presents
        presents.forEach(present => {
            const presentTitle = present.querySelector('.present-name')?.textContent || '';
            const presentText = present.textContent.toLowerCase();
            const presentMatches = presentText.includes(lowerQuery);

            if (presentMatches) {
                searchResults.push({
                    type: 'present',
                    name: presentTitle,
                    recipient: recipientName,
                    element: present
                });
                hasMatch = true;
            }

            present.style.display = presentMatches ? '' : 'none';
        });

        item.style.display = hasMatch ? '' : 'none';
    });

    // Show search results dropdown
    showSearchDropdown(searchResults, query);

    // Show "no results" message if needed
    if (searchResults.length === 0) {
        showNoResultsMessage();
    } else {
        hideNoResultsMessage();
    }
}

function applyFilter() {
    // Save scroll position before filtering
    const scrollPosition = window.pageYOffset || document.documentElement.scrollTop;

    const recipientItems = document.querySelectorAll('.recipient-item');

    recipientItems.forEach(item => {
        const presents = Array.from(item.querySelectorAll('.present-item'));
        let hasVisiblePresent = false;

        presents.forEach(present => {
            let shouldShow = true;

            switch (currentFilter) {
                case 'unreserved':
                    shouldShow = !present.classList.contains('reserved-by-me') &&
                        !present.classList.contains('reserved-by-other');
                    break;
                case 'my-reserved':
                    shouldShow = present.classList.contains('reserved-by-me');
                    break;
                case 'unchecked':
                    shouldShow = !present.classList.contains('checked');
                    break;
                case 'all':
                default:
                    shouldShow = true;
            }

            present.style.display = shouldShow ? '' : 'none';
            if (shouldShow) hasVisiblePresent = true;
        });

        // Hide recipient if no presents match filter
        item.style.display = hasVisiblePresent ? '' : 'none';
    });

    // Restore scroll position after filtering to prevent jumping
    requestAnimationFrame(() => {
        window.scrollTo(0, scrollPosition);
    });
}

function showSearchDropdown(results, query) {
    const dropdown = document.getElementById('searchResults');
    const resultsList = dropdown.querySelector('.search-results-list');
    const resultsCount = dropdown.querySelector('.results-count');

    if (!dropdown || !resultsList) return;

    // Update count
    resultsCount.textContent = `Znaleziono: ${results.length}`;

    // Group results by type
    const recipients = results.filter(r => r.type === 'recipient');
    const presents = results.filter(r => r.type === 'present');

    let html = '';

    if (recipients.length > 0) {
        html += '<div class="search-results-section">';
        html += '<div class="search-results-section-title"><i class="fas fa-user me-2"></i>Osoby</div>';
        recipients.slice(0, 5).forEach(result => {
            const highlighted = highlightText(result.name, query);
            html += `
                <div class="search-result-item" onclick="scrollToElement('recipient-${result.id}')">
                    <i class="fas fa-user-circle me-2"></i>
                    <span>${highlighted}</span>
                </div>
            `;
        });
        if (recipients.length > 5) {
            html += `<div class="search-results-more">+${recipients.length - 5} więcej</div>`;
        }
        html += '</div>';
    }

    if (presents.length > 0) {
        html += '<div class="search-results-section">';
        html += '<div class="search-results-section-title"><i class="fas fa-gift me-2"></i>Prezenty</div>';
        presents.slice(0, 5).forEach(result => {
            const highlighted = highlightText(result.name, query);
            html += `
                <div class="search-result-item" onclick="scrollToPresent(this)" data-present-name="${escapeAttr(result.name)}">
                    <i class="fas fa-gift me-2"></i>
                    <div>
                        <div>${highlighted}</div>
                        <small class="text-muted">dla: ${escapeHtml(result.recipient)}</small>
                    </div>
                </div>
            `;
        });
        if (presents.length > 5) {
            html += `<div class="search-results-more">+${presents.length - 5} więcej</div>`;
        }
        html += '</div>';
    }

    resultsList.innerHTML = html;
    dropdown.style.display = 'block';
}

function hideSearchDropdown() {
    const dropdown = document.getElementById('searchResults');
    if (dropdown) {
        dropdown.style.display = 'none';
    }
}

function focusSearch() {
    const searchInput = document.getElementById('searchInput');
    const searchContainer = document.getElementById('searchContainer');

    // On mobile, expand search if collapsed
    if (searchContainer && !searchContainer.classList.contains('expanded')) {
        searchContainer.classList.add('expanded');
    }

    // Focus the search input
    if (searchInput) {
        searchInput.focus();
        searchInput.select(); // Select any existing text
    }
}

function highlightText(text, query) {
    if (!query) return escapeHtml(text);
    const regex = new RegExp(`(${escapeRegex(query)})`, 'gi');
    return escapeHtml(text).replace(regex, '<mark>$1</mark>');
}

function escapeRegex(string) {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function scrollToElement(elementId) {
    const element = document.getElementById(elementId);
    if (element) {
        element.scrollIntoView({ behavior: 'smooth', block: 'center' });
        element.classList.add('highlight-flash');
        setTimeout(() => {
            element.classList.remove('highlight-flash');
        }, 2000);
    }
    hideSearchDropdown();
}

function scrollToPresent(element) {
    const presentName = element.getAttribute('data-present-name');
    const presents = document.querySelectorAll('.present-item');

    for (let present of presents) {
        const name = present.querySelector('.present-name')?.textContent;
        if (name === presentName) {
            present.scrollIntoView({ behavior: 'smooth', block: 'center' });
            present.classList.add('highlight-flash');
            setTimeout(() => {
                present.classList.remove('highlight-flash');
            }, 2000);
            break;
        }
    }
    hideSearchDropdown();
}

function showNoResultsMessage() {
    let noResults = document.getElementById('noResultsMessage');
    if (!noResults) {
        noResults = document.createElement('div');
        noResults.id = 'noResultsMessage';
        noResults.className = 'empty-state';
        noResults.innerHTML = `
            <i class="fas fa-search"></i>
            <h5>Nie znaleziono wyników</h5>
            <p>Spróbuj użyć innych słów kluczowych</p>
        `;
        document.getElementById('recipientsList').appendChild(noResults);
    }
}

function hideNoResultsMessage() {
    const noResults = document.getElementById('noResultsMessage');
    if (noResults) {
        noResults.remove();
    }
}

// FAB (Floating Action Button) functionality
function initializeFAB() {
    // FAB now directly opens add present modal via onclick attribute
    // No additional initialization needed
}

// Keyboard shortcuts
document.addEventListener('keydown', function (e) {
    // Ctrl/Cmd + F - Focus search
    if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
        e.preventDefault();
        const searchInput = document.getElementById('searchInput');
        if (searchInput) {
            searchInput.focus();
            searchInput.select();
        }
    }

    // Ctrl/Cmd + K - Add present
    if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault();
        openAddPresentModal();
    }

    // Ctrl/Cmd + P - Add person
    if ((e.ctrlKey || e.metaKey) && e.key === 'p') {
        e.preventDefault();
        openAddRecipientModal();
    }

    // Ctrl/Cmd + Shift + R - Refresh
    if ((e.ctrlKey || e.metaKey) && e.key === 'R' && e.shiftKey) {
        e.preventDefault();
        loadRecipients();
    }

    // Ctrl/Cmd + B - Reserved presents
    if ((e.ctrlKey || e.metaKey) && e.key === 'b') {
        e.preventDefault();
        openReservedPresentsModal();
    }

    // Escape - Clear search
    if (e.key === 'Escape') {
        const searchInput = document.getElementById('searchInput');
        if (searchInput && searchInput.value) {
            searchInput.value = '';
            document.getElementById('clearSearch').style.display = 'none';
            performSearch('');
        }
    }
});

