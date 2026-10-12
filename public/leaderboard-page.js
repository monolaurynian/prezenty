
        async function loadLeaderboard() {
            try {
                const response = await fetch('/api/leaderboard');
                const data = await response.json();

                document.getElementById('loadingSpinner').style.display = 'none';

                if (data.users && data.users.length > 0) {
                    renderLeaderboard(data.users, data.cumulativeStats);
                } else {
                    document.getElementById('emptyState').style.display = 'block';
                }
            } catch (error) {
                console.error('Error loading leaderboard:', error);
                document.getElementById('loadingSpinner').style.display = 'none';
                document.getElementById('emptyState').style.display = 'block';
            }
        }

        function renderLeaderboard(users, cumulativeStats) {
            // Sort users by activity for activity podium
            const activitySorted = [...users].sort((a, b) => {
                const aActivity = (parseInt(a.user_bought_count) || 0) + (parseInt(a.user_reserved_count) || 0);
                const bActivity = (parseInt(b.user_bought_count) || 0) + (parseInt(b.user_reserved_count) || 0);
                return bActivity - aActivity;
            });

            // Show activity podium for top 3 active users
            if (activitySorted.length >= 3 && (parseInt(activitySorted[0].user_bought_count) || 0) + (parseInt(activitySorted[0].user_reserved_count) || 0) > 0) {
                document.getElementById('activityPodiumSection').style.display = 'block';
                renderActivityPodium(activitySorted.slice(0, 3));
            }

            // Show activity leaderboard (bought + reserved)
            document.getElementById('activityLeaderboard').style.display = 'block';
            renderActivityLeaderboard(users);

            // Show podium for top 3 (by total presents added)
            if (users.length >= 3) {
                document.getElementById('podiumSection').style.display = 'block';
                renderPodium(users.slice(0, 3));
            }

            // Show full ranking
            document.getElementById('rankingList').style.display = 'block';
            renderUsersList(users);
        }

        function renderActivityLeaderboard(users) {
            // Sort by bought + reserved presents (by the user, not for them)
            const sortedUsers = [...users].sort((a, b) => {
                const aActivity = (parseInt(a.user_bought_count) || 0) + (parseInt(a.user_reserved_count) || 0);
                const bActivity = (parseInt(b.user_bought_count) || 0) + (parseInt(b.user_reserved_count) || 0);
                return bActivity - aActivity;
            }).slice(0, 10); // Top 10

            const activityList = document.getElementById('activityList');
            activityList.innerHTML = sortedUsers.map((user, index) => {
                const boughtCount = parseInt(user.user_bought_count) || 0;
                const reservedCount = parseInt(user.user_reserved_count) || 0;
                const totalActivity = boughtCount + reservedCount;

                if (totalActivity === 0) return ''; // Skip users with no activity

                // Names are recipients.name - user supplied, so escape before
                // interpolating, and allowlist the picture URL (escape-html.js).
                // Branch on the SANITISED url: a rejected one falls through to
                // the emoji avatar instead of rendering a broken image.
                const pic = PrezentyEscape.safeImageSrc(user.profile_picture);
                const name = PrezentyEscape.escapeHtml(user.username);
                const avatarHTML = pic
                    ? `<img src="${pic}" alt="${name}" class="activity-avatar-img">`
                    : `<div class="activity-avatar-img activity-avatar-emoji" aria-hidden="true">${getEmojiAvatar(user.username)}</div>`;

                // noun for the screen-reader-only part, agreeing with the count
                const giftNoun = (n) => plPlural(n, 'prezent', 'prezenty', 'prezentów');

                return `
                    <div class="user-card activity-card">
                        <div class="activity-rank">#${index + 1}</div>
                        ${avatarHTML}
                        <div class="activity-name">${name}</div>
                        <div class="activity-stats">
                            <span class="activity-stat">
                                <i class="fas fa-check-circle" style="color: #4CAF50;" aria-hidden="true"></i>
                                <span>${plCount(boughtCount, 'kupiony', 'kupione', 'kupionych')}<span class="activity-stat-noun"> ${giftNoun(boughtCount)}</span></span>
                            </span>
                            <span class="activity-stat-sep" aria-hidden="true">•</span>
                            <span class="activity-stat">
                                <i class="fas fa-bookmark" style="color: #FF9800;" aria-hidden="true"></i>
                                <span>${plCount(reservedCount, 'zarezerwowany', 'zarezerwowane', 'zarezerwowanych')}<span class="activity-stat-noun"> ${giftNoun(reservedCount)}</span></span>
                            </span>
                        </div>
                        <div class="activity-score">
                            <div class="activity-score-value">${totalActivity}</div>
                            <div class="activity-score-label">${plPlural(totalActivity, 'aktywność', 'aktywności', 'aktywności')}</div>
                        </div>
                    </div>
                `;
            }).filter(html => html !== '').join('');

            if (activityList.innerHTML === '') {
                activityList.innerHTML = '<p style="text-align: center; color: #718096;">Brak aktywności</p>';
            }
        }
        function getEmojiAvatar(name) {
            const emojis = ['😀', '😃', '😄', '😁', '😆', '😊', '😎', '🤓', '🥳', '😇', '🤗', '🤩', '😺', '😸', '😻', '🐶', '🐱', '🐭', '🐹', '🐰', '🦊', '🐻', '🐼', '🐨', '🐯', '🦁', '🐮', '🐷', '🐸', '🐵'];
            const index = name.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0) % emojis.length;
            return emojis[index];
        }

        function renderActivityPodium(top3) {
            const podium = document.getElementById('activityPodium');
            const medals = ['🥇', '🥈', '🥉'];
            const positions = ['first', 'second', 'third'];

            podium.innerHTML = top3.map((user, index) => {
                const boughtCount = parseInt(user.user_bought_count) || 0;
                const reservedCount = parseInt(user.user_reserved_count) || 0;
                const totalActivity = boughtCount + reservedCount;

                const emojiSize = index === 0 ? '140px' : (index === 1 ? '110px' : '100px');
                const emojiFontSize = index === 0 ? '4rem' : (index === 1 ? '3.5rem' : '3rem');

                // See renderActivityLeaderboard: escape the name, allowlist the URL.
                const pic = PrezentyEscape.safeImageSrc(user.profile_picture);
                const name = PrezentyEscape.escapeHtml(user.username);
                const avatarHTML = pic
                    ? `<img src="${pic}" 
                           alt="${name}" 
                           class="podium-avatar"
                           onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';">
                       <div class="podium-avatar-emoji podium-avatar" style="display: none; width: ${emojiSize}; height: ${emojiSize}; align-items: center; justify-content: center; font-size: ${emojiFontSize}; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); border-radius: 50%;">
                           ${getEmojiAvatar(user.username)}
                       </div>`
                    : `<div class="podium-avatar-emoji podium-avatar" style="display: flex; width: ${emojiSize}; height: ${emojiSize}; align-items: center; justify-content: center; font-size: ${emojiFontSize}; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); border-radius: 50%;">
                           ${getEmojiAvatar(user.username)}
                       </div>`;

                return `
                    <div class="podium-place ${positions[index]}" data-username="${PrezentyEscape.escapeAttr(user.username)}" style="cursor: pointer;">
                        ${index === 0 ? '<div class="podium-crown">👑</div>' : ''}
                        <div class="podium-rank">${medals[index]}</div>
                        <div class="podium-avatar-container">
                            ${avatarHTML}
                        </div>
                        <div class="podium-name">${name}</div>
                        <div class="podium-stats">
                            <div class="stat-item">
                                <i class="fas fa-fire" style="color: #FF6B6B;"></i>
                                ${plCount(totalActivity, 'aktywność', 'aktywności', 'aktywności')}
                            </div>
                            <div class="stat-item" style="font-size: 0.85em; color: #718096;">
                                <i class="fas fa-check-circle" style="color: #4CAF50;"></i> ${boughtCount}
                                <span style="margin: 0 4px;">•</span>
                                <i class="fas fa-bookmark" style="color: #FF9800;"></i> ${reservedCount}
                            </div>
                        </div>
                        <div class="podium-base">
                            <div class="podium-position">#${index + 1}</div>
                        </div>
                    </div>
                `;
            }).join('');
        }

        function renderPodium(top3) {
            const podium = document.getElementById('podium');
            const medals = ['🥇', '🥈', '🥉'];
            const positions = ['first', 'second', 'third'];

            podium.innerHTML = top3.map((user, index) => {
                const emojiSize = index === 0 ? '140px' : (index === 1 ? '110px' : '100px');
                const emojiFontSize = index === 0 ? '4rem' : (index === 1 ? '3.5rem' : '3rem');

                // See renderActivityLeaderboard: escape the name, allowlist the URL.
                const pic = PrezentyEscape.safeImageSrc(user.profile_picture);
                const name = PrezentyEscape.escapeHtml(user.username);
                const avatarHTML = pic
                    ? `<img src="${pic}" 
                           alt="${name}" 
                           class="podium-avatar"
                           onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';">
                       <div class="podium-avatar-emoji podium-avatar" style="display: none; width: ${emojiSize}; height: ${emojiSize}; align-items: center; justify-content: center; font-size: ${emojiFontSize}; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); border-radius: 50%;">
                           ${getEmojiAvatar(user.username)}
                       </div>`
                    : `<div class="podium-avatar-emoji podium-avatar" style="display: flex; width: ${emojiSize}; height: ${emojiSize}; align-items: center; justify-content: center; font-size: ${emojiFontSize}; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); border-radius: 50%;">
                           ${getEmojiAvatar(user.username)}
                       </div>`;

                return `
                    <div class="podium-place ${positions[index]}" data-username="${PrezentyEscape.escapeAttr(user.username)}" style="cursor: pointer;">
                        ${index === 0 ? '<div class="podium-crown">👑</div>' : ''}
                        <div class="podium-rank">${medals[index]}</div>
                        <div class="podium-avatar-container">
                            ${avatarHTML}
                        </div>
                        <div class="podium-name">${name}</div>
                        <div class="podium-stats">
                            <div class="stat-item">
                                <i class="fas fa-gift"></i>
                                ${plCount(Number(user.total_presents) || 0, 'prezent', 'prezenty', 'prezentów')}
                            </div>
                        </div>
                        <div class="podium-base">
                            <div class="podium-position">#${index + 1}</div>
                        </div>
                    </div>
                `;
            }).join('');
        }
        function renderUsersList(users) {
            const usersList = document.getElementById('usersList');

            usersList.innerHTML = users.map((user, index) => {
                // See renderActivityLeaderboard: escape the name, allowlist the URL.
                const pic = PrezentyEscape.safeImageSrc(user.profile_picture);
                const name = PrezentyEscape.escapeHtml(user.username);
                const avatarHTML = pic
                    ? `<img src="${pic}" 
                           alt="${name}" 
                           class="user-avatar"
                           onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';">
                       <div class="user-avatar-emoji user-avatar" style="display: none; align-items: center; justify-content: center; font-size: 2rem; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);">
                           ${getEmojiAvatar(user.username)}
                       </div>`
                    : `<div class="user-avatar-emoji user-avatar" style="display: flex; align-items: center; justify-content: center; font-size: 2rem; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);">
                           ${getEmojiAvatar(user.username)}
                       </div>`;

                return `
                    <div class="user-card" data-username="${PrezentyEscape.escapeAttr(user.username)}" style="cursor: pointer;">
                        <div class="user-rank">#${index + 1}</div>
                        ${avatarHTML}
                        <div class="user-info">
                            <div class="user-name">${name}</div>
                            <div class="user-stats">
                                <span>
                                    <i class="fas fa-gift"></i>
                                    ${plCount(Number(user.total_presents) || 0, 'prezent', 'prezenty', 'prezentów')}
                                </span>
                            </div>
                        </div>
                        <div class="user-score">
                            <i class="fas fa-star me-1"></i>${user.total_presents}
                        </div>
                    </div>
                `;
            }).join('');
        }

        function navigateToUserInRecipients(username) {
            // Open the recipients page pre-filtered to this person
            // (filters.js picks up ?osoba= and applies the person filter)
            window.location.href = '/recipients.html?osoba=' + encodeURIComponent(username);
        }

        // The podium places and the ranking cards used to carry
        // onclick="navigateToUserInRecipients('${user.username}')" - a JS string
        // inside an HTML attribute, where a name containing a single apostrophe
        // breaks straight into executable code. HTML-escaping cannot fix that
        // context (the HTML parser decodes entities before the JS parser runs),
        // so the handler is gone and the name travels as a data attribute
        // instead. `dataset` hands back the decoded original, so
        // navigateToUserInRecipients still receives the real name and its own
        // encodeURIComponent keeps working unchanged.
        //
        // The selector is [data-username] rather than .user-card on purpose:
        // .user-card is shared with the activity list, which has never been
        // clickable and must not become clickable now.
        document.addEventListener('click', function (e) {
            const target = e.target.closest && e.target.closest('[data-username]');
            if (!target) return;
            navigateToUserInRecipients(target.dataset.username);
        });

        // Calculate days to Christmas
        function updateChristmasCountdown() {
            const now = new Date();
            const currentYear = now.getFullYear();
            let christmas = new Date(currentYear, 11, 25); // December 25

            // If Christmas has passed this year, calculate for next year
            if (now > christmas) {
                christmas = new Date(currentYear + 1, 11, 25);
            }

            const daysUntilChristmas = Math.ceil((christmas - now) / (1000 * 60 * 60 * 24));

            const countdownElement = document.getElementById('daysToChristmas');
            if (countdownElement) {
                countdownElement.innerHTML = `Do Świąt Bożego Narodzenia<br>${plPlural(daysUntilChristmas, 'został', 'zostały', 'zostało')} ${plCount(daysUntilChristmas, 'dzień', 'dni', 'dni')}`;
            }
        }

        // Load leaderboard on page load
        loadLeaderboard();
        updateChristmasCountdown();
    