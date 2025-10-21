// Profile Picture Debug Script
// Add this temporarily to diagnose profile picture issues

(function() {
    'use strict';
    
    console.log('[ProfilePictureDebug] Starting diagnostics...');
    
    // Monitor all image load errors
    document.addEventListener('error', function(e) {
        if (e.target.tagName === 'IMG') {
            console.error('[ProfilePictureDebug] Image failed to load:', {
                src: e.target.src,
                alt: e.target.alt,
                element: e.target
            });
            
            // Try to fetch the image directly to see the error
            fetch(e.target.src)
                .then(response => {
                    console.log('[ProfilePictureDebug] Fetch response:', {
                        url: e.target.src,
                        status: response.status,
                        statusText: response.statusText,
                        headers: Array.from(response.headers.entries())
                    });
                })
                .catch(error => {
                    console.error('[ProfilePictureDebug] Fetch error:', error);
                });
        }
    }, true);
    
    // Monitor all successful image loads
    document.addEventListener('load', function(e) {
        if (e.target.tagName === 'IMG' && e.target.src.includes('profile-picture')) {
            console.log('[ProfilePictureDebug] Profile picture loaded successfully:', {
                src: e.target.src,
                naturalWidth: e.target.naturalWidth,
                naturalHeight: e.target.naturalHeight
            });
        }
    }, true);
    
    // Check for profile pictures after page load
    setTimeout(() => {
        const profileImages = document.querySelectorAll('img[src*="profile-picture"]');
        console.log('[ProfilePictureDebug] Found', profileImages.length, 'profile picture elements');
        
        profileImages.forEach((img, index) => {
            console.log(`[ProfilePictureDebug] Image ${index + 1}:`, {
                src: img.src,
                complete: img.complete,
                naturalWidth: img.naturalWidth,
                naturalHeight: img.naturalHeight,
                error: img.error
            });
            
            // Test fetch
            fetch(img.src)
                .then(response => {
                    console.log(`[ProfilePictureDebug] Fetch test ${index + 1}:`, {
                        url: img.src,
                        ok: response.ok,
                        status: response.status,
                        contentType: response.headers.get('content-type')
                    });
                })
                .catch(error => {
                    console.error(`[ProfilePictureDebug] Fetch test ${index + 1} failed:`, error);
                });
        });
    }, 2000);
    
    // Check localStorage cache
    try {
        const cache = localStorage.getItem('recipientsCache');
        if (cache) {
            const data = JSON.parse(cache);
            console.log('[ProfilePictureDebug] Cache data:', {
                hasData: !!data,
                timestamp: data.timestamp,
                recipientsCount: data.data?.recipients?.length,
                recipientsWithPictures: data.data?.recipients?.filter(r => r.profile_picture).length
            });
            
            // Log first recipient with profile picture
            const withPicture = data.data?.recipients?.find(r => r.profile_picture);
            if (withPicture) {
                console.log('[ProfilePictureDebug] Sample recipient with picture:', {
                    id: withPicture.id,
                    name: withPicture.name,
                    profile_picture: withPicture.profile_picture
                });
            }
        }
    } catch (error) {
        console.error('[ProfilePictureDebug] Error reading cache:', error);
    }
    
    console.log('[ProfilePictureDebug] Diagnostics complete. Check console for details.');
})();
