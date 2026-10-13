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
        recipientsList.innerHTML = getSkeletonCardsHTML();
    }

    // Load data with optimized single request
    const startTime = performance.now();

    Promise.all([
        fetch('/api/recipients-with-presents', { credentials: 'include' }).then(response => {
            if (!response.ok) {
                if (response.status === 401) {
                    console.warn('[API] Got 401 from /api/recipients-with-presents, will retry...');
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
                const offline = !navigator.onLine;
                document.getElementById('recipientsList').innerHTML = `
                    <div class="text-center py-5">
                        <div style="font-size: 48px; margin-bottom: 12px;">${offline ? '📡' : '🎄'}</div>
                        <h5>${offline ? 'Brak połączenia z internetem' : 'Nie udało się załadować danych'}</h5>
                        <p class="text-muted">${offline
                            ? 'Sprawdź połączenie i spróbuj ponownie.'
                            : 'Serwer mógł się jeszcze budzić. Zwykle pomaga ponowna próba.'}</p>
                        <button class="btn btn-primary mt-2" onclick="loadRecipientsWithPresents(true, false)">
                            <i class="fas fa-rotate-right me-1"></i>Spróbuj ponownie
                        </button>
                    </div>`;
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
        // Verification badge next to the name (replaces the old "Zidentyfikowane przez" banner)
        const verifiedByName = isIdentifiedByOther ? (recipient.identified_by_username || 'nieznany użytkownik') : null;

        // Show surprise note for identified user, otherwise show presents
        let presentsHTML;
        if (isIdentified) {
            // List presents added by the current user in a collapsed accordion
            const ownPresents = recipientPresents.filter(p => p.created_by === currentUserId);
            const accordionId = `accordion-own-${recipient.id}`;
            const isLoading = recipientPresents.length === 0 && !window._identifiedUserDataLoaded;

            presentsHTML = `
                <div class="accordion" id="${accordionId}" data-recipient-id="${recipient.id}">
                    <div class="accordion-item">
                        <h2 class="accordion-header">
                            <button class="accordion-button collapsed accordion-button-identified" type="button" data-bs-toggle="collapse" data-bs-target="#${accordionId}-collapse" aria-expanded="false" style="background-color: #cfe2ff; color: #084298; font-weight: 600;">
                                ${isLoading ? `
                                    <i class="fas fa-spinner fa-spin me-2"></i>
                                    <i class="fas fa-lock me-2"></i>Ładowanie Twoich prezentów z zachowaniem niespodzianki...
                                ` : `
                                    <i class="fas fa-gift me-2"></i>
                                    Twoje prezenty (${ownPresents.length}) - kliknij, aby edytować
                                `}
                            </button>
                        </h2>
                        <div id="${accordionId}-collapse" class="accordion-collapse collapse" data-bs-parent="#${accordionId}">
                            <div class="accordion-body accordion-body-identified">
                                ${isLoading ? `
                                    <div class="text-center py-4">
                                        <div class="spinner-border text-primary mb-3" role="status">
                                            <span class="visually-hidden">Ładowanie...</span>
                                        </div>
                                        <p class="text-muted">Ładowanie Twoich prezentów z zachowaniem niespodzianki...</p>
                                    </div>
                                ` : `
                                    <div class="alert alert-info mb-3" style="background: linear-gradient(135deg, #cfe2ff 0%, #9ec5fe 100%); border-left: 4px solid #0d6efd;">
                                        <strong>🎁 Niespodzianka!</strong><br>
                                        Nie możesz zobaczyć, które z Twoich prezentów zostały zarezerwowane albo zakupione. Chyba nie chcesz sobie zepsuć niespodzianki!
                                    </div>
                                    ${ownPresents.length > 0 ? `
                                        <div class="fw-bold mb-2"><i class="fas fa-list me-1"></i>Twoje dodane prezenty:</div>
                                        <ul class="list-group">
                                            ${ownPresents.map(p => `
                                                <li class="list-group-item present-item" data-id="${p.id}">
                                                    <div class="d-flex align-items-start flex-wrap flex-md-nowrap">
                                                        <div class="flex-grow-1">
                                                            <div class="fw-semibold present-name">${escapeHtml(p.title)}</div>
                                                            ${p.comments ? `<div class="text-muted small mt-1"><i class="fas fa-info-circle me-1"></i>${escapeHtml(p.comments)}</div>` : ''}
                                                        </div>
                                                        <div class="d-flex gap-2 justify-content-center justify-content-md-end w-100 w-md-auto mt-2 mt-md-0">
                                                            <button class="btn btn-sm btn-primary w-100 w-md-auto edit-present-btn"
                                                                data-present-id="${p.id}"
                                                                data-present-title="${escapeAttr(p.title)}"
                                                                data-recipient-id="${p.recipient_id}"
                                                                data-present-comments="${escapeAttr(p.comments || '')}"
                                                                style="max-width:50px; min-width:50px;">
                                                                <i class="fas fa-edit" style="color: white;"></i>
                                                            </button>
                                                            <button class="btn btn-sm btn-danger w-100 w-md-auto delete-present-btn"
                                                                data-present-id="${p.id}"
                                                                data-present-title="${escapeAttr(p.title)}"
                                                                data-recipient-id="${recipient.id}"
                                                                style="max-width:50px; min-width:50px;">
                                                                <i class="fas fa-trash-alt"></i>
                                                            </button>
                                                        </div>
                                                    </div>
                                                </li>
                                            `).join('')}
                                        </ul>
                                    ` : '<p class="text-muted mb-0">Nie masz jeszcze dodanych prezentów.</p>'}
                                `}
                            </div>
                        </div>
                    </div>
                </div>
            `;
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
                        <div class="recipient-avatar" style="position: relative; display: inline-block;">
                            ${recipient.profile_picture && recipient.profile_picture.trim() !== '' ?
                `<img src="${escapeAttr(getFullProfilePictureUrl(recipient.profile_picture))}" alt="Zdjęcie profilowe" class="img-fluid" onclick="openProfilePicturePreview(${recipient.id})" style="cursor: pointer;">` :
                `<div class="profile-picture-placeholder" onclick="openProfilePicturePreview(${recipient.id})" style="cursor: pointer; font-size: 4rem;">
                                    ${getEmojiAvatar(recipient.name)}
                                </div>`
            }
                            ${recipient.identified_by ? `<span title="${recipient.online ? 'Online' : 'Offline'}" style="position: absolute; bottom: 6px; right: 6px; width: 16px; height: 16px; border-radius: 50%; background: ${recipient.online ? '#4CAF50' : '#F44336'}; border: 2.5px solid #ffffff; box-shadow: 0 1px 4px rgba(0,0,0,0.25);"></span>` : ''}
                        </div>
                        
                        <!-- Name shown in profile section for wider screens -->
                        <div class="recipient-name-in-profile d-none d-lg-block">
                            <div class="profile-name-with-check d-flex align-items-center justify-content-center">
                                <h6 class="mt-2 mb-1 me-2">${recipientNameWithBadge(recipient.name, verifiedByName)}</h6>
                                ${!isIdentified && !hasAnyIdentification ? `
                                    <button class="btn profile-check-btn d-none d-lg-block" onclick="identifyAsRecipient(${recipient.id}, ${PrezentyEscape.jsStringAttr(escapeHtml(recipient.name))})" title="To jestem ja">
                                        <i class="fas fa-user-check"></i>
                                    </button>
                                ` : isIdentified ? `
                                    <button class="btn profile-check-btn identified d-none d-lg-block" onclick="cancelIdentification(${recipient.id}, ${PrezentyEscape.jsStringAttr(escapeHtml(recipient.name))})" title="To jest Twój profil">
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
                            
                            <div class="mt-2 d-none d-md-block">
                                <button class="btn btn-outline-secondary btn-sm" style="max-width: 100%; white-space: normal;" onclick="shareFormularzLink(${PrezentyEscape.jsStringAttr(escapeHtml(recipient.name))})" title="Wyślij tej osobie link do formularza życzeń">
                                    <i class="fas fa-share-alt me-1"></i>Udostępnij
                                </button>
                            </div>
                            ${recipient.identified_by && Number(recipient.identified_by) !== Number(currentUserId) ? `
                            <div class="mt-2 d-none d-md-block">
                                <a class="btn btn-outline-secondary btn-sm" style="max-width: 100%; white-space: normal; color: #7B1FA2; border-color: #7B1FA2;" href="/wiadomosci?do=${recipient.identified_by}" title="Wyślij anonimową wiadomość 🎅">
                                    <i class="fas fa-envelope me-1"></i>Wiadomość
                                </a>
                            </div>` : ''}
                        </div>
                    </div>
                    <div class="col-lg-10 col-md-6">
                        <div class="mb-2 d-lg-none">
                          <center>  <h5 class="recipient-name mb-0">
                               
                                ${recipientNameWithBadge(recipient.name, verifiedByName)}
                            </h5> </center>
                            ${!isIdentified && !hasAnyIdentification ? `
                                <div class="mt-2">
                                    <button class="btn btn-outline-success btn-sm identify-btn" onclick="identifyAsRecipient(${recipient.id}, ${PrezentyEscape.jsStringAttr(escapeHtml(recipient.name))})">
                                        <i class="fas fa-user-check me-1"></i>To jestem ja
                                    </button>
                                </div>
                            ` : isIdentified ? `
                                <div class="mt-2">
                                    <button class="btn btn-outline-success btn-sm identify-btn" onclick="cancelIdentification(${recipient.id}, ${PrezentyEscape.jsStringAttr(escapeHtml(recipient.name))})">
                                        <i class="fas fa-check-circle me-1"></i>To jest Twój profil
                                    </button>
                                </div>
                            ` : ''}
                            <div class="mt-2 d-md-none">
                                <button class="btn btn-outline-secondary btn-sm" style="max-width: 100%; white-space: normal;" onclick="shareFormularzLink(${PrezentyEscape.jsStringAttr(escapeHtml(recipient.name))})" title="Wyślij tej osobie link do formularza życzeń">
                                    <i class="fas fa-share-alt me-1"></i>Udostępnij
                                </button>
                                ${recipient.identified_by && Number(recipient.identified_by) !== Number(currentUserId) ? `
                                <a class="btn btn-outline-secondary btn-sm ms-1" style="white-space: normal; color: #7B1FA2; border-color: #7B1FA2;" href="/wiadomosci?do=${recipient.identified_by}" title="Wyślij anonimową wiadomość 🎅">
                                    <i class="fas fa-envelope me-1"></i>Wiadomość
                                </a>` : ''}
                            </div>
                        </div>
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
                </div>
            </div>
        `;
    }).join('');

    // Add event delegation for edit and delete buttons
    setupPresentButtonListeners();

    // Update search autocomplete data + re-apply active filters.
    // Synchronous on purpose: it runs in the same task as the innerHTML
    // update above, so the browser never paints an unfiltered frame
    // (the old 100ms delay caused a visible flicker on ?osoba= links).
    if (typeof updateSearchData === 'function') {
        updateSearchData();
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

