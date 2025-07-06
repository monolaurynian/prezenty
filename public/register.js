document.addEventListener('DOMContentLoaded', function() {
    const registerForm = document.getElementById('registerForm');
    const errorMessage = document.getElementById('registerMessage');

    registerForm.addEventListener('submit', function(e) {
        e.preventDefault();
        const username = document.getElementById('username').value;
        const password = document.getElementById('password').value;
        const confirmPassword = document.getElementById('confirmPassword').value;
        
        // Clear previous error
        errorMessage.style.display = 'none';
        
        // Validate passwords match
        if (password !== confirmPassword) {
            showError('Hasła nie są identyczne');
            return;
        }
        
        // Validate password length
        if (password.length < 6) {
            showError('Hasło musi mieć co najmniej 6 znaków');
            return;
        }
        
        // Validate username
        if (username.length < 3) {
            showError('Nazwa użytkownika musi mieć co najmniej 3 znaki');
            return;
        }
        const submitBtn = registerForm.querySelector('button[type="submit"]');
        const originalText = submitBtn.innerHTML;
        submitBtn.innerHTML = '<span class="spinner-border spinner-border-sm me-2"></span>Rejestracja...';
        submitBtn.disabled = true;
        fetch('/api/register', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password })
        })
        .then(response => response.json().then(data => ({ status: response.status, body: data })))
        .then(({ status, body }) => {
            if (status === 200 && body.success) {
                // Redirect to presents page after successful registration
                window.location.href = '/recipients';
            } else {
                showError(body.error || 'Błąd rejestracji');
            }
        })
        .catch(error => {
            showError('Błąd połączenia z serwerem');
        })
        .finally(() => {
            submitBtn.innerHTML = originalText;
            submitBtn.disabled = false;
        });
    });

    function showError(message) {
        errorMessage.textContent = message;
        errorMessage.style.display = 'block';
    }
}); 