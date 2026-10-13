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
    // Remember the world state at request time - see race guards above
    const tokenAtRequest = _presentOpToken;

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
            // A newer user action happened (or is still in flight) - this
            // snapshot is stale and applying it would revert the user's
            // latest clicks. Discard it and reload once things settle.
            if (_pendingPresentOps > 0 || _presentOpToken !== tokenAtRequest) {
                _softReloadQueued = true;
                console.log('[SoftReload] Stale snapshot discarded (newer action in flight)');
                return;
            }

            const endTime = performance.now();
            console.log(`Soft reload completed in ${(endTime - startTime).toFixed(2)}ms`);

            const recipients = combinedData.recipients || [];
            const presentsData = combinedData.presents || [];

            // Store old cache for comparison
            const oldCache = window._dataCache;

            // Update cache
            const cacheData = { recipients, presents: presentsData, identificationStatus };
            window._dataCache = cacheData;
            window._dataCacheTimestamp = Date.now();
            window._cachedRecipients = recipients;
            window._cachedIdentificationStatus = identificationStatus;

            // Save to persistent cache
            saveToPersistentCache(cacheData);

            // Smart update: only update changed elements
            updateChangedElementsOnly(oldCache, cacheData);
        })
        .catch(error => {
            console.error('Error in soft reload:', error);
            // Fallback to cached data if available
            if (window._dataCache) {
                console.log('Using cached data after soft reload error');
            }
        });
}

// Smart update: only update elements that changed
function updateChangedElementsOnly(oldCache, newCache) {
    if (!oldCache || !oldCache.presents || !newCache || !newCache.presents) {
        console.log('[SmartUpdate] No old cache, skipping smart update');
        return;
    }

    const oldPresents = oldCache.presents;
    const newPresents = newCache.presents;

    // Find changed presents
    newPresents.forEach(newPresent => {
        const oldPresent = oldPresents.find(p => p.id === newPresent.id);

        if (!oldPresent) {
            // New present added - could add it to DOM, but for now just log
            console.log('[SmartUpdate] New present detected:', newPresent.id);
            return;
        }

        // Check if reservation status changed
        if (oldPresent.reserved_by !== newPresent.reserved_by) {
            console.log('[SmartUpdate] Reservation changed for present:', newPresent.id);
            updatePresentReservationUI(newPresent);
        }

        // Check if checked status changed
        if (oldPresent.is_checked !== newPresent.is_checked) {
            console.log('[SmartUpdate] Check status changed for present:', newPresent.id);
            updatePresentCheckUI(newPresent);
        }
    });

    // Check for identification changes
    if (oldCache.identificationStatus?.isIdentified !== newCache.identificationStatus?.isIdentified) {
        console.log('[SmartUpdate] Identification status changed, full reload needed');

        // Save scroll position before reload
        const scrollPosition = window.pageYOffset || document.documentElement.scrollTop;

        // For identification changes, we need a full reload
        displayRecipientsWithPresents(newCache.recipients, newCache.presents);

        // Restore scroll position after a brief delay to allow DOM update
        setTimeout(() => {
            window.scrollTo(0, scrollPosition);
        }, 50);
    }
}

// Update present reservation UI without full reload
function updatePresentReservationUI(present) {
    const presentElement = document.querySelector(`[data-id="${present.id}"]`);
    if (!presentElement) return;

    const reserveBtn = presentElement.querySelector('.reserve-btn');
    if (!reserveBtn) return;

    const currentUserId = window._currentUserId;

    // Update button based on reservation status
    if (present.reserved_by === currentUserId) {
        // Reserved by current user
        reserveBtn.className = 'btn btn-danger btn-sm w-100 w-md-auto reserve-btn';
        reserveBtn.innerHTML = '<i class="fas fa-xmark"></i> <span class="d-none d-md-inline">Anuluj</span>';
        reserveBtn.setAttribute('onclick', `handleReserveClick(event, ${present.id}, 'cancel')`);
        reserveBtn.setAttribute('title', 'Usuń rezerwację');
        presentElement.classList.add('reserved-by-me');
        presentElement.classList.remove('reserved-by-other');
    } else if (present.reserved_by) {
        // Reserved by someone else
        reserveBtn.className = 'btn btn-secondary btn-sm w-100 w-md-auto reserve-btn';
        reserveBtn.innerHTML = '<i class="fas fa-bookmark"></i> <span class="d-none d-md-inline">Zarezerwowane</span>';
        // setAttribute: no HTML-parsing step, so the value only needs to be a valid
        // JS string literal (JSON.stringify) - '${...}' used to end on an apostrophe.
        reserveBtn.setAttribute('onclick', `showReservedByOtherModal(${JSON.stringify(escapeHtml(present.reserved_by_username || 'Nieznany użytkownik'))})`);
        reserveBtn.setAttribute('title', `Zarezerwowane przez: ${escapeHtml(present.reserved_by_username || 'Nieznany użytkownik')}`);
        presentElement.classList.add('reserved-by-other');
        presentElement.classList.remove('reserved-by-me');
    } else {
        // Not reserved
        reserveBtn.className = 'btn btn-reserve btn-sm w-100 w-md-auto reserve-btn';
        reserveBtn.innerHTML = '<i class="fas fa-bookmark"></i> <span class="d-none d-md-inline">Zarezerwuj</span>';
        reserveBtn.setAttribute('onclick', `handleReserveClick(event, ${present.id}, 'reserve')`);
        reserveBtn.setAttribute('title', 'Zarezerwuj prezent');
        presentElement.classList.remove('reserved-by-me', 'reserved-by-other');
    }
}

// Update present check UI without full reload
function updatePresentCheckUI(present) {
    const presentElement = document.querySelector(`[data-id="${present.id}"]`);
    if (!presentElement) return;

    const checkbox = presentElement.querySelector('input[type="checkbox"]');
    if (checkbox) {
        checkbox.checked = present.is_checked;
    }

    if (present.is_checked) {
        presentElement.classList.add('checked');
    } else {
        presentElement.classList.remove('checked');
    }
}

// Update present title and comments in DOM without full reload
function updatePresentInDOM(presentId, newTitle, newComments) {
    const presentElement = document.querySelector(`[data-id="${presentId}"]`);
    if (!presentElement) return;

    // Update title
    const titleElement = presentElement.querySelector('.present-name');
    if (titleElement) {
        titleElement.textContent = newTitle;
    }

    // Update comments
    const commentsElement = presentElement.querySelector('.text-muted.small');
    if (commentsElement) {
        if (newComments) {
            commentsElement.innerHTML = `<i class="fas fa-info-circle me-1"></i>${escapeHtml(newComments)}`;
            commentsElement.style.display = '';
        } else {
            commentsElement.style.display = 'none';
        }
    } else if (newComments) {
        // Add comments if they didn't exist before
        const presentNameDiv = presentElement.querySelector('.present-name').parentElement;
        const commentsDiv = document.createElement('div');
        commentsDiv.className = 'text-muted small mt-1';
        commentsDiv.innerHTML = `<i class="fas fa-info-circle me-1"></i>${escapeHtml(newComments)}`;
        presentNameDiv.appendChild(commentsDiv);
    }

    // Add a brief highlight animation to show the change
    presentElement.style.transition = 'background-color 0.3s ease';
    const originalBg = presentElement.style.backgroundColor;
    presentElement.style.backgroundColor = 'rgba(33, 150, 243, 0.1)';
    setTimeout(() => {
        presentElement.style.backgroundColor = originalBg;
    }, 1000);
}

// Add a new present to the DOM immediately
function addPresentToDOM(recipientId, present) {
    const currentUserId = window._currentUserId;

    // Find the recipient's card
    const recipientElement = document.querySelector(`[data-id="${recipientId}"]`);
    if (!recipientElement) {
        console.warn('[AddPresent] Recipient element not found:', recipientId);
        return;
    }

    // Check if this is the identified user's card (with accordion)
    const accordion = recipientElement.querySelector('.accordion');
    if (accordion) {
        // This is the identified user - add to their accordion list
        console.log('[AddPresent] Adding to identified user accordion');
        addPresentToIdentifiedUserAccordion(recipientElement, present);
        return;
    }

    // Find the presents list
    let presentsList = recipientElement.querySelector('.presents-list');
    if (!presentsList) {
        // Create presents list if it doesn't exist
        const presentsPreview = recipientElement.querySelector('.presents-preview');
        if (presentsPreview) {
            presentsList = document.createElement('div');
            presentsList.className = 'presents-list';
            presentsPreview.innerHTML = '';
            presentsPreview.appendChild(presentsList);
        } else {
            console.warn('[AddPresent] Presents preview not found');
            return;
        }
    }

    // Generate the present HTML
    const presentHTML = generateSinglePresentHTML(present);

    // Add to the top of the list with animation
    const tempDiv = document.createElement('div');
    tempDiv.innerHTML = presentHTML;
    const presentElement = tempDiv.firstElementChild;

    // Start with opacity 0
    presentElement.style.opacity = '0';
    presentElement.style.transition = 'opacity 0.5s ease-in';

    // Insert at the beginning
    presentsList.insertBefore(presentElement, presentsList.firstChild);

    // Fade in
    setTimeout(() => {
        presentElement.style.opacity = '1';
    }, 50);

    // Add highlight animation
    setTimeout(() => {
        presentElement.style.transition = 'background-color 0.3s ease';
        presentElement.style.backgroundColor = 'rgba(76, 175, 80, 0.1)';
        setTimeout(() => {
            presentElement.style.backgroundColor = '';
        }, 2000);
    }, 500);
}

// Add present to identified user's accordion
function addPresentToIdentifiedUserAccordion(recipientElement, present) {
    // Find the accordion body with the list of own presents
    const accordionBody = recipientElement.querySelector('.accordion-body-identified');
    if (!accordionBody) {
        console.warn('[AddPresent] Accordion body not found');
        return;
    }

    // Find the list-group (ul element)
    let listGroup = accordionBody.querySelector('.list-group');

    if (!listGroup) {
        // No presents yet - need to replace the "no presents" message
        const noPresentsMsg = accordionBody.querySelector('p.text-muted');
        if (noPresentsMsg) {
            noPresentsMsg.remove();
        }

        // Create the list group
        listGroup = document.createElement('ul');
        listGroup.className = 'list-group';

        // Find where to insert (after the alert)
        const alert = accordionBody.querySelector('.alert');
        if (alert) {
            alert.insertAdjacentElement('afterend', listGroup);
        } else {
            accordionBody.appendChild(listGroup);
        }
    }

    // Generate the present HTML for accordion
    const presentHTML = `
        <li class="list-group-item present-item" data-id="${present.id}" style="opacity: 0; transition: opacity 0.5s ease-in;">
            <div class="d-flex align-items-start flex-wrap flex-md-nowrap">
                <div class="flex-grow-1">
                    <div class="fw-semibold present-name">${escapeHtml(present.title)}</div>
                    ${present.comments ? `<div class="text-muted small mt-1"><i class="fas fa-info-circle me-1"></i>${escapeHtml(present.comments)}</div>` : ''}
                </div>
                <div class="d-flex gap-2 justify-content-center justify-content-md-end w-100 w-md-auto mt-2 mt-md-0">
                    <button class="btn btn-sm btn-primary w-100 w-md-auto edit-present-btn"
                        data-present-id="${present.id}"
                        data-present-title="${escapeAttr(present.title)}"
                        data-recipient-id="${present.recipient_id}"
                        data-present-comments="${escapeAttr(present.comments || '')}"
                        style="max-width:50px; min-width:50px;">
                        <i class="fas fa-edit" style="color: white;"></i>
                    </button>
                    <button class="btn btn-sm btn-danger w-100 w-md-auto delete-present-btn"
                        data-present-id="${present.id}"
                        data-present-title="${escapeAttr(present.title)}"
                        data-recipient-id="${present.recipient_id}"
                        style="max-width:50px; min-width:50px;">
                        <i class="fas fa-trash-alt"></i>
                    </button>
                </div>
            </div>
        </li>
    `;

    // Add to the top of the list
    listGroup.insertAdjacentHTML('afterbegin', presentHTML);

    // Get the newly added element and fade it in
    const newPresentElement = listGroup.firstElementChild;
    setTimeout(() => {
        newPresentElement.style.opacity = '1';
    }, 50);

    // Add highlight animation
    setTimeout(() => {
        newPresentElement.style.transition = 'background-color 0.3s ease';
        newPresentElement.style.backgroundColor = 'rgba(76, 175, 80, 0.1)';
        setTimeout(() => {
            newPresentElement.style.backgroundColor = '';
        }, 2000);
    }, 500);

    // Update the accordion button text to show new count
    const accordionButton = recipientElement.querySelector('.accordion-button');
    if (accordionButton) {
        const currentCount = listGroup.children.length;
        // Update the button text with new count
        const buttonText = accordionButton.innerHTML;
        const countMatch = buttonText.match(/\((\d+)\)/);
        if (countMatch) {
            accordionButton.innerHTML = buttonText.replace(/\(\d+\)/, `(${currentCount})`);
        }
    }
}

// Generate HTML for a single present (uses the shared button-flow builder)
function generateSinglePresentHTML(present) {
    const uid = Number(window._currentUserId || currentUserId);
    const isReservedByMe = present.reserved_by != null && Number(present.reserved_by) === uid;
    const isReservedByOther = present.reserved_by && !isReservedByMe;

    const classes = ['present-item'];
    if (present.is_checked) classes.push('checked');
    if (isReservedByMe) classes.push('reserved-by-me');
    if (isReservedByOther) classes.push('reserved-by-other');

    return `
        <div class="${classes.join(' ')}" data-id="${present.id}">
            <div class="d-flex align-items-start justify-content-between w-100" style="gap: 12px;">
                <div class="d-flex present-details" style="gap: 8px; flex: 1 1 auto; min-width: 0;">
                    <i class="fas fa-gift present-gift-icon" style="margin-top: 4px; flex-shrink: 0;"></i>
                    <div style="flex: 1; min-width: 0;">
                        <div class="fw-semibold present-name">${escapeHtml(present.title)}</div>
                        ${present.comments ? `<div class="text-muted small mt-1">${escapeHtml(present.comments)}</div>` : ''}
                    </div>
                </div>
                <div class="present-actions d-flex flex-column" style="gap: 6px; flex-shrink: 0;">
                    ${generateReservationButton(present)}
                </div>
            </div>
        </div>
    `;
}

// Notification update functions are now in tab-bar-functions.js (shared across pages)

