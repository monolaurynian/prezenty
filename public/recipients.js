console.log('Recipients.js loading... v7.0 - Reverted to separate API calls');

// Global logout function - ensure it's always available
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
    
    // OPTIMIZATION: Try to show cached data immediately (if available)
    // BUT: Skip instant display if user is identified (privacy first!)
    let persistentCache = null;
    try {
        persistentCache = loadFromPersistentCache();
        if (persistentCache) {
            // PRIVACY CHECK: Don't show cache instantly if user is identified
            const isIdentified = persistentCache.data.identificationStatus && 
                                persistentCache.data.identificationStatus.isIdentified;
            
            if (isIdentified) {
                console.log('[FastLoad] User is identified - skipping instant cache to preserve privacy');
                // Don't show cache - wait for proper auth and data load
                // This prevents showing purchase status before privacy filter applies
            } else {
                console.log('[FastLoad] Showing cached data immediately');
                displayRecipientsData(persistentCache.data.recipients, persistentCache.data.presents, persistentCache.data.identificationStatus);
                
                // Store in memory cache too
                window._dataCache = persistentCache.data;
                window._dataCacheTimestamp = persistentCache.timestamp;
            }
        } else {
            console.log('[FastLoad] No cache available, will load from server');
        }
    } catch (e) {
        console.error('[FastLoad] Error loading cache:', e);
        persistentCache = null; // Ensure it's null on error
        // Continue without cache - app will work fine
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
        window.location.href = '/';
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
        fetch('/api/recipients-with-presents').then(response => {
            if (!response.ok) {
                if (response.status === 401) {
                    window.location.href = '/';
                    throw new Error('Unauthorized');
                }
                throw new Error('Combined API error');
            }
            return response.json();
        }),
        fetch('/api/user/identification').then(response => {
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
            if (error.message !== 'Unauthorized') {
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
                `<div class="profile-picture-placeholder" onclick="openProfileModal(${recipient.id})" style="cursor: pointer;">
                                   
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
            <div class="profile-picture-placeholder">
                <i class="fas fa-user"></i>
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
            placeholder.innerHTML = '<i class="fas fa-user"></i>';
            placeholder.style.width = '200px';
            placeholder.style.height = '200px';
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
        const reader = new FileReader();
        reader.onload = function (e) {
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
        reader.onload = function (e) {
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

    // Sort presents: reserved by current user first, then unchecked, then checked at bottom
    const sortedPresents = presents.sort((a, b) => {
        // First, move checked items to the bottom regardless of reservation status
        if (a.is_checked !== b.is_checked) {
            return a.is_checked ? 1 : -1;
        }
        // Then sort by reservation status (reserved by current user first)
        const aReservedByMe = a.reserved_by === currentUserId;
        const bReservedByMe = b.reserved_by === currentUserId;
        if (aReservedByMe && !bReservedByMe) return -1;
        if (!aReservedByMe && bReservedByMe) return 1;
        // Finally by creation date (newer first)
        return new Date(b.created_at) - new Date(a.created_at);
    });

    const html = `
        <div class="presents-list presents-list-container">
            ${sortedPresents.map((present, index) => `
                <div class="present-item ${present.is_checked ? 'checked' : ''} ${present.reserved_by && present.reserved_by !== currentUserId ? 'reserved-by-other' : ''} ${present.reserved_by === currentUserId ? 'reserved-by-me' : ''}" data-id="${present.id}" style="transition-delay: ${index * 50}ms;">
                    <div class="d-flex align-items-start flex-wrap flex-md-nowrap w-100 gap-2">
                        <!-- Checkbox block -->
                        <div class="flex-shrink-0 d-flex align-items-center" style="min-width: 36px;">
                            <input class="form-check-input" type="checkbox" 
                                ${present.is_checked ? 'checked' : ''} 
                                onchange="togglePresentFromRecipients(${present.id}, this.checked)">
                        </div>
                        <!-- Title and comments block -->
                        <div class="flex-grow-1">
                            <div class="present-title-block">
                                <h6 class="present-title mb-1">${convertUrlsToLinks(escapeHtml(present.title))}</h6>
                                ${present.comments ? `<div class="present-comments mb-1">${formatCommentsPreview(present.comments)}</div>` : ''}
                            </div>
                        </div>
                        <!-- Date block -->
                        <div class="d-flex flex-column align-items-end justify-content-between ms-2" style="min-width: 90px;">
                            <small class="text-muted">${present.created_at ? new Date(present.created_at).toLocaleDateString('pl-PL') : ''}</small>
                        </div>
                        <!-- Reservation block -->
                        <div class="d-flex flex-column align-items-end justify-content-between ms-2" style="min-width: 120px;">
                            ${generateReservationButton(present)}
                        </div>
                    </div>
                </div>
            `).join('')}
        </div>
    `;

    // Calculate container height after rendering
    setTimeout(() => {
        calculateContainerHeight();
    }, 100);

    return html;
}

function togglePresentFromRecipients(id, isChecked) {
    const presentItem = document.querySelector(`[data-id="${id}"]`);
    if (!presentItem) {
        console.error('Present item not found:', id);
        return;
    }

    // Prevent multiple clicks during animation
    if (presentItem.classList.contains('animating')) {
        return;
    }

    // Add animating state to prevent multiple animations
    presentItem.classList.add('animating');

    // Update the server and state immediately
    updatePresentCheckStatus(id, isChecked, presentItem);

    // Animate the visual movement, then reorder after animation completes
    animatePresentTransition(presentItem, isChecked, () => {
        // Reorder the list after animation completes
        reorderPresentsList();
        // Remove animating state
        presentItem.classList.remove('animating');
    });
}

// Separate function to update the server after animation
function updatePresentCheckStatus(id, isChecked, presentItem) {
    // Optimistically update the cached data
    if (window._dataCache && window._dataCache.presents) {
        const present = window._dataCache.presents.find(p => p.id === id);
        if (present) {
            present.is_checked = isChecked;
        }
    }

    // Update the UI immediately
    if (isChecked) {
        presentItem.classList.add('checked');
    } else {
        presentItem.classList.remove('checked');
    }

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
                // Update progress bar without full reload
                updateProgressBar(presentItem);
                presentItem.classList.remove('updating');
                presentItem.classList.remove('animating');
            } else {
                console.error('Failed to toggle present:', data.error);
                // Revert optimistic update on error
                if (window._dataCache && window._dataCache.presents) {
                    const present = window._dataCache.presents.find(p => p.id === id);
                    if (present) {
                        present.is_checked = !isChecked;
                    }
                }
                // Revert UI
                if (isChecked) {
                    presentItem.classList.remove('checked');
                } else {
                    presentItem.classList.add('checked');
                }
                // Revert checkbox
                const checkbox = presentItem.querySelector('input[type="checkbox"]');
                if (checkbox) {
                    checkbox.checked = !isChecked;
                }
                presentItem.classList.remove('updating');
                presentItem.classList.remove('animating');
            }
        })
        .catch(error => {
            console.error('Error toggling present:', error);
            // Revert optimistic update on error
            if (window._dataCache && window._dataCache.presents) {
                const present = window._dataCache.presents.find(p => p.id === id);
                if (present) {
                    present.is_checked = !isChecked;
                }
            }
            // Revert UI
            if (isChecked) {
                presentItem.classList.remove('checked');
            } else {
                presentItem.classList.add('checked');
            }
            // Revert checkbox
            const checkbox = presentItem.querySelector('input[type="checkbox"]');
            if (checkbox) {
                checkbox.checked = !isChecked;
            }
            presentItem.classList.remove('updating');
            presentItem.classList.remove('animating');
        });
}

// Update progress bar for a specific recipient
function updateProgressBar(presentItem) {
    // Find the recipient container
    const recipientItem = presentItem.closest('.recipient-item');
    if (!recipientItem) return;

    const recipientId = recipientItem.getAttribute('data-id');
    if (!recipientId) return;

    // Get all presents for this recipient from cache
    if (!window._dataCache || !window._dataCache.presents) return;

    const recipientPresents = window._dataCache.presents.filter(p => p.recipient_id == recipientId);
    const checkedPresents = recipientPresents.filter(p => p.is_checked).length;
    const totalPresents = recipientPresents.length;

    // Update the progress bar
    const progressBar = recipientItem.querySelector('.progress-bar');
    if (progressBar && totalPresents > 0) {
        const percentage = (checkedPresents / totalPresents) * 100;
        progressBar.style.width = `${percentage}%`;
    }

    // Update the text
    const progressText = recipientItem.querySelector('.text-muted');
    if (progressText) {
        const icon = progressText.querySelector('i');
        const iconHTML = icon ? icon.outerHTML : '<i class="fas fa-gift me-1"></i>';
        progressText.innerHTML = `${iconHTML}Prezenty: ${checkedPresents}/${totalPresents} zakupione`;
    }
}

// Helper function to animate present transitions
function animatePresentTransition(presentItem, isChecked, callback) {
    const container = presentItem.closest('.presents-list');
    if (!container) {
        if (callback) callback();
        return;
    }

    // Get current position and dimensions
    const rect = presentItem.getBoundingClientRect();
    const containerRect = container.getBoundingClientRect();
    const itemHeight = rect.height;
    const itemTop = rect.top - containerRect.top;

    // Create a clone for the animation
    const clone = presentItem.cloneNode(true);
    clone.style.position = 'absolute';
    clone.style.top = itemTop + 'px';
    clone.style.left = '0';
    clone.style.right = '0';
    clone.style.zIndex = '1000';
    clone.style.pointerEvents = 'none';
    clone.style.opacity = '1'; // Keep the animated item fully opaque
    clone.classList.remove('updating', 'animating');

    // Add to container
    container.style.position = 'relative';
    container.appendChild(clone);

    // Animate the clone
    const targetY = isChecked ? containerRect.height : -itemHeight;
    clone.style.transition = 'all 0.8s ease-out'; // Updated to 0.8s

    // Trigger animation
    setTimeout(() => {
        clone.style.transform = `translateY(${targetY}px)`;
        clone.style.opacity = '0'; // Only fade out at the end
    }, 10);

    // Remove clone after animation and call callback
    setTimeout(() => {
        if (clone.parentNode) {
            clone.parentNode.removeChild(clone);
        }
        // Call the callback function after animation completes
        if (callback) callback();
    }, 800); // Updated to 800ms
}

// Helper function to calculate container height for smooth animations
function calculateContainerHeight() {
    const containers = document.querySelectorAll('.presents-list');
    containers.forEach(container => {
        const items = container.querySelectorAll('.present-item');
        if (items.length > 0) {
            const firstItem = items[0];
            const itemHeight = firstItem.offsetHeight;
            const totalHeight = items.length * itemHeight + (items.length - 1) * 8; // 8px margin
            container.style.minHeight = totalHeight + 'px';
        }
    });
}

function generateReservationButton(present) {
    if (present.reserved_by) {
        if (present.reserved_by === currentUserId) {
            return `
                <button class="btn btn-danger btn-sm w-100 w-md-auto reserve-btn" 
                        onclick="handleReserveClick(event, ${present.id}, 'cancel')" 
                        title="Usuń rezerwację">
                    <i class="fas fa-xmark"></i>
                    <span class="d-inline d-md-none ms-1">Usuń rezerwację</span>
                </button>
            `;
        } else {
            return `
                <button class="btn btn-secondary btn-sm w-100 w-md-auto reserve-btn" 
                        onclick="showReservedByOtherModal('${escapeHtml(present.reserved_by_username || 'Nieznany użytkownik')}')" 
                        title="Zarezerwowane przez: ${escapeHtml(present.reserved_by_username || 'Nieznany użytkownik')}">
                    <i class="fas fa-bookmark"></i>
                    <span class="d-inline d-md-none ms-1">Niedostępne</span>
                </button>
            `;
        }
    } else {
        return `
            <button class="btn btn-outline-warning btn-sm w-100 w-md-auto reserve-btn" 
                    onclick="handleReserveClick(event, ${present.id}, 'reserve')" 
                    title="Zarezerwuj prezent">
                <i class="fas fa-bookmark"></i>
                <span class="d-inline d-md-none ms-1">Zarezerwuj prezent</span>
            </button>
        `;
    }
}

// Handle reserve button click with optimistic updates
function handleReserveClick(event, presentId, action) {
    event.preventDefault();
    event.stopPropagation();

    const button = event.currentTarget;
    const presentItem = document.querySelector(`[data-id="${presentId}"]`);

    // Store previous state for potential rollback
    const previousState = {
        reserved_by: null,
        reserved_by_username: null,
        buttonHTML: button.outerHTML,
        itemClasses: presentItem ? presentItem.className : ''
    };

    // Get current state from cache
    if (window._dataCache && window._dataCache.presents) {
        const present = window._dataCache.presents.find(p => p.id === presentId);
        if (present) {
            previousState.reserved_by = present.reserved_by;
            previousState.reserved_by_username = present.reserved_by_username;
        }
    }

    // Perform optimistic updates immediately
    updateButtonOptimistically(button, action);
    if (presentItem) {
        updatePresentItemOptimistically(presentItem, action);
    }
    updateCacheOptimistically(presentId, action, window._currentUserId);

    // Make API call with rollback capability
    if (action === 'reserve') {
        reservePresentFromRecipients(presentId, button, previousState);
    } else if (action === 'cancel') {
        cancelReservationFromRecipients(presentId, button, previousState);
    }
}

function formatCommentsPreview(comments) {
    // Truncate long comments and make URLs clickable
    const maxLength = 500;
    let truncated = comments.length > maxLength ?
        comments.substring(0, maxLength) + '...' : comments;

    // Regex to match URLs and domain-like words
    // Matches http(s)://... or www.... or anything.something
    const urlRegex = /((https?:\/\/)?([\w-]+\.)+[\w-]{2,}(\/[\w\-._~:/?#[\]@!$&'()*+,;=]*)?)/gi;
    return truncated.replace(urlRegex, (match, p1, p2) => {
        // If it already starts with http/https, use as is
        let url = match;
        if (!/^https?:\/\//i.test(match)) {
            url = 'https://' + match;
        }
        return `<a href="${url}" target="_blank" rel="noopener noreferrer">${match}</a>`;
    });
}

function convertUrlsToLinks(text) {
    if (!text) return text;

    // Convert URLs to clickable links
    const urlRegex = /(https?:\/\/[^\s]+)/g;
    return text.replace(urlRegex, '<a href="$1" target="_blank" rel="noopener noreferrer">$1</a>');
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
            if (data.success && data.recipient) {
                showSuccessMessage('Osoba została dodana!');
                document.getElementById('recipientForm').reset();
                softReloadRecipients();
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
    // Pokaż modal potwierdzenia
    const modal = new bootstrap.Modal(document.getElementById('confirmDeleteRecipientModal'));
    document.getElementById('confirmDeleteRecipientModal').setAttribute('data-recipient-id', id);
    document.getElementById('confirmDeleteRecipientModal').setAttribute('data-recipient-name', name);
    document.getElementById('confirmDeleteRecipientModalBody').textContent = `Czy na pewno chcesz usunąć osobę "${name}"? Ta akcja nie może być cofnięta.`;
    modal.show();
}

// Funkcja do usunięcia osoby po potwierdzeniu
function deleteRecipientConfirmed() {
    const id = document.getElementById('confirmDeleteRecipientModal').getAttribute('data-recipient-id');
    const modal = bootstrap.Modal.getInstance(document.getElementById('confirmDeleteRecipientModal'));

    fetch(`/api/recipients/${id}`, {
        method: 'DELETE'
    })
        .then(response => response.json())
        .then(data => {
            if (data.success) {
                modal.hide();
                showSuccessMessage('Osoba została usunięta!');
                softReloadRecipients();
            } else {
                modal.hide();
                showErrorModal(data.error || 'Błąd podczas usuwania osoby');
            }
        })
        .catch(error => {
            console.error('Error:', error);
            modal.hide();
            showErrorModal('Błąd połączenia z serwerem');
        });
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}



// Modal functions
function openAddPresentModal() {
    // Show modal immediately for better UX
    const modal = new bootstrap.Modal(document.getElementById('addPresentModal'));
    modal.show();

    // Clear form immediately
    document.getElementById('addPresentForm').reset();
    document.getElementById('addPresentMessage').style.display = 'none';

    // Use cached data if available, otherwise load fresh data
    if (window._cachedRecipients && window._cachedIdentificationStatus) {
        populateAddPresentModal(window._cachedRecipients, window._cachedIdentificationStatus);
    } else {
        // Show loading state in dropdown
        const select = document.getElementById('recipientSelect');
        select.innerHTML = '<option value="">Ładowanie...</option>';

        // Load data in background
        Promise.all([
            fetch('/api/recipients').then(response => response.json()),
            fetch('/api/user/identification').then(response => response.json())
        ])
            .then(([recipients, identificationStatus]) => {
                // Cache the data
                window._cachedRecipients = recipients;
                window._cachedIdentificationStatus = identificationStatus;

                populateAddPresentModal(recipients, identificationStatus);
            })
            .catch(error => {
                console.error('Error loading recipients:', error);
                const select = document.getElementById('recipientSelect');
                select.innerHTML = '<option value="">Błąd ładowania</option>';
                showModalMessage('addPresentMessage', 'Błąd podczas ładowania listy osób', 'danger');
            });
    }
}

function populateAddPresentModal(recipients, identificationStatus) {
    const select = document.getElementById('recipientSelect');

    // Clear select
    select.innerHTML = '<option value="">Wybierz osobę</option>';

    // Add existing recipients to select
    recipients.forEach(recipient => {
        const option = document.createElement('option');
        option.value = recipient.id;
        option.textContent = recipient.name;
        select.appendChild(option);
    });

    // Add "Add person" option at the end
    const addOption = document.createElement('option');
    addOption.value = 'add_new';
    addOption.textContent = '➕ Dodaj nową osobę';
    select.appendChild(addOption);

    // Default set identified person if user is identified
    if (identificationStatus.isIdentified && identificationStatus.identifiedRecipient) {
        const identifiedId = identificationStatus.identifiedRecipient.id.toString();

        for (let i = 0; i < select.options.length; i++) {
            if (select.options[i].value === identifiedId) {
                select.selectedIndex = i;
                break;
            }
        }
    } else {
        select.selectedIndex = 0; // Select "Wybierz osobę"
    }
}

function addPresentFromModal() {
    const title = document.getElementById('presentTitle').value.trim();
    const recipientId = document.getElementById('recipientSelect').value;
    const comments = document.getElementById('presentComments').value.trim();

    if (!title) {
        showModalMessage('addPresentMessage', 'Nazwa prezentu jest wymagana', 'danger');
        return;
    }

    if (!recipientId) {
        showModalMessage('addPresentMessage', 'Wybierz osobę dla prezentu', 'danger');
        return;
    }

    // Check if user wants to add new person
    if (recipientId === 'add_new') {
        // Close current modal and open add recipient modal
        const addPresentModal = bootstrap.Modal.getInstance(document.getElementById('addPresentModal'));
        addPresentModal.hide();

        // Store form data for later use
        window.pendingPresentData = {
            title: title,
            comments: comments
        };

        // Open add recipient modal
        openAddRecipientModal();
        return;
    }

    // Add the present with existing recipient
    fetch('/api/presents', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            title,
            recipient_id: recipientId,
            comments
        })
    })
        .then(response => response.json())
        .then(data => {
            if (data.id) {
                showModalMessage('addPresentMessage', 'Prezent został dodany!', 'success');
                document.getElementById('addPresentForm').reset();

                // Refresh the recipients list to show the new present
                softReloadRecipients();

                // Close modal after 1 second
                setTimeout(() => {
                    const modal = bootstrap.Modal.getInstance(document.getElementById('addPresentModal'));
                    modal.hide();
                }, 1000);
            } else {
                showModalMessage('addPresentMessage', data.error || 'Błąd podczas dodawania prezentu', 'danger');
            }
        })
        .catch(error => {
            console.error('Error:', error);
            showModalMessage('addPresentMessage', 'Błąd połączenia z serwerem', 'danger');
        });
}

function openReservedPresentsModal() {
    // Load reserved presents
    fetch('/api/presents/all')
        .then(response => response.json())
        .then(presents => {
            const reservedPresents = presents.filter(present => present.reserved_by === currentUserId);
            displayReservedPresentsInModal(reservedPresents);

            // Show modal
            const modal = new bootstrap.Modal(document.getElementById('reservedPresentsModal'));
            modal.show();
        })
        .catch(error => {
            console.error('Error loading presents:', error);
            showErrorModal('Błąd podczas ładowania prezentów');
        });
}

function displayReservedPresentsInModal(presents) {
    const container = document.getElementById('reservedPresentsList');

    if (presents.length === 0) {
        container.innerHTML = `
            <div class="text-center text-muted">
                <i class="fas fa-bookmark fa-3x mb-3"></i>
                <p>Nie masz żadnych zarezerwowanych prezentów</p>
            </div>
        `;
        return;
    }

    // Separate presents into two categories
    const uncheckedPresents = presents.filter(present => !present.is_checked);
    const checkedPresents = presents.filter(present => present.is_checked);

    container.innerHTML = `
        <div class="row">
            <!-- Do kupienia -->
            <div class="col-md-6">
                <div class="card">
                    <div class="card-header d-flex justify-content-between align-items-center" style="background-color: #fff3cd; border-color: #ffeaa7;">
                        <div>
                            <i class="fas fa-shopping-cart me-2"></i>
                            <strong>Do kupienia</strong>
                        </div>
                        <span class="badge bg-warning text-dark">${uncheckedPresents.length}</span>
                    </div>
                    <div class="card-body">
                        ${uncheckedPresents.length === 0 ?
            '<p class="text-muted text-center">Brak prezentów do kupienia</p>' :
            uncheckedPresents.map(present => `
                                <div class="present-item-modal card mb-2" data-id="${present.id}">
                                    <div class="card-body p-3">
                                        <div class="row align-items-center">
                                            <div class="col-1">
                                                <div class="form-check">
                                                    <input class="form-check-input" type="checkbox" 
                                                           ${present.is_checked ? 'checked' : ''} 
                                                           onchange="togglePresentFromModal(${present.id}, this.checked)">
                                                </div>
                                            </div>
                                            <div class="col-11">
                                                <h6 class="mb-1">${convertUrlsToLinks(escapeHtml(present.title))}</h6>
                                                <small class="text-muted">Dla: ${escapeHtml(present.recipient_name)}</small>
                                                ${typeof present.comments === 'string' && present.comments.trim().length > 0
                    ? `
                                                    <div class="mt-2">
                                                        <div class="card card-body p-2" style="background: #f8f9fa; min-height: 80px; max-height: 220px; overflow-y: auto;">
                                                            <small class="text-muted" style="white-space: pre-line;">${escapeHtml(present.comments)}</small>
                                                        </div>
                                                    </div>
                                                `
                    : ''
                }
                                                ${present.comments && typeof present.comments !== 'string'
                    ? `<div class="alert alert-danger mt-2 p-2">Błąd: nieprawidłowy format komentarza</div>`
                    : ''
                }
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            `).join('')
        }
                    </div>
                </div>
            </div>
            
            <!-- Kupione -->
            <div class="col-md-6">
                <div class="card">
                    <div class="card-header d-flex justify-content-between align-items-center" style="background-color: #d4edda; border-color: #c3e6cb;">
                        <div>
                            <i class="fas fa-check-circle me-2"></i>
                            <strong>Kupione</strong>
                        </div>
                        <span class="badge bg-success">${checkedPresents.length}</span>
                    </div>
                    <div class="card-body">
                        ${checkedPresents.length === 0 ?
            '<p class="text-muted text-center">Brak kupionych prezentów</p>' :
            checkedPresents.map(present => `
                                <div class="present-item-modal card mb-2 checked" data-id="${present.id}">
                                    <div class="card-body p-3">
                                        <div class="row align-items-center">
                                            <div class="col-1">
                                                <div class="form-check">
                                                    <input class="form-check-input" type="checkbox" 
                                                           ${present.is_checked ? 'checked' : ''} 
                                                           onchange="togglePresentFromModal(${present.id}, this.checked)">
                                                </div>
                                            </div>
                                            <div class="col-11">
                                                <h6 class="mb-1">${convertUrlsToLinks(escapeHtml(present.title))}</h6>
                                                <small class="text-muted">Dla: ${escapeHtml(present.recipient_name)}</small>
                                                ${present.comments ? `<br><small class="text-muted">${escapeHtml(present.comments)}</small>` : ''}
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            `).join('')
        }
                    </div>
                </div>
            </div>
        </div>
    `;
}

function togglePresentFromModal(id, isChecked) {
    const presentItem = document.querySelector(`.present-item-modal[data-id="${id}"]`);
    if (!presentItem) {
        console.error('Present item not found in modal:', id);
        return;
    }

    // Prevent multiple clicks during animation
    if (presentItem.classList.contains('animating')) {
        return;
    }

    // Add animating state to prevent multiple animations
    presentItem.classList.add('animating');

    // Update the server and state immediately
    updateModalPresentCheckStatus(id, isChecked, presentItem);

    // Animate the visual movement, then reorder after animation completes
    animateModalPresentTransition(presentItem, isChecked, () => {
        // Reorder the modal list after animation completes
        reorderModalPresentsList();
        // Remove animating state
        presentItem.classList.remove('animating');
    });
}

// Separate function to update the server after modal animation
function updateModalPresentCheckStatus(id, isChecked, presentItem) {
    // Optimistically update the cached data
    if (window._dataCache && window._dataCache.presents) {
        const present = window._dataCache.presents.find(p => p.id === id);
        if (present) {
            present.is_checked = isChecked;
        }
    }

    // Update the UI immediately
    if (isChecked) {
        presentItem.classList.add('checked');
    } else {
        presentItem.classList.remove('checked');
    }

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
                // Remove updating state
                presentItem.classList.remove('updating');
                presentItem.classList.remove('animating');

                // Update badge counts without full reload
                updateModalBadgeCounts();
            } else {
                console.error('Failed to toggle present:', data.error);
                // Revert optimistic update on error
                if (window._dataCache && window._dataCache.presents) {
                    const present = window._dataCache.presents.find(p => p.id === id);
                    if (present) {
                        present.is_checked = !isChecked;
                    }
                }
                // Revert UI
                if (isChecked) {
                    presentItem.classList.remove('checked');
                } else {
                    presentItem.classList.add('checked');
                }
                // Revert checkbox
                const checkbox = presentItem.querySelector('input[type="checkbox"]');
                if (checkbox) {
                    checkbox.checked = !isChecked;
                }
                presentItem.classList.remove('updating');
                presentItem.classList.remove('animating');
            }
        })
        .catch(error => {
            console.error('Error toggling present:', error);
            // Revert optimistic update on error
            if (window._dataCache && window._dataCache.presents) {
                const present = window._dataCache.presents.find(p => p.id === id);
                if (present) {
                    present.is_checked = !isChecked;
                }
            }
            // Revert UI
            if (isChecked) {
                presentItem.classList.remove('checked');
            } else {
                presentItem.classList.add('checked');
            }
            // Revert checkbox
            const checkbox = presentItem.querySelector('input[type="checkbox"]');
            if (checkbox) {
                checkbox.checked = !isChecked;
            }
            presentItem.classList.remove('updating');
            presentItem.classList.remove('animating');
        });
}

// Update badge counts in modal without full reload
function updateModalBadgeCounts() {
    if (!window._dataCache || !window._dataCache.presents) return;

    const currentUserId = window._currentUserId;
    const reservedPresents = window._dataCache.presents.filter(p => p.reserved_by === currentUserId);
    const uncheckedPresents = reservedPresents.filter(p => !p.is_checked);
    const checkedPresents = reservedPresents.filter(p => p.is_checked);

    // Update badges
    const uncheckedBadge = document.querySelector('#reservedPresentsModal .card-header .badge.bg-warning');
    const checkedBadge = document.querySelector('#reservedPresentsModal .card-header .badge.bg-success');

    if (uncheckedBadge) {
        uncheckedBadge.textContent = uncheckedPresents.length;
    }
    if (checkedBadge) {
        checkedBadge.textContent = checkedPresents.length;
    }
}

// Helper function to animate present transitions in modal
function animateModalPresentTransition(presentItem, isChecked, callback) {
    const container = presentItem.closest('.card-body');
    if (!container) {
        if (callback) callback();
        return;
    }

    // Get current position and dimensions
    const rect = presentItem.getBoundingClientRect();
    const containerRect = container.getBoundingClientRect();
    const itemHeight = rect.height;
    const itemTop = rect.top - containerRect.top;

    // Create a clone for the animation
    const clone = presentItem.cloneNode(true);
    clone.style.position = 'absolute';
    clone.style.top = itemTop + 'px';
    clone.style.left = '0';
    clone.style.right = '0';
    clone.style.zIndex = '1000';
    clone.style.pointerEvents = 'none';
    clone.style.opacity = '1'; // Keep the animated item fully opaque
    clone.classList.remove('updating', 'animating');

    // Add to container
    container.style.position = 'relative';
    container.appendChild(clone);

    // Animate the clone
    const targetY = isChecked ? containerRect.height : -itemHeight;
    clone.style.transition = 'all 0.8s ease-out'; // Updated to 0.8s

    // Trigger animation
    setTimeout(() => {
        clone.style.transform = `translateY(${targetY}px)`;
        clone.style.opacity = '0'; // Only fade out at the end
    }, 10);

    // Remove clone after animation and call callback
    setTimeout(() => {
        if (clone.parentNode) {
            clone.parentNode.removeChild(clone);
        }
        // Call the callback function after animation completes
        if (callback) callback();
    }, 800); // Updated to 800ms
}

function cancelReservationFromModal(presentId) {
    if (confirm('Czy na pewno chcesz anulować rezerwację tego prezentu?')) {
        fetch(`/api/presents/${presentId}/reserve`, {
            method: 'DELETE'
        })
            .then(response => response.json())
            .then(data => {
                if (data.success) {
                    // Refresh the reserved presents list
                    openReservedPresentsModal();
                } else {
                    showErrorModal(data.error || 'Błąd podczas anulowania rezerwacji');
                }
            })
            .catch(error => {
                console.error('Error:', error);
                showErrorModal('Błąd połączenia z serwerem');
            });
    }
}

function openAddRecipientModal() {
    // Clear form
    document.getElementById('addRecipientForm').reset();
    document.getElementById('addRecipientMessage').style.display = 'none';

    // Show modal
    const modal = new bootstrap.Modal(document.getElementById('addRecipientModal'));
    modal.show();
}

function addRecipientFromModal() {
    const name = document.getElementById('recipientName').value.trim();

    if (!name) {
        showModalMessage('addRecipientMessage', 'Nazwa jest wymagana', 'danger');
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
            if (data.success && data.recipient) {
                // Close add recipient modal
                const addRecipientModal = bootstrap.Modal.getInstance(document.getElementById('addRecipientModal'));
                addRecipientModal.hide();

                // Check if we have pending present data
                if (window.pendingPresentData) {
                    // Return to add present modal with the new recipient selected
                    returnToAddPresentModalWithNewRecipient(data.recipient.id, name);
                } else {
                    // Normal flow - just show success message and refresh list
                    showModalMessage('addRecipientMessage', 'Osoba została dodana!', 'success');
                    document.getElementById('addRecipientForm').reset();

                    // Clear cache and refresh the recipients list to show the new person
                    clearRecipientsCache();
                    softReloadRecipients();

                    // Close modal after 1 second
                    setTimeout(() => {
                        const modal = bootstrap.Modal.getInstance(document.getElementById('addRecipientModal'));
                        modal.hide();
                    }, 1000);
                }
            } else {
                showModalMessage('addRecipientMessage', data.error || 'Błąd podczas dodawania osoby', 'danger');
            }
        })
        .catch(error => {
            console.error('Error:', error);
            showModalMessage('addRecipientMessage', 'Błąd połączenia z serwerem', 'danger');
        });
}

function returnToAddPresentModalWithNewRecipient(recipientId, recipientName) {
    // Reload recipients and open add present modal
    Promise.all([
        fetch('/api/recipients').then(response => response.json()),
        fetch('/api/user/identification').then(response => response.json())
    ])
        .then(([recipients, identificationStatus]) => {
            const select = document.getElementById('recipientSelect');

            // Clear select
            select.innerHTML = '<option value="">Wybierz osobę</option>';

            // Add existing recipients to select
            recipients.forEach(recipient => {
                const option = document.createElement('option');
                option.value = recipient.id;
                option.textContent = recipient.name;
                select.appendChild(option);
            });

            // Add "Add person" option at the end
            const addOption = document.createElement('option');
            addOption.value = 'add_new';
            addOption.textContent = '➕ Dodaj nową osobę';
            select.appendChild(addOption);

            // Restore form data
            document.getElementById('presentTitle').value = window.pendingPresentData.title;
            document.getElementById('presentComments').value = window.pendingPresentData.comments;

            // Select the newly added recipient
            for (let i = 0; i < select.options.length; i++) {
                if (select.options[i].value === recipientId.toString()) {
                    select.selectedIndex = i;
                    break;
                }
            }

            // Clear pending data
            delete window.pendingPresentData;

            // Clear any previous messages
            document.getElementById('addPresentMessage').style.display = 'none';

            // Show modal
            const modal = new bootstrap.Modal(document.getElementById('addPresentModal'));
            modal.show();
        })
        .catch(error => {
            console.error('Error loading recipients:', error);
            showErrorModal('Błąd podczas ładowania listy osób');
        });
}

function showModalMessage(elementId, message, type) {
    const element = document.getElementById(elementId);
    element.textContent = message;
    element.className = `alert alert-${type} mt-3`;
    element.style.display = 'block';
}

// Optimistic update helper functions
function fetchWithTimeout(url, options, timeout = 10000) {
    return Promise.race([
        fetch(url, options),
        new Promise((_, reject) =>
            setTimeout(() => reject(new Error('Request timeout')), timeout)
        )
    ]);
}

function updateButtonOptimistically(button, action) {
    if (action === 'reserve') {
        button.className = 'btn btn-danger btn-sm w-100 w-md-auto reserve-btn updating';
        button.innerHTML = '<i class="fas fa-xmark"></i> <span class="d-inline d-md-none ms-1">Usuń rezerwację</span>';
    } else {
        button.className = 'btn btn-outline-warning btn-sm w-100 w-md-auto reserve-btn updating';
        button.innerHTML = '<i class="fas fa-bookmark"></i> <span class="d-inline d-md-none ms-1">Zarezerwuj prezent</span>';
    }
    button.disabled = true;
}

function updatePresentItemOptimistically(presentItem, action) {
    if (action === 'reserve') {
        presentItem.classList.remove('reserved-by-other');
        presentItem.classList.add('reserved-by-me');
    } else {
        presentItem.classList.remove('reserved-by-me');
    }
}

function updateCacheOptimistically(presentId, action, userId) {
    if (window._dataCache && window._dataCache.presents) {
        const present = window._dataCache.presents.find(p => p.id === presentId);
        if (present) {
            if (action === 'reserve') {
                present.reserved_by = userId;
                present.reserved_by_username = 'Ty';
            } else {
                present.reserved_by = null;
                present.reserved_by_username = null;
            }
        }
    }
}

function rollbackOptimisticUpdate(presentId, previousState) {
    // Restore cache
    if (window._dataCache && window._dataCache.presents) {
        const present = window._dataCache.presents.find(p => p.id === presentId);
        if (present) {
            present.reserved_by = previousState.reserved_by;
            present.reserved_by_username = previousState.reserved_by_username;
        }
    }

    // Restore present item classes
    const presentItem = document.querySelector(`[data-id="${presentId}"]`);
    if (presentItem) {
        presentItem.className = previousState.itemClasses;
    }

    // Restore button - need to find it again and update its HTML
    const button = presentItem ? presentItem.querySelector('.reserve-btn') : null;
    if (button) {
        button.outerHTML = previousState.buttonHTML;
    }
}

function reservePresentFromRecipients(presentId, button, previousState) {
    fetchWithTimeout(`/api/presents/${presentId}/reserve`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        }
    }, 10000)
        .then(response => {
            if (!response.ok) {
                return response.json().then(data => {
                    throw new Error(data.error || 'Server error');
                });
            }
            return response.json();
        })
        .then(data => {
            if (data.success) {
                // Success - optimistic update is confirmed
                showSuccessToast('Prezent zarezerwowany!');

                // Update button to show cancel action with correct onclick handler
                const presentItem = document.querySelector(`[data-id="${presentId}"]`);
                const currentButton = presentItem ? presentItem.querySelector('.reserve-btn') : null;
                if (currentButton) {
                    currentButton.disabled = false;
                    currentButton.classList.remove('updating');
                    currentButton.setAttribute('onclick', `handleReserveClick(event, ${presentId}, 'cancel')`);
                    currentButton.setAttribute('title', 'Usuń rezerwację');
                }
            } else {
                // Server returned success: false - rollback
                const errorMsg = data.error || 'Błąd podczas rezerwacji';
                showErrorToast(errorMsg);
                rollbackOptimisticUpdate(presentId, previousState);
            }
        })
        .catch(error => {
            console.error('Error reserving present:', error);

            // Determine error type for better messaging
            let errorMsg = 'Błąd podczas rezerwacji';
            if (error.message === 'Request timeout') {
                errorMsg = 'Przekroczono limit czasu żądania. Spróbuj ponownie.';
            } else if (error.message.includes('already reserved')) {
                errorMsg = 'Ten prezent został już zarezerwowany przez kogoś innego';
            } else if (!navigator.onLine) {
                errorMsg = 'Brak połączenia z internetem';
            } else if (error.message) {
                errorMsg = error.message;
            }

            showErrorToast(errorMsg);
            rollbackOptimisticUpdate(presentId, previousState);
        });
}

function cancelReservationFromRecipients(presentId, button, previousState) {
    fetchWithTimeout(`/api/presents/${presentId}/reserve`, {
        method: 'DELETE',
        headers: {
            'Content-Type': 'application/json',
        }
    }, 10000)
        .then(response => {
            if (!response.ok) {
                return response.json().then(data => {
                    throw new Error(data.error || 'Server error');
                });
            }
            return response.json();
        })
        .then(data => {
            if (data.success) {
                // Success - optimistic update is confirmed
                showSuccessToast('Rezerwacja anulowana');

                // Update button to show reserve action with correct onclick handler
                const presentItem = document.querySelector(`[data-id="${presentId}"]`);
                const currentButton = presentItem ? presentItem.querySelector('.reserve-btn') : null;
                if (currentButton) {
                    currentButton.disabled = false;
                    currentButton.classList.remove('updating');
                    currentButton.setAttribute('onclick', `handleReserveClick(event, ${presentId}, 'reserve')`);
                    currentButton.setAttribute('title', 'Zarezerwuj prezent');
                }
            } else {
                // Server returned success: false - rollback
                const errorMsg = data.error || 'Błąd podczas anulowania rezerwacji';
                showErrorToast(errorMsg);
                rollbackOptimisticUpdate(presentId, previousState);
            }
        })
        .catch(error => {
            console.error('Error canceling reservation:', error);

            // Determine error type for better messaging
            let errorMsg = 'Błąd podczas anulowania rezerwacji';
            if (error.message === 'Request timeout') {
                errorMsg = 'Przekroczono limit czasu żądania. Spróbuj ponownie.';
            } else if (error.message.includes('not reserved')) {
                errorMsg = 'Ten prezent nie jest zarezerwowany';
            } else if (!navigator.onLine) {
                errorMsg = 'Brak połączenia z internetem';
            } else if (error.message) {
                errorMsg = error.message;
            }

            showErrorToast(errorMsg);
            rollbackOptimisticUpdate(presentId, previousState);
        });
}

function showReservedByOtherModal(username) {
    // Show modal with the message
    const modal = new bootstrap.Modal(document.getElementById('reservedByOtherModal'));
    document.getElementById('reservedByOtherMessage').textContent = "Sorry, teraz to już po ptokach! Już ktoś inny to zarezerwował. Trzeba było szybciej rezerwować matole! Wybierz coś innego.";
    modal.show();
}

function redirectIfAuthenticated() {
    fetch('/api/auth')
        .then(response => response.json())
        .then(data => {
            if (data.authenticated) {
                window.location.href = '/recipients';
            }
        });
}

function openRecipientDetailsModal(recipient, presents, isIdentified) {
    // Ustaw dane w modalu
    document.getElementById('recipientDetailsName').textContent = recipient.name;
    document.getElementById('recipientDetailsName2').textContent = recipient.name;
    const img = document.getElementById('recipientDetailsImage');
    if (recipient.profile_picture) {
        img.src = getFullProfilePictureUrl(recipient.profile_picture);
        img.style.display = 'block';
    } else {
        img.src = '';
        img.style.display = 'none';
    }
    const contentDiv = document.getElementById('recipientDetailsContent');
    if (isIdentified) {
        contentDiv.innerHTML = `<div class="alert alert-warning text-center"><b>Co korci Cię żeby zobaczyć czy już ktoś kupił Twoje prezenty??? Wynocha!</b></div>`;
    } else {
        // Sortowanie prezentów: najpierw niekupione i niezarezerwowane, potem zarezerwowane, potem kupione
        const notBought = presents.filter(p => !p.is_checked && !p.reserved_by);
        const reserved = presents.filter(p => !p.is_checked && p.reserved_by);
        const bought = presents.filter(p => p.is_checked);
        function presentRow(p, extraClass = '') {
            return `<div class="present-item ${extraClass}" style="opacity:${extraClass ? '0.5' : '1'};">` +
                `<div class="d-flex align-items-center justify-content-between">` +
                `<div><b>${escapeHtml(p.title)}</b>${p.comments ? `<br><small class='text-muted'>${escapeHtml(p.comments)}</small>` : ''}</div>` +
                `<div><small>${p.created_at ? new Date(p.created_at).toLocaleDateString('pl-PL') : ''}</small></div>` +
                `</div></div>`;
        }
        let html = '';
        if (notBought.length) {
            html += `<div class='mb-2'><b>Do kupienia:</b></div>` + notBought.map(p => presentRow(p)).join('');
        }
        if (reserved.length) {
            html += `<div class='mb-2 mt-3'><b>Zarezerwowane:</b></div>` + reserved.map(p => presentRow(p, 'reserved-by-other')).join('');
        }
        if (bought.length) {
            html += `<div class='mb-2 mt-3'><b>Kupione:</b></div>` + bought.map(p => presentRow(p, 'checked')).join('');
        }
        if (!html) html = '<p class="text-muted">Brak prezentów dla tej osoby</p>';
        contentDiv.innerHTML = html;
    }
    const modal = new bootstrap.Modal(document.getElementById('recipientDetailsModal'));
    modal.show();
}

// Funkcja pomocnicza do wywołania modalu po kliknięciu
function showRecipientDetailsFromList(recipientId) {
    // Pobierz dane z listy już załadowanej na stronie
    const recipients = window._allRecipients || [];
    const presentsByRecipient = window._allPresentsByRecipient || {};
    const recipient = recipients.find(r => r.id === recipientId);
    const presents = presentsByRecipient[recipientId] || [];
    const isIdentified = currentUserId && recipient.identified_by === currentUserId;
    openRecipientDetailsModal(recipient, presents, isIdentified);
}

// Zmodyfikuj displayRecipientsWithPresents by zapisać dane globalnie
const oldDisplayRecipientsWithPresents = displayRecipientsWithPresents;
displayRecipientsWithPresents = function (recipients, presents) {
    // Zbuduj mapę prezentów po recipientId
    const presentsByRecipient = {};
    presents.forEach(p => {
        if (!presentsByRecipient[p.recipient_id]) presentsByRecipient[p.recipient_id] = [];
        presentsByRecipient[p.recipient_id].push(p);
    });
    window._allRecipients = recipients;
    window._allPresentsByRecipient = presentsByRecipient;
    oldDisplayRecipientsWithPresents(recipients, presents);
};

// Add proper focus management for modals to prevent aria-hidden accessibility issues
document.addEventListener('DOMContentLoaded', function () {
    // Handle modal hidden events to ensure proper focus management
    const modals = document.querySelectorAll('.modal');
    modals.forEach(modal => {
        modal.addEventListener('hidden.bs.modal', function () {
            // Move focus to body when modal is hidden to prevent aria-hidden issues
            document.body.focus();
        });

        modal.addEventListener('show.bs.modal', function () {
            // Ensure modal is properly accessible when shown
            this.removeAttribute('aria-hidden');
        });
    });
});

function openChangePictureModal(recipientId) {
    // Store the recipient ID for later use
    window.currentChangingRecipientId = recipientId;

    const modal = document.getElementById('changePictureModal');
    if (!modal) {
        console.error('Change picture modal not found');
        return;
    }

    // Clear previous form
    document.getElementById('changePictureForm').reset();
    document.getElementById('imagePreview').style.display = 'none';

    // Show the modal
    const bootstrapModal = new bootstrap.Modal(modal);
    bootstrapModal.show();

    // Add event listener for file input
    const fileInput = document.getElementById('newProfilePicture');
    fileInput.onchange = function () {
        const file = this.files[0];
        if (file) {
            const reader = new FileReader();
            reader.onload = function (e) {
                document.getElementById('previewImage').src = e.target.result;
                document.getElementById('imagePreview').style.display = 'block';
            };
            reader.readAsDataURL(file);
        }
    };
}

function saveNewProfilePicture() {
    const fileInput = document.getElementById('newProfilePicture');
    const file = fileInput.files[0];
    const recipientId = window.currentChangingRecipientId;

    if (!file || !recipientId) {
        alert('Proszę wybrać zdjęcie');
        return;
    }

    const formData = new FormData();
    formData.append('profile_picture', file);

    fetch(`/api/recipients/${recipientId}/profile-picture`, {
        method: 'POST',
        body: formData
    })
        .then(response => response.json())
        .then(data => {
            if (data.success) {
                // Close the modal
                const modal = document.getElementById('changePictureModal');
                const bootstrapModal = bootstrap.Modal.getInstance(modal);
                bootstrapModal.hide();

                // Refresh the recipients list
                softReloadRecipients();

                // Show success message
                alert('Zdjęcie profilowe zostało zaktualizowane');
            } else {
                alert('Błąd podczas aktualizacji zdjęcia: ' + (data.error || 'Nieznany błąd'));
            }
        })
        .catch(error => {
            console.error('Error:', error);
            alert('Błąd podczas aktualizacji zdjęcia');
        });
}

function openProfilePicturePreview(recipientId) {
    const recipient = window._allRecipients.find(r => r.id === recipientId);
    if (!recipient || !recipient.profile_picture || recipient.profile_picture.trim() === '') {
        return; // Don't open modal for placeholders
    }

    const modal = document.getElementById('profilePreviewModal');
    const previewImage = document.getElementById('profilePreviewImage');
    const previewName = document.getElementById('profilePreviewName');

    if (modal && previewImage && previewName) {
        previewImage.src = getFullProfilePictureUrl(recipient.profile_picture);
        previewName.textContent = recipient.name;

        const bootstrapModal = new bootstrap.Modal(modal);
        bootstrapModal.show();
    }
}

// Edit present function
function editPresent(presentId, title, recipientId, comments) {
    console.log('Editing present:', { presentId, title, recipientId, comments });

    // Set the form values
    document.getElementById('editPresentId').value = presentId;
    document.getElementById('editPresentTitle').value = title;
    document.getElementById('editPresentComments').value = comments || '';

    // Populate recipient select
    populateEditRecipientSelect(recipientId);

    // Show the modal
    const modal = new bootstrap.Modal(document.getElementById('editPresentModal'));
    modal.show();
}

function populateEditRecipientSelect(selectedRecipientId) {
    const select = document.getElementById('editRecipientSelect');
    select.innerHTML = '<option value="">Wybierz osobę</option>';

    // Use cached recipients if available
    const recipients = window._cachedRecipients || [];

    recipients.forEach(recipient => {
        const option = document.createElement('option');
        option.value = recipient.id;
        option.textContent = recipient.name;
        if (recipient.id === selectedRecipientId) {
            option.selected = true;
        }
        select.appendChild(option);
    });
}

function saveEditedPresent() {
    const presentId = document.getElementById('editPresentId').value;
    const title = document.getElementById('editPresentTitle').value.trim();
    const recipientId = document.getElementById('editRecipientSelect').value;
    const comments = document.getElementById('editPresentComments').value.trim();

    if (!title) {
        showEditPresentMessage('Nazwa prezentu jest wymagana', 'danger');
        return;
    }

    if (!recipientId) {
        showEditPresentMessage('Wybierz osobę', 'danger');
        return;
    }

    // Show loading state
    showEditPresentMessage('Zapisywanie...', 'info');

    fetch(`/api/presents/${presentId}`, {
        method: 'PUT',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            title,
            recipient_id: recipientId,
            comments: comments || null
        })
    })
        .then(response => response.json())
        .then(data => {
            if (data.success) {
                showEditPresentMessage('Prezent został zaktualizowany!', 'success');

                // Refresh the list
                setTimeout(() => {
                    const modal = bootstrap.Modal.getInstance(document.getElementById('editPresentModal'));
                    modal.hide();
                    softReloadRecipients();
                }, 1000);
            } else {
                showEditPresentMessage(data.error || 'Błąd podczas aktualizacji prezentu', 'danger');
            }
        })
        .catch(error => {
            console.error('Error updating present:', error);
            showEditPresentMessage('Błąd podczas aktualizacji prezentu', 'danger');
        });
}

function showEditPresentMessage(message, type) {
    const messageDiv = document.getElementById('editPresentMessage');
    messageDiv.className = `alert alert-${type} mt-3`;
    messageDiv.textContent = message;
    messageDiv.style.display = 'block';

    if (type === 'success') {
        setTimeout(() => {
            messageDiv.style.display = 'none';
        }, 3000);
    }
}

// Add deletePresent function if not present
if (typeof window.deletePresent !== 'function') {
    window.deletePresent = function (presentId, presentTitle, recipientId) {
        if (!confirm(`Czy na pewno chcesz usunąć prezent: "${presentTitle}"?`)) return;
        fetch(`/api/presents/${presentId}`, { method: 'DELETE' })
            .then(res => res.json())
            .then(data => {
                if (data.success) {
                    showSuccessMessage('Prezent został usunięty.');
                    softReloadRecipients();
                } else {
                    showErrorModal(data.error || 'Błąd podczas usuwania prezentu');
                }
            })
            .catch(() => showErrorModal('Błąd połączenia z serwerem'));
    }
}

// Function to reorder presents list after animation
function reorderPresentsList() {
    const presentsList = document.querySelector('.presents-list');
    if (!presentsList) return;

    const presentItems = Array.from(presentsList.querySelectorAll('.present-item'));

    // Store original positions before sorting
    const originalPositions = new Map();
    presentItems.forEach((item, index) => {
        originalPositions.set(item, index);
    });

    // Sort items: unchecked first, then checked
    presentItems.sort((a, b) => {
        const aChecked = a.querySelector('.form-check-input').checked;
        const bChecked = b.querySelector('.form-check-input').checked;

        if (aChecked === bChecked) return 0;
        return aChecked ? 1 : -1; // Unchecked items first
    });

    // Reorder DOM elements, skipping animation for items that don't move
    presentItems.forEach((item, newIndex) => {
        const originalIndex = originalPositions.get(item);

        // Skip animation if item doesn't change position
        if (originalIndex === newIndex) {
            item.style.transition = 'none';
            presentsList.appendChild(item);
            // Restore transition after a brief delay
            setTimeout(() => {
                item.style.transition = '';
            }, 10);
        } else {
            presentsList.appendChild(item);
        }
    });
}

// Function to reorder modal presents list after animation
function reorderModalPresentsList() {
    const modalBody = document.querySelector('#reservedPresentsModal .card-body');
    if (!modalBody) return;

    const presentItems = Array.from(modalBody.querySelectorAll('.present-item-modal'));

    // Sort items: unchecked first, then checked
    presentItems.sort((a, b) => {
        const aChecked = a.querySelector('.form-check-input').checked;
        const bChecked = b.querySelector('.form-check-input').checked;

        if (aChecked === bChecked) return 0;
        return aChecked ? 1 : -1; // Unchecked items first
    });

    // Store original positions before sorting
    const originalPositions = new Map();
    presentItems.forEach((item, index) => {
        originalPositions.set(item, index);
    });

    // Sort items: unchecked first, then checked
    presentItems.sort((a, b) => {
        const aChecked = a.querySelector('.form-check-input').checked;
        const bChecked = b.querySelector('.form-check-input').checked;

        if (aChecked === bChecked) return 0;
        return aChecked ? 1 : -1; // Unchecked items first
    });

    // Reorder DOM elements, skipping animation for items that don't move
    presentItems.forEach((item, newIndex) => {
        const originalIndex = originalPositions.get(item);

        // Skip animation if item doesn't change position
        if (originalIndex === newIndex) {
            item.style.transition = 'none';
            modalBody.appendChild(item);
            // Restore transition after a brief delay
            setTimeout(() => {
                item.style.transition = '';
            }, 10);
        } else {
            modalBody.appendChild(item);
        }
    });
}

// Helper to get full profile picture URL
function getFullProfilePictureUrl(path) {
    if (!path) return '';
    if (path.startsWith('/uploads/')) {
        return 'https://prezenty.matmamon.com' + path;
    }
    return path;
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
                recipient_name: p.recipient_name
            })),
            // Only cache essential identification info (not the huge object)
            identificationStatus: data.identificationStatus ? {
                isIdentified: data.identificationStatus.isIdentified,
                userId: data.identificationStatus.userId,
                username: data.identificationStatus.username,
                name: data.identificationStatus.name
                // Don't cache identifiedRecipient - it's huge!
            } : null
        };
        
        const cacheData = {
            data: optimizedData,
            timestamp: Date.now()
        };
        
        const jsonString = JSON.stringify(cacheData);
        const sizeKB = (jsonString.length / 1024).toFixed(2);
        
        // Log detailed size breakdown
        console.log(`[Cache] Data breakdown:`, {
            recipients: optimizedData.recipients.length,
            presents: optimizedData.presents.length,
            totalSizeKB: sizeKB,
            recipientsSizeKB: (JSON.stringify(optimizedData.recipients).length / 1024).toFixed(2),
            presentsSizeKB: (JSON.stringify(optimizedData.presents).length / 1024).toFixed(2)
        });
        
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
                console.log('Persistent cache expired');
                localStorage.removeItem('recipientsCache');
            }
        }
    } catch (error) {
        console.error('Error loading from persistent cache:', error);
        localStorage.removeItem('recipientsCache');
    }
    return null;
}

function clearPersistentCache() {
    try {
        localStorage.removeItem('recipientsCache');
        console.log('Persistent cache cleared');
    } catch (error) {
        console.error('Error clearing persistent cache:', error);
    }
}

// Soft reload - only updates cache without showing loading state
function softReloadRecipients() {
    console.log('Soft reloading recipients data...');

    const startTime = performance.now();

    Promise.all([
        fetch('/api/recipients-with-presents').then(response => {
            if (!response.ok) throw new Error('API error');
            return response.json();
        }),
        fetch('/api/user/identification').then(response => {
            if (!response.ok) throw new Error('Identification API error');
            return response.json();
        })
    ])
        .then(([combinedData, identificationStatus]) => {
            const endTime = performance.now();
            console.log(`Soft reload completed in ${(endTime - startTime).toFixed(2)}ms`);

            const recipients = combinedData.recipients || [];
            const presentsData = combinedData.presents || [];

            // Update cache
            const cacheData = { recipients, presents: presentsData, identificationStatus };
            window._dataCache = cacheData;
            window._dataCacheTimestamp = Date.now();
            window._cachedRecipients = recipients;
            window._cachedIdentificationStatus = identificationStatus;

            // Save to persistent cache
            saveToPersistentCache(cacheData);

            // Update display without loading state
            displayRecipientsWithPresents(recipients, presentsData);
            handleIdentificationLogic(recipients, identificationStatus);
        })
        .catch(error => {
            console.error('Error in soft reload:', error);
            // Fallback to cached data if available
            if (window._dataCache) {
                console.log('Using cached data after soft reload error');
            }
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

// Cache management functions
function clearRecipientsCache() {
    window._cachedRecipients = null;
    window._cachedIdentificationStatus = null;
    window._dataCache = null;
    window._dataCacheTimestamp = null;
    clearPersistentCache();
}

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
            const recipientCard = document.querySelector(`[data-recipient-id="${identifiedRecipient.id}"]`);
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

function refreshRecipientsCache() {
    return Promise.all([
        fetch('/api/recipients').then(response => response.json()),
        fetch('/api/user/identification').then(response => response.json())
    ])
        .then(([recipients, identificationStatus]) => {
            window._cachedRecipients = recipients;
            window._cachedIdentificationStatus = identificationStatus;
            return { recipients, identificationStatus };
        });
}

// PWA functionality is now handled in recipients.html

// PWA helper functions removed - functionality moved to recipients.html
