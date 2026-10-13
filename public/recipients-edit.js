function openChangePictureModal(recipientId) {
    // Store the recipient ID for later use
    window.currentChangingRecipientId = recipientId;

    const modal = document.getElementById('changePictureModal');
    if (!modal) {
        console.error('Change picture modal not found');
        return;
    }

    // Clear previous form
    document.getElementById('changePictureForm').reset();
    document.getElementById('imagePreview').style.display = 'none';

    // Show the modal
    const bootstrapModal = new bootstrap.Modal(modal);
    bootstrapModal.show();

    // Add event listener for file input
    const fileInput = document.getElementById('newProfilePicture');
    fileInput.onchange = function () {
        const file = this.files[0];
        if (file) {
            // Show compressed preview
            compressImage(file, 600, 600, 0.6)
                .then(compressedDataUrl => {
                    document.getElementById('previewImage').src = compressedDataUrl;
                    document.getElementById('imagePreview').style.display = 'block';
                })
                .catch(error => {
                    console.error('Error compressing preview:', error);
                    // Fallback to original if compression fails
                    const reader = new FileReader();
                    reader.onload = function (e) {
                        document.getElementById('previewImage').src = e.target.result;
                        document.getElementById('imagePreview').style.display = 'block';
                    };
                    reader.readAsDataURL(file);
                });
        }
    };
}

function saveNewProfilePicture() {
    const fileInput = document.getElementById('newProfilePicture');
    const file = fileInput.files[0];
    const recipientId = window.currentChangingRecipientId;

    if (!file || !recipientId) {
        alert('Proszę wybrać zdjęcie');
        return;
    }

    // Check file size (10MB limit for original file)
    const maxSize = 10 * 1024 * 1024; // 10MB in bytes
    if (file.size > maxSize) {
        alert('Plik jest zbyt duży. Maksymalny rozmiar to 10MB.');
        return;
    }

    // Compress image before upload (smaller size and lower quality for better compression)
    compressImage(file, 600, 600, 0.6)
        .then(compressedDataUrl => {
            const sizeKB = (compressedDataUrl.length / 1024).toFixed(2);
            const sizeMB = (compressedDataUrl.length / 1024 / 1024).toFixed(2);
            console.log('Image compressed successfully');
            console.log('- Base64 string length:', compressedDataUrl.length);
            console.log('- Size:', sizeKB, 'KB (', sizeMB, 'MB)');

            // Check compressed size (base64 string length / 1.37 ≈ actual bytes)
            const estimatedSize = compressedDataUrl.length * 0.75; // rough estimate
            const maxSize = 40 * 1024 * 1024; // 40MB limit for base64

            if (estimatedSize > maxSize) {
                throw new Error('Skompresowany obraz jest nadal zbyt duży. Spróbuj użyć mniejszego zdjęcia.');
            }

            console.log('Sending image to server...');

            // Send compressed image as JSON
            return fetch(`/api/recipients/${recipientId}/profile-picture`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ profile_picture: compressedDataUrl })
            });
        })
        .then(response => {
            console.log('Server response status:', response.status);
            if (!response.ok) {
                if (response.status === 413) {
                    throw new Error('Plik jest zbyt duży. Maksymalny rozmiar to 10MB.');
                }
                return response.json().then(data => {
                    console.error('Server error:', data);
                    throw new Error(data.error || 'Błąd podczas zapisywania zdjęcia');
                }).catch(err => {
                    console.error('Failed to parse error response:', err);
                    throw new Error(`Błąd serwera (${response.status})`);
                });
            }
            return response.json();
        })
        .then(data => {
            console.log('Server response data:', data);
            if (data.success) {
                // Close the modal
                const modal = document.getElementById('changePictureModal');
                const bootstrapModal = bootstrap.Modal.getInstance(modal);
                bootstrapModal.hide();

                // Refresh the recipients list
                softReloadRecipients();

                // Show success message
                alert('Zdjęcie profilowe zostało zaktualizowane');
            } else {
                alert('Błąd podczas aktualizacji zdjęcia: ' + (data.error || 'Nieznany błąd'));
            }
        })
        .catch(error => {
            console.error('Error uploading profile picture:', error);
            alert(error.message || 'Błąd podczas aktualizacji zdjęcia');
        });
}

function openProfilePicturePreview(recipientId) {
    const recipient = window._allRecipients.find(r => r.id === recipientId);
    if (!recipient) return;

    const modal = document.getElementById('profilePreviewModal');
    const previewImage = document.getElementById('profilePreviewImage');
    const previewName = document.getElementById('profilePreviewName');
    const previewEmoji = document.getElementById('profilePreviewEmoji');

    if (modal && previewImage && previewName) {
        const hasPicture = recipient.profile_picture && recipient.profile_picture.trim() !== '';
        if (hasPicture) {
            previewImage.src = getFullProfilePictureUrl(recipient.profile_picture);
            previewImage.style.display = '';
            if (previewEmoji) previewEmoji.style.display = 'none';
        } else {
            // Emoji avatar - show it big instead of a photo
            previewImage.style.display = 'none';
            if (previewEmoji) {
                previewEmoji.textContent = getEmojiAvatar(recipient.name);
                previewEmoji.style.display = 'block';
            }
        }
        previewName.textContent = recipient.name;

        // "Send anonymous message" - only for people with an account
        // (identified) and not for yourself
        const msgLink = document.getElementById('profilePreviewMessageLink');
        if (msgLink) {
            const uid = Number(window._currentUserId || currentUserId);
            if (recipient.identified_by && Number(recipient.identified_by) !== uid) {
                msgLink.href = '/wiadomosci?do=' + recipient.identified_by;
                msgLink.style.display = 'inline-block';
            } else {
                msgLink.style.display = 'none';
            }
        }

        const bootstrapModal = new bootstrap.Modal(modal);
        bootstrapModal.show();
    }
}

// Edit present function
function editPresent(presentId, title, recipientId, comments) {
    console.log('Editing present:', { presentId, title, recipientId, comments });

    // Set the form values
    document.getElementById('editPresentId').value = presentId;
    document.getElementById('editPresentTitle').value = title;
    document.getElementById('editPresentComments').value = comments || '';

    // Populate recipient select
    populateEditRecipientSelect(recipientId);

    // Show the modal
    const modal = new bootstrap.Modal(document.getElementById('editPresentModal'));
    modal.show();
}

function populateEditRecipientSelect(selectedRecipientId) {
    const select = document.getElementById('editRecipientSelect');
    select.innerHTML = '<option value="">Wybierz osobę</option>';

    // Use cached recipients if available
    const recipients = window._cachedRecipients || (window._dataCache && window._dataCache.recipients) || [];
    console.log('[Edit Modal] Populating recipients:', recipients.length, 'selected:', selectedRecipientId);

    recipients.forEach(recipient => {
        const option = document.createElement('option');
        option.value = recipient.id;
        option.textContent = recipient.name;
        if (recipient.id == selectedRecipientId) { // Use == for loose comparison
            option.selected = true;
        }
        select.appendChild(option);
    });
}

function saveEditedPresent() {
    const presentId = document.getElementById('editPresentId').value;
    const title = document.getElementById('editPresentTitle').value.trim();
    const recipientId = document.getElementById('editRecipientSelect').value;
    const comments = document.getElementById('editPresentComments').value.trim();

    if (!title) {
        showEditPresentMessage('Nazwa prezentu jest wymagana', 'danger');
        return;
    }

    if (!recipientId) {
        showEditPresentMessage('Wybierz osobę', 'danger');
        return;
    }

    // Show loading state
    showEditPresentMessage('Zapisywanie...', 'info');

    fetch(`/api/presents/${presentId}`, {
        method: 'PUT',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            title,
            recipient_id: recipientId,
            comments: comments || null
        })
    })
        .then(response => response.json())
        .then(data => {
            if (data.success) {
                showEditPresentMessage('Prezent został zaktualizowany!', 'success');

                // Update the present in the DOM immediately
                updatePresentInDOM(presentId, title, comments);

                // Update cache
                if (window._dataCache && window._dataCache.presents) {
                    const present = window._dataCache.presents.find(p => p.id == presentId);
                    if (present) {
                        present.title = title;
                        present.comments = comments;
                        present.recipient_id = recipientId;
                    }
                }

                // Update notifications to reflect the new title
                updateNotificationsForEditedPresent(presentId, title);

                // Close modal and refresh cache in background
                setTimeout(() => {
                    const modal = bootstrap.Modal.getInstance(document.getElementById('editPresentModal'));
                    modal.hide();
                    softReloadRecipients();
                }, 1000);
            } else {
                showEditPresentMessage(data.error || 'Błąd podczas aktualizacji prezentu', 'danger');
            }
        })
        .catch(error => {
            console.error('Error updating present:', error);
            showEditPresentMessage('Błąd podczas aktualizacji prezentu', 'danger');
        });
}

function showEditPresentMessage(message, type) {
    const messageDiv = document.getElementById('editPresentMessage');
    messageDiv.className = `alert alert-${type} mt-3`;
    messageDiv.textContent = message;
    messageDiv.style.display = 'block';

    if (type === 'success') {
        setTimeout(() => {
            messageDiv.style.display = 'none';
        }, 3000);
    }
}

// Add deletePresent function if not present
if (typeof window.deletePresent !== 'function') {
    window.deletePresent = function (presentId, presentTitle, recipientId) {
        if (!confirm(`Czy na pewno chcesz usunąć prezent: "${presentTitle}"?`)) return;
        fetch(`/api/presents/${presentId}`, { method: 'DELETE' })
            .then(res => res.json())
            .then(data => {
                if (data.success) {
                    showSuccessMessage('Prezent został usunięty.');

                    // Remove from DOM immediately
                    const presentElement = document.querySelector(`[data-id="${presentId}"]`);
                    if (presentElement) {
                        presentElement.style.transition = 'opacity 0.3s ease-out';
                        presentElement.style.opacity = '0';
                        setTimeout(() => {
                            presentElement.remove();
                        }, 300);
                    }

                    // Update cache
                    if (window._dataCache && window._dataCache.presents) {
                        window._dataCache.presents = window._dataCache.presents.filter(p => p.id != presentId);
                    }

                    // Cross out the present in notifications
                    updateNotificationsForDeletedPresent(presentId);

                    // Refresh cache in background
                    softReloadRecipients();
                } else {
                    showErrorModal(data.error || 'Błąd podczas usuwania prezentu');
                }
            })
            .catch(() => showErrorModal('Błąd połączenia z serwerem'));
    }
}

// Function to reorder presents list after animation
function reorderPresentsList() {
    const presentsList = document.querySelector('.presents-list');
    if (!presentsList) return;

    const presentItems = Array.from(presentsList.querySelectorAll('.present-item'));

    // Store original positions before sorting
    const originalPositions = new Map();
    presentItems.forEach((item, index) => {
        originalPositions.set(item, index);
    });

    // Sort items: unchecked first, then checked (state lives on the item
    // class now - the checkbox was replaced by action buttons)
    presentItems.sort((a, b) => {
        const aChecked = a.classList.contains('checked');
        const bChecked = b.classList.contains('checked');

        if (aChecked === bChecked) return 0;
        return aChecked ? 1 : -1; // Unchecked items first
    });

    // Reorder DOM elements, skipping animation for items that don't move
    presentItems.forEach((item, newIndex) => {
        const originalIndex = originalPositions.get(item);

        // Skip animation if item doesn't change position
        if (originalIndex === newIndex) {
            item.style.transition = 'none';
            presentsList.appendChild(item);
            // Restore transition after a brief delay
            setTimeout(() => {
                item.style.transition = '';
            }, 10);
        } else {
            presentsList.appendChild(item);
        }
    });
}

// Function to reorder modal presents list after animation
function reorderModalPresentsList() {
    const modalBody = document.querySelector('#reservedPresentsModal .card-body');
    if (!modalBody) return;

    const presentItems = Array.from(modalBody.querySelectorAll('.present-item-modal'));

    // Sort items: unchecked first, then checked
    presentItems.sort((a, b) => {
        const aChecked = a.querySelector('.form-check-input').checked;
        const bChecked = b.querySelector('.form-check-input').checked;

        if (aChecked === bChecked) return 0;
        return aChecked ? 1 : -1; // Unchecked items first
    });

    // Store original positions before sorting
    const originalPositions = new Map();
    presentItems.forEach((item, index) => {
        originalPositions.set(item, index);
    });

    // Sort items: unchecked first, then checked
    presentItems.sort((a, b) => {
        const aChecked = a.querySelector('.form-check-input').checked;
        const bChecked = b.querySelector('.form-check-input').checked;

        if (aChecked === bChecked) return 0;
        return aChecked ? 1 : -1; // Unchecked items first
    });

    // Reorder DOM elements, skipping animation for items that don't move
    presentItems.forEach((item, newIndex) => {
        const originalIndex = originalPositions.get(item);

        // Skip animation if item doesn't change position
        if (originalIndex === newIndex) {
            item.style.transition = 'none';
            modalBody.appendChild(item);
            // Restore transition after a brief delay
            setTimeout(() => {
                item.style.transition = '';
            }, 10);
        } else {
            modalBody.appendChild(item);
        }
    });
}

// Helper to get full profile picture URL
function getFullProfilePictureUrl(path) {
    if (!path) return '';
    if (path.startsWith('/uploads/')) {
        return 'https://prezenty.matmamon.com' + path;
    }
    return path;
}

// Helper to get a consistent emoji avatar based on name
function getEmojiAvatar(name) {
    const emojis = [
        '🎅', '🤶', '🎄', '⛄', '🎁',
        '🦌', '⭐', '🔔', '🕯️', '🎀',
        '🧑', '👨', '👩', '👦', '👧',
        '🐻', '🐱', '🐶', '🐼', '🦊',
        '🌟', '💫', '✨', '🎊', '🎉'
    ];

    // Generate a consistent index based on the name
    let hash = 0;
    for (let i = 0; i < name.length; i++) {
        hash = ((hash << 5) - hash) + name.charCodeAt(i);
        hash = hash & hash; // Convert to 32bit integer
    }

    const index = Math.abs(hash) % emojis.length;
    return emojis[index];
}
