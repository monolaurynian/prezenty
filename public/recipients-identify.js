function identifyAsRecipient(recipientId, recipientName, hideDeleteButton = false) {
    pendingIdentificationRecipientId = recipientId;
    document.getElementById('identificationRecipientName').textContent = recipientName;

    // Show or hide the delete button
    const deleteBtn = document.querySelector('#selfIdentificationModal .btn-outline-danger');
    if (deleteBtn) {
        if (hideDeleteButton) {
            deleteBtn.style.display = 'none';
        } else {
            deleteBtn.style.display = 'inline-flex';
        }
    }

    const modal = new bootstrap.Modal(document.getElementById('selfIdentificationModal'));
    modal.show();
}

function confirmSelfIdentification() {
    if (!pendingIdentificationRecipientId) return;

    fetch(`/api/recipients/${pendingIdentificationRecipientId}/identify`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        }
    })
        .then(response => response.json())
        .then(data => {
            if (data.success) {
                showSuccessMessage('Pomyślnie zidentyfikowano!');
                clearRecipientsCache();
                softReloadRecipients();

                // Close the modal
                const modal = bootstrap.Modal.getInstance(document.getElementById('selfIdentificationModal'));
                modal.hide();
            } else {
                showErrorModal(data.error || 'Błąd podczas identyfikacji');
            }
        })
        .catch(error => {
            console.error('Error:', error);
            showErrorModal('Błąd połączenia z serwerem');
        });
}

function deleteRecipientFromModal() {
    if (!pendingIdentificationRecipientId) return;

    // Get the recipient name from the modal
    const recipientName = document.getElementById('identificationRecipientName').textContent;

    // Close the self-identification modal
    const modal = bootstrap.Modal.getInstance(document.getElementById('selfIdentificationModal'));
    modal.hide();

    // Show the confirmation modal
    document.getElementById('confirmDeleteRecipientModalBody').innerHTML = `
        <p>Czy na pewno chcesz usunąć osobę <strong>${escapeHtml(recipientName)}</strong>?</p>
        <p class="text-muted">Ta operacja jest nieodwracalna i usunie wszystkie prezenty tej osoby.</p>
    `;

    // Store the recipient ID for deletion
    window.pendingDeleteRecipientId = pendingIdentificationRecipientId;
    window.pendingDeleteRecipientName = recipientName;

    const confirmModal = new bootstrap.Modal(document.getElementById('confirmDeleteRecipientModal'));
    confirmModal.show();
}

function showRecipientSelectionModal() {
    console.log('showRecipientSelectionModal() called');

    // Close the self-identification modal and move focus out
    const selfIdentificationModal = bootstrap.Modal.getInstance(document.getElementById('selfIdentificationModal'));
    if (selfIdentificationModal) {
        console.log('Closing self-identification modal');
        // Move focus to body before hiding modal to prevent aria-hidden issues
        document.body.focus();
        selfIdentificationModal.hide();
    }

    // Load available recipients and show selection modal
    console.log('Fetching recipients for selection modal...');
    fetch('/api/recipients')
        .then(response => response.json())
        .then(recipients => {
            console.log('Recipients loaded for selection modal:', recipients);
            const availableRecipientsList = document.getElementById('availableRecipientsList');

            // Filter out already identified recipients
            const availableRecipients = recipients.filter(recipient => !recipient.identified_by);
            console.log('Available recipients (not identified):', availableRecipients);

            if (availableRecipients.length === 0) {
                availableRecipientsList.innerHTML = `
                <div class="alert alert-info">
                    <i class="fas fa-info-circle me-2"></i>
                    Wszystkie osoby są już zidentyfikowane. Dodaj nową osobę poniżej.
                </div>
            `;
            } else {
                availableRecipientsList.innerHTML = availableRecipients.map(recipient => `
                <div class="list-group-item list-group-item-action d-flex justify-content-between align-items-center">
                    <div style="cursor:pointer;" onclick="identifyAsRecipientFromSelection(${recipient.id}, ${PrezentyEscape.jsStringAttr(escapeHtml(recipient.name))})">
                        <i class="fas fa-user me-2"></i>
                        <strong class="recipient-name-clickable">${escapeHtml(recipient.name)}</strong>
                    </div>
                    <div class="d-flex gap-2">
                        <button class="btn btn-sm btn-success identify-btn-modal" onclick="identifyAsRecipientFromSelection(${recipient.id}, ${PrezentyEscape.jsStringAttr(escapeHtml(recipient.name))})">
                            <i class="fas fa-check me-1"></i>To jestem ja
                        </button>
                        <button class="btn btn-outline-danger btn-sm" style="width: 28%;" onclick="deleteRecipientFromSelection(${recipient.id}, ${PrezentyEscape.jsStringAttr(escapeHtml(recipient.name))})">
                            <i class="fas fa-trash"></i>
                        </button>
                        <style>
                        @media (max-width: 576px) {
                            .recipient-name-clickable ~ div > .btn-outline-success {
                                
                            width: 70% !important;
                                min-width: 110px;
                                margin-right: 2%;
                            }
                            .recipient-name-clickable ~ div > .btn-outline-danger {
                                width: 28% !important;
                                min-width: 40px;
                            }
                        }
                        </style>
                    </div>
                </div>
            `).join('');
            }

            // Show the selection modal
            console.log('Showing recipient selection modal...');
            const selectionModal = new bootstrap.Modal(document.getElementById('recipientSelectionModal'));
            selectionModal.show();
            console.log('Recipient selection modal should be visible now');
        })
        .catch(error => {
            console.error('Error loading recipients:', error);
            showErrorModal('Błąd podczas ładowania listy osób');
        });
}

function deleteRecipientFromSelection(recipientId, recipientName) {
    if (!confirm(`Czy na pewno chcesz usunąć osobę "${recipientName}"? Ta akcja nie może być cofnięta.`)) {
        return;
    }
    fetch(`/api/recipients/${recipientId}`, {
        method: 'DELETE'
    })
        .then(response => response.json())
        .then(data => {
            if (data.success) {
                showSuccessMessage('Osoba została usunięta!');
                showRecipientSelectionModal(); // Refresh the modal list
            } else {
                showErrorModal(data.error || 'Błąd podczas usuwania osoby');
            }
        })
        .catch(error => {
            console.error('Error:', error);
            showErrorModal('Błąd połączenia z serwerem');
        });
}

function identifyAsRecipientFromSelection(recipientId, recipientName) {
    // Close the selection modal and move focus out
    const selectionModal = bootstrap.Modal.getInstance(document.getElementById('recipientSelectionModal'));
    // Move focus to body before hiding modal to prevent aria-hidden issues
    document.body.focus();
    selectionModal.hide();

    // Identify as the selected recipient
    fetch(`/api/recipients/${recipientId}/identify`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        }
    })
        .then(response => response.json())
        .then(data => {
            if (data.success) {
                showSuccessMessage(`Pomyślnie zidentyfikowano jako ${recipientName}!`);
                softReloadRecipients();
            } else {
                showErrorModal(data.error || 'Błąd podczas identyfikacji');
            }
        })
        .catch(error => {
            console.error('Error:', error);
            showErrorModal('Błąd połączenia z serwerem');
        });
}

function addNewRecipientAndIdentify() {
    const newRecipientName = document.getElementById('newRecipientName').value.trim();

    if (!newRecipientName) {
        showModalMessage('recipientSelectionMessage', 'Wprowadź imię i nazwisko', 'danger');
        return;
    }

    // Use the atomic endpoint to add and identify in one step
    fetch('/api/user/identify', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({ name: newRecipientName })
    })
        .then(response => response.json())
        .then(data => {
            if (data.success) {
                // Close the selection modal and move focus out
                const selectionModal = bootstrap.Modal.getInstance(document.getElementById('recipientSelectionModal'));
                // Move focus to body before hiding modal to prevent aria-hidden issues
                document.body.focus();
                selectionModal.hide();

                showSuccessMessage(`Pomyślnie dodano i zidentyfikowano jako ${newRecipientName}!`);
                clearRecipientsCache();
                softReloadRecipients();
            } else {
                throw new Error(data.error || 'Błąd podczas dodawania osoby');
            }
        })
        .catch(error => {
            console.error('Error:', error);
            showModalMessage('recipientSelectionMessage', error.message || 'Błąd połączenia z serwerem', 'danger');
        });
}

function cancelIdentification(recipientId, recipientName) {
    pendingIdentificationRecipientId = recipientId;
    document.getElementById('cancelIdentificationRecipientName').textContent = recipientName;

    const modal = new bootstrap.Modal(document.getElementById('cancelIdentificationModal'));
    modal.show();
}

function confirmCancelIdentification() {
    if (!pendingIdentificationRecipientId) return;

    fetch(`/api/recipients/${pendingIdentificationRecipientId}/identify`, {
        method: 'DELETE',
        headers: {
            'Content-Type': 'application/json',
        }
    })
        .then(response => response.json())
        .then(data => {
            if (data.success) {
                showSuccessMessage('Identyfikacja została anulowana!');
                softReloadRecipients();

                // Close the modal
                const modal = bootstrap.Modal.getInstance(document.getElementById('cancelIdentificationModal'));
                modal.hide();
            } else {
                showErrorModal(data.error || 'Błąd podczas anulowania identyfikacji');
            }
        })
        .catch(error => {
            console.error('Error:', error);
            showErrorModal('Błąd połączenia z serwerem');
        });
}

function showErrorModal(message) {
    document.getElementById('errorModalMessage').textContent = message;
    const modal = new bootstrap.Modal(document.getElementById('errorModal'));
    modal.show();
}

function showSuccessMessage(message) {
    // Show success message as a temporary alert
    const alertDiv = document.createElement('div');
    alertDiv.className = 'alert alert-success alert-dismissible fade show position-fixed';
    alertDiv.style.cssText = 'top: 20px; right: 20px; z-index: 9999; min-width: 300px;';
    alertDiv.innerHTML = `
        <i class="fas fa-check-circle me-2"></i>${message}
        <button type="button" class="btn-close" data-bs-dismiss="alert"></button>
    `;
    document.body.appendChild(alertDiv);

    // Auto-remove after 3 seconds
    setTimeout(() => {
        if (alertDiv.parentNode) {
            alertDiv.remove();
        }
    }, 3000);
}

function openProfileModal(recipientId) {
    const recipient = window._allRecipients.find(r => r.id === recipientId);
    if (!recipient) return;

    const profileImg = document.getElementById('profileModalImage');
    const profileName = document.getElementById('profileModalName');

    if (profileImg && profileName) {
        profileName.textContent = recipient.name;

        if (recipient.profile_picture && recipient.profile_picture.trim() !== '') {
            profileImg.src = getFullProfilePictureUrl(recipient.profile_picture);
            profileImg.style.display = 'block';
        } else {
            // Show placeholder instead of image
            profileImg.style.display = 'none';
            const placeholder = document.createElement('div');
            placeholder.className = 'profile-picture-placeholder-large';
            placeholder.innerHTML = getEmojiAvatar(recipient.name);
            placeholder.style.width = '200px';
            placeholder.style.height = '200px';
            placeholder.style.fontSize = '8rem';
            placeholder.style.fontSize = '4rem';
            placeholder.style.margin = '0 auto';

            const container = profileImg.parentElement;
            // Remove any existing placeholder
            const existingPlaceholder = container.querySelector('.profile-picture-placeholder-large');
            if (existingPlaceholder) {
                existingPlaceholder.remove();
            }
            container.appendChild(placeholder);
        }

        const modal = new bootstrap.Modal(document.getElementById('profileModal'));
        modal.show();
    }
}

function previewImage(input) {
    const preview = document.getElementById('profilePicturePreview');
    const file = input.files[0];

    if (file) {
        // Show compressed preview
        compressImage(file, 600, 600, 0.6)
            .then(compressedDataUrl => {
                preview.src = compressedDataUrl;
                preview.style.display = 'block';
            })
            .catch(error => {
                console.error('Error compressing preview:', error);
                // Fallback to original if compression fails
                const reader = new FileReader();
                reader.onload = function (e) {
                    preview.src = e.target.result;
                    preview.style.display = 'block';
                };
                reader.readAsDataURL(file);
            });
    } else {
        preview.style.display = 'none';
    }
}

// Compress image before upload
function compressImage(file, maxWidth = 800, maxHeight = 800, quality = 0.8) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = function (e) {
            const img = new Image();
            img.onload = function () {
                const canvas = document.createElement('canvas');
                let width = img.width;
                let height = img.height;

                // Calculate new dimensions while maintaining aspect ratio
                if (width > height) {
                    if (width > maxWidth) {
                        height = Math.round((height * maxWidth) / width);
                        width = maxWidth;
                    }
                } else {
                    if (height > maxHeight) {
                        width = Math.round((width * maxHeight) / height);
                        height = maxHeight;
                    }
                }

                canvas.width = width;
                canvas.height = height;

                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0, width, height);

                // Convert to JPEG with quality compression
                const compressedDataUrl = canvas.toDataURL('image/jpeg', quality);
                resolve(compressedDataUrl);
            };
            img.onerror = reject;
            img.src = e.target.result;
        };
        reader.onerror = reject;
        reader.readAsDataURL(file);
    });
}

function saveProfilePicture() {
    if (!currentRecipientId) return;

    const url = document.getElementById('profilePictureUrl').value.trim();
    const file = document.getElementById('profilePictureFile').files[0];

    if (!url && !file) {
        showErrorModal('Wybierz plik lub wprowadź URL zdjęcia');
        return;
    }

    if (file) {
        // Check file size (10MB limit for original file)
        const maxSize = 10 * 1024 * 1024; // 10MB in bytes
        if (file.size > maxSize) {
            showErrorModal('Plik jest zbyt duży. Maksymalny rozmiar to 10MB.');
            return;
        }

        // Compress image before upload (smaller size and lower quality for better compression)
        compressImage(file, 600, 600, 0.6)
            .then(compressedDataUrl => {
                console.log('Image compressed successfully, size:', (compressedDataUrl.length / 1024).toFixed(2), 'KB');

                // Check compressed size
                const estimatedSize = compressedDataUrl.length * 0.75;
                const maxSize = 40 * 1024 * 1024; // 40MB limit for base64

                if (estimatedSize > maxSize) {
                    showErrorModal('Skompresowany obraz jest nadal zbyt duży. Spróbuj użyć mniejszego zdjęcia.');
                    return;
                }

                saveImageToServer(compressedDataUrl);
            })
            .catch(error => {
                console.error('Error compressing image:', error);
                showErrorModal('Błąd podczas przetwarzania obrazu');
            });
    } else if (url) {
        // Handle URL
        saveImageToServer(url);
    }
}

function saveImageToServer(imageData) {
    fetch(`/api/recipients/${currentRecipientId}/profile-picture`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({ profile_picture: imageData })
    })
        .then(response => {
            if (!response.ok) {
                if (response.status === 413) {
                    throw new Error('Plik jest zbyt duży. Maksymalny rozmiar to 10MB.');
                }
                return response.json().then(data => {
                    throw new Error(data.error || 'Błąd podczas zapisywania zdjęcia');
                });
            }
            return response.json();
        })
        .then(data => {
            if (data.success) {
                showSuccessMessage('Zdjęcie profilowe zostało zapisane!');
                softReloadRecipients();

                // Close the modal
                const modal = bootstrap.Modal.getInstance(document.getElementById('profilePictureModal'));
                modal.hide();
            } else {
                showErrorModal(data.error || 'Błąd podczas zapisywania zdjęcia');
            }
        })
        .catch(error => {
            console.error('Error:', error);
            showErrorModal(error.message || 'Błąd połączenia z serwerem');
        });
}

