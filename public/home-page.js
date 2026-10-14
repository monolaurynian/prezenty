
        function getEmojiAvatar(name) {
            const emojis = ['😀', '😃', '😄', '😁', '😆', '😊', '😎', '🤓', '🥳', '😇', '🤗', '🤩', '😺', '😸', '😻', '🐶', '🐱', '🐭', '🐹', '🐰', '🦊', '🐻', '🐼', '🐨', '🐯', '🦁', '🐮', '🐷', '🐸', '🐵'];
            const index = name.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0) % emojis.length;
            return emojis[index];
        }

        async function loadStats() {
            try {
                const response = await fetch('/api/leaderboard');
                const data = await response.json();

                if (data.cumulativeStats) {
                    updateCumulativeProgress(data.cumulativeStats);
                }

                loadAvailablePresents();
                loadMyReservations();
                loadBoughtPresents();
            } catch (error) {
                console.error('Error loading stats:', error);
            }
        }

        function updateCumulativeProgress(cumulativeStats) {
            const totalPresents = cumulativeStats.totalPresents || 0;
            const totalBought = cumulativeStats.boughtPresents || 0;
            const totalReserved = cumulativeStats.reservedPresents || 0;

            const boughtPercent = totalPresents > 0 ? Math.round((totalBought / totalPresents) * 100) : 0;
            const reservedPercent = totalPresents > 0 ? Math.round((totalReserved / totalPresents) * 100) : 0;

            document.getElementById('boughtStats').textContent = `${totalBought}/${totalPresents}`;
            document.getElementById('boughtProgressBar').style.width = `${boughtPercent}%`;

            document.getElementById('reservedStats').textContent = `${totalReserved}/${totalPresents}`;
            document.getElementById('reservedProgressBar').style.width = `${reservedPercent}%`;
        }

        // Profile card removed from homepage - this now renders the small
        // user avatar in the navbar instead (links to /ustawienia)
        function loadMyProfileWithData(recipients, presents, identificationStatus) {
            const link = document.getElementById('userAvatarLink');
            if (!link) return;

            const identifiedRecipient = identificationStatus && identificationStatus.isIdentified
                ? (recipients || []).find(r => r.identified_by === identificationStatus.userId)
                : null;

            if (identifiedRecipient) {
                if (identifiedRecipient.profile_picture) {
                    link.innerHTML = `<img src="/api/recipients/${identifiedRecipient.id}/profile-picture" alt="${PrezentyEscape.escapeAttr(identifiedRecipient.name)}"
                        style="width: 100%; height: 100%; object-fit: cover;"
                        onerror="this.outerHTML='${getEmojiAvatar(identifiedRecipient.name)}';">`;
                } else {
                    link.textContent = getEmojiAvatar(identifiedRecipient.name);
                }
                link.title = `${identifiedRecipient.name} - profil i ustawienia`;
            } else {
                // Not identified yet - show a generic icon nudging towards settings
                link.innerHTML = '<i class="fas fa-user"></i>';
            }
            link.style.display = 'flex';
        }

        function loadAvailablePresents() {
            Promise.all([
                fetch('/api/recipients-with-presents').then(r => r.json()),
                fetch('/api/user/identification').then(r => r.json())
            ])
                .then(([data, identificationStatus]) => {
                    window._homeData = { presents: data.presents, recipients: data.recipients, identificationStatus };
                    loadAvailablePresentsWithData(data.presents, data.recipients, identificationStatus);
                })
                .catch(error => console.error('Error loading presents:', error));
        }

        function loadAvailablePresentsWithData(presents, recipients, identificationStatus) {
            const identifiedRecipientId = identificationStatus.isIdentified ?
                recipients.find(r => r.identified_by === identificationStatus.userId)?.id : null;

            const availablePresents = presents.filter(p =>
                !p.reserved_by &&
                !p.is_checked &&
                p.recipient_id !== identifiedRecipientId
            );

            renderAvailablePresents(availablePresents, recipients);
        }

        function renderAvailablePresents(presents, recipients) {
            const container = document.getElementById('availablePresentsList');

            if (presents.length === 0) {
                container.innerHTML = '<div class="text-center py-5"><p class="text-muted">Brak dostępnych prezentów</p></div>';
                return;
            }

            const presentsByRecipient = {};
            presents.forEach(present => {
                if (!presentsByRecipient[present.recipient_id]) {
                    presentsByRecipient[present.recipient_id] = [];
                }
                presentsByRecipient[present.recipient_id].push(present);
            });

            let html = '';
            Object.keys(presentsByRecipient).forEach(recipientId => {
                const recipient = recipients.find(r => r.id == recipientId);
                if (!recipient) return;

                const recipientPresents = presentsByRecipient[recipientId];

                const avatarHTML = recipient.profile_picture
                    ? `<img src="/api/recipients/${recipient.id}/profile-picture" 
                           alt="${PrezentyEscape.escapeAttr(recipient.name)}" 
                           style="width: 40px; height: 40px; border-radius: 50%; object-fit: cover; flex-shrink: 0; cursor: pointer;"
                           data-preview-recipient="${recipient.id}" data-preview-name="${PrezentyEscape.escapeAttr(recipient.name)}" data-preview-url="/api/recipients/${recipient.id}/profile-picture"
                           onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';">
                       <div style="display: none; width: 40px; height: 40px; align-items: center; justify-content: center; font-size: 1.5rem; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); border-radius: 50%; flex-shrink: 0;">
                           ${getEmojiAvatar(recipient.name)}
                       </div>`
                    : `<div style="display: flex; width: 40px; height: 40px; align-items: center; justify-content: center; font-size: 1.5rem; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); border-radius: 50%; flex-shrink: 0; cursor: pointer;" data-preview-recipient="${recipient.id}" data-preview-name="${PrezentyEscape.escapeAttr(recipient.name)}">
                           ${getEmojiAvatar(recipient.name)}
                       </div>`;

                html += `
                    <div class="home-recipient-card" style="margin-bottom: 20px; background: rgba(255,255,255,0.72); backdrop-filter: blur(14px) saturate(150%); -webkit-backdrop-filter: blur(14px) saturate(150%); border: 1px solid rgba(255,255,255,0.55); padding: 20px; box-shadow: 0 6px 20px rgba(0,0,0,0.13);">
                        <h5 style="color: #2d3748; font-weight: 600; margin-bottom: 15px; display: flex; align-items: center; gap: 10px; flex-wrap: wrap;">
                            ${avatarHTML}
                            ${escapeHtml(recipient.name)}
                            <span style="background: rgba(0,0,0,0.07); color: #4a5568; padding: 3px 10px; border-radius: 10px; font-size: 12px; font-weight: 500;">
                                ${plCount(recipientPresents.length, 'prezent', 'prezenty', 'prezentów')}
                            </span>
                        </h5>
                        <div style="display: flex; flex-direction: column; gap: 10px;">
                            ${recipientPresents.map(present => `
                                <div class="home-present-row" style="display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; padding: 12px; background: rgba(248,249,250,0.7); border-radius: 10px; border-left: 4px solid #ffcc00;">
                                    <div class="home-present-main" style="flex: 1; min-width: 0; display: flex; gap: 8px;">
                                        <i class="fas fa-gift" style="color:  #ffcc00; margin-top: 2px; flex-shrink: 0;"></i>
                                        <div style="flex: 1; min-width: 0;">
                                            <div class="home-present-title" style="font-weight: 500; color: #2d3748; margin-bottom: 4px;">
                                                ${makeLinksClickable(escapeHtml(present.title))}
                                            </div>
                                            ${present.comments ? `
                                                <div class="home-present-comments" style="font-size: 13px; color: #718096;">
                                                    ${makeLinksClickable(escapeHtml(present.comments))}
                                                </div>
                                            ` : ''}
                                        </div>
                                    </div>
                                    <div class="home-present-actions" style="flex-shrink: 0;">
                                        <button class="btn btn-sm btn-reserve" onclick="reservePresent(event, ${present.id})" style="white-space: nowrap; padding: 6px 16px; font-size: 13px;">
                                            <i class="fas fa-bookmark me-1"></i>Zarezerwuj
                                        </button>
                                    </div>
                                </div>
                            `).join('')}
                        </div>
                    </div>
                `;
            });

            container.innerHTML = html;
        }

        function escapeHtml(text) {
            const div = document.createElement('div');
            div.textContent = text;
            return div.innerHTML;
        }

        function makeLinksClickable(text) {
            const urlPattern = /(https?:\/\/[^\s<>"{}|\\^`\[\]]+)/g;
            const urls = [];
            let match;
            while ((match = urlPattern.exec(text)) !== null) {
                urls.push(match[1]);
            }

            if (urls.length > 0) {
                // Remove URLs from text
                let textOnly = text;
                urls.forEach(url => {
                    textOnly = textOnly.replace(url, '');
                });

                // Clean up extra whitespace
                textOnly = textOnly.trim().replace(/\s+/g, ' ');

                // Create links list with li style
                const linksList = urls.map(url => {
                    let cleanUrl = url.replace(/[.,;:!?)]+$/, '');
                    let displayText = cleanUrl;
                    if (cleanUrl.length > 60) {
                        displayText = cleanUrl.substring(0, 57) + '...';
                    }
                    return `<li style="margin: 4px 0; padding-left: 0; display: flex; align-items: flex-start; min-width: 0;"><span style="margin-right: 4px; flex-shrink: 0;">🔗</span><a href="${cleanUrl}" class="home-present-link" title="${cleanUrl}" target="_blank" rel="noopener noreferrer" style="color: #1565C0; text-decoration: underline;">${escapeHtml(displayText)}</a></li>`;
                }).join('');

                const urlList = `<ul style="margin: 8px 0 8px 0; padding-left: 0; list-style: none;">${linksList}</ul>`;

                if (textOnly) {
                    return textOnly + '<br>' + urlList;
                } else {
                    return urlList;
                }
            }

            return text;
        }

        function loadMyReservations() {
            Promise.all([
                fetch('/api/recipients-with-presents').then(r => r.json()),
                fetch('/api/user/identification').then(r => r.json())
            ])
                .then(([data, identificationStatus]) => {
                    window._homeData = { presents: data.presents, recipients: data.recipients, identificationStatus };
                    loadMyReservationsWithData(data.presents, data.recipients, identificationStatus);
                })
                .catch(error => console.error('Error loading reservations:', error));
        }

        function loadMyReservationsWithData(presents, recipients, identificationStatus) {
            // Normalized comparison: the id can come from two different API
            // calls, so guard against type/source mismatches
            const userId = Number(identificationStatus.userId || window._currentUserId);
            const myReservations = presents.filter(p => Number(p.reserved_by) === userId && !p.is_checked);
            renderPresentsList(myReservations, recipients, 'myReservationsList', 'Brak zarezerwowanych prezentów');
        }

        function loadBoughtPresents() {
            Promise.all([
                fetch('/api/recipients-with-presents').then(r => r.json()),
                fetch('/api/user/identification').then(r => r.json())
            ])
                .then(([data, identificationStatus]) => {
                    window._homeData = { presents: data.presents, recipients: data.recipients, identificationStatus };
                    loadBoughtPresentsWithData(data.presents, data.recipients, identificationStatus);
                })
                .catch(error => console.error('Error loading bought presents:', error));
        }

        function loadBoughtPresentsWithData(presents, recipients, identificationStatus) {
            const userId = Number(identificationStatus.userId || window._currentUserId);
            const boughtPresents = presents.filter(p => Number(p.reserved_by) === userId && p.is_checked);
            renderPresentsList(boughtPresents, recipients, 'boughtPresentsList', 'Brak kupionych prezentów');
        }

        function renderPresentsList(presents, recipients, containerId, emptyMessage) {
            const container = document.getElementById(containerId);

            if (presents.length === 0) {
                container.innerHTML = `<div class="text-center py-5"><p class="text-muted">${emptyMessage}</p></div>`;
                return;
            }

            const presentsByRecipient = {};
            presents.forEach(present => {
                if (!presentsByRecipient[present.recipient_id]) {
                    presentsByRecipient[present.recipient_id] = [];
                }
                presentsByRecipient[present.recipient_id].push(present);
            });

            let html = '';
            Object.keys(presentsByRecipient).forEach(recipientId => {
                const recipient = recipients.find(r => r.id == recipientId);
                if (!recipient) return;

                const recipientPresents = presentsByRecipient[recipientId];

                const avatarHTML = recipient.profile_picture
                    ? `<img src="/api/recipients/${recipient.id}/profile-picture" 
                           alt="${PrezentyEscape.escapeAttr(recipient.name)}" 
                           style="width: 40px; height: 40px; border-radius: 50%; object-fit: cover; flex-shrink: 0; cursor: pointer;"
                           data-preview-recipient="${recipient.id}" data-preview-name="${PrezentyEscape.escapeAttr(recipient.name)}" data-preview-url="/api/recipients/${recipient.id}/profile-picture"
                           onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';">
                       <div style="display: none; width: 40px; height: 40px; align-items: center; justify-content: center; font-size: 1.5rem; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); border-radius: 50%; flex-shrink: 0;">
                           ${getEmojiAvatar(recipient.name)}
                       </div>`
                    : `<div style="display: flex; width: 40px; height: 40px; align-items: center; justify-content: center; font-size: 1.5rem; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); border-radius: 50%; flex-shrink: 0; cursor: pointer;" data-preview-recipient="${recipient.id}" data-preview-name="${PrezentyEscape.escapeAttr(recipient.name)}">
                           ${getEmojiAvatar(recipient.name)}
                       </div>`;

                html += `
                    <div class="home-recipient-card" style="margin-bottom: 20px; background: rgba(255,255,255,0.72); backdrop-filter: blur(14px) saturate(150%); -webkit-backdrop-filter: blur(14px) saturate(150%); border: 1px solid rgba(255,255,255,0.55); padding: 20px; box-shadow: 0 6px 20px rgba(0,0,0,0.13);">
                        <h5 style="color: #2d3748; font-weight: 600; margin-bottom: 15px; display: flex; align-items: center; gap: 10px; flex-wrap: wrap;">
                            ${avatarHTML}
                            ${escapeHtml(recipient.name)}
                            <span style="background: rgba(0,0,0,0.07); color: #4a5568; padding: 3px 10px; border-radius: 10px; font-size: 12px; font-weight: 500;">
                                ${plCount(recipientPresents.length, 'prezent', 'prezenty', 'prezentów')}
                            </span>
                        </h5>
                        <div style="display: flex; flex-direction: column; gap: 10px;">
                            ${recipientPresents.map(present => `
                                <div class="home-present-row" style="display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; padding: 12px; background: #f8f9fa; border-radius: 10px; border-left: 4px solid ${present.is_checked ? '#4CAF50' : '#FF9800'};">
                                    <div class="home-present-main" style="display: flex; gap: 8px; flex: 1; min-width: 0;">
                                        <i class="fas fa-gift" style="color: ${present.is_checked ? '#4CAF50' : '#FF9800'}; margin-top: 2px; flex-shrink: 0;"></i>
                                        <div style="flex: 1; min-width: 0;">
                                            <div class="home-present-title" style="font-weight: 500; color: #2d3748; margin-bottom: 4px;">
                                                ${makeLinksClickable(escapeHtml(present.title))}
                                            </div>
                                            ${present.comments ? `
                                                <div class="home-present-comments" style="font-size: 13px; color: #718096;">
                                                    ${makeLinksClickable(escapeHtml(present.comments))}
                                                </div>
                                            ` : ''}
                                        </div>
                                    </div>
                                    <div class="home-present-actions" style="display: flex; flex-direction: column; gap: 6px; flex-shrink: 0;">
                                        ${present.is_checked ? `
                                            <button class="btn btn-sm btn-outline-danger" onclick="markAsUnbought(${present.id})" style="white-space: nowrap; padding: 6px 16px; font-size: 13px;">
                                                <i class="fas fa-undo me-1"></i>Anuluj zakup
                                            </button>
                                        ` : `
                                            <button class="btn btn-sm btn-success" onclick="markAsBought(${present.id})" style="white-space: nowrap; padding: 6px 16px; font-size: 13px;">
                                                <i class="fas fa-check me-1"></i>Kupione
                                            </button>
                                            <button class="btn btn-sm btn-outline-danger" onclick="unreservePresent(event, ${present.id})" style="white-space: nowrap; padding: 6px 16px; font-size: 13px;">
                                                <i class="fas fa-times me-1"></i>Anuluj
                                            </button>
                                        `}
                                    </div>
                                </div>
                            `).join('')}
                        </div>
                    </div>
                `;
            });

            container.innerHTML = html;
        }

        // ===== Optimistic updates =====
        // Mutate the shared dataset, re-render sections instantly (present
        // moves to the right category), then sync with the server and roll
        // back if it fails.
        function rerenderHomeSections() {
            const d = window._homeData;
            if (!d) return;
            loadAvailablePresentsWithData(d.presents, d.recipients, d.identificationStatus);
            loadMyReservationsWithData(d.presents, d.recipients, d.identificationStatus);
            loadBoughtPresentsWithData(d.presents, d.recipients, d.identificationStatus);
        }

        function optimisticUpdatePresent(presentId, changes) {
            const d = window._homeData;
            if (!d) return null;
            const p = d.presents.find(x => x.id === presentId);
            if (!p) return null;
            const prev = { reserved_by: p.reserved_by, is_checked: p.is_checked };
            Object.assign(p, changes);
            rerenderHomeSections();
            return prev;
        }

        function rollbackPresent(presentId, prev) {
            const d = window._homeData;
            if (!d || !prev) return;
            const p = d.presents.find(x => x.id === presentId);
            if (p) Object.assign(p, prev);
            rerenderHomeSections();
        }

        // Refresh only the progress counters (no section re-fetch/jank)
        function refreshStatsCounters() {
            fetch('/api/leaderboard')
                .then(r => r.json())
                .then(d => { if (d.cumulativeStats) updateCumulativeProgress(d.cumulativeStats); })
                .catch(() => { /* non-critical */ });
        }

        // After a successful action, quietly re-fetch and re-render from the
        // server so the UI always converges to the truth (no manual refresh).
        // Guards against races: reconcile results are ignored while other
        // actions are still in flight, and stale responses are discarded -
        // otherwise a quick "Zakupione -> Anuluj zakup" sequence could be
        // overwritten by the reconcile of the first action.
        let pendingOps = 0;
        let reconcileToken = 0;

        function beginOp() { pendingOps++; }

        function endOp() {
            pendingOps = Math.max(0, pendingOps - 1);
            if (pendingOps === 0) reconcileWithServer();
        }

        function reconcileWithServer() {
            const token = ++reconcileToken;
            Promise.all([
                fetch('/api/recipients-with-presents').then(r => r.json()),
                fetch('/api/user/identification').then(r => r.json())
            ])
                .then(([data, identificationStatus]) => {
                    // Discard if a newer reconcile started or actions are pending
                    if (token !== reconcileToken || pendingOps > 0) return;
                    window._homeData = { presents: data.presents, recipients: data.recipients, identificationStatus };
                    rerenderHomeSections();
                })
                .catch(() => { /* optimistic state stays; next action fixes it */ });
        }

        function reservePresent(event, presentId) {
            const d = window._homeData;
            const userId = Number((d && d.identificationStatus && d.identificationStatus.userId) || window._currentUserId);
            const prev = optimisticUpdatePresent(presentId, { reserved_by: userId, is_checked: false });
            beginOp();

            fetch(`/api/presents/${presentId}/reserve`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' }
            })
                .then(response => response.json())
                .then(data => {
                    if (data.success) {
                        refreshStatsCounters();
                        showToast('Prezent zarezerwowany! 🎁', 'success', {
                            label: 'Cofnij',
                            onClick: () => unreservePresent(null, presentId)
                        });
                    } else {
                        rollbackPresent(presentId, prev);
                        showToast(data.error || 'Nie udało się zarezerwować prezentu', 'error');
                    }
                })
                .catch(error => {
                    console.error('Error:', error);
                    rollbackPresent(presentId, prev);
                    showToast('Błąd połączenia. Zmiana została cofnięta.', 'error');
                })
                .finally(endOp);
        }

        function unreservePresent(event, presentId) {
            const prev = optimisticUpdatePresent(presentId, { reserved_by: null });
            beginOp();

            fetch(`/api/presents/${presentId}/reserve`, {
                method: 'DELETE',
                headers: { 'Content-Type': 'application/json' }
            })
                .then(response => response.json())
                .then(data => {
                    if (data.success) {
                        refreshStatsCounters();
                        showToast('Rezerwacja anulowana', 'success', {
                            label: 'Cofnij',
                            onClick: () => reReservePresent(presentId)
                        });
                    } else {
                        rollbackPresent(presentId, prev);
                        showToast(data.error || 'Nie udało się anulować rezerwacji', 'error');
                    }
                })
                .catch(error => {
                    console.error('Error:', error);
                    rollbackPresent(presentId, prev);
                    showToast('Błąd połączenia. Zmiana została cofnięta.', 'error');
                })
                .finally(endOp);
        }

        // Undo for "Rezerwacja anulowana" - re-reserves the present
        function reReservePresent(presentId) {
            const prev = optimisticUpdatePresent(presentId, { reserved_by: window._currentUserId || null });
            beginOp();

            fetch(`/api/presents/${presentId}/reserve`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' }
            })
                .then(response => response.json())
                .then(data => {
                    if (data.success) {
                        refreshStatsCounters();
                        showToast('Przywrócono rezerwację', 'success');
                    } else {
                        rollbackPresent(presentId, prev);
                        showToast(data.error || 'Nie udało się przywrócić rezerwacji', 'error');
                    }
                })
                .catch(() => {
                    rollbackPresent(presentId, prev);
                    showToast('Nie udało się przywrócić rezerwacji', 'error');
                })
                .finally(endOp);
        }

        // The avatars used to call this from an inline
        // onclick="openProfilePicturePreview(id, '<name>', url)" - a JS string
        // literal inside an HTML attribute, escaped with the quote-unsafe
        // textContent helper, so a name containing " closed the attribute
        // outright. The name now travels as a data attribute and `dataset`
        // hands back the decoded original.
        document.addEventListener('click', function (e) {
            const el = e.target.closest && e.target.closest('[data-preview-name]');
            if (!el) return;
            openProfilePicturePreview(
                Number(el.dataset.previewRecipient),
                el.dataset.previewName,
                el.dataset.previewUrl || null
            );
        });

        function openProfilePicturePreview(recipientId, recipientName, profilePictureUrl) {
            const modal = document.getElementById('profilePreviewModal');
            const previewImage = document.getElementById('profilePreviewImage');
            const previewName = document.getElementById('profilePreviewName');

            if (modal && previewImage && previewName) {
                const previewEmoji = document.getElementById('profilePreviewEmoji');
                if (profilePictureUrl) {
                    previewImage.src = profilePictureUrl;
                    previewImage.style.display = '';
                    if (previewEmoji) previewEmoji.style.display = 'none';
                } else {
                    // Emoji avatar - show it big instead of a photo
                    previewImage.style.display = 'none';
                    if (previewEmoji) {
                        previewEmoji.textContent = getEmojiAvatar(recipientName);
                        previewEmoji.style.display = 'block';
                    }
                }
                previewName.textContent = recipientName;

                // "Send anonymous message" - only for people with an
                // account (identified) and not for yourself
                const msgLink = document.getElementById('profilePreviewMessageLink');
                if (msgLink) {
                    const d = window._homeData;
                    const rec = d && d.recipients
                        ? d.recipients.find(r => Number(r.id) === Number(recipientId))
                        : null;
                    const uid = Number(window._currentUserId);
                    if (rec && rec.identified_by && Number(rec.identified_by) !== uid) {
                        msgLink.href = '/wiadomosci?do=' + rec.identified_by;
                        msgLink.style.display = 'inline-block';
                    } else {
                        msgLink.style.display = 'none';
                    }
                }

                const bootstrapModal = new bootstrap.Modal(modal);
                bootstrapModal.show();
            }
        }

        function markAsBought(presentId) {
            // Optimistic: moves instantly from "Moje rezerwacje" to "Kupione"
            const prev = optimisticUpdatePresent(presentId, { is_checked: true });
            beginOp();

            fetch(`/api/presents/${presentId}/check`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ is_checked: true })
            })
                .then(response => response.json())
                .then(data => {
                    if (data.success) {
                        refreshStatsCounters();
                        showToast('Oznaczono jako kupione 🛍️', 'success', {
                            label: 'Cofnij',
                            onClick: () => markAsUnbought(presentId)
                        });
                    } else {
                        rollbackPresent(presentId, prev);
                        showToast(data.error || 'Nie udało się oznaczyć prezentu', 'error');
                    }
                })
                .catch(error => {
                    console.error('Error marking as bought:', error);
                    rollbackPresent(presentId, prev);
                    showToast('Błąd połączenia. Zmiana została cofnięta.', 'error');
                })
                .finally(endOp);
        }

        function markAsUnbought(presentId) {
            // Optimistic: moves instantly from "Kupione" back to "Moje rezerwacje"
            const prev = optimisticUpdatePresent(presentId, { is_checked: false });
            beginOp();

            fetch(`/api/presents/${presentId}/check`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ is_checked: false })
            })
                .then(response => response.json())
                .then(data => {
                    if (data.success) {
                        refreshStatsCounters();
                        showToast('Cofnięto oznaczenie', 'success');
                    } else {
                        rollbackPresent(presentId, prev);
                        showToast(data.error || 'Nie udało się cofnąć oznaczenia', 'error');
                    }
                })
                .catch(error => {
                    console.error('Error unmarking as bought:', error);
                    rollbackPresent(presentId, prev);
                    showToast('Błąd połączenia. Zmiana została cofnięta.', 'error');
                })
                .finally(endOp);
        }

        function logout() {
            fetch('/api/logout', { method: 'POST' })
                .then(() => {
                    // Clear local storage
                    localStorage.clear();
                    sessionStorage.clear();
                    window.location.href = '/';
                })
                .catch(() => {
                    // Even if logout fails, redirect to login
                    localStorage.clear();
                    sessionStorage.clear();
                    window.location.href = '/';
                });
        }

        loadStats();
    