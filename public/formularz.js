console.log('Formularz.js loading...');

let currentUser = null;
let authModal = null;
let loginModal = null;
let editPresentModal = null;

// Auto-select state: selection happens as soon as BOTH the identified
// name and the recipient options are available (no fixed timeouts).
let identifiedName = null;
let recipientsLoaded = false;
let identificationFetched = false;
let autoSelectedFromCache = false;

// Fast path: remember the identified name from the last visit so the
// dropdown can be pre-selected the moment recipients load, without
// waiting for /api/auth + /api/user/identification round trips.
try {
    identifiedName = localStorage.getItem('formularzIdentifiedName') || null;
    autoSelectedFromCache = !!identifiedName;
} catch (e) {}

document.addEventListener('DOMContentLoaded', function() {
    // Initialize Bootstrap modals
    authModal = new bootstrap.Modal(document.getElementById('authModal'));
    loginModal = new bootstrap.Modal(document.getElementById('loginModal'));
    editPresentModal = new bootstrap.Modal(document.getElementById('editPresentModal'));
    
    // Check if user is authenticated
    checkAuth();
    
    // Fetch identification in parallel with the auth check (not after it)
    fetchIdentification();
    
    // Setup form handlers
    setupFormHandlers();
    setupQuickAddComposer();
    
    // Load recipients for dropdown
    loadRecipients();
});

function setupFormHandlers() {
    // Present form submission
    const presentForm = document.getElementById('presentForm');
    if (presentForm) {
        presentForm.addEventListener('submit', function(e) {
            e.preventDefault();
            submitPresent();
        });
    }
    
    // Recipient dropdown change handler
    const recipientSelect = document.getElementById('recipientSelect');
    if (recipientSelect) {
        recipientSelect.addEventListener('change', function() {
            const newNameInput = document.getElementById('newNameInput');
            if (this.value === '__new__') {
                newNameInput.style.display = 'block';
                document.getElementById('recipientName').required = true;
            } else {
                newNameInput.style.display = 'none';
                document.getElementById('recipientName').required = false;
            }
        });
    }
    
    // Modal login form
    const modalLoginForm = document.getElementById('modalLoginForm');
    if (modalLoginForm) {
        modalLoginForm.addEventListener('submit', function(e) {
            e.preventDefault();
            modalLogin();
        });
    }
    
    // Modal register form
    const modalRegisterForm = document.getElementById('modalRegisterForm');
    if (modalRegisterForm) {
        modalRegisterForm.addEventListener('submit', function(e) {
            e.preventDefault();
            modalRegister();
        });
    }
    
    // Edit present form
    const editPresentForm = document.getElementById('editPresentForm');
    if (editPresentForm) {
        editPresentForm.addEventListener('submit', function(e) {
            e.preventDefault();
            saveEditedPresent();
        });
    }
    
    // Login modal form
    const loginModalForm = document.getElementById('loginModalForm');
    if (loginModalForm) {
        loginModalForm.addEventListener('submit', function(e) {
            e.preventDefault();
            loginModalSubmit();
        });
    }
}

function openLoginModal() {
    loginModal.show();
}

function loginModalSubmit() {
    const username = document.getElementById('loginModalUsername').value.trim();
    const password = document.getElementById('loginModalPassword').value;
    
    if (!username || !password) {
        showLoginModalMessage('Proszę wypełnić wszystkie pola', 'danger');
        return;
    }
    
    const submitBtn = document.querySelector('#loginModalForm button[type="submit"]');
    const originalText = submitBtn.innerHTML;
    submitBtn.innerHTML = '<span class="spinner-border spinner-border-sm me-2"></span>Logowanie...';
    submitBtn.disabled = true;
    
    fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
    })
    .then(response => response.json())
    .then(data => {
        if (data.success) {
            currentUser = data.user;
            // Redirect to recipients page
            window.location.href = '/recipients';
        } else {
            showLoginModalMessage(data.error || 'Błąd logowania', 'danger');
        }
    })
    .catch(error => {
        console.error('Login error:', error);
        showLoginModalMessage('Błąd połączenia z serwerem', 'danger');
    })
    .finally(() => {
        submitBtn.innerHTML = originalText;
        submitBtn.disabled = false;
    });
}

function showLoginModalMessage(message, type) {
    const loginModalMessage = document.getElementById('loginModalMessage');
    loginModalMessage.textContent = message;
    loginModalMessage.className = `alert alert-${type} mt-3`;
    loginModalMessage.style.display = 'block';
}

function checkAuth() {
    fetch('/api/auth')
        .then(response => response.json())
        .then(data => {
            if (data.authenticated) {
                currentUser = data.user;
                console.log('User authenticated:', currentUser);
                // Reveal the quiet "edit my presents" path under the form
                const editLink = document.getElementById('editMyPresentsLink');
                if (editLink) editLink.style.display = 'block';
                // Edit tab is the default view - show it now that auth is confirmed
                document.getElementById('editTab').style.display = 'block';
                loadMyPresents();
            } else {
                currentUser = null;
                console.log('User not authenticated');
                // Not logged in: fall back to add tab so the page isn't blank
                document.getElementById('addTab').style.display = 'block';
                document.getElementById('editTab').style.display = 'none';
            }
        })
        .catch(error => {
            console.error('Auth check error:', error);
            currentUser = null;
            document.getElementById('addTab').style.display = 'block';
            document.getElementById('editTab').style.display = 'none';
        });
}

function fetchIdentification() {
    if (identificationFetched) return;
    identificationFetched = true;
    fetch('/api/user/identification')
        .then(response => response.json())
        .then(data => {
            if (data.isIdentified && data.name) {
                console.log('User identified as:', data.name);
                identifiedName = data.name;
                try { localStorage.setItem('formularzIdentifiedName', data.name); } catch (e) {}
            } else {
                identifiedName = null;
                try { localStorage.removeItem('formularzIdentifiedName'); } catch (e) {}
                // Cached name was stale - undo a cache-based pre-selection
                if (autoSelectedFromCache && !window._osobaPreselected) {
                    const sel = document.getElementById('recipientSelect');
                    if (sel) sel.value = '';
                }
            }
            autoSelectedFromCache = false;
            tryAutoSelect();
        })
        .catch(error => {
            console.error('Error getting user identification:', error);
        });
}

// Runs whenever either recipients finish loading or the identification
// arrives - selects as soon as both pieces are ready.
function tryAutoSelect() {
    if (!identifiedName || !recipientsLoaded) return;
    // Don't override an explicit ?osoba= link selection
    if (window._osobaPreselected) return;
    const recipientSelect = document.getElementById('recipientSelect');
    if (!recipientSelect) return;
    for (let i = 0; i < recipientSelect.options.length; i++) {
        if (recipientSelect.options[i].dataset.name === identifiedName ||
            recipientSelect.options[i].textContent === identifiedName) {
            recipientSelect.value = recipientSelect.options[i].value;
            console.log('Auto-selected user name:', identifiedName, 'with ID:', recipientSelect.options[i].value);
            break;
        }
    }
}

function switchTab(tab, fromButton) {
    const addTab = document.getElementById('addTab');
    const editTab = document.getElementById('editTab');
    const backLink = document.getElementById('backToEditLink');
    
    if (tab === 'add') {
        addTab.style.display = 'block';
        editTab.style.display = 'none';
        if (backLink) backLink.style.display = fromButton ? 'block' : 'none';
    } else if (tab === 'edit') {
        // Check if user is authenticated
        if (!currentUser) {
            // Show authentication modal
            authModal.show();
        } else {
            addTab.style.display = 'none';
            editTab.style.display = 'block';
            if (backLink) backLink.style.display = 'none';
            loadMyPresents();
        }
    }
}

function loadRecipients() {
    fetch('/api/formularz/recipients')
        .then(response => response.json())
        .then(data => {
            const recipientSelect = document.getElementById('recipientSelect');
            if (recipientSelect && data.recipients) {
                console.log('Loading recipients:', data.recipients.length);
                
                // Clear existing options except the first two
                while (recipientSelect.options.length > 2) {
                    recipientSelect.remove(2);
                }
                
                // Add recipients to dropdown
                data.recipients.forEach(recipient => {
                    const option = document.createElement('option');
                    option.value = recipient.id;
                    option.textContent = recipient.name;
                    option.dataset.name = recipient.name;
                    recipientSelect.appendChild(option);
                });
                
                // Ensure dropdown is enabled
                recipientSelect.disabled = false;
                
                console.log('Recipients loaded successfully. Total options:', recipientSelect.options.length);
                
                // Deep link support: /formularz?osoba=Babcia pre-selects that
                // person (used by the "share form" feature). Takes priority
                // over auto-selection based on the logged-in user.
                const osobaParam = new URLSearchParams(window.location.search).get('osoba');
                if (osobaParam) {
                    for (let i = 0; i < recipientSelect.options.length; i++) {
                        if (recipientSelect.options[i].dataset.name === osobaParam ||
                            recipientSelect.options[i].textContent === osobaParam) {
                            recipientSelect.value = recipientSelect.options[i].value;
                            window._osobaPreselected = true;
                            console.log('Pre-selected recipient from URL:', osobaParam);
                            break;
                        }
                    }
                    // Name not on the list yet - fill it in as a new name
                    if (!window._osobaPreselected) {
                        recipientSelect.value = '__new__';
                        recipientSelect.dispatchEvent(new Event('change'));
                        document.getElementById('recipientName').value = osobaParam;
                        window._osobaPreselected = true;
                    }
                }

                // Recipients ready - select the identified user's name
                // immediately (cached name makes this instant on repeat visits)
                recipientsLoaded = true;
                tryAutoSelect();
            }
        })
        .catch(error => {
            console.error('Error loading recipients:', error);
        });
}

function submitPresent() {
    const recipientSelect = document.getElementById('recipientSelect');
    const recipientNameInput = document.getElementById('recipientName');
    const presentTitle = document.getElementById('presentTitle').value.trim();
    const presentComments = document.getElementById('presentComments').value.trim();
    const formMessage = document.getElementById('formMessage');
    
    console.log('Submit present - recipientSelect value:', recipientSelect.value);
    console.log('Submit present - recipientSelect disabled:', recipientSelect.disabled);
    
    // Determine recipient name
    let recipientName;
    if (recipientSelect.value === '__new__') {
        recipientName = recipientNameInput.value.trim();
        if (!recipientName) {
            showFormMessage('Proszę wprowadzić swoje imię i nazwisko', 'danger');
            return;
        }
    } else if (recipientSelect.value && recipientSelect.value !== '') {
        // Get the text content (name) from the selected option
        const selectedOption = recipientSelect.options[recipientSelect.selectedIndex];
        recipientName = selectedOption ? selectedOption.textContent : recipientSelect.value;
    } else {
        showFormMessage('Proszę wybrać lub wprowadzić swoje imię', 'danger');
        return;
    }
    
    if (!presentTitle) {
        showFormMessage('Proszę wprowadzić nazwę prezentu', 'danger');
        return;
    }
    
    console.log('Submitting present for recipient:', recipientName);
    
    // Disable submit button
    const submitBtn = document.querySelector('#presentForm button[type="submit"]');
    const originalText = submitBtn.innerHTML;
    submitBtn.innerHTML = '<span class="spinner-border spinner-border-sm me-2"></span>Dodawanie...';
    submitBtn.disabled = true;
    
    // Submit to server
    fetch('/api/formularz/present', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            recipientName: recipientName,
            presentTitle: presentTitle,
            presentComments: presentComments
        })
    })
    .then(response => response.json())
    .then(data => {
        if (data.success) {
            showFormMessage('Prezent został dodany pomyślnie! 🎁', 'success');
            // Clear form
            document.getElementById('presentForm').reset();
            document.getElementById('newNameInput').style.display = 'none';
            // Reload recipients to include the new one if added
            loadRecipients();
        } else {
            showFormMessage(data.error || 'Błąd podczas dodawania prezentu', 'danger');
        }
    })
    .catch(error => {
        console.error('Error submitting present:', error);
        showFormMessage('Błąd połączenia z serwerem', 'danger');
    })
    .finally(() => {
        submitBtn.innerHTML = originalText;
        submitBtn.disabled = false;
    });
}

// Quick add on the "Dodaj i edytuj moje prezenty" tab - adds a present for
// the identified user without leaving the edit view. Submitted by the
// form (Enter in the name input or the round add button).
function quickAddPresent() {
    const input = document.getElementById('quickAddTitle');
    const commentsInput = document.getElementById('quickAddComments');
    const btn = document.getElementById('quickAddBtn');
    const title = input ? input.value.trim() : '';
    const comments = commentsInput ? commentsInput.value.trim() : '';

    // Ignore repeated Enter presses while a request is in flight
    if (!btn || btn.disabled) return;

    if (!title) {
        showQuickAddMessage('Wpisz nazwę prezentu', 'danger');
        if (input) input.focus();
        return;
    }
    if (!identifiedName) {
        showQuickAddMessage('Najpierw zidentyfikuj się w Ustawieniach, żeby dodawać prezenty do swojej listy', 'danger');
        return;
    }

    const originalText = btn.innerHTML;
    // Label is visually hidden on mobile (icon-only round button)
    btn.innerHTML = '<span class="spinner-border spinner-border-sm" aria-hidden="true"></span><span class="quick-add-submit-label">Dodawanie…</span>';
    btn.disabled = true;
    let added = false;

    fetch('/api/formularz/present', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            recipientName: identifiedName,
            presentTitle: title,
            presentComments: comments
        })
    })
        .then(response => response.json())
        .then(data => {
            if (data.success) {
                added = true;
                input.value = '';
                if (commentsInput) commentsInput.value = '';
                if (window._resetQuickAddComposer) window._resetQuickAddComposer();
                showQuickAddMessage('Prezent dodany! 🎁', 'success');
                // Scroll to + flash the new item (newest first, so fall
                // back to the first item if the id isn't returned)
                loadMyPresents(data.presentId || 'first');
            } else {
                showQuickAddMessage(data.error || 'Błąd podczas dodawania prezentu', 'danger');
            }
        })
        .catch(() => showQuickAddMessage('Błąd połączenia z serwerem', 'danger'))
        .finally(() => {
            btn.innerHTML = originalText;
            btn.disabled = false;
            // Back to the name field so several presents can be added in a row
            if (added && input) input.focus({ preventScroll: true });
        });
}

// ---- Quick add composer (thumb zone on mobile) ----
// On <=768px the quick add form is fixed just above the bottom tab bar.
// Keeps it above the tab bar (and the FAB poking out of it), follows the
// tab bar when it slides away, lifts above the on-screen keyboard via the
// visualViewport API, and reserves matching bottom padding on the page.
function setupQuickAddComposer() {
    const form = document.getElementById('quickAddForm');
    const toggle = document.getElementById('quickAddToggle');
    if (!form) return;
    const body = document.body;
    const mobileQuery = window.matchMedia('(max-width: 768px)');

    const nameInput = document.getElementById('quickAddTitle');
    const descInput = document.getElementById('quickAddComments');
    // Set when the user closes the description with the chevron - don't
    // auto-reopen it again for the same entry (reset on the next present)
    let descDismissed = false;

    function setDescExpanded(open) {
        if (toggle) {
            toggle.setAttribute('aria-expanded', String(open));
            toggle.setAttribute('aria-label', open ? 'Ukryj opis' : 'Dodaj opis (opcjonalnie)');
        }
        form.classList.toggle('is-expanded', open);
        updateComposerLayout();
    }

    function isDescExpanded() {
        return form.classList.contains('is-expanded');
    }

    // ---- Attention scrim ----
    // While the composer is active the rest of the page is dimmed so the
    // bright composer is the obvious place to look. Visual state only: a
    // dismissal never clears the fields and never collapses a description
    // the user typed into. Not a modal - no focus trap, no scroll lock.
    const scrim = document.getElementById('quickAddScrim');
    let blurTimer = null;
    let composerPointerAt = 0; // last pointerdown inside the composer
    let suppressActivateUntil = 0; // ignore refocus right after a dismissal

    function isComposerActive() {
        return body.classList.contains('quick-add-active');
    }

    function activateComposer() {
        if (Date.now() < suppressActivateUntil) return;
        clearTimeout(blurTimer);
        body.classList.add('quick-add-active');
    }

    function deactivateComposer(suppressMs) {
        clearTimeout(blurTimer);
        if (suppressMs) suppressActivateUntil = Date.now() + suppressMs;
        body.classList.remove('quick-add-active');
    }

    if (toggle) {
        toggle.addEventListener('click', () => {
            const open = !isDescExpanded();
            descDismissed = !open;
            setDescExpanded(open);
            if (open && descInput) descInput.focus({ preventScroll: true });
            // Collapsing with the chevron is a "done for now" signal
            else deactivateComposer(300);
        });
    }

    // Progressive disclosure: reveal the (optional, recommended)
    // description as soon as a name is typed. Focus stays in the name field.
    if (nameInput) {
        nameInput.addEventListener('input', () => {
            const hasName = nameInput.value.trim() !== '';
            if (hasName) {
                if (!isDescExpanded() && !descDismissed) setDescExpanded(true);
            } else {
                // Name cleared - back to the compact bar for the next present
                // (unless a description was already typed, so it isn't hidden)
                descDismissed = false;
                if (isDescExpanded() && !(descInput && descInput.value.trim())) {
                    setDescExpanded(false);
                }
            }
        });
    }

    // Enter adds a new line in the description; Ctrl/Cmd+Enter submits
    if (descInput) {
        descInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && !e.isComposing) {
                e.preventDefault();
                quickAddPresent();
            }
        });
    }

    // Active as soon as a composer field is focused (so the dimming
    // arrives together with the on-screen keyboard), and again when the
    // user starts typing after a dismissal.
    form.addEventListener('focusin', activateComposer);
    form.addEventListener('focusout', (e) => {
        // Moving between the composer's own controls keeps it active
        if (e.relatedTarget && form.contains(e.relatedTarget)) return;
        clearTimeout(blurTimer);
        blurTimer = setTimeout(() => {
            if (document.activeElement && form.contains(document.activeElement)) return;
            // iOS doesn't focus buttons on tap, so a tap on the chevron or
            // the "+" button arrives here as a plain blur - never dismiss
            // before those handlers (and the submit) have run
            if (Date.now() - composerPointerAt < 500) return;
            deactivateComposer();
        }, 150);
    });
    document.addEventListener('pointerdown', (e) => {
        if (form.contains(e.target)) composerPointerAt = Date.now();
    }, true);

    const onComposerInput = () => {
        suppressActivateUntil = 0;
        activateComposer();
    };
    if (nameInput) nameInput.addEventListener('input', onComposerInput);
    if (descInput) descInput.addEventListener('input', onComposerInput);

    // Escape leaves the composer: undim and drop the keyboard, but keep
    // whatever was typed (and keep the description open if it is open)
    document.addEventListener('keydown', (e) => {
        if (e.key !== 'Escape' || e.isComposing || !isComposerActive()) return;
        const el = document.activeElement;
        const inComposer = el && form.contains(el);
        // Some engines revert/clear an input's value on Escape
        if (inComposer) e.preventDefault();
        // No suppression window: blurring means nothing refocuses us, so a
        // deliberate tap back into the field must dim again right away
        deactivateComposer();
        if (inComposer && typeof el.blur === 'function') el.blur();
    });

    // A tap on the scrim dismisses; a drag on it is a scroll, so the list
    // stays scrollable (the scrim isn't scrollable itself, so touch
    // scrolling chains straight to the page - no scroll lock needed)
    if (scrim) {
        let tapX = 0;
        let tapY = 0;
        let tapAt = 0;
        if (window.PointerEvent) {
            scrim.addEventListener('pointerdown', (e) => {
                tapX = e.clientX;
                tapY = e.clientY;
                tapAt = Date.now();
            });
            scrim.addEventListener('pointerup', (e) => {
                if (Date.now() - tapAt > 700) return;
                if (Math.abs(e.clientX - tapX) > 12 || Math.abs(e.clientY - tapY) > 12) return;
                // The tap already blurred the field, so no suppression is
                // needed - tapping back into the composer dims again at once
                deactivateComposer();
            });
        } else {
            scrim.addEventListener('click', () => deactivateComposer());
        }
    }

    // Called after a successful add: compact state for the next present
    window._resetQuickAddComposer = () => {
        descDismissed = false;
        setDescExpanded(false);
        // Undim so the new item flashing in the list is visible. The
        // suppression window covers the programmatic refocus of the name
        // field; typing the next name dims again.
        deactivateComposer(600);
    };

    function tabBarOffset() {
        const bar = document.querySelector('.bottom-tab-bar');
        if (!bar || getComputedStyle(bar).display === 'none') return 12;
        const barStyle = getComputedStyle(bar);
        const inset = parseFloat(barStyle.bottom) || 0;
        // Bar slid away on scroll - let the composer drop into its place
        if (bar.classList.contains('tab-bar-hidden')) return Math.max(inset, 12);
        const fab = bar.querySelector('.tab-fab');
        const fabPoke = fab ? Math.max(0, -(parseFloat(getComputedStyle(fab).top) || 0)) : 0;
        return inset + bar.offsetHeight + fabPoke + 8;
    }

    function keyboardOffset() {
        const vv = window.visualViewport;
        if (!vv) return 0;
        // Part of the layout viewport covered by the keyboard
        const covered = window.innerHeight - (vv.height + vv.offsetTop);
        return covered > 60 ? covered : 0;
    }

    function updateComposerLayout() {
        // (offsetParent is always null for fixed elements - use client rects)
        const docked = mobileQuery.matches && form.getClientRects().length > 0 &&
            getComputedStyle(form).position === 'fixed';
        body.classList.toggle('quick-add-docked', docked);
        if (!docked) {
            // Desktop, or the edit tab was left - never leave the page dimmed
            deactivateComposer();
            return;
        }
        const kb = keyboardOffset();
        const bottom = Math.max(tabBarOffset(), kb ? kb + 8 : 0);
        form.style.setProperty('--quick-add-bottom', bottom + 'px');
        body.style.setProperty('--quick-add-bottom', bottom + 'px');
        body.style.setProperty('--quick-add-h', form.offsetHeight + 'px');
    }

    window._updateQuickAddComposer = updateComposerLayout;

    if (window.ResizeObserver) {
        new ResizeObserver(updateComposerLayout).observe(form);
    }
    if (window.visualViewport) {
        window.visualViewport.addEventListener('resize', updateComposerLayout);
        window.visualViewport.addEventListener('scroll', updateComposerLayout);
    }
    window.addEventListener('resize', updateComposerLayout);
    if (mobileQuery.addEventListener) mobileQuery.addEventListener('change', updateComposerLayout);

    // Tab bar is injected/hidden by other scripts - follow its class changes
    const watchBar = () => {
        const bar = document.querySelector('.bottom-tab-bar');
        if (bar && window.MutationObserver) {
            new MutationObserver(updateComposerLayout).observe(bar, { attributes: true, attributeFilter: ['class', 'style'] });
        }
    };
    watchBar();

    // #editTab is shown/hidden via inline style - re-check when that happens
    const editTab = document.getElementById('editTab');
    if (editTab && window.MutationObserver) {
        new MutationObserver(updateComposerLayout).observe(editTab, { attributes: true, attributeFilter: ['style', 'class'] });
    }

    updateComposerLayout();
}

// Scroll a list item into the part of the screen the composer and the
// on-screen keyboard leave visible, then flash it briefly
function revealNewPresent(item) {
    if (!item) return;
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const vv = window.visualViewport;
    const form = document.getElementById('quickAddForm');
    const viewTop = (vv ? vv.offsetTop : 0) + 12;
    let viewBottom = vv ? vv.offsetTop + vv.height : window.innerHeight;
    if (form && getComputedStyle(form).position === 'fixed') {
        viewBottom = Math.min(viewBottom, form.getBoundingClientRect().top);
    }
    viewBottom -= 12;
    const rect = item.getBoundingClientRect();
    let delta = 0;
    if (rect.top < viewTop) delta = rect.top - viewTop;
    else if (rect.bottom > viewBottom) delta = rect.bottom - viewBottom;
    if (delta) window.scrollBy({ top: delta, behavior: reduceMotion ? 'auto' : 'smooth' });

    item.classList.remove('is-new');
    void item.offsetWidth; // restart the animation
    item.classList.add('is-new');
    setTimeout(() => item.classList.remove('is-new'), 2600);
}

// "3 prezenty" badge next to the "Moje prezenty" heading
function updateMyPresentsCount(count) {
    const badge = document.getElementById('myPresentsCount');
    if (!badge) return;
    if (typeof count !== 'number') {
        count = document.querySelectorAll('#myPresentsList .my-present-item').length;
    }
    badge.textContent = typeof window.plCount === 'function'
        ? window.plCount(count, 'prezent', 'prezenty', 'prezentów')
        : String(count);
    badge.hidden = false;
}

function showQuickAddMessage(message, type) {
    const el = document.getElementById('quickAddMessage');
    if (!el) return;
    el.textContent = message;
    el.className = `alert alert-${type} quick-add-message`;
    el.style.display = 'block';
    clearTimeout(el._hideTimer);
    if (type === 'success') {
        el._hideTimer = setTimeout(() => { el.style.display = 'none'; }, 4000);
    }
}

function showFormMessage(message, type, withEditLink = false) {
    const formMessage = document.getElementById('formMessage');
    formMessage.textContent = message;

    // Optional inline jump to the edit view (only for logged-in users)
    if (withEditLink && currentUser) {
        const link = document.createElement('a');
        link.href = '#';
        link.className = 'fw-semibold ms-2 text-decoration-none';
        link.style.whiteSpace = 'nowrap';
        link.innerHTML = '<i class="fas fa-edit me-1"></i>Edytuj moje prezenty';
        link.addEventListener('click', (e) => {
            e.preventDefault();
            formMessage.style.display = 'none';
            switchTab('edit');
        });
        formMessage.appendChild(link);
    }

    formMessage.className = `alert alert-${type} mt-3`;
    formMessage.style.display = 'block';
    
    // Auto-hide success messages after 5 seconds (longer when there's an
    // action link so it can actually be used)
    if (type === 'success') {
        setTimeout(() => {
            formMessage.style.display = 'none';
        }, withEditLink ? 8000 : 5000);
    }
}

function toggleAuthForm(event) {
    event.preventDefault();
    const loginSection = document.getElementById('loginSection');
    const registerSection = document.getElementById('registerSection');
    
    if (loginSection.style.display === 'none') {
        loginSection.style.display = 'block';
        registerSection.style.display = 'none';
    } else {
        loginSection.style.display = 'none';
        registerSection.style.display = 'block';
    }
    
    // Clear auth message
    document.getElementById('authMessage').style.display = 'none';
}

function modalLogin() {
    const username = document.getElementById('modalUsername').value.trim();
    const password = document.getElementById('modalPassword').value;
    const authMessage = document.getElementById('authMessage');
    
    if (!username || !password) {
        showAuthMessage('Proszę wypełnić wszystkie pola', 'danger');
        return;
    }
    
    const submitBtn = document.querySelector('#modalLoginForm button[type="submit"]');
    const originalText = submitBtn.innerHTML;
    submitBtn.innerHTML = '<span class="spinner-border spinner-border-sm me-2"></span>Logowanie...';
    submitBtn.disabled = true;
    
    fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
    })
    .then(response => response.json())
    .then(data => {
        if (data.success) {
            currentUser = data.user;
            authModal.hide();
            switchTab('edit');
        } else {
            showAuthMessage(data.error || 'Błąd logowania', 'danger');
        }
    })
    .catch(error => {
        console.error('Login error:', error);
        showAuthMessage('Błąd połączenia z serwerem', 'danger');
    })
    .finally(() => {
        submitBtn.innerHTML = originalText;
        submitBtn.disabled = false;
    });
}

function modalRegister() {
    const username = document.getElementById('modalRegUsername').value.trim();
    const password = document.getElementById('modalRegPassword').value;
    const confirmPassword = document.getElementById('modalConfirmPassword').value;
    
    if (!username || !password || !confirmPassword) {
        showAuthMessage('Proszę wypełnić wszystkie pola', 'danger');
        return;
    }
    
    if (password !== confirmPassword) {
        showAuthMessage('Hasła nie są identyczne', 'danger');
        return;
    }
    
    const submitBtn = document.querySelector('#modalRegisterForm button[type="submit"]');
    const originalText = submitBtn.innerHTML;
    submitBtn.innerHTML = '<span class="spinner-border spinner-border-sm me-2"></span>Rejestracja...';
    submitBtn.disabled = true;
    
    fetch('/api/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
    })
    .then(response => response.json())
    .then(data => {
        if (data.success) {
            // Auto-login after registration
            return fetch('/api/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username, password })
            }).then(r => r.json());
        } else {
            throw new Error(data.error || 'Błąd rejestracji');
        }
    })
    .then(data => {
        if (data.success) {
            currentUser = data.user;
            authModal.hide();
            switchTab('edit');
        } else {
            showAuthMessage(data.error || 'Błąd logowania', 'danger');
        }
    })
    .catch(error => {
        console.error('Register error:', error);
        showAuthMessage(error.message || 'Błąd połączenia z serwerem', 'danger');
    })
    .finally(() => {
        submitBtn.innerHTML = originalText;
        submitBtn.disabled = false;
    });
}

function showAuthMessage(message, type) {
    const authMessage = document.getElementById('authMessage');
    authMessage.textContent = message;
    authMessage.className = `alert alert-${type} mt-3`;
    authMessage.style.display = 'block';
}

// highlightId: id of a just-added present to scroll to and flash
// ('first' = the newest item, the list is sorted newest first)
function loadMyPresents(highlightId) {
    const myPresentsList = document.getElementById('myPresentsList');
    // Keep the old list (and scroll position) while refreshing after an add
    if (!highlightId) {
        myPresentsList.innerHTML = '<div class="text-center"><div class="spinner-border" role="status"><span class="visually-hidden">Ładowanie...</span></div></div>';
    }
    
    return fetch('/api/formularz/my-presents')
        .then(response => response.json())
        .then(data => {
            console.log('[Load My Presents] Received data:', data);
            if (data.presents && data.presents.length > 0) {
                console.log('[Load My Presents] First present:', data.presents[0]);
                displayMyPresents(data.presents);
                if (highlightId) {
                    const item = highlightId === 'first'
                        ? myPresentsList.querySelector('.my-present-item')
                        : myPresentsList.querySelector(`.my-present-item[data-present-id="${Number(highlightId)}"]`);
                    revealNewPresent(item || myPresentsList.querySelector('.my-present-item'));
                }
            } else {
                updateMyPresentsCount(0);
                myPresentsList.innerHTML = `
                    <div class="text-center py-5">
                        <i class="fas fa-gift fa-3x text-muted mb-3"></i>
                        <h5 class="text-muted">Nie masz jeszcze żadnych prezentów</h5>
                        <p class="text-muted">Wpisz nazwę prezentu w polu „Nazwa prezentu…”, aby dodać pierwszy</p>
                        <button class="btn btn-primary mt-3" onclick="switchTab('add', true)">
                            <i class="fas fa-plus me-2"></i>Dodaj prezent
                        </button>
                    </div>
                `;
            }
        })
        .catch(error => {
            console.error('Error loading presents:', error);
            myPresentsList.innerHTML = `
                <div class="alert alert-danger">
                    <i class="fas fa-exclamation-circle me-2"></i>Błąd podczas ładowania prezentów
                </div>
            `;
        });
}

// Last rendered presents by id (used by the "+ Dodaj szczegóły" chip)
let myPresentsById = new Map();

function displayMyPresents(presents) {
    const myPresentsList = document.getElementById('myPresentsList');
    setupAddDetailsChip(myPresentsList);
    myPresentsById = new Map(presents.map(p => [String(p.id), p]));
    
    let html = '<div class="list-group" style="gap: 0;">';
    
    presents.forEach(present => {
        const hasComments = !!(present.comments && String(present.comments).trim());
        const titleHasLink = /https?:\/\//i.test(present.title || '');
        // Nudge towards details only when there's nothing beyond the name
        const addDetailsChip = (!hasComments && !titleHasLink)
            ? `<button type="button" class="my-present-add-details" data-add-details="${present.id}"
                       aria-label="Dodaj szczegóły do: ${escapeAttr(present.title)}">
                   <i class="fas fa-plus" aria-hidden="true"></i>Dodaj szczegóły
               </button>`
            : '';
        html += `
            <div class="list-group-item my-present-item" data-present-id="${present.id}">
                <div class="d-flex justify-content-between align-items-start my-present-row">
                    <div class="flex-grow-1 my-present-body">
                        <h6 class="mb-1 my-present-title">${makeLinksClickable(escapeHtml(present.title))}</h6>
                        ${hasComments ? `<p class="mb-1 my-present-comments">${makeLinksClickable(escapeHtml(present.comments))}</p>` : ''}
                        ${addDetailsChip}
                        <small class="my-present-date">
                            <i class="fas fa-calendar me-1"></i>${formatDate(present.created_at)}
                        </small>
                    </div>
                    <div class="btn-group-vertical ms-2 my-present-actions">
                        <button class="btn btn-sm btn-outline-primary" aria-label="Edytuj prezent" onclick="openEditPresentModal(${present.id}, '${escapeHtml(present.title)}', '${escapeHtml(present.comments || '')}', ${present.recipient_id})">
                            <i class="fas fa-edit"></i>
                        </button>
                        <button class="btn btn-sm btn-outline-danger" aria-label="Usuń prezent" onclick="deletePresent(${present.id})">
                            <i class="fas fa-trash"></i>
                        </button>
                    </div>
                </div>
            </div>
        `;
    });
    
    html += '</div>';
    myPresentsList.innerHTML = html;
    updateMyPresentsCount(presents.length);
}

// One delegated listener on the list container (survives re-renders):
// the chip opens the existing edit modal with the description focused
function setupAddDetailsChip(list) {
    if (!list || list._addDetailsBound) return;
    list._addDetailsBound = true;
    list.addEventListener('click', (e) => {
        const chip = e.target.closest('[data-add-details]');
        if (!chip || !list.contains(chip)) return;
        const present = myPresentsById.get(chip.getAttribute('data-add-details'));
        if (!present) return;
        openEditPresentModal(present.id, present.title, present.comments || '', present.recipient_id, true);
    });
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
            return `<li style="margin: 4px 0; padding-left: 0; display: flex; align-items: center; min-width: 0;"><span style="margin-right: 4px; flex-shrink: 0;">🔗</span><a href="${cleanUrl}" class="my-present-link" title="${escapeHtml(cleanUrl)}" target="_blank" rel="noopener noreferrer" style="color: #0D47A1; text-decoration: underline; display: block; min-width: 0; max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${escapeHtml(displayText)}</a></li>`;
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

function openEditPresentModal(id, title, comments, recipientId, focusComments) {
    console.log('[Edit Modal] Opening with:', { id, title, comments, recipientId });
    document.getElementById('editPresentId').value = id;
    document.getElementById('editPresentTitle').value = title;
    document.getElementById('editPresentComments').value = comments;
    document.getElementById('editRecipientSelect').value = recipientId;
    console.log('[Edit Modal] Set recipientId to:', document.getElementById('editRecipientSelect').value);
    document.getElementById('editPresentMessage').style.display = 'none';
    if (focusComments) {
        const modalEl = document.getElementById('editPresentModal');
        modalEl.addEventListener('shown.bs.modal', () => {
            const ta = document.getElementById('editPresentComments');
            ta.focus();
            const end = ta.value.length;
            ta.setSelectionRange(end, end);
        }, { once: true });
    }
    editPresentModal.show();
}

function saveEditedPresent() {
    const id = document.getElementById('editPresentId').value;
    const title = document.getElementById('editPresentTitle').value.trim();
    const comments = document.getElementById('editPresentComments').value.trim();
    const recipientId = document.getElementById('editRecipientSelect').value;
    
    console.log('[Save Edit] Saving with recipientId:', recipientId);
    
    if (!title) {
        showEditMessage('Nazwa prezentu jest wymagana', 'danger');
        return;
    }
    
    const submitBtn = document.querySelector('#editPresentModal .btn-success');
    const originalText = submitBtn.innerHTML;
    submitBtn.innerHTML = '<span class="spinner-border spinner-border-sm me-2"></span>Zapisywanie...';
    submitBtn.disabled = true;
    
    fetch(`/api/presents/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            title: title,
            comments: comments,
            recipient_id: recipientId || null
        })
    })
    .then(response => response.json())
    .then(data => {
        if (data.success) {
            editPresentModal.hide();
            loadMyPresents();
        } else {
            showEditMessage(data.error || 'Błąd podczas zapisywania', 'danger');
        }
    })
    .catch(error => {
        console.error('Error saving present:', error);
        showEditMessage('Błąd połączenia z serwerem', 'danger');
    })
    .finally(() => {
        submitBtn.innerHTML = originalText;
        submitBtn.disabled = false;
    });
}

function showEditMessage(message, type) {
    const editMessage = document.getElementById('editPresentMessage');
    editMessage.textContent = message;
    editMessage.className = `alert alert-${type} mt-3`;
    editMessage.style.display = 'block';
}

function deletePresent(id) {
    if (!confirm('Czy na pewno chcesz usunąć ten prezent?')) {
        return;
    }

    // Smart update: collapse the row immediately instead of reloading the
    // whole list (no spinner, no scroll jump); restore it if the server
    // declines
    const item = document.querySelector(`#myPresentsList .list-group-item[data-present-id="${id}"]`);
    let restore = null;
    if (item) {
        restore = {
            parent: item.parentElement,
            nextSibling: item.nextElementSibling,
            node: item
        };
        item.style.transition = 'opacity 0.25s ease, transform 0.25s ease';
        item.style.opacity = '0';
        item.style.transform = 'translateX(12px)';
        setTimeout(() => {
            item.remove();
            updateMyPresentsCount();
            // Last present gone - swap in the empty state in place
            const list = document.querySelector('#myPresentsList .list-group');
            if (list && list.children.length === 0) {
                renderMyPresentsEmptyState();
            }
        }, 250);
    }

    fetch(`/api/presents/${id}`, {
        method: 'DELETE'
    })
    .then(response => response.json())
    .then(data => {
        if (data.success) {
            // Confirmed - if the row was somehow not found in the DOM,
            // fall back to a full refresh so the view stays truthful
            if (!item) loadMyPresents();
        } else {
            undoRemoveMyPresent(restore);
            alert(data.error || 'Błąd podczas usuwania prezentu');
        }
    })
    .catch(error => {
        console.error('Error deleting present:', error);
        undoRemoveMyPresent(restore);
        alert('Błąd połączenia z serwerem');
    });
}

// Put a removed row back (delete failed)
function undoRemoveMyPresent(restore) {
    if (!restore || !restore.parent) {
        loadMyPresents();
        return;
    }
    const { parent, nextSibling, node } = restore;
    node.style.opacity = '1';
    node.style.transform = 'none';
    // The empty state may have replaced the list - rebuild via reload then
    if (!document.body.contains(parent)) {
        loadMyPresents();
        return;
    }
    if (nextSibling && parent.contains(nextSibling)) {
        parent.insertBefore(node, nextSibling);
    } else {
        parent.appendChild(node);
    }
    updateMyPresentsCount();
}

// Empty state shown in place when the last present is removed
function renderMyPresentsEmptyState() {
    const myPresentsList = document.getElementById('myPresentsList');
    if (!myPresentsList) return;
    myPresentsList.innerHTML = `
        <div class="text-center py-5">
            <i class="fas fa-gift fa-3x text-muted mb-3"></i>
            <h5 class="text-muted">Nie masz jeszcze żadnych prezentów</h5>
            <p class="text-muted">Wpisz nazwę prezentu w polu „Nazwa prezentu…”, aby dodać pierwszy</p>
        </div>
    `;
    updateMyPresentsCount(0);
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// escapeHtml leaves quotes alone - also escape them for attribute values
function escapeAttr(text) {
    return escapeHtml(text == null ? '' : String(text))
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function formatDate(dateString) {
    const date = new Date(dateString);
    return date.toLocaleDateString('pl-PL', {
        year: 'numeric',
        month: 'long',
        day: 'numeric'
    });
}
