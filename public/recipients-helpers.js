function formatCommentsPreview(comments) {
    if (!comments) return '';

    // Extract URLs first (including those with % and special chars)
    const urlPattern = /(https?:\/\/[^\s<>"{}|\\^`\[\]]+)/g;
    const urls = [];
    let match;
    while ((match = urlPattern.exec(comments)) !== null) {
        urls.push(match[1]);
    }

    // Remove URLs from text
    let textOnly = comments;
    urls.forEach(url => {
        textOnly = textOnly.replace(url, '');
    });

    // Clean up extra whitespace
    textOnly = textOnly.trim().replace(/\s+/g, ' ');

    // Escape the text portion
    let result = escapeHtml(textOnly);

    // Add URLs as list items if any exist
    if (urls.length > 0) {
        const linksList = urls.map(url => {
            // Clean trailing punctuation
            let cleanUrl = url.replace(/[.,;:!?)]+$/, '');

            // Shorten display text if too long
            let displayText = cleanUrl;
            if (cleanUrl.length > 60) {
                displayText = cleanUrl.substring(0, 57) + '...';
            }

            return `<li style="margin: 4px 0; padding-left: 0; display: flex; align-items: flex-start; gap: 8px;"><span style="margin-top: 2px; flex-shrink: 0;">🔗</span><a href="${cleanUrl}" target="_blank" rel="noopener noreferrer" style="color: #2196F3; text-decoration: underline; word-break: break-all;">${escapeHtml(displayText)}</a></li>`;
        }).join('');

        const urlList = `<ul style="margin: 8px 0 8px 0; padding-left: 0; list-style: none;">${linksList}</ul>`;

        if (result) {
            result += '<br>' + urlList;
        } else {
            result = urlList;
        }
    }

    return result;
}

function convertUrlsToLinks(text) {
    if (!text) return text;

    // Convert URLs to clickable links
    const urlRegex = /(https?:\/\/[^\s]+)/g;
    return text.replace(urlRegex, '<a href="$1" target="_blank" rel="noopener noreferrer">$1</a>');
}

function addRecipient() {
    const name = document.getElementById('recipientName').value.trim();

    if (!name) {
        showErrorModal('Nazwa jest wymagana');
        return;
    }

    fetch('/api/recipients', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({ name })
    })
        .then(response => response.json())
        .then(data => {
            if (data.success && data.recipient) {
                showSuccessMessage('Osoba została dodana!');
                document.getElementById('recipientForm').reset();
                softReloadRecipients();
            } else {
                showErrorModal(data.error || 'Błąd podczas dodawania osoby');
            }
        })
        .catch(error => {
            console.error('Error:', error);
            showErrorModal('Błąd połączenia z serwerem');
        });
}

function deleteRecipient(id, name) {
    // Pokaż modal potwierdzenia
    const modal = new bootstrap.Modal(document.getElementById('confirmDeleteRecipientModal'));
    document.getElementById('confirmDeleteRecipientModal').setAttribute('data-recipient-id', id);
    document.getElementById('confirmDeleteRecipientModal').setAttribute('data-recipient-name', name);
    document.getElementById('confirmDeleteRecipientModalBody').textContent = `Czy na pewno chcesz usunąć osobę "${name}"? Ta akcja nie może być cofnięta.`;
    modal.show();
}

// Funkcja do usunięcia osoby po potwierdzeniu
function deleteRecipientConfirmed() {
    const id = document.getElementById('confirmDeleteRecipientModal').getAttribute('data-recipient-id');
    const modal = bootstrap.Modal.getInstance(document.getElementById('confirmDeleteRecipientModal'));

    fetch(`/api/recipients/${id}`, {
        method: 'DELETE'
    })
        .then(response => response.json())
        .then(data => {
            if (data.success) {
                modal.hide();
                showSuccessMessage('Osoba została usunięta!');
                softReloadRecipients();
            } else {
                modal.hide();
                showErrorModal(data.error || 'Błąd podczas usuwania osoby');
            }
        })
        .catch(error => {
            console.error('Error:', error);
            modal.hide();
            showErrorModal('Błąd połączenia z serwerem');
        });
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// Escape for use inside quoted HTML attributes (escapeHtml leaves quotes as-is)
function escapeAttr(text) {
    return String(text == null ? '' : text)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

// Scalloped seal with a white check (inline SVG, scales with font-size).
// No <title> inside on purpose: it would end up in the name's textContent,
// which search/scroll code compares against the recipient name.
const VERIFIED_BADGE_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">' +
    '<polygon class="verified-badge-seal" points="12 1.8 14.17 3.89 17.1 3.17 17.94 6.06 20.83 6.9 20.11 9.83 22.2 12 20.11 14.17 20.83 17.1 17.94 17.94 17.1 20.83 14.17 20.11 12 22.2 9.83 20.11 6.9 20.83 6.06 17.94 3.17 17.1 3.89 14.17 1.8 12 3.89 9.83 3.17 6.9 6.06 6.06 6.9 3.17 9.83 3.89"/>' +
    '<path class="verified-badge-check" d="M7.6 12.3l3 3 5.8-6.2"/>' +
    '</svg>';

// Recipient name with a verification badge glued to its last word, so the
// badge never wraps onto a line of its own. Returns escaped HTML.
function recipientNameWithBadge(name, identifiedByName) {
    if (identifiedByName == null) return escapeHtml(name);
    const label = 'Potwierdzone przez: ' + identifiedByName;
    const badge = `<button type="button" class="verified-badge" aria-label="${escapeAttr(label)}" title="${escapeAttr(label)}" data-tooltip="${escapeAttr(label)}">${VERIFIED_BADGE_SVG}</button>`;
    const trimmed = String(name == null ? '' : name).trim();
    const cut = trimmed.lastIndexOf(' ') + 1;
    const lastWord = trimmed.slice(cut);
    // Very long single words must still be allowed to break, so only glue short ones
    if (lastWord.length > 18) return escapeHtml(trimmed) + badge;
    return `${escapeHtml(trimmed.slice(0, cut))}<span class="name-with-badge">${escapeHtml(lastWord)}${badge}</span>`;
}

// Tap/keyboard support for the badge tooltip (hover uses the title attribute)
document.addEventListener('click', (e) => {
    const badge = e.target.closest && e.target.closest('.verified-badge');
    document.querySelectorAll('.verified-badge.is-open').forEach(b => { if (b !== badge) b.classList.remove('is-open'); });
    if (badge) badge.classList.toggle('is-open');
});
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
        document.querySelectorAll('.verified-badge.is-open').forEach(b => b.classList.remove('is-open'));
    }
});
document.addEventListener('focusout', (e) => {
    if (e.target.classList && e.target.classList.contains('verified-badge')) e.target.classList.remove('is-open');
});

function convertUrlsToLinks(text) {
    // URL regex pattern
    const urlPattern = /(https?:\/\/[^\s<]+)/g;
    const urls = text.match(urlPattern);

    // If URLs found, display them on separate lines
    if (urls && urls.length > 0) {
        let result = text;
        const linksList = urls.map(url => {
            // Remove trailing punctuation
            let cleanUrl = url;
            const punctuation = /[.,;:!?)]+$/;
            const match = url.match(punctuation);
            if (match) {
                cleanUrl = url.slice(0, -match[0].length);
            }

            // Shorten display text if URL is too long
            let displayText = cleanUrl;
            if (cleanUrl.length > 50) {
                displayText = cleanUrl.substring(0, 47) + '...';
            }

            return `<a href="${cleanUrl}" class="present-link" title="${cleanUrl}" target="_blank" rel="noopener noreferrer" style="color: #1565C0; text-decoration: underline; display: block; max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${displayText}</a>`;
        }).join('<br>');

        // Replace all URLs with placeholder
        urls.forEach(url => {
            result = result.replace(url, '');
        });

        // Clean up extra spaces and add links at the end
        result = result.trim().replace(/\s+/g, ' ');
        if (result) {
            return result + '<br>' + linksList;
        } else {
            return linksList;
        }
    }

    // No URLs - return text as is
    return text;
}

