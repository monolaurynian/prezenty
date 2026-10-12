
        // Check if we need to scroll to a specific recipient
        function scrollToRecipientFromLeaderboard() {
            const params = new URLSearchParams(window.location.search);
            const scrollToUsername = params.get('scrollTo') || sessionStorage.getItem('scrollToRecipient');
            
            if (scrollToUsername) {
                console.log('[Scroll] Looking for recipient:', scrollToUsername);
                
                // Clear the sessionStorage so it doesn't persist
                sessionStorage.removeItem('scrollToRecipient');
                
                // Wait for the page to load and render recipients
                const checkInterval = setInterval(() => {
                    // Look for recipient item with matching name
                    const recipientItems = document.querySelectorAll('.recipient-item');
                    let found = false;
                    
                    recipientItems.forEach(item => {
                        const recipientName = item.querySelector('.recipient-name')?.textContent?.trim();
                        if (recipientName && recipientName.toLowerCase() === scrollToUsername.toLowerCase()) {
                            console.log('[Scroll] Found recipient:', recipientName);
                            // Scroll to this element
                            item.scrollIntoView({ behavior: 'smooth', block: 'start' });
                            // Highlight it briefly
                            item.style.backgroundColor = 'rgba(255, 215, 0, 0.3)';
                            setTimeout(() => {
                                item.style.backgroundColor = '';
                            }, 2000);
                            found = true;
                            clearInterval(checkInterval);
                        }
                    });
                    
                    // Stop checking after 10 seconds
                    if (!found && Date.now() - startTime > 10000) {
                        console.log('[Scroll] Recipient not found after 10 seconds');
                        clearInterval(checkInterval);
                    }
                }, 500);
                
                const startTime = Date.now();
            }
        }
        
        // Run on page load
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', scrollToRecipientFromLeaderboard);
        } else {
            scrollToRecipientFromLeaderboard();
        }
        
        // Also run after a delay to catch dynamic content
        setTimeout(scrollToRecipientFromLeaderboard, 2000);
    