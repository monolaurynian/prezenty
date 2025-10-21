// Fast loading system for instant page loads
// Shows cached data immediately, then updates in background

(function() {
    'use strict';

    const CACHE_KEY = 'app_data_cache';
    const CACHE_TIMESTAMP_KEY = 'app_data_cache_timestamp';
    const CACHE_MAX_AGE = 5 * 60 * 1000; // 5 minutes

    // Preload critical data from cache immediately
    function preloadFromCache() {
        try {
            const cachedData = localStorage.getItem(CACHE_KEY);
            const cacheTimestamp = localStorage.getItem(CACHE_TIMESTAMP_KEY);
            
            if (!cachedData || !cacheTimestamp) {
                return null;
            }
            
            const age = Date.now() - parseInt(cacheTimestamp);
            
            // Return cached data even if old (will refresh in background)
            return {
                data: JSON.parse(cachedData),
                timestamp: parseInt(cacheTimestamp),
                isStale: age > CACHE_MAX_AGE
            };
        } catch (error) {
            console.error('[FastLoader] Error loading cache:', error);
            return null;
        }
    }

    // Save data to cache
    function saveToCache(data) {
        try {
            localStorage.setItem(CACHE_KEY, JSON.stringify(data));
            localStorage.setItem(CACHE_TIMESTAMP_KEY, Date.now().toString());
        } catch (error) {
            console.error('[FastLoader] Error saving cache:', error);
            // If quota exceeded, clear old data
            if (error.name === 'QuotaExceededError') {
                try {
                    localStorage.removeItem(CACHE_KEY);
                    localStorage.removeItem(CACHE_TIMESTAMP_KEY);
                    localStorage.setItem(CACHE_KEY, JSON.stringify(data));
                    localStorage.setItem(CACHE_TIMESTAMP_KEY, Date.now().toString());
                } catch (e) {
                    console.error('[FastLoader] Failed to clear and save cache:', e);
                }
            }
        }
    }

    // Load data with progressive enhancement
    async function loadData(options = {}) {
        const { forceRefresh = false, showLoading = true } = options;
        
        console.log('[FastLoader] Loading data...', { forceRefresh });
        
        // Step 1: Try to show cached data immediately
        if (!forceRefresh) {
            const cached = preloadFromCache();
            if (cached) {
                console.log('[FastLoader] Showing cached data (age:', Math.round((Date.now() - cached.timestamp) / 1000), 'seconds)');
                
                // Show cached data immediately
                if (typeof displayRecipientsData === 'function') {
                    displayRecipientsData(
                        cached.data.recipients || [],
                        cached.data.presents || [],
                        cached.data.identificationStatus || {}
                    );
                }
                
                // If cache is fresh enough, we're done
                if (!cached.isStale) {
                    console.log('[FastLoader] Cache is fresh, skipping network request');
                    return cached.data;
                }
                
                // Cache is stale, refresh in background
                console.log('[FastLoader] Cache is stale, refreshing in background...');
                showLoading = false; // Don't show loading spinner
            }
        }
        
        // Step 2: Load fresh data from server
        if (showLoading) {
            showLoadingState();
        }
        
        try {
            const startTime = performance.now();
            
            // Load data in parallel
            const [combinedData, identificationStatus] = await Promise.all([
                fetch('/api/recipients-with-presents', {
                    cache: 'no-cache',
                    headers: {
                        'Cache-Control': 'no-cache',
                        'Pragma': 'no-cache'
                    }
                }).then(res => {
                    if (!res.ok) {
                        if (res.status === 401) {
                            window.location.href = '/';
                            throw new Error('Unauthorized');
                        }
                        throw new Error('API error');
                    }
                    return res.json();
                }),
                fetch('/api/user/identification', {
                    cache: 'no-cache',
                    headers: {
                        'Cache-Control': 'no-cache',
                        'Pragma': 'no-cache'
                    }
                }).then(res => {
                    if (!res.ok) throw new Error('Identification API error');
                    return res.json();
                })
            ]);
            
            const endTime = performance.now();
            console.log(`[FastLoader] Data loaded in ${(endTime - startTime).toFixed(2)}ms`);
            
            const recipients = combinedData.recipients || [];
            const presents = combinedData.presents || [];
            
            const data = {
                recipients,
                presents,
                identificationStatus
            };
            
            // Save to cache
            saveToCache(data);
            
            // Update display
            if (typeof displayRecipientsData === 'function') {
                displayRecipientsData(recipients, presents, identificationStatus);
            }
            
            // Handle identification logic
            if (typeof handleIdentificationLogic === 'function') {
                handleIdentificationLogic(recipients, identificationStatus);
            }
            
            return data;
            
        } catch (error) {
            console.error('[FastLoader] Error loading data:', error);
            
            // If we have cached data, keep showing it
            const cached = preloadFromCache();
            if (cached && !forceRefresh) {
                console.log('[FastLoader] Network failed, keeping cached data');
                showToast('Używamy zapisanych danych. Sprawdź połączenie internetowe.', 'warning');
                return cached.data;
            }
            
            // No cached data, show error
            showErrorState(error);
            throw error;
        }
    }

    // Show loading state
    function showLoadingState() {
        const recipientsList = document.getElementById('recipientsList');
        if (!recipientsList) return;
        
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

    // Show error state
    function showErrorState(error) {
        const recipientsList = document.getElementById('recipientsList');
        if (!recipientsList) return;
        
        recipientsList.innerHTML = `
            <div class="alert alert-danger">
                <i class="fas fa-exclamation-triangle me-2"></i>
                Błąd podczas ładowania danych. 
                <button class="btn btn-sm btn-outline-danger ms-2" onclick="window.fastLoader.reload()">
                    <i class="fas fa-redo me-1"></i>Spróbuj ponownie
                </button>
            </div>
        `;
    }

    // Lazy load images
    function setupLazyLoading() {
        if ('IntersectionObserver' in window) {
            const imageObserver = new IntersectionObserver((entries, observer) => {
                entries.forEach(entry => {
                    if (entry.isIntersecting) {
                        const img = entry.target;
                        const src = img.dataset.src;
                        
                        if (src) {
                            img.src = src;
                            img.removeAttribute('data-src');
                            observer.unobserve(img);
                        }
                    }
                });
            }, {
                rootMargin: '50px' // Start loading 50px before image is visible
            });
            
            // Observe all images with data-src
            document.querySelectorAll('img[data-src]').forEach(img => {
                imageObserver.observe(img);
            });
        } else {
            // Fallback for browsers without IntersectionObserver
            document.querySelectorAll('img[data-src]').forEach(img => {
                img.src = img.dataset.src;
                img.removeAttribute('data-src');
            });
        }
    }

    // Prefetch critical resources
    function prefetchResources() {
        // Prefetch API endpoints
        const endpoints = [
            '/api/recipients-with-presents',
            '/api/user/identification'
        ];
        
        endpoints.forEach(endpoint => {
            const link = document.createElement('link');
            link.rel = 'prefetch';
            link.href = endpoint;
            document.head.appendChild(link);
        });
    }

    // Clear cache
    function clearCache() {
        try {
            localStorage.removeItem(CACHE_KEY);
            localStorage.removeItem(CACHE_TIMESTAMP_KEY);
            console.log('[FastLoader] Cache cleared');
        } catch (error) {
            console.error('[FastLoader] Error clearing cache:', error);
        }
    }

    // Reload data
    function reload() {
        return loadData({ forceRefresh: true, showLoading: true });
    }

    // Initialize
    function init() {
        console.log('[FastLoader] Initialized');
        
        // Setup lazy loading for images
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', setupLazyLoading);
        } else {
            setupLazyLoading();
        }
        
        // Prefetch resources
        prefetchResources();
        
        // Re-setup lazy loading when new content is added
        const observer = new MutationObserver(() => {
            setupLazyLoading();
        });
        
        observer.observe(document.body, {
            childList: true,
            subtree: true
        });
    }

    // Expose public API
    window.fastLoader = {
        load: loadData,
        reload: reload,
        clearCache: clearCache,
        preloadFromCache: preloadFromCache,
        saveToCache: saveToCache
    };

    // Auto-initialize
    init();
})();
