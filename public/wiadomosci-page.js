
        let currentThreadId = null;
        // "New chat" mode: conversation view open toward a user with no
        // thread yet - the first message creates it
        let newChatTargetId = null;
        // Signature of the last rendered message list - re-render (and
        // scroll to bottom) only when something actually changed
        let lastChatSignature = null;
        // Separate signature for reactions: when only those changed we
        // repaint the chip strips in place, so the chat never scroll-jumps
        let lastReactionSignature = null;

        // Safe stand-in if chat-reactions.js fails to load (stale cache) -
        // the chat keeps working, just without reaction UI
        const reactionsApi = window.ChatReactions || {
            ingest: () => '', strip: () => '', refreshStrips: () => {}, reset: () => {}, setScope: () => {}
        };

        document.addEventListener('DOMContentLoaded', () => {
            fetch('/api/auth')
                .then(r => r.json())
                .then(data => {
                    if (!data.authenticated) { window.location.href = '/'; return; }

                    Promise.all([loadUsers(), loadThreads()]).then(([users, threads]) => {
                        const params = new URLSearchParams(window.location.search);

                        // Deep link: ?rozmowa=<id> opens the conversation
                        const rozmowa = params.get('rozmowa');
                        if (rozmowa) {
                            if (rozmowa === 'group') {
                                openThread('group', false);
                            } else {
                                openThread(parseInt(rozmowa, 10), false);
                            }
                            return;
                        }

                        // Deep link: ?do=<userId> (profile modals) - open
                        // the existing thread with that person, or a fresh
                        // conversation view when there is none yet
                        const doParam = params.get('do');
                        if (doParam) {
                            const targetId = parseInt(doParam, 10);
                            const existing = (threads || []).find(t =>
                                t.role === 'initiator' && Number(t.targetUserId) === targetId);
                            if (existing) {
                                openThread(existing.id, false);
                            } else {
                                const user = (users || []).find(u => Number(u.id) === targetId);
                                if (user) openNewChat(targetId, user.username);
                            }
                        }
                    });
                })
                .catch(() => { window.location.href = '/'; });

            // Enter sends the reply (Shift+Enter for a newline)
            document.getElementById('targetSelect').addEventListener('change', onTargetChange);

            // GIFs: show the buttons only when the server says GIFs are on
            setupGifs();

            // A GIF that fails to load (removed upstream, offline) becomes a
            // short note instead of a broken-image icon. `error` does not
            // bubble, hence the capture phase.
            const messagesBox = document.getElementById('chatMessages');
            messagesBox.addEventListener('error', (e) => {
                const img = e.target;
                if (!(img instanceof HTMLImageElement) || !img.classList.contains('chat-gif')) return;
                const note = document.createElement('div');
                note.className = 'chat-gif-missing';
                note.textContent = 'Ten GIF jest niedostępny';
                (img.closest('.chat-gif-toggle') || img).replaceWith(note);
            }, true);
            // Reduced motion: tap a still to play it, tap again to stop
            messagesBox.addEventListener('click', (e) => {
                if (!(e.target instanceof Element)) return;
                const toggle = e.target.closest('.chat-gif-toggle');
                if (!toggle) return;
                const img = toggle.querySelector('img');
                const playing = toggle.classList.toggle('is-still') === false;
                img.src = playing ? toggle.getAttribute('data-animated') : toggle.getAttribute('data-still');
                toggle.setAttribute('aria-label', playing ? 'Zatrzymaj GIF' : 'Odtwórz GIF');
            });

            document.getElementById('replyBody').addEventListener('keydown', (e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    sendReply();
                }
            });

            // Periodic refresh: an open conversation polls fast so replies
            // show up quickly, the thread list refreshes lazily
            setInterval(() => { if (currentThreadId) loadThreadMessages(); }, 8000);
            setInterval(() => { if (!currentThreadId) loadThreads(); }, 60000);

            // Instant refresh: the service worker relays every push to open
            // pages, so new messages appear without waiting for the poll
            if (navigator.serviceWorker) {
                navigator.serviceWorker.addEventListener('message', (e) => {
                    const d = e.data && e.data.type === 'push' ? e.data.data : null;
                    if (!d) return;
                    if (d.isGroup) {
                        if (currentThreadId === 'group') loadGroupMessages();
                        else loadThreads();
                    } else if (!d.threadId) {
                        // no-op
                    } else if (currentThreadId && Number(d.threadId) === Number(currentThreadId)) {
                        loadThreadMessages();
                    } else if (!currentThreadId) {
                        loadThreads();
                    }
                    if (typeof updateMessagesBadge === 'function') updateMessagesBadge();
                });
            }

            // Coming back to the app refreshes the open view immediately
            document.addEventListener('visibilitychange', () => {
                if (document.visibilityState !== 'visible') return;
                if (currentThreadId) loadThreadMessages();
                else loadThreads();
            });
        });

        // The system back button navigates between conversation and list
        window.addEventListener('popstate', (e) => {
            if (e.state && e.state.rozmowa) {
                openThread(e.state.rozmowa, false);
            } else {
                showListView(false);
            }
        });

        function escapeHtml(text) {
            const div = document.createElement('div');
            div.textContent = text == null ? '' : String(text);
            return div.innerHTML;
        }

        // List preview line: the OTHER side's newest reaction when the
        // server sent one (only if it is newer than the last message),
        // otherwise the last message. The wording lives in
        // notification-text.js (reactionPreview). Fails closed to the normal
        // preview when the emoji is off the allowlist or a helper is missing.
        // The result is plain text and is escaped by the caller.
        function threadPreviewText(t) {
            const r = t && t.lastReaction;
            if (r && typeof reactionsApi.isAllowedReactionEmoji === 'function'
                && reactionsApi.isAllowedReactionEmoji(r.emoji)
                && typeof window.reactionPreview === 'function') {
                return window.reactionPreview(r.emoji, r.excerpt);
            }
            return plainPreview(t && t.lastBody);
        }

        // A GIF message is a token: show it as "GIF" in lists, not as raw text
        function plainPreview(body) {
            const label = window.GifMessage && window.GifMessage.gifPreviewText(body);
            return label || body || '';
        }

        function showToast(message, type) {
            const el = document.getElementById(`${type}Toast`);
            document.getElementById(`${type}ToastMessage`).textContent = message;
            new bootstrap.Toast(el, { autohide: true, delay: type === 'error' ? 5000 : 3000 }).show();
        }

        function timeAgo(ts) {
            if (!ts) return '';
            const s = Math.floor((Date.now() - new Date(ts)) / 1000);
            if (s < 60) return 'przed chwilą';
            if (s < 3600) return `${Math.floor(s / 60)} min temu`;
            if (s < 86400) return `${Math.floor(s / 3600)} godz. temu`;
            return new Date(ts).toLocaleDateString('pl-PL');
        }

        // ===== Compose =====
        // The group chat is one more choice in the recipient dropdown
        const GROUP_OPTION_VALUE = 'group';

        // The message body for a picked GIF, or null (with a toast) if the
        // pick is not valid. Never fall back to sending the typed draft.
        function gifToken(gif) {
            const token = window.GifMessage.buildGifToken(gif.provider, gif.id, gif.width, gif.height);
            if (!token) showToast('Nie można wysłać tego GIF-a', 'error');
            return token;
        }

        // Asks the server whether GIFs are on; if so, wires up both GIF buttons
        // (the conversation composer and the new-message card).
        function setupGifs() {
            if (!window.GifPicker || !window.GifMessage) { resolveGifConfig(); return; }
            fetch('/api/wiadomosci/gif-config')
                .then(r => (r.ok ? r.json() : null))
                .then(cfg => {
                    if (!cfg) return;
                    window.GifPicker.init(cfg);
                    if (!window.GifPicker.isEnabled()) return;
                    const reply = document.getElementById('gifBtn');
                    const compose = document.getElementById('gifComposeBtn');
                    [reply, compose].forEach(btn => { if (btn) btn.style.display = ''; });
                    if (reply) {
                        reply.addEventListener('click', () => {
                            window.GifPicker.open({
                                trigger: reply,
                                onPick: (gif) => { const token = gifToken(gif); if (token) sendReply(token); }
                            });
                        });
                    }
                    if (compose) {
                        compose.addEventListener('click', () => {
                            // The recipient decides where the GIF goes, so ask first
                            if (!document.getElementById('targetSelect').value) {
                                showToast('Wybierz odbiorcę', 'error');
                                return;
                            }
                            window.GifPicker.open({
                                trigger: compose,
                                onPick: (gif) => { const token = gifToken(gif); if (token) sendNewMessage(token); }
                            });
                        });
                    }
                })
                .catch(() => { /* GIFs stay off; the chat works as before */ })
                .then(resolveGifConfig);
        }

        // Explains where the message goes when the group chat is chosen
        function onTargetChange() {
            const hint = document.getElementById('composeGroupHint');
            if (!hint) return;
            hint.style.display = document.getElementById('targetSelect').value === GROUP_OPTION_VALUE ? '' : 'none';
        }

        function loadUsers() {
            return fetch('/api/wiadomosci/users')
                .then(r => r.json())
                .then(d => {
                    const sel = document.getElementById('targetSelect');
                    (d.users || []).forEach(u => {
                        const opt = document.createElement('option');
                        opt.value = u.id;
                        opt.textContent = u.username;
                        sel.appendChild(opt);
                    });
                    return d.users || [];
                })
                .catch(() => []);
        }

        // `overrideBody` is a GIF token from the picker; otherwise the textarea is sent
        function sendNewMessage(overrideBody) {
            const targetUserId = document.getElementById('targetSelect').value;
            const body = typeof overrideBody === 'string' ? overrideBody : document.getElementById('composeBody').value.trim();
            const msgEl = document.getElementById('composeMessage');
            msgEl.style.display = 'none';

            if (!targetUserId) { showToast('Wybierz odbiorcę', 'error'); return; }
            if (!body) { showToast('Wpisz wiadomość', 'error'); return; }

            const btn = document.getElementById('composeBtn');
            const original = btn.innerHTML;
            btn.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span>Wysyłanie...';
            btn.disabled = true;

            // "Czat grupowy" in the dropdown posts into the one shared room
            // (no thread is created) and opens it
            if (targetUserId === GROUP_OPTION_VALUE) {
                fetch('/api/wiadomosci/group', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ body })
                })
                    .then(r => r.json())
                    .then(d => {
                        if (d.ok) {
                            if (typeof overrideBody !== 'string') document.getElementById('composeBody').value = '';
                            document.getElementById('targetSelect').value = '';
                            onTargetChange();
                            openThread('group');
                        } else {
                            showToast(d.error || 'Nie udało się wysłać', 'error');
                        }
                    })
                    .catch(() => showToast('Błąd połączenia', 'error'))
                    .finally(() => { btn.innerHTML = original; btn.disabled = false; });
                return;
            }

            fetch('/api/wiadomosci/threads', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ targetUserId, body })
            })
                .then(r => r.json())
                .then(d => {
                    if (d.success) {
                        if (typeof overrideBody !== 'string') document.getElementById('composeBody').value = '';
                        document.getElementById('targetSelect').value = '';
                        showToast('Wiadomość wysłana anonimowo! 🎅', 'success');
                        loadThreads();
                    } else {
                        showToast(d.error || 'Nie udało się wysłać', 'error');
                    }
                })
                .catch(() => showToast('Błąd połączenia', 'error'))
                .finally(() => { btn.innerHTML = original; btn.disabled = false; });
        }

        // ===== Threads =====
        function loadThreads() {
            return fetch('/api/wiadomosci/threads')
                .then(r => r.json())
                .then(d => {
                    const list = document.getElementById('threadsList');
                    const threads = d.threads || [];
                    if (threads.length === 0) {
                        list.innerHTML = `
                            <div class="text-center py-4">
                                <div style="font-size: 40px;">🎅</div>
                                <p class="mb-0" style="opacity: 0.85;">Brak rozmów. Wyślij pierwszą anonimową wiadomość!</p>
                            </div>`;
                        return threads;
                    }
                    list.innerHTML = threads.map(t => {
                        if (t.isGroup || t.id === 'group') {
                            return `
                        <div class="thread-row thread-row--group" onclick="openThread('group')">
                            <div class="d-flex justify-content-between align-items-center gap-2">
                                <span class="thread-who">👥 Czat grupowy</span>
                                <span class="d-flex align-items-center gap-2">
                                    ${t.unreadCount > 0 ? `<span class="thread-unread">${t.unreadCount}</span>` : ''}
                                    <small style="color:#9ca3af !important;">${timeAgo(t.lastAt)}</small>
                                </span>
                            </div>
                            <div class="thread-last">${escapeHtml(plainPreview(t.lastBody))}</div>
                        </div>`;
                        }
                        return `
                        <div class="thread-row" onclick="openThread(${t.id})">
                            <div class="d-flex justify-content-between align-items-center gap-2">
                                <span class="thread-who">${escapeHtml(t.otherLabel)}</span>
                                <span class="d-flex align-items-center gap-2">
                                    ${t.unreadCount > 0 ? `<span class="thread-unread">${t.unreadCount}</span>` : ''}
                                    <small style="color:#9ca3af !important;">${timeAgo(t.lastAt)}</small>
                                </span>
                            </div>
                            <div class="thread-last">${escapeHtml(threadPreviewText(t))}</div>
                        </div>`;
                    }).join('');
                    return threads;
                })
                .catch(() => {
                    document.getElementById('threadsList').innerHTML =
                        '<p class="mb-0">Nie udało się załadować rozmów. <a href="#" onclick="loadThreads(); return false;">Spróbuj ponownie</a></p>';
                    return [];
                });
        }

        // ===== Conversation view =====
        function openThread(threadId, pushHistory = true) {
            currentThreadId = threadId;
            newChatTargetId = null;
            lastChatSignature = null;
            lastReactionSignature = null;
            reactionsApi.reset();
            // Group messages live in their own id space and endpoint
            reactionsApi.setScope(threadId === 'group' ? 'group' : 'thread');
            if (pushHistory) {
                history.pushState({ rozmowa: threadId }, '', '/wiadomosci?rozmowa=' + threadId);
            }
            document.getElementById('listView').style.display = 'none';
            document.getElementById('chatView').style.display = 'block';
            document.getElementById('chatMessages').innerHTML =
                '<div class="text-center py-3"><div class="spinner-border spinner-border-sm"></div></div>';
            // Hide delete button for group chat (it can't be deleted)
            document.getElementById('deleteThreadBtn').style.display = 'none';
            // Clear the app icon badge — user is reading the conversation
            if ('clearAppBadge' in navigator) {
                navigator.clearAppBadge().catch(() => {});
            }
            if (threadId === 'group') {
                document.getElementById('chatTitle').innerHTML =
                    `<i class="fas fa-comment-dots" style="color:#7B1FA2;"></i>👥 Czat grupowy`;
            }
            loadThreadMessages();
        }

        // Conversation view toward a person with no thread yet - the
        // first message sent creates the thread
        function openNewChat(targetUserId, username) {
            currentThreadId = null;
            newChatTargetId = targetUserId;
            lastChatSignature = null;
            lastReactionSignature = null;
            reactionsApi.reset();
            reactionsApi.setScope('thread');
            document.getElementById('listView').style.display = 'none';
            document.getElementById('chatView').style.display = 'block';
            document.getElementById('deleteThreadBtn').style.display = 'none';
            document.getElementById('chatTitle').innerHTML =
                `<i class="fas fa-comment-dots" style="color:#7B1FA2;"></i>${escapeHtml(username)}`;
            document.getElementById('chatMessages').innerHTML = `
                <div class="text-center py-4" style="opacity: 0.8;">
                    <div style="font-size: 36px;">🎅</div>
                    <p class="mb-0" style="font-size: 14px;">Napisz pierwszą anonimową wiadomość do
                        <strong>${escapeHtml(username)}</strong> - zobaczy tylko Świętego Mikołaja.</p>
                </div>`;
            document.getElementById('replyBody').focus();
        }

        function closeThread() {
            // If we pushed a history entry, going back pops it (and the
            // popstate handler shows the list); deep links just switch views
            if (history.state && history.state.rozmowa) {
                history.back();
            } else {
                showListView(true);
            }
        }

        function showListView(replaceUrl) {
            currentThreadId = null;
            newChatTargetId = null;
            lastChatSignature = null;
            lastReactionSignature = null;
            reactionsApi.reset();
            reactionsApi.setScope('thread');
            document.getElementById('deleteThreadBtn').style.display = 'none';
            document.getElementById('chatView').style.display = 'none';
            document.getElementById('listView').style.display = 'block';
            if (replaceUrl) history.replaceState(null, '', '/wiadomosci');
            loadThreads();
        }

        // ===== GIF messages =====
        // A message whose whole body is a GIF token (see gif-message.js)
        // is drawn as a picture. The URL is built from the validated id,
        // never taken from the message text.
        function parsedGif(text) {
            return window.GifMessage ? window.GifMessage.parseGif(text) : null;
        }

        // Extra bubble class so a GIF gets snug padding
        function gifBubbleClass(text) {
            return parsedGif(text) ? ' has-gif' : '';
        }

        function prefersReducedMotion() {
            return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
        }

        const GIF_MISSING_HTML = '<div class="chat-gif-missing">Ten GIF jest niedostępny</div>';

        // Settles once the GIF config request is done (success or failure).
        // KLIPY slots wait for it: until then the key is not known, and
        // "unavailable" would be shown for GIFs that are merely not looked up yet.
        let resolveGifConfig;
        const gifConfigReady = new Promise(resolve => { resolveGifConfig = resolve; });

        function gifHtml(gif) {
            let urls = window.GifMessage.gifUrls(gif);
            const size = window.GifMessage.displaySize(gif, 220);
            if (gif.provider === 'klipy') {
                // KLIPY hands out the picture URLs through its API (they are
                // not rebuilt from the id). Known -> draw it now; unknown ->
                // a slot of the final size, filled in by hydrateKlipyGifs().
                const entry = window.GifKlipy ? window.GifKlipy.cached(gif.id) : null;
                if (entry === null) return GIF_MISSING_HTML;   // KLIPY no longer has it
                if (!entry) {
                    return `<span class="chat-gif-slot" role="img" aria-label="GIF się ładuje"` +
                        ` data-klipy-slug="${escapeHtml(gif.id)}" data-w="${gif.width}" data-h="${gif.height}"` +
                        ` style="width:${size.width}px;aspect-ratio:${gif.width}/${gif.height}"></span>`;
                }
                urls = entry.urls;
            }
            if (!urls) return '';
            const dims = `width="${size.width}" height="${size.height}"`;
            if (prefersReducedMotion()) {
                // Reduced motion: a still picture, tap to play
                return `<button type="button" class="chat-gif-toggle is-still" aria-label="Odtwórz GIF"` +
                    ` data-still="${escapeHtml(urls.still)}" data-animated="${escapeHtml(urls.animated)}">` +
                    `<img class="chat-gif" src="${escapeHtml(urls.still)}" ${dims} alt="GIF - nieruchomy podgląd" loading="lazy"></button>`;
            }
            return `<img class="chat-gif" src="${escapeHtml(urls.animated)}" ${dims} alt="Animowany GIF" loading="lazy">`;
        }

        // Fills the KLIPY slots drawn by gifHtml(): asks KLIPY (once, batched,
        // cached) for the real picture URLs of the slugs on screen.
        function hydrateKlipyGifs(container) {
            const slots = Array.prototype.slice.call(container.querySelectorAll('.chat-gif-slot[data-klipy-slug]'));
            if (!slots.length) return;
            const missing = (slot) => { if (slot.isConnected) slot.outerHTML = GIF_MISSING_HTML; };
            gifConfigReady.then(() => {
                if (!window.GifKlipy || !window.GifKlipy.hasKey()) { slots.forEach(missing); return; }
                return window.GifKlipy.resolve(slots.map(slot => slot.getAttribute('data-klipy-slug')));
            }).then(() => {
                slots.forEach(slot => {
                    if (!slot.isConnected) return; // the list was re-rendered meanwhile
                    const slug = slot.getAttribute('data-klipy-slug');
                    const gif = parsedGif(`[gif:klipy:${slug}:${slot.getAttribute('data-w')}x${slot.getAttribute('data-h')}]`);
                    // undefined = the lookup itself failed (offline, rate limit)
                    if (!gif || window.GifKlipy.cached(slug) === undefined) { missing(slot); return; }
                    slot.outerHTML = gifHtml(gif);
                });
            });
        }

        // URLs in messages become clickable links
        function renderMessageBody(text) {
            const gif = parsedGif(text);
            if (gif) return gifHtml(gif);
            const esc = escapeHtml(text);
            return esc.replace(/(https?:\/\/[^\s<]+)/g,
                (u) => `<a href="${u}" target="_blank" rel="noopener noreferrer">${u}</a>`);
        }

        // ===== Link previews =====
        const previewCache = new Map(); // url -> data|null (null = no preview)

        function firstUrlIn(text) {
            const m = String(text).match(/https?:\/\/[^\s]+/);
            return m ? m[0].replace(/[.,;:!?)]+$/, '') : null;
        }

        function renderPreviewCard(container, data) {
            if (!data || (!data.title && !data.image)) return;
            const a = document.createElement('a');
            a.className = 'link-preview-card';
            a.href = data.url;
            a.target = '_blank';
            a.rel = 'noopener noreferrer';
            if (data.image) {
                const img = document.createElement('img');
                img.src = data.image;
                img.alt = '';
                img.loading = 'lazy';
                img.onerror = () => img.remove();
                a.appendChild(img);
            }
            const body = document.createElement('div');
            body.className = 'lp-body';
            if (data.title) {
                const t = document.createElement('div');
                t.className = 'lp-title';
                t.textContent = data.title;
                body.appendChild(t);
            }
            const dom = document.createElement('div');
            dom.className = 'lp-domain';
            dom.textContent = data.siteName || '';
            body.appendChild(dom);
            a.appendChild(body);
            container.appendChild(a);
        }

        function loadLinkPreview(url, containerId) {
            const container = document.getElementById(containerId);
            if (!container) return;
            if (previewCache.has(url)) {
                renderPreviewCard(container, previewCache.get(url));
                return;
            }
            fetch('/api/link-preview?url=' + encodeURIComponent(url))
                .then(r => (r.ok ? r.json() : null))
                .then(data => {
                    previewCache.set(url, data);
                    renderPreviewCard(container, data);
                })
                .catch(() => previewCache.set(url, null));
        }

        function loadGroupMessages() {
            fetch('/api/wiadomosci/group')
                .then(r => r.json())
                .then(d => {
                    if (currentThreadId !== 'group') return;
                    const box = document.getElementById('chatMessages');
                    const msgs = d.messages || [];
                    // API returns newest-first; reverse for display
                    const ordered = msgs.slice().reverse();

                    // Same reaction pipeline as the private threads: ingest
                    // the aggregate first so the strips and the reaction
                    // signature use the fresh data.
                    const rsig = reactionsApi.ingest(ordered);

                    const sig = 'group:' + ordered.length + ':' + (ordered.length ? ordered[ordered.length - 1].id : 0);
                    if (sig === lastChatSignature) {
                        // Same messages, different reactions: repaint only
                        // the chip strips (no scroll jump, previews stay)
                        if (rsig !== lastReactionSignature) {
                            lastReactionSignature = rsig;
                            reactionsApi.refreshStrips();
                        }
                        return;
                    }
                    lastChatSignature = sig;
                    lastReactionSignature = rsig;
                    box.innerHTML = ordered.map(m => `
                        <div class="chat-msg-row ${m.isOwn ? 'from-me' : 'from-them'}">
                            <div class="chat-bubble ${m.isOwn ? 'from-me' : 'from-them'}${gifBubbleClass(m.body)}">
                                ${renderMessageBody(m.body)}
                                <div id="lp-g${m.id}"></div>
                                <div class="chat-time">${timeAgo(m.created_at)}</div>
                            </div>
                            <div class="chat-reactions" data-reactions-for="${m.id}">${reactionsApi.strip(m)}</div>
                        </div>
                    `).join('');
                    box.scrollTop = box.scrollHeight;
                    hydrateKlipyGifs(box);
                    ordered.forEach(m => {
                        const url = firstUrlIn(m.body);
                        if (url) loadLinkPreview(url, 'lp-g' + m.id);
                    });
                    if (typeof updateMessagesBadge === 'function') updateMessagesBadge();
                })
                .catch(() => showToast('Nie udało się załadować czatu grupowego', 'error'));
        }

        function loadThreadMessages() {
            if (!currentThreadId) return;
            if (currentThreadId === 'group') { loadGroupMessages(); return; }
            fetch(`/api/wiadomosci/threads/${currentThreadId}`)
                .then(r => r.json())
                .then(d => {
                    if (!currentThreadId) return; // view was closed meanwhile
                    document.getElementById('chatTitle').innerHTML =
                        `<i class="fas fa-comment-dots" style="color:#7B1FA2;"></i>${escapeHtml(d.otherLabel || 'Rozmowa')}`;
                    const box = document.getElementById('chatMessages');
                    const msgs = d.messages || [];

                    // Reactions ride along in this payload - no second
                    // polling loop. Ingest first so the strips below (and
                    // the reaction signature) use the fresh aggregate.
                    const rsig = reactionsApi.ingest(msgs);

                    // Nothing new - keep the DOM (and scroll position) as is
                    const sig = currentThreadId + ':' + msgs.length + ':' + (msgs.length ? msgs[msgs.length - 1].id : 0);
                    if (sig === lastChatSignature) {
                        // Same messages, different reactions: repaint only
                        // the chip strips, leaving scroll and previews alone
                        if (rsig !== lastReactionSignature) {
                            lastReactionSignature = rsig;
                            reactionsApi.refreshStrips();
                        }
                        return;
                    }
                    lastChatSignature = sig;
                    lastReactionSignature = rsig;

                    box.innerHTML = msgs.map(m => `
                        <div class="chat-msg-row ${m.fromMe ? 'from-me' : 'from-them'}">
                            <div class="chat-bubble ${m.fromMe ? 'from-me' : 'from-them'}${gifBubbleClass(m.body)}">
                                ${renderMessageBody(m.body)}
                                <div id="lp-${m.id}"></div>
                                <div class="chat-time">${timeAgo(m.createdAt)}</div>
                            </div>
                            <div class="chat-reactions" data-reactions-for="${m.id}">${reactionsApi.strip(m)}</div>
                        </div>
                    `).join('');
                    box.scrollTop = box.scrollHeight;
                    hydrateKlipyGifs(box);

                    // Thread exists and loaded - deletion is possible
                    document.getElementById('deleteThreadBtn').style.display = '';

                    // Load a preview card for the first URL in each message
                    msgs.forEach(m => {
                        const url = firstUrlIn(m.body);
                        if (url) loadLinkPreview(url, 'lp-' + m.id);
                    });

                    // Reading the thread marked messages as read - refresh
                    // the dock badge right away
                    if (typeof updateMessagesBadge === 'function') updateMessagesBadge();
                })
                .catch(() => showToast('Nie udało się załadować rozmowy', 'error'));
        }

        // `overrideBody` is a GIF token from the picker; otherwise the textarea is sent
        function sendReply(overrideBody) {
            const input = document.getElementById('replyBody');
            const isOverride = typeof overrideBody === 'string';
            const body = isOverride ? overrideBody : input.value.trim();
            if (!body || (!currentThreadId && !newChatTargetId)) return;

            const btn = document.getElementById('replyBtn');
            btn.disabled = true;

            // Group chat branch
            if (currentThreadId === 'group') {
                fetch('/api/wiadomosci/group', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ body })
                })
                    .then(r => r.json())
                    .then(d => {
                        if (d.ok) {
                            if (!isOverride) input.value = ''; // a GIF leaves the typed draft alone
                            lastChatSignature = null; // force re-render
                            loadGroupMessages();
                        } else {
                            showToast(d.error || 'Nie udało się wysłać', 'error');
                        }
                    })
                    .catch(() => showToast('Błąd połączenia', 'error'))
                    .finally(() => { btn.disabled = false; });
                return;
            }

            // New-chat mode: the first message creates the thread
            const isNew = !currentThreadId && newChatTargetId;
            const url = isNew
                ? '/api/wiadomosci/threads'
                : `/api/wiadomosci/threads/${currentThreadId}/messages`;
            const payload = isNew
                ? { targetUserId: newChatTargetId, body }
                : { body };

            fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            })
                .then(r => r.json())
                .then(d => {
                    if (d.success) {
                        if (!isOverride) input.value = ''; // a GIF leaves the typed draft alone
                        if (isNew && d.threadId) {
                            currentThreadId = d.threadId;
                            newChatTargetId = null;
                            history.replaceState({ rozmowa: d.threadId }, '', '/wiadomosci?rozmowa=' + d.threadId);
                        }
                        loadThreadMessages();
                    } else {
                        showToast(d.error || 'Nie udało się wysłać', 'error');
                    }
                })
                .catch(() => showToast('Błąd połączenia', 'error'))
                .finally(() => { btn.disabled = false; });
        }

        // Hard-deletes the thread for BOTH participants - the other
        // side loses the conversation too, so the confirm says so
        function deleteThread() {
            if (!currentThreadId) return;
            if (!confirm('Usunąć tę rozmowę? Zniknie ona również u drugiej osoby. Tej operacji nie można cofnąć.')) {
                return;
            }
            const btn = document.getElementById('deleteThreadBtn');
            btn.disabled = true;
            fetch(`/api/wiadomosci/threads/${currentThreadId}`, { method: 'DELETE' })
                .then(r => r.json())
                .then(d => {
                    if (d.success) {
                        showToast('Rozmowa została usunięta', 'success');
                        showListView(true);
                        if (typeof updateMessagesBadge === 'function') updateMessagesBadge();
                    } else {
                        showToast(d.error || 'Nie udało się usunąć rozmowy', 'error');
                    }
                })
                .catch(() => showToast('Błąd połączenia', 'error'))
                .finally(() => { btn.disabled = false; });
        }

        function logout() {
            fetch('/api/logout', { method: 'POST' })
                .finally(() => { window.location.href = '/'; });
        }
    