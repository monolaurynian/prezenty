
        let currentStep = 1;
        const totalSteps = 5;

        // Calculate Christmas countdown
        function updateChristmasCountdown() {
            const now = new Date();
            const currentYear = now.getFullYear();
            let christmas = new Date(currentYear, 11, 25); // December 25

            // If Christmas has passed this year, calculate for next year
            if (now > christmas) {
                christmas = new Date(currentYear + 1, 11, 25);
            }

            const totalDays = 365;
            const daysUntilChristmas = Math.ceil((christmas - now) / (1000 * 60 * 60 * 24));
            const daysPassed = totalDays - daysUntilChristmas;
            const percentage = Math.round((daysPassed / totalDays) * 100);

            document.getElementById('christmasCountdown').textContent = 
                `Do Świąt Bożego Narodzenia ${plPlural(daysUntilChristmas, 'został', 'zostały', 'zostało')} ${plCount(daysUntilChristmas, 'dzień', 'dni', 'dni')}`;
            document.getElementById('christmasProgress').style.width = percentage + '%';
            document.getElementById('progressText').textContent = percentage + '%';
        }

        function nextStep() {
            if (currentStep < totalSteps) {
                document.querySelector(`[data-step="${currentStep}"]`).classList.add('hidden');
                currentStep++;
                document.querySelector(`[data-step="${currentStep}"]`).classList.remove('hidden');
            }
        }

        function prevStep() {
            if (currentStep > 1) {
                document.querySelector(`[data-step="${currentStep}"]`).classList.add('hidden');
                currentStep--;
                document.querySelector(`[data-step="${currentStep}"]`).classList.remove('hidden');
            }
        }

        function showLeaderboard() {
            document.getElementById('stepsContainer').classList.add('hidden');
            document.getElementById('skipButton').classList.add('hidden');
            document.getElementById('leaderboardContainer').classList.remove('hidden');
            loadLeaderboard();
        }

        async function loadLeaderboard() {
            try {
                const response = await fetch('/api/leaderboard');
                const data = await response.json();

                if (data.users && data.users.length > 0) {
                    renderLeaderboard(data.users);
                } else {
                    renderEmptyLeaderboard();
                }
            } catch (error) {
                console.error('Error loading leaderboard:', error);
                renderEmptyLeaderboard();
            }
        }

        function renderLeaderboard(users) {
            const podium = document.getElementById('podium');
            const otherUsers = document.getElementById('otherUsers');

            // Top 3 users
            const top3 = users.slice(0, 3);
            const medals = ['🥇', '🥈', '🥉'];
            const positions = ['first', 'second', 'third'];

            podium.innerHTML = top3.map((user, index) => {
                // Names come from POST /api/recipients, so they are user
                // supplied: escape before interpolating and allowlist the
                // picture URL (escape-html.js). A rejected URL falls back to the
                // same default avatar the || fallback already used.
                const pic = PrezentyEscape.safeImageSrc(user.profile_picture) || '/images/default-avatar.svg';
                const name = PrezentyEscape.escapeHtml(user.username);
                return `
                <div class="podium-place ${positions[index]}">
                    <div class="podium-rank">${medals[index]}</div>
                    <img src="${pic}" 
                         alt="${name}" 
                         class="podium-avatar"
                         onerror="this.src='/images/default-avatar.svg'">
                    <div class="podium-name">${name}</div>
                    <div class="podium-score">
                        <i class="fas fa-gift me-1"></i>${plCount(Number(user.total_presents) || 0, 'prezent', 'prezenty', 'prezentów')}
                    </div>
                    <div class="podium-base">
                        <div style="font-size: 24px; font-weight: 700;">#${index + 1}</div>
                    </div>
                </div>
            `;
            }).join('');

            // Other users (4-10)
            const others = users.slice(3, 10);
            if (others.length > 0) {
                otherUsers.innerHTML = others.map((user, index) => {
                    // Same reasoning as the podium above.
                    const pic = PrezentyEscape.safeImageSrc(user.profile_picture) || '/images/default-avatar.svg';
                    const name = PrezentyEscape.escapeHtml(user.username);
                    return `
                    <div class="user-row">
                        <div class="user-rank">#${index + 4}</div>
                        <img src="${pic}" 
                             alt="${name}" 
                             class="user-avatar"
                             onerror="this.src='/images/default-avatar.svg'">
                        <div class="user-info">
                            <div class="user-name">${name}</div>
                        </div>
                        <div class="user-score">
                            <i class="fas fa-gift me-1"></i>${user.total_presents}
                        </div>
                    </div>
                `;
                }).join('');
            } else {
                otherUsers.innerHTML = '';
            }
        }

        function renderEmptyLeaderboard() {
            const podium = document.getElementById('podium');
            podium.innerHTML = `
                <div class="text-center py-5">
                    <i class="fas fa-users fa-3x text-muted mb-3"></i>
                    <p class="text-muted">Zostań pierwszą aktywną osobą!</p>
                </div>
            `;
            document.getElementById('otherUsers').innerHTML = '';
        }

        function startApp() {
            // Mark intro as completed
            localStorage.setItem('introCompleted', 'true');
            // Redirect to main app
            window.location.href = '/recipients.html';
        }

        // Initialize
        updateChristmasCountdown();

        // Check if intro was already completed
        if (localStorage.getItem('introCompleted') === 'true') {
            // Optionally redirect immediately or show a "return to app" button
            // window.location.href = '/recipients.html';
        }
    