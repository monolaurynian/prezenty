
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
            ingest: () => '', strip: () => '', refreshStrips: () => {}, reset: () => {}
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
                        if (rozmowa) { openThread(parseInt(rozmowa, 10), false); return; }

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
                    if (!d || !d.threadId) return;
                    if (currentThreadId && Number(d.threadId) === Number(currentThreadId)) {
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
            return (t && t.lastBody) || '';
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

        function sendNewMessage() {
            const targetUserId = document.getElementById('targetSelect').value;
            const body = document.getElementById('composeBody').value.trim();
            const msgEl = document.getElementById('composeMessage');
            msgEl.style.display = 'none';

            if (!targetUserId) { showToast('Wybierz odbiorcę', 'error'); return; }
            if (!body) { showToast('Wpisz wiadomość', 'error'); return; }

            const btn = document.getElementById('composeBtn');
            const original = btn.innerHTML;
            btn.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span>Wysyłanie...';
            btn.disabled = true;

            fetch('/api/wiadomosci/threads', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ targetUserId, body })
            })
                .then(r => r.json())
                .then(d => {
                    if (d.success) {
                        document.getElementById('composeBody').value = '';
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
                    list.innerHTML = threads.map(t => `
                        <div class="thread-row" onclick="openThread(${t.id})">
                            <div class="d-flex justify-content-between align-items-center gap-2">
                                <span class="thread-who">${escapeHtml(t.otherLabel)}</span>
                                <span class="d-flex align-items-center gap-2">
                                    ${t.unreadCount > 0 ? `<span class="thread-unread">${t.unreadCount}</span>` : ''}
                                    <small style="color:#9ca3af !important;">${timeAgo(t.lastAt)}</small>
                                </span>
                            </div>
                            <div class="thread-last">${escapeHtml(threadPreviewText(t))}</div>
                        </div>
                    `).join('');
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
            if (pushHistory) {
                history.pushState({ rozmowa: threadId }, '', '/wiadomosci?rozmowa=' + threadId);
            }
            document.getElementById('listView').style.display = 'none';
            document.getElementById('chatView').style.display = 'block';
            document.getElementById('chatMessages').innerHTML =
                '<div class="text-center py-3"><div class="spinner-border spinner-border-sm"></div></div>';
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
            document.getElementById('deleteThreadBtn').style.display = 'none';
            document.getElementById('chatView').style.display = 'none';
            document.getElementById('listView').style.display = 'block';
            if (replaceUrl) history.replaceState(null, '', '/wiadomosci');
            loadThreads();
        }

        // URLs in messages become clickable links
        function renderMessageBody(text) {
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

        function loadThreadMessages() {
            if (!currentThreadId) return;
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
                            <div class="chat-bubble ${m.fromMe ? 'from-me' : 'from-them'}">
                                ${renderMessageBody(m.body)}
                                <div id="lp-${m.id}"></div>
                                <div class="chat-time">${timeAgo(m.createdAt)}</div>
                            </div>
                            <div class="chat-reactions" data-reactions-for="${m.id}">${reactionsApi.strip(m)}</div>
                        </div>
                    `).join('');
                    box.scrollTop = box.scrollHeight;

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

        function sendReply() {
            const input = document.getElementById('replyBody');
            const body = input.value.trim();
            if (!body || (!currentThreadId && !newChatTargetId)) return;

            const btn = document.getElementById('replyBtn');
            btn.disabled = true;

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
                        input.value = '';
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
    