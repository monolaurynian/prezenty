const CACHE_NAME = 'prezenty-v8';
const urlsToCache = [
  '/manifest.json',
  '/favicon.svg',
  '/seba_logo.png',
  '/styles.deduped.min.css',
  '/aws-design.css',
  'https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css',
  'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.0.0/css/all.min.css',
  'https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/js/bootstrap.bundle.min.js'
];

self.addEventListener('install', function(event) {
  // Skip waiting to activate immediately
  self.skipWaiting();
  
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(function(cache) {
        // Cache files individually to handle failures gracefully
        return Promise.allSettled(
          urlsToCache.map(url => 
            cache.add(url).catch(err => {
              console.warn('[SW] Failed to cache:', url);
              return null;
            })
          )
        );
      })
      .catch(err => {
        console.warn('[SW] Cache open failed:', err);
      })
  );
});

self.addEventListener('fetch', function(event) {
  // Skip caching for non-GET requests and API endpoints
  if (event.request.method !== 'GET' || event.request.url.includes('/api/')) {
    return;
  }

  // For HTML files, always fetch from network first (network-first strategy)
  if (event.request.url.endsWith('.html') || event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request)
        .then(function(response) {
          // Only cache successful responses
          if (response && response.status === 200) {
            const responseToCache = response.clone();
            caches.open(CACHE_NAME)
              .then(function(cache) {
                cache.put(event.request, responseToCache).catch(err => {
                  // Silently fail - cache errors are non-critical
                });
              })
              .catch(err => {
                // Silently fail - cache errors are non-critical
              });
          }
          return response;
        })
        .catch(function() {
          // Fallback to cache if network fails
          return caches.match(event.request).then(function(response) {
            return response || new Response('Network error', { status: 503 });
          });
        })
    );
    return;
  }

  // For other resources, use cache-first strategy
  event.respondWith(
    caches.match(event.request)
      .then(function(response) {
        // Return cached version if available
        if (response) {
          return response;
        }

        // Fetch from network
        return fetch(event.request).then(function(response) {
          // Don't cache redirected responses or error responses
          if (!response || response.status !== 200 || response.type !== 'basic') {
            return response;
          }

          // Clone the response for caching
          const responseToCache = response.clone();

          caches.open(CACHE_NAME)
            .then(function(cache) {
              cache.put(event.request, responseToCache).catch(err => {
                // Silently fail - cache errors are non-critical
              });
            })
            .catch(err => {
              // Silently fail - cache errors are non-critical
            });

          return response;
        }).catch(function() {
          return new Response('Network error', { status: 503 });
        });
      })
  );
});

self.addEventListener('activate', function(event) {
  // Take control of all clients immediately
  event.waitUntil(
    Promise.all([
      // Delete old caches
      caches.keys().then(function(cacheNames) {
        return Promise.all(
          cacheNames.map(function(cacheName) {
            if (cacheName !== CACHE_NAME) {
              console.log('[SW] Deleting old cache:', cacheName);
              return caches.delete(cacheName);
            }
          })
        );
      }),
      // Take control immediately
      self.clients.claim()
    ])
  );
});

// Push notification event listener
self.addEventListener('push', function(event) {
  console.log('🔔 [SW] Push notification received at:', new Date().toISOString());
  console.log('🔔 [SW] Push event data available:', !!event.data);
  
  let notificationData = {
    title: 'Życzenia Prezentowe',
    body: 'Nowy prezent został dodany!',
    icon: '/seba_logo.png',
    badge: '/seba_logo.png',
    tag: 'new-present',
    requireInteraction: false,
    vibrate: [200, 100, 200], // Vibration pattern for mobile
    renotify: true, // Allow re-notification with same tag
    silent: false,
    data: {
      url: '/recipients',
      timestamp: Date.now()
    }
  };
  
  // Add actions only if supported (not on iOS)
  if (self.registration.getNotifications) {
    notificationData.actions = [
      {
        action: 'view',
        title: 'Zobacz'
      },
      {
        action: 'dismiss',
        title: 'Zamknij'
      }
    ];
  }

  if (event.data) {
    try {
      const data = event.data.json();
      console.log('📦 [SW] Parsed push data:', data);
      notificationData = {
        ...notificationData,
        title: data.title || notificationData.title,
        body: data.body || notificationData.body,
        data: { ...notificationData.data, ...data }
      };
      console.log('✅ [SW] Notification data prepared:', { title: notificationData.title, body: notificationData.body });
    } catch (e) {
      console.error('❌ [SW] Error parsing push data:', e);
      // If parsing fails, try text
      if (event.data.text) {
        notificationData.body = event.data.text();
      }
    }
  }

  console.log('📢 [SW] Displaying notification:', notificationData.title);
  
  event.waitUntil(
    self.registration.showNotification(notificationData.title, notificationData)
      .then(() => {
        console.log('✅ [SW] Notification displayed successfully');
      })
      .catch((error) => {
        console.error('❌ [SW] Error displaying notification:', error);
      })
  );
});

// Notification click event listener
self.addEventListener('notificationclick', function(event) {
  console.log('Notification clicked:', event);
  
  event.notification.close();
  
  // Handle dismiss action
  if (event.action === 'dismiss') {
    return;
  }
  
  // Handle view action or default click
  if (event.action === 'view' || !event.action) {
    const urlToOpen = event.notification.data?.url || '/recipients';
    
    event.waitUntil(
      clients.matchAll({ 
        type: 'window',
        includeUncontrolled: true 
      }).then(function(clientList) {
        // If app is already open, focus it
        for (let client of clientList) {
          if (client.url.includes('/recipients') && 'focus' in client) {
            return client.focus();
          }
        }
        
        // If app is not open, open it
        if (clients.openWindow) {
          return clients.openWindow(urlToOpen);
        }
      })
    );
  }
});

// Handle notification close event
self.addEventListener('notificationclose', function(event) {
  console.log('Notification closed:', event);
});