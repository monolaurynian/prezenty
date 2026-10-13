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
            // Seed the user id from the cached identification BEFORE the
            // first render. checkAuth() hasn't resolved yet at this point,
            // and rendering with currentUserId=null made every present the
            // user reserved look "taken by someone else" (greyed out) until
            // the post-auth re-render corrected it.
            const cachedUserId = persistentCache.data.identificationStatus &&
                persistentCache.data.identificationStatus.userId;
            if (cachedUserId != null && currentUserId == null) {
                currentUserId = cachedUserId;
                window._currentUserId = cachedUserId;
                console.log('[FastLoad] Seeded currentUserId from cache:', cachedUserId);
            }

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

                    // No loading placeholder for the identified user's own
                    // card anymore: the own card is hidden by default (own
                    // presents are managed in "Edytuj moje prezenty") and
                    // only appears when explicitly selected in the person
                    // filter - see applyAllFilters in filters.js.

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

    // Skip initialization if flag is set (e.g., on home.html)
    if (window.SKIP_RECIPIENTS_INIT) {
        console.log('[Recipients.js] Skipping auto-initialization (SKIP_RECIPIENTS_INIT flag set)');
        return;
    }

    // Initialize UI components
    initializeSearchAndFilter();
    initializeFAB();
    initializeAnimations();

    // Check authentication and refresh data if needed
    checkAuth().then(() => {
        // Deep link: opening recipients.html#reserved (e.g. from the homepage
        // tab-bar menu) should immediately show the reserved presents popup
        if (window.location.hash === '#reserved') {
            // Clear the hash so a page refresh doesn't reopen the modal
            history.replaceState(null, '', window.location.pathname + window.location.search);
            setTimeout(() => openReservedPresentsModal(), 300);
        }

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

                    // Update caches BEFORE rendering: the render pipeline
                    // re-applies filters synchronously (incl. hiding the
                    // identified user's own card) and reads identification
                    // from these caches - rendering first would let the own
                    // card slip through with stale/old-format cache data.
                    window._identifiedUserDataLoaded = true;
                    window._dataCache = {
                        recipients: allRecipients,
                        presents: allPresents,
                        identificationStatus
                    };
                    window._cachedIdentificationStatus = identificationStatus;
                    saveToPersistentCache(window._dataCache);

                    console.log('[FastLoad] Merging cached data with identified user data');
                    displayRecipientsWithPresents(allRecipients, allPresents);
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
                // Rendering/compare helpers use window._currentUserId - it was
                // never set on this page, so freshly reserved presents weren't
                // recognized as the user's own after optimistic re-renders
                window._currentUserId = data.user.id;
                console.log('Auth successful, currentUserId set to:', currentUserId);
            }
        })
        .catch(error => {
            console.error('Auth check error:', error);
            throw error;
        });
}

// Skeleton placeholder cards shown while data loads (no layout jump, feels instant)
function getSkeletonCardsHTML(count = 3) {
    const widths = [[40, 70, 55], [50, 65, 45], [35, 75, 60]];
    let cards = '';
    for (let i = 0; i < count; i++) {
        const w = widths[i % widths.length];
        cards += `
            <div class="skeleton-card">
                <div class="skeleton skeleton-avatar"></div>
                <div class="skeleton-lines">
                    <div class="skeleton skeleton-line" style="width: ${w[0]}%;"></div>
                    <div class="skeleton skeleton-line" style="width: ${w[1]}%;"></div>
                    <div class="skeleton skeleton-line" style="width: ${w[2]}%;"></div>
                </div>
            </div>`;
    }
    return `<div class="skeleton-cards" aria-hidden="true">${cards}</div>
        <p class="text-center visually-hidden" role="status">Ładowanie danych...</p>`;
}

