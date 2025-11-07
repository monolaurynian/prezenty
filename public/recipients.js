console.log('Recipients.js loading... v7.0 - Reverted to separate API calls');

// Handle scrolling to present from notification
function handleScrollToPresentFromNotification() {
    // Don't run if we're in the process of logging out
    if (window._isLoggingOut) return;
    
    const presentId = sessionStorage.getItem('scrollToPresentId');
    if (!presentId) return; // Exit early if no scroll target
    
    sessionStorage.removeItem('scrollToPresentId');
    
    let resizeObserver = null;
    let lastScrollPosition = null;
    
    // Retry scrolling with exponential backoff to handle privacy screen loading
    const scrollToPresentWithRetry = (retries = 0, maxRetries = 10) => {
        const presentElement = document.querySelector(`.present-item[data-id="${presentId}"]`);
        if (presentElement) {
            // Scroll to the element
            presentElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
            lastScrollPosition = presentElement.getBoundingClientRect().top + window.scrollY;
            
            // Watch for layout changes (privacy screen loading) and re-adjust scroll
            if (!resizeObserver) {
                resizeObserver = new ResizeObserver(() => {
                    // When layout changes, re-scroll to keep element in view
                    if (presentElement && presentElement.offsetParent !== null) {
                        const currentTop = presentElement.getBoundingClientRect().top + window.scrollY;
                        const scrollDifference = currentTop - lastScrollPosition;
                        
                        // If layout shifted significantly, adjust scroll to keep element centered
                        if (Math.abs(scrollDifference) > 10) {
                            presentElement.scrollIntoView({ behavior: 'auto', block: 'center' });
                            lastScrollPosition = presentElement.getBoundingClientRect().top + window.scrollY;
                            console.log('[Notification] Adjusted scroll due to layout change');
                        }
                    }
                });
                
                // Only observe the specific present element, not the entire body
                resizeObserver.observe(presentElement);
                
                // Stop observing after 3 seconds (privacy screen should be loaded by then)
                setTimeout(() => {
                    if (resizeObserver) {
                        resizeObserver.disconnect();
                        resizeObserver = null;
                    }
                }, 3000);
            }
            
            // Highlight the element briefly
            presentElement.style.transition = 'background-color 0.3s ease';
            const originalBg = presentElement.style.backgroundColor;
            presentElement.style.backgroundColor = 'rgba(33, 150, 243, 0.2)';
            setTimeout(() => {
                presentElement.style.backgroundColor = originalBg;
            }, 2000);
            
            console.log('[Notification] Scrolled to present:', presentId);
        } else if (retries < maxRetries) {
            // Retry with increasing delays to handle privacy screen loading
            const delay = Math.min(100 + (retries * 50), 500);
            setTimeout(() => scrollToPresentWithRetry(retries + 1, maxRetries), delay);
        } else {
            console.warn('[Notification] Present element not found after retries:', presentId);
        }
    };
    
    // Start scrolling after initial page load
    setTimeout(() => scrollToPresentWithRetry(), 300);
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
                <div class="search-result-item" onclick="scrollToPresent(this)" data-present-name="${escapeHtml(result.name)}">
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

document.addEventListener('DOMContentLoaded', function () {
    // Clean up old cache keys on startup (prevent quota issues)
    try {
        const keysToCheck = ['app_data_cache', 'app_data_cache_timestamp', 'last_update_timestamp'];
        keysToCheck.forEach(key => {
            if (localStorage.getItem(key)) {
                console.log('[Cleanup] Removing duplicate cache key:', key);
                localStorage.removeItem(key);
            }
        });
    } catch (e) {
        console.error('[Cleanup] Error cleaning cache:', e);
    }

    // OPTIMIZATION: Smart cache display - show others instantly, hide identified user
    let persistentCache = null;
    try {
        persistentCache = loadFromPersistentCache();
        if (persistentCache) {
            const isIdentified = persistentCache.data.identificationStatus &&
                persistentCache.data.identificationStatus.isIdentified;

            if (isIdentified) {
                console.log('[FastLoad] User is identified - showing OTHER recipients from cache, hiding own');

                // Find which recipient the user is identified as
                const identifiedRecipientId = persistentCache.data.recipients.find(
                    r => r.identified_by === persistentCache.data.identificationStatus.userId
                )?.id;

                if (identifiedRecipientId) {
                    // Filter out the identified recipient and their presents
                    const filteredRecipients = persistentCache.data.recipients.filter(
                        r => r.id !== identifiedRecipientId
                    );
                    const filteredPresents = persistentCache.data.presents.filter(
                        p => p.recipient_id !== identifiedRecipientId
                    );

                    console.log('[FastLoad] Showing', filteredRecipients.length, 'other recipients instantly');

                    // Show filtered data immediately (fast!)
                    displayRecipientsData(filteredRecipients, filteredPresents, persistentCache.data.identificationStatus);

                    // Add placeholder for the identified user's card
                    const identifiedRecipient = persistentCache.data.recipients.find(r => r.id === identifiedRecipientId);
                    if (identifiedRecipient) {
                        setTimeout(() => {
                            const recipientsList = document.getElementById('recipientsList');
                            if (recipientsList && !recipientsList.querySelector('.loading-placeholder')) {
                                const placeholder = document.createElement('div');
                                placeholder.className = 'col-12 loading-placeholder';
                                placeholder.innerHTML = `
                                    <div class="card main-card" style="background: linear-gradient(135deg, #fff3cd 0%, #ffeaa7 100%); border-left: 4px solid #ffc107;">
                                        <div class="card-body text-center py-4">
                                            <div class="mb-3">
                                                <div class="spinner-border text-warning" role="status" style="width: 3rem; height: 3rem;">
                                                    <span class="visually-hidden">Ładowanie...</span>
                                                </div>
                                            </div>
                                            <h5 class="mb-2">
                                                <i class="fas fa-gift me-2"></i>${identifiedRecipient.name}
                                            </h5>
                                            <p class="text-muted mb-0">
                                                <i class="fas fa-lock me-1"></i>Ładowanie Twoich prezentów z zachowaniem prywatności...
                                            </p>
                                        </div>
                                    </div>
                                `;
                                recipientsList.insertBefore(placeholder, recipientsList.firstChild);
                            }
                        }, 50);
                    }

                    // Store in memory cache
                    window._dataCache = {
                        recipients: filteredRecipients,
                        presents: filteredPresents,
                        identificationStatus: persistentCache.data.identificationStatus
                    };
                    window._dataCacheTimestamp = persistentCache.timestamp;

                    // Mark that we need to reload to get the identified user's data
                    window._needsIdentifiedUserReload = true;
                } else {
                    // Couldn't find identified recipient, show all (safe fallback)
                    console.log('[FastLoad] Showing all cached data');
                    displayRecipientsData(persistentCache.data.recipients, persistentCache.data.presents, persistentCache.data.identificationStatus);
                    window._dataCache = persistentCache.data;
                    window._dataCacheTimestamp = persistentCache.timestamp;
                }
            } else {
                // Not identified - show everything instantly
                console.log('[FastLoad] Showing all cached data immediately');
                displayRecipientsData(persistentCache.data.recipients, persistentCache.data.presents, persistentCache.data.identificationStatus);

                window._dataCache = persistentCache.data;
                window._dataCacheTimestamp = persistentCache.timestamp;
            }
        } else {
            console.log('[FastLoad] No cache available, will load from server');
        }
    } catch (e) {
        console.error('[FastLoad] Error loading cache:', e);
        persistentCache = null;
    }

    // Initialize UI components
    initializeSearchAndFilter();
    initializeFAB();
    initializeAnimations();

    // Check authentication and refresh data if needed
    checkAuth().then(() => {
        // Only reload if cache is stale or missing
        const now = Date.now();
        const cacheAge = persistentCache ? (now - persistentCache.timestamp) : Infinity;

        if (!persistentCache) {
            // No cache - show loading spinner and fetch
            console.log('[FastLoad] No cache, loading data...');
            loadRecipientsWithPresents(false, false);
        } else if (window._needsIdentifiedUserReload) {
            // We showed filtered cache with placeholder - only load the missing identified user
            console.log('[FastLoad] Loading identified user data only');

            // Load fresh data from server
            Promise.all([
                fetch('/api/recipients-with-presents').then(r => r.json()),
                fetch('/api/user/identification').then(r => r.json())
            ]).then(([combinedData, identificationStatus]) => {
                // Find the identified recipient from fresh data
                const identifiedRecipientId = combinedData.recipients.find(
                    r => r.identified_by === identificationStatus.userId
                )?.id;

                if (identifiedRecipientId) {
                    // Get the identified recipient and their presents from fresh data
                    const identifiedRecipient = combinedData.recipients.find(r => r.id === identifiedRecipientId);
                    const identifiedPresents = combinedData.presents.filter(p => p.recipient_id === identifiedRecipientId);

                    // Merge with cached data (others stay from cache, identified user from server)
                    const allRecipients = [
                        ...window._dataCache.recipients, // Keep cached others
                        identifiedRecipient // Add fresh identified user
                    ];
                    const allPresents = [
                        ...window._dataCache.presents, // Keep cached others' presents
                        ...identifiedPresents // Add fresh identified user's presents
                    ];

                    // Remove placeholder
                    const placeholder = document.querySelector('.loading-placeholder');
                    if (placeholder) placeholder.remove();

                    // Display complete data
                    console.log('[FastLoad] Merging cached data with identified user data');
                    displayRecipientsWithPresents(allRecipients, allPresents);

                    // Update cache
                    window._dataCache = {
                        recipients: allRecipients,
                        presents: allPresents,
                        identificationStatus
                    };
                    saveToPersistentCache(window._dataCache);
                }
            }).catch(error => {
                console.error('[FastLoad] Error loading identified user:', error);
                // Fallback: reload everything
                loadRecipientsWithPresents(true, false);
            });

            window._needsIdentifiedUserReload = false; // Clear flag
        } else if (cacheAge > 30000) {
            // Stale cache - refresh silently in background
            console.log('[FastLoad] Refreshing stale data in background (age:', Math.round(cacheAge / 1000), 'seconds)');
            loadRecipientsWithPresents(false, true);
        } else {
            // Fresh cache - no need to reload
            console.log('[FastLoad] Using fresh cached data (age:', Math.round(cacheAge / 1000), 'seconds)');
        }

        // Initialize Bootstrap tooltips (only on non-mobile devices)
        if (window.innerWidth > 768) {
            setTimeout(() => {
                const tooltipTriggerList = [].slice.call(document.querySelectorAll('[data-bs-toggle="tooltip"]'));
                tooltipTriggerList.map(function (tooltipTriggerEl) {
                    return new bootstrap.Tooltip(tooltipTriggerEl);
                });
            }, 100);
        }

        // Set up periodic auth check to detect session expiry
        setInterval(() => {
            checkAuth().catch(() => {
                console.warn('Session expired, redirecting to login');
                window.location.href = '/';
            });
        }, 5 * 60 * 1000); // Check every 5 minutes

    }).catch(error => {
        console.error('Auth failed:', error);
        // Prevent redirect loop - only redirect if we're not already redirecting
        if (!window._isRedirecting) {
            window._isRedirecting = true;
            setTimeout(() => {
                window.location.href = '/';
            }, 100);
        }
    });

    // Profile picture preview
    const profilePictureUrl = document.getElementById('profilePictureUrl');
    profilePictureUrl.addEventListener('input', function () {
        const preview = document.getElementById('profilePicturePreview');
        const url = this.value.trim();

        if (url) {
            preview.src = url;
            preview.style.display = 'block';
            preview.onerror = function () {
                preview.style.display = 'none';
            };
        } else {
            preview.style.display = 'none';
        }
    });

    // Add event listener to submit the new recipient form on Enter
    const newRecipientForm = document.getElementById('newRecipientForm');
    if (newRecipientForm) {
        newRecipientForm.addEventListener('submit', function (e) {
            e.preventDefault();
            addNewRecipientAndIdentify();
        });
    }

    // Add event listener to submit the add person modal form on Enter
    const addRecipientForm = document.getElementById('addRecipientForm');
    if (addRecipientForm) {
        addRecipientForm.addEventListener('submit', function (e) {
            e.preventDefault();
            addRecipientFromModal();
        });
    }
});

// Initialize animation system
function initializeAnimations() {
    // Add appearing animation to present items when they're first loaded
    setTimeout(() => {
        const presentItems = document.querySelectorAll('.present-item');
        presentItems.forEach((item, index) => {
            item.classList.add('appearing');
            setTimeout(() => {
                item.classList.remove('appearing');
            }, 600 + (index * 50));
        });
    }, 500);
}

function checkAuth() {
    console.log('Checking authentication...');
    return fetch('/api/auth', {
        credentials: 'include' // Ensure cookies are sent
    })
        .then(response => {
            console.log('Auth response status:', response.status);
            return response.json();
        })
        .then(data => {
            console.log('Auth response data:', data);
            if (!data.authenticated) {
                console.warn('User not authenticated, redirecting to login');
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

function loadRecipientsWithPresents(forceReload = false, silent = false) {
    console.log('Loading recipients and presents...', forceReload ? '(forced)' : '', silent ? '(silent)' : '');

    const now = Date.now();
    const cacheExpiry = 60000; // 60 seconds cache

    // Try to load from localStorage first (persistent cache)
    if (!forceReload && !window._dataCache) {
        const persistentCache = loadFromPersistentCache();
        if (persistentCache) {
            console.log('Using persistent cache from localStorage');
            window._dataCache = persistentCache.data;
            window._dataCacheTimestamp = persistentCache.timestamp;
            displayRecipientsData(persistentCache.data.recipients, persistentCache.data.presents, persistentCache.data.identificationStatus);

            // Refresh in background if cache is older than 30 seconds
            if ((now - persistentCache.timestamp) > 30000) {
                console.log('Background refresh triggered');
                setTimeout(() => softReloadRecipients(), 1000);
            }
            return;
        }
    }

    // Use memory cache if available and fresh (unless forced reload)
    if (!forceReload &&
        window._dataCache &&
        window._dataCacheTimestamp &&
        (now - window._dataCacheTimestamp) < cacheExpiry) {
        console.log('Using memory cache (age:', Math.round((now - window._dataCacheTimestamp) / 1000), 'seconds)');
        displayRecipientsData(window._dataCache.recipients, window._dataCache.presents, window._dataCache.identificationStatus);
        return;
    }

    // Show loading state only if not silent (i.e., no cached data displayed)
    if (!silent) {
        const recipientsList = document.getElementById('recipientsList');
        recipientsList.innerHTML = `
            <div class="text-center aws-loading-state">
                <div class="logo-spinner" role="status">
                    <img src="seba_logo.png" alt="Loading..." class="spinning-logo">
                    <span class="visually-hidden">Ładowanie...</span>
                </div>
                <p class="mt-3 text-muted loading-text">Ładowanie danych...</p>
            </div>
        `;
    }

    // Load data with optimized single request
    const startTime = performance.now();

    Promise.all([
        fetch('/api/recipients-with-presents', { credentials: 'include' }).then(response => {
            if (!response.ok) {
                if (response.status === 401) {
                    console.warn('[API] Got 401 from /api/recipients-with-presents, checking auth status...');
                    // Don't immediately redirect - check if this is a session timing issue
                    throw new Error('Unauthorized');
                }
                throw new Error('Combined API error');
            }
            return response.json();
        }),
        fetch('/api/user/identification', { credentials: 'include' }).then(response => {
            if (!response.ok) {
                throw new Error('Identification API error');
            }
            return response.json();
        })
    ])
        .then(([combinedData, identificationStatus]) => {
            const endTime = performance.now();
            console.log(`Data loaded in ${(endTime - startTime).toFixed(2)}ms`);

            const recipients = combinedData.recipients || [];
            const presentsData = combinedData.presents || [];

            // Validate data
            const validRecipients = Array.isArray(recipients) ? recipients : [];
            const validPresents = Array.isArray(presentsData) ? presentsData : [];

            if (!validRecipients || !validPresents) {
                throw new Error('Invalid data received from server');
            }

            // Cache the data
            const cacheData = { recipients: validRecipients, presents: validPresents, identificationStatus };
            window._dataCache = cacheData;
            window._dataCacheTimestamp = Date.now();

            // Save to persistent cache
            saveToPersistentCache(cacheData);

            // Update modal cache as well
            window._cachedRecipients = validRecipients;
            window._cachedIdentificationStatus = identificationStatus;

            // Display data
            displayRecipientsWithPresents(validRecipients, validPresents);

            // Handle identification logic
            handleIdentificationLogic(validRecipients, identificationStatus);
        })
        .catch(error => {
            console.error('Error loading data:', error);
            if (error.message === 'Unauthorized') {
                // Session might not be ready yet, retry after a short delay
                console.log('[API] Retrying after 1 second due to 401...');
                setTimeout(() => {
                    checkAuth().then(() => {
                        console.log('[API] Auth check passed on retry, loading data again...');
                        loadRecipientsWithPresents(true, false);
                    }).catch(() => {
                        console.error('[API] Auth check failed on retry, redirecting to login');
                        window.location.href = '/';
                    });
                }, 1000);
            } else {
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
        let presentsHTML;
        if (isIdentified) {
            // Enhanced surprise note - completely hide purchase status
            presentsHTML = `<div class="alert alert-warning mb-0" style="background: linear-gradient(135deg, #fff3cd 0%, #ffeaa7 100%); border-left: 4px solid #ffc107;">
                <div class="d-flex align-items-center">
                    <i class="fas fa-gift fa-2x me-3 text-warning"></i>
                    <div>
                        <strong class="d-block mb-1">🎁 Niespodzianka!</strong>
                        <span>Twoje prezenty są ukryte, żeby nie zepsuć niespodzianki. Nie możesz zobaczyć, co zostało kupione ani zarezerwowane.</span>
                    </div>
                </div>
            </div>`;
            // List presents added by the current user (created_by = currentUserId)
            const ownPresents = recipientPresents.filter(p => p.created_by === currentUserId);
            if (ownPresents.length > 0) {
                presentsHTML += `
                <div class="mt-3">
                  <div class="fw-bold mb-2"><i class="fas fa-list me-1"></i>Twoje dodane prezenty:</div>
                  <ul class="list-group">
                    ${ownPresents.map(p => `
                      <li class="list-group-item">
                        <div class="d-flex align-items-start flex-wrap flex-md-nowrap">
                          <div class="flex-grow-1">
                            <div class="fw-semibold">${escapeHtml(p.title)}</div>
                            ${p.comments ? `<div class="text-muted small mt-1"><i class="fas fa-info-circle me-1"></i>${escapeHtml(p.comments)}</div>` : ''}
                          </div>
                          <div class="d-flex gap-2 justify-content-center justify-content-md-end w-100 w-md-auto mt-2 mt-md-0">
                            <button class="btn btn-sm btn-outline-primary w-100 w-md-auto edit-present-btn"
                              data-present-id="${p.id}"
                              data-present-title="${escapeHtml(p.title)}"
                              data-recipient-id="${p.recipient_id}"
                              data-present-comments="${escapeHtml(p.comments || '')}"
                              style="max-width:50px;">
                              <i class="fas fa-edit"></i>
                            </button>
                            <button class="btn btn-sm btn-danger w-100 w-md-auto delete-present-btn"
                              data-present-id="${p.id}"
                              data-present-title="${escapeHtml(p.title)}"
                              data-recipient-id="${recipient.id}"
                              style="max-width:50px;">
                              <i class="fas fa-trash-alt"></i>
                            </button>
                          </div>
                        </div>
                      </li>
                    `).join('')}
                  </ul>
                </div>`;
            }
        } else {
            presentsHTML = (recipientPresents.length > 0 ?
                generatePresentsList(recipientPresents) :
                '<p class="text-muted mb-0">Brak prezentów dla tej osoby</p>'
            );
        }

        const profilePictureHTML = generateProfilePictureHTML(recipient, isIdentified);

        return `
            <div class="recipient-item" data-id="${recipient.id}" id="recipient-${recipient.id}">
                <div class="row">
                    <div class="col-lg-2 col-md-6 text-center">
                        <div class="recipient-avatar">
                            ${recipient.profile_picture && recipient.profile_picture.trim() !== '' ?
                `<img src="${getFullProfilePictureUrl(escapeHtml(recipient.profile_picture))}" alt="Zdjęcie profilowe" class="img-fluid" onclick="openProfilePicturePreview(${recipient.id})" style="cursor: pointer;">` :
                `<div class="profile-picture-placeholder" onclick="openProfileModal(${recipient.id})" style="cursor: pointer; font-size: 4rem;">
                                    ${getEmojiAvatar(recipient.name)}
                                </div>`
            }
                        </div>
                        
                        <!-- Name shown in profile section for wider screens -->
                        <div class="recipient-name-in-profile d-none d-lg-block">
                            <div class="profile-name-with-check d-flex align-items-center justify-content-center">
                                <h6 class="mt-2 mb-1 me-2">${escapeHtml(recipient.name)}</h6>
                                ${!isIdentified && !hasAnyIdentification ? `
                                    <button class="btn profile-check-btn d-none d-lg-block" onclick="identifyAsRecipient(${recipient.id}, '${escapeHtml(recipient.name)}')" title="To jestem ja">
                                        <i class="fas fa-user-check"></i>
                                    </button>
                                ` : isIdentified ? `
                                    <button class="btn profile-check-btn identified d-none d-lg-block" onclick="cancelIdentification(${recipient.id}, '${escapeHtml(recipient.name)}')" title="To jest Twój profil">
                                        <i class="fas fa-check-circle"></i>
                                    </button>
                                ` : ''}
                            </div>
                            ${!isIdentified ? `
                                <div class="mb-2">
                                    <small class="text-muted d-block">
                                        <i class="fas fa-gift me-1"></i>
                                        Prezenty: ${checkedPresents}/${totalPresents} zakupione
                                    </small>
                                    ${totalPresents > 0 ? `
                                        <div class="progress mt-1" style="height: 6px;">
                                            <div class="progress-bar bg-success" style="width: ${(checkedPresents / totalPresents) * 100}%"></div>
                                        </div>
                                    ` : ''}
                                </div>
                            ` : ''}
                        </div>
                        
                        <!-- Buttons in profile section -->
                        <div class="profile-buttons">
                            
                            ${!isIdentifiedByOther ? `
                                <div class="mt-2 d-none d-md-block">
                                    <button class="btn btn-outline-primary btn-sm change-picture-btn" onclick="openChangePictureModal(${recipient.id})">
                                        <i class="fas fa-camera me-1"></i>Zmień zdjęcie
                                    </button>
                                </div>
                            ` : ''}
                        </div>
                    </div>
                    <div class="col-lg-6 col-md-6">
                        <div class="mb-2 d-lg-none">
                          <center>  <h5 class="recipient-name mb-0">
                               
                                ${escapeHtml(recipient.name)}
                            </h5> </center>
                            ${!isIdentified && !hasAnyIdentification ? `
                                <div class="mt-2">
                                    <button class="btn btn-outline-success btn-sm identify-btn" onclick="identifyAsRecipient(${recipient.id}, '${escapeHtml(recipient.name)}')">
                                        <i class="fas fa-user-check me-1"></i>To jestem ja
                                    </button>
                                </div>
                            ` : isIdentified ? `
                                <div class="mt-2">
                                    <button class="btn btn-outline-success btn-sm identify-btn" onclick="cancelIdentification(${recipient.id}, '${escapeHtml(recipient.name)}')">
                                        <i class="fas fa-check-circle me-1"></i>To jest Twój profil
                                    </button>
                                </div>
                            ` : ''}
                            ${!isIdentifiedByOther ? `
                                <div class="mt-2 d-md-none">
                                    <button class="btn btn-outline-primary btn-sm change-picture-btn-mobile" onclick="openChangePictureModal(${recipient.id})">
                                        <i class="fas fa-camera me-1"></i>Zmień zdjęcie
                                    </button>
                                </div>
                            ` : ''}
                        </div>
                        ${isIdentifiedByOther ? `
                            <div class="alert alert-warning py-2 px-3 mb-3">
                                <i class="fas fa-user-check me-1"></i>
                                <small>Zidentyfikowane przez: ${escapeHtml(recipient.identified_by_username || 'nieznany użytkownik')}</small>
                            </div>
                        ` : ''}
                        ${!isIdentified ? `
                        <div class="mb-3 d-lg-none">
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
                    <div class="col-lg-4 col-md-12 text-end">
                        <div class="btn-group-vertical w-100">
                            <!-- Other action buttons can be added here if needed -->
                        </div>
                    </div>
                </div>
            </div>
        `;
    }).join('');

    // Add event delegation for edit and delete buttons
    setupPresentButtonListeners();
    
    // Update search autocomplete data
    if (typeof updateSearchData === 'function') {
        setTimeout(() => updateSearchData(), 100);
    }
}

function setupPresentButtonListeners() {
    // Remove old listeners if they exist
    const recipientsList = document.getElementById('recipientsList');
    if (!recipientsList) return;

    // Use event delegation for edit buttons
    recipientsList.removeEventListener('click', handlePresentButtonClick);
    recipientsList.addEventListener('click', handlePresentButtonClick);
}

function handlePresentButtonClick(e) {
    const editBtn = e.target.closest('.edit-present-btn');
    const deleteBtn = e.target.closest('.delete-present-btn');

    if (editBtn) {
        e.preventDefault();
        const presentId = parseInt(editBtn.dataset.presentId);
        const title = editBtn.dataset.presentTitle;
        const recipientId = parseInt(editBtn.dataset.recipientId);
        const comments = editBtn.dataset.presentComments;
        editPresent(presentId, title, recipientId, comments);
    } else if (deleteBtn) {
        e.preventDefault();
        const presentId = parseInt(deleteBtn.dataset.presentId);
        const title = deleteBtn.dataset.presentTitle;
        const recipientId = parseInt(deleteBtn.dataset.recipientId);
        deletePresent(presentId, title, recipientId);
    }
}

function generateProfilePictureHTML(recipient, isIdentified) {
    const presents = window._allPresentsByRecipient && window._allPresentsByRecipient[recipient.id] ? window._allPresentsByRecipient[recipient.id] : [];
    const clickHandler = `onclick="showRecipientDetailsFromList(${recipient.id})" style="cursor:pointer;"`;
    if (recipient.profile_picture && recipient.profile_picture.trim() !== '') {
        return `<div class="profile-picture-wrapper mb-2 ${isIdentified ? 'identified' : ''}" ${clickHandler}>
            <img src="${getFullProfilePictureUrl(escapeHtml(recipient.profile_picture))}" alt="Zdjęcie profilowe" class="img-fluid">
        </div>`;
    } else {
        return `<div class="profile-picture-wrapper mb-2 ${isIdentified ? 'identified' : ''}" ${clickHandler}>
            <div class="profile-picture-placeholder" style="font-size: 3rem;">
                ${getEmojiAvatar(recipient.name)}
            </div>
        </div>`;
    }
}

function identifyAsRecipient(recipientId, recipientName, hideDeleteButton = false) {
    pendingIdentificationRecipientId = recipientId;
    document.getElementById('identificationRecipientName').textContent = recipientName;

    // Show or hide the delete button
    const deleteBtn = document.querySelector('#selfIdentificationModal .btn-outline-danger');
    if (deleteBtn) {
        if (hideDeleteButton) {
            deleteBtn.style.display = 'none';
        } else {
            deleteBtn.style.display = 'inline-flex';
        }
    }

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
                clearRecipientsCache();
                softReloadRecipients();

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
                    <div style="cursor:pointer;" onclick="identifyAsRecipientFromSelection(${recipient.id}, '${escapeHtml(recipient.name)}')">
                        <i class="fas fa-user me-2"></i>
                        <strong class="recipient-name-clickable">${escapeHtml(recipient.name)}</strong>
                    </div>
                    <div class="d-flex gap-2">
                        <button class="btn btn-sm btn-success identify-btn-modal" onclick="identifyAsRecipientFromSelection(${recipient.id}, '${escapeHtml(recipient.name)}')">
                            <i class="fas fa-check me-1"></i>To jestem ja
                        </button>
                        <button class="btn btn-outline-danger btn-sm" style="width: 28%;" onclick="deleteRecipientFromSelection(${recipient.id}, '${escapeHtml(recipient.name)}')">
                            <i class="fas fa-trash"></i>
                        </button>
                        <style>
                        @media (max-width: 576px) {
                            .recipient-name-clickable ~ div > .btn-outline-success {
                                
                            width: 70% !important;
                                min-width: 110px;
                                margin-right: 2%;
                            }
                            .recipient-name-clickable ~ div > .btn-outline-danger {
                                width: 28% !important;
                                min-width: 40px;
                            }
                        }
                        </style>
                    </div>
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

function deleteRecipientFromSelection(recipientId, recipientName) {
    if (!confirm(`Czy na pewno chcesz usunąć osobę "${recipientName}"? Ta akcja nie może być cofnięta.`)) {
        return;
    }
    fetch(`/api/recipients/${recipientId}`, {
        method: 'DELETE'
    })
        .then(response => response.json())
        .then(data => {
            if (data.success) {
                showSuccessMessage('Osoba została usunięta!');
                showRecipientSelectionModal(); // Refresh the modal list
            } else {
                showErrorModal(data.error || 'Błąd podczas usuwania osoby');
            }
        })
        .catch(error => {
            console.error('Error:', error);
            showErrorModal('Błąd połączenia z serwerem');
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
                softReloadRecipients();
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

    // Use the atomic endpoint to add and identify in one step
    fetch('/api/user/identify', {
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

                showSuccessMessage(`Pomyślnie dodano i zidentyfikowano jako ${newRecipientName}!`);
                clearRecipientsCache();
                softReloadRecipients();
            } else {
                throw new Error(data.error || 'Błąd podczas dodawania osoby');
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
                softReloadRecipients();

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
            profileImg.src = getFullProfilePictureUrl(recipient.profile_picture);
            profileImg.style.display = 'block';
        } else {
            // Show placeholder instead of image
            profileImg.style.display = 'none';
            const placeholder = document.createElement('div');
            placeholder.className = 'profile-picture-placeholder-large';
            placeholder.innerHTML = getEmojiAvatar(recipient.name);
            placeholder.style.width = '200px';
            placeholder.style.height = '200px';
            placeholder.style.fontSize = '8rem';
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
        // Show compressed preview
        compressImage(file, 600, 600, 0.6)
            .then(compressedDataUrl => {
                preview.src = compressedDataUrl;
                preview.style.display = 'block';
            })
            .catch(error => {
                console.error('Error compressing preview:', error);
                // Fallback to original if compression fails
                const reader = new FileReader();
                reader.onload = function (e) {
                    preview.src = e.target.result;
                    preview.style.display = 'block';
                };
                reader.readAsDataURL(file);
            });
    } else {
        preview.style.display = 'none';
    }
}

// Compress image before upload
function compressImage(file, maxWidth = 800, maxHeight = 800, quality = 0.8) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = function (e) {
            const img = new Image();
            img.onload = function () {
                const canvas = document.createElement('canvas');
                let width = img.width;
                let height = img.height;

                // Calculate new dimensions while maintaining aspect ratio
                if (width > height) {
                    if (width > maxWidth) {
                        height = Math.round((height * maxWidth) / width);
                        width = maxWidth;
                    }
                } else {
                    if (height > maxHeight) {
                        width = Math.round((width * maxHeight) / height);
                        height = maxHeight;
                    }
                }

                canvas.width = width;
                canvas.height = height;

                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0, width, height);

                // Convert to JPEG with quality compression
                const compressedDataUrl = canvas.toDataURL('image/jpeg', quality);
                resolve(compressedDataUrl);
            };
            img.onerror = reject;
            img.src = e.target.result;
        };
        reader.onerror = reject;
        reader.readAsDataURL(file);
    });
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
        // Check file size (10MB limit for original file)
        const maxSize = 10 * 1024 * 1024; // 10MB in bytes
        if (file.size > maxSize) {
            showErrorModal('Plik jest zbyt duży. Maksymalny rozmiar to 10MB.');
            return;
        }

        // Compress image before upload (smaller size and lower quality for better compression)
        compressImage(file, 600, 600, 0.6)
            .then(compressedDataUrl => {
                console.log('Image compressed successfully, size:', (compressedDataUrl.length / 1024).toFixed(2), 'KB');
                
                // Check compressed size
                const estimatedSize = compressedDataUrl.length * 0.75;
                const maxSize = 40 * 1024 * 1024; // 40MB limit for base64
                
                if (estimatedSize > maxSize) {
                    showErrorModal('Skompresowany obraz jest nadal zbyt duży. Spróbuj użyć mniejszego zdjęcia.');
                    return;
                }
                
                saveImageToServer(compressedDataUrl);
            })
            .catch(error => {
                console.error('Error compressing image:', error);
                showErrorModal('Błąd podczas przetwarzania obrazu');
            });
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
                softReloadRecipients();

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

    // Separate presents into bought and not bought
    const boughtPresents = presents.filter(p => p.is_checked);
    const notBoughtPresents = presents.filter(p => !p.is_checked);

    // Sort not bought presents: reserved by current user first, then by creation date
    const sortedNotBought = notBoughtPresents.sort((a, b) => {
        const aReservedByMe = a.reserved_by === currentUserId;
        const bReservedByMe = b.reserved_by === currentUserId;
        if (aReservedByMe && !bReservedByMe) return -1;
        if (!aReservedByMe && bReservedByMe) return 1;
        return new Date(b.created_at) - new Date(a.created_at);
    });

    // Sort bought presents by creation date (newer first)
    const sortedBought = boughtPresents.sort((a, b) => {
        return new Date(b.created_at) - new Date(a.created_at);
    });

    const generatePresentItem = (present, index) => `
        <div class="present-item ${present.is_checked ? 'checked' : ''}
${present.reserved_by && present.reserved_by !== currentUserId ? 'reserved-by-other' : ''}
${present.reserved_by === currentUserId ? 'reserved-by-me' : ''}" data-id="${present.id}"
style="transition-delay: ${index * 50}ms;">
            <div class="d-flex align-items-start flex-wrap flex-md-nowrap w-100 gap-2">
                <div class="flex-shrink-0 d-flex align-items-center" style="min-width: 36px;">
                    <input class="form-check-input" type="checkbox"
                        ${present.is_checked ? 'checked' : ''}
                        onchange="togglePresentFromRecipients(${present.id}, this.checked)">
                </div>
                <div class="flex-grow-1">
                    <div class="present-title-block">
                        <h6 class="present-title mb-1">${convertUrlsToLinks(escapeHtml(present.title))}</h6>
                        ${present.comments ? `<div class="present-comments mb-1">${formatCommentsPreview(present.comments)}</div>` : ''}
                    </div>
                </div>
                <div class="d-flex flex-column align-items-end justify-content-between ms-2" style="min-width: 90px;">
                    <small class="text-muted">${present.created_at ? new Date(present.created_at).toLocaleDateString('pl-PL') : ''}</small>
                </div>
                <div class="d-flex flex-column align-items-end justify-content-between ms-2" style="min-width: 120px;">
                    ${generateReservationButton(present)}
                </div>
            </div>
        </div>
    `;

    let html = `<div class="presents-list presents-list-container">`;

    // Add not bought presents
    html += sortedNotBought.map((present, index) => generatePresentItem(present, index)).join('');

    // Add bought presents in accordion if there are any
    if (sortedBought.length > 0) {
        const accordionId = `accordion-bought-${Math.random().toString(36).substr(2, 9)}`;
        html += `
            <div class="accordion mt-3" id="${accordionId}">
                <div class="accordion-item">
                    <h2 class="accordion-header">
                        <button class="accordion-button collapsed" type="button" data-bs-toggle="collapse" data-bs-target="#${accordionId}-collapse" aria-expanded="false" aria-controls="${accordionId}-collapse" style="background-color: #f8f9fa; color: #28a745; font-weight: 600;">
                            <i class="fas fa-check-circle me-2" style="color: #28a745;"></i>Kupione (${sortedBought.length})
                        </button>
                    </h2>
                    <div id="${accordionId}-collapse" class="accordion-collapse collapse" data-bs-parent="#${accordionId}">
                        <div class="accordion-body p-0">
                            ${sortedBought.map((present, index) => generatePresentItem(present, index)).join('')}
                        </div>
                    </div>
                </div>
            </div>
        `;
    }

    html += `</div>`;

    // Calculate container height after rendering
    setTimeout(() => {
        calculateContainerHeight();
    }, 100);

    return html;
}





// Persistent cache functions
function saveToPersistentCache(data) {
    try {
        // Check for large comments before optimization
        const largeComments = data.presents.filter(p => p.comments && p.comments.length > 1000);
        if (largeComments.length > 0) {
            console.log(`[Cache] Found ${largeComments.length} presents with large comments (>1000 chars)`);
            largeComments.forEach(p => {
                console.log(`[Cache] Present "${p.title}" has ${p.comments.length} char comment`);
            });
        }

        // Optimize data before saving - remove large fields
        const optimizedData = {
            recipients: data.recipients.map(r => ({
                id: r.id,
                name: r.name,
                identified_by: r.identified_by,
                identified_by_username: r.identified_by_username,
                profile_picture: r.profile_picture // Just the URL, not BLOB
            })),
            presents: data.presents.map(p => ({
                id: p.id,
                title: p.title,
                recipient_id: p.recipient_id,
                // Truncate comments to 200 chars to save more space
                comments: p.comments ? p.comments.substring(0, 200) : null,
                is_checked: p.is_checked,
                reserved_by: p.reserved_by,
                reserved_by_username: p.reserved_by_username,
                recipient_name: p.recipient_name,
                created_by: p.created_by,
                created_at: p.created_at
            })),
            identificationStatus: data.identificationStatus,
            timestamp: Date.now()
        };

        const jsonString = JSON.stringify(optimizedData);
        const sizeKB = (jsonString.length / 1024).toFixed(2);
        console.log(`[Cache] Attempting to save ${sizeKB}KB to localStorage`);

        // Try to save
        localStorage.setItem('recipientsCache', jsonString);
        console.log('[Cache] Data saved successfully');
    } catch (error) {
        console.error('[Cache] Error saving:', error);

        // If quota exceeded, disable caching
        if (error.name === 'QuotaExceededError') {
            console.warn('[Cache] Quota exceeded - disabling cache. App will work without it.');

            // Clear ALL localStorage to free up space
            try {
                localStorage.clear();
                console.log('[Cache] localStorage cleared');
            } catch (e) {
                console.error('[Cache] Could not clear localStorage:', e);
            }

            // Don't try to save again - just continue without cache
            // The app will work fine, just slower on refresh
        }
    }
}

function loadFromPersistentCache() {
    try {
        const cached = localStorage.getItem('recipientsCache');
        if (cached) {
            const cacheData = JSON.parse(cached);
            const age = Date.now() - cacheData.timestamp;

            // Cache valid for 5 minutes
            if (age < 300000) {
                return cacheData;
            } else {
                console.log('[Cache] Persistent cache expired');
                localStorage.removeItem('recipientsCache');
            }
        }
    } catch (error) {
        console.error('[Cache] Error loading from persistent cache:', error);
        localStorage.removeItem('recipientsCache');
    }
    return null;
}

function clearPersistentCache() {
    try {
        localStorage.removeItem('recipientsCache');
        console.log('[Cache] Persistent cache cleared');
    } catch (error) {
        console.error('[Cache] Error clearing persistent cache:', error);
    }
}

function clearRecipientsCache() {
    clearPersistentCache();
    window._dataCache = null;
    window._dataCacheTimestamp = null;
}


// Display recipients data with privacy handling
function displayRecipientsData(recipients, presents, identificationStatus) {
    // Add instant load class for smooth fade-in
    const recipientsList = document.getElementById('recipientsList');
    if (recipientsList) {
        recipientsList.classList.add('instant-load');
    }

    // Store identification status for later use
    window._cachedIdentificationStatus = identificationStatus;

    // Store data globally for other functions
    window._allPresentsByRecipient = {};
    presents.forEach(present => {
        if (!window._allPresentsByRecipient[present.recipient_id]) {
            window._allPresentsByRecipient[present.recipient_id] = [];
        }
        window._allPresentsByRecipient[present.recipient_id].push(present);
    });

    // Display the recipients
    displayRecipientsWithPresents(recipients, presents);

    // PRIVACY FIX: If user is identified in cache, hide their presents immediately
    if (identificationStatus && identificationStatus.isIdentified && identificationStatus.userId) {
        console.log('[Privacy] Applying privacy filter from cache');
        // Find the identified recipient and hide their presents
        const identifiedRecipient = recipients.find(r => r.identified_by === identificationStatus.userId);
        if (identifiedRecipient) {
            // Hide presents for this recipient immediately
            const recipientCard = document.querySelector(`[data-id="${identifiedRecipient.id}"]`);
            if (recipientCard) {
                const presentsContainer = recipientCard.querySelector('.presents-list, .recipient-presents');
                if (presentsContainer) {
                    // Temporarily hide until auth completes
                    presentsContainer.style.opacity = '0.3';
                    presentsContainer.style.pointerEvents = 'none';
                    console.log('[Privacy] Temporarily hiding presents for recipient:', identifiedRecipient.name);
                }
            }
        }
    }
}

// Handle identification logic
function handleIdentificationLogic(recipients, identificationStatus) {
    console.log('handleIdentificationLogic called with:', {
        currentUserId,
        recipients: recipients.map(r => ({ id: r.id, name: r.name, identified_by: r.identified_by })),
        identificationStatus
    });

    // Ensure currentUserId is set
    if (!currentUserId) {
        console.warn('currentUserId not set, skipping identification logic');
        return;
    }

    // First check the identification status from the API
    if (identificationStatus.isIdentified && identificationStatus.identifiedRecipient) {
        console.log('User is already identified according to API:', identificationStatus.identifiedRecipient.name, '- skipping identification flow');
        return;
    }

    // Also check if user is already identified as any recipient in the recipients list
    const alreadyIdentified = recipients.find(recipient =>
        recipient.identified_by === currentUserId
    );

    console.log('Already identified check:', { currentUserId, alreadyIdentified });

    if (alreadyIdentified) {
        console.log('User is already identified as:', alreadyIdentified.name, '- skipping identification flow');
        return; // Don't show any identification modals
    }

    // Only show identification flow if user is not identified at all
    console.log('User is not identified, checking for identification options...');

    // Find matching recipient by username (for first-time identification)
    const matchingRecipient = recipients.find(recipient =>
        recipient.name.toLowerCase() === identificationStatus.username?.toLowerCase() &&
        !recipient.identified_by
    );

    if (matchingRecipient) {
        console.log('Found matching unidentified recipient:', matchingRecipient.name);
        setTimeout(() => {
            identifyAsRecipient(matchingRecipient.id, matchingRecipient.name, true);
        }, 500);
    } else {
        console.log('No matching recipient found, showing selection modal');
        setTimeout(() => {
            showRecipientSelectionModal();
        }, 500);
    }
}

// Refresh recipients cache
function refreshRecipientsCache() {
    return Promise.all([
        fetch('/api/recipients', { credentials: 'include' }).then(response => response.json()),
        fetch('/api/user/identification', { credentials: 'include' }).then(response => response.json())
    ])
        .then(([recipients, identificationStatus]) => {
            window._cachedRecipients = recipients;
            window._cachedIdentificationStatus = identificationStatus;
            return { recipients, identificationStatus };
        });
}

// Toast notification system
function showToast(message, type = 'success') {
    const toastId = `${type}Toast`;
    const messageId = `${type}ToastMessage`;

    const toastElement = document.getElementById(toastId);
    const messageElement = document.getElementById(messageId);

    if (toastElement && messageElement) {
        messageElement.textContent = message;
        const toast = new bootstrap.Toast(toastElement, {
            autohide: true,
            delay: type === 'error' ? 5000 : 3000
        });
        toast.show();
    }
}

function showSuccessToast(message) {
    showToast(message, 'success');
}

function showErrorToast(message) {
    showToast(message, 'error');
}

function showInfoToast(message) {
    showToast(message, 'info');
}

// Add missing loadRecipients function for the refresh button
function loadRecipients() {
    console.log('Refreshing recipients data...');
    showInfoToast('Odświeżanie danych...');
    // Clear all caches when refreshing
    clearRecipientsCache();
    loadRecipientsWithPresents(true); // Force reload
}

// Soft reload for background updates
function softReloadRecipients() {
    console.log('Soft reloading recipients in background...');
    return Promise.all([
        fetch('/api/recipients-with-presents', { credentials: 'include' }).then(r => r.json()),
        fetch('/api/user/identification', { credentials: 'include' }).then(r => r.json())
    ])
        .then(([combinedData, identificationStatus]) => {
            const recipients = combinedData.recipients || [];
            const presents = combinedData.presents || [];

            // Update cache
            window._dataCache = { recipients, presents, identificationStatus };
            window._dataCacheTimestamp = Date.now();
            saveToPersistentCache(window._dataCache);

            console.log('Soft reload completed');
        })
        .catch(error => {
            console.error('Error in soft reload:', error);
            // Fallback to cached data if available
            if (window._dataCache) {
                console.log('Using cached data after soft reload error');
            }
        });
}
