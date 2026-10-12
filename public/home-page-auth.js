
        // Check authentication
        function checkAuth() {
            return fetch('/api/auth', {
                credentials: 'include'
            })
                .then(response => response.json())
                .then(data => {
                    if (!data.authenticated) {
                        console.warn('User not authenticated, redirecting to login');
                        window.location.href = '/';
                        throw new Error('Not authenticated');
                    }
                    // Set current user ID for recipients.js functions
                    window._currentUserId = data.user.id;
                    return data.user;
                })
                .catch(error => {
                    console.error('Auth check error:', error);
                    throw error;
                });
        }

        // Check auth on page load
        checkAuth().then(() => {
            console.log('User authenticated, loading all data');
            loadAllData();

            // Check identification status and show modal if needed
            checkIdentificationStatus();
        }).catch(() => {
            console.log('Auth failed, redirecting to login');
        });

        // Optimized: Load all data with a single API call
        function loadAllData() {
            Promise.all([
                fetch('/api/recipients-with-presents').then(r => r.json()),
                fetch('/api/user/identification').then(r => r.json()),
                fetch('/api/leaderboard').then(r => r.json())
            ])
                .then(([combinedData, identificationStatus, leaderboardData]) => {
                    const presents = combinedData.presents || [];
                    const recipients = combinedData.recipients || [];

                    // Cache for edit modal
                    window._cachedRecipients = recipients;

                    // Shared dataset for optimistic updates: actions mutate
                    // this and re-render sections instantly
                    window._homeData = { presents, recipients, identificationStatus };

                    // Update stats
                    if (leaderboardData.cumulativeStats) {
                        updateCumulativeProgress(leaderboardData.cumulativeStats);
                    }

                    // Load profile
                    loadMyProfileWithData(recipients, presents, identificationStatus);

                    // Load all sections with the same data
                    loadAvailablePresentsWithData(presents, recipients, identificationStatus);
                    loadMyReservationsWithData(presents, recipients, identificationStatus);
                    loadBoughtPresentsWithData(presents, recipients, identificationStatus);
                })
                .catch(error => console.error('Error loading data:', error));
        }

        // Check if user needs to identify themselves
        function checkIdentificationStatus() {
            Promise.all([
                fetch('/api/recipients').then(r => r.json()),
                fetch('/api/user/identification').then(r => r.json())
            ]).then(([recipients, identificationStatus]) => {
                // Call the identification logic from recipients.js
                if (typeof window.checkAndPromptIdentification === 'function') {
                    window.checkAndPromptIdentification(recipients, identificationStatus);
                } else {
                    // Fallback: manually check and show modal
                    const alreadyIdentified = recipients.find(r => r.identified_by === window._currentUserId);

                    if (!alreadyIdentified && !identificationStatus.isIdentified) {
                        const matchingRecipient = recipients.find(r =>
                            r.name.toLowerCase() === identificationStatus.username?.toLowerCase() &&
                            !r.identified_by
                        );

                        if (matchingRecipient) {
                            setTimeout(() => {
                                if (typeof identifyAsRecipient === 'function') {
                                    identifyAsRecipient(matchingRecipient.id, matchingRecipient.name, true);
                                }
                            }, 500);
                        } else {
                            setTimeout(() => {
                                if (typeof showRecipientSelectionModal === 'function') {
                                    showRecipientSelectionModal();
                                }
                            }, 500);
                        }
                    }
                }
            }).catch(error => {
                console.error('Error checking identification:', error);
            });
        }
    