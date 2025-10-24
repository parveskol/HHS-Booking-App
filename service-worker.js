const CACHE_NAME = 'hhs-booking-cache-v4';
const urlsToCache = [
  '/',
  '/index.html',
  '/manifest.json',
  '/manifest-customer.json',
  '/firebase-messaging-sw.js'
];

// Firebase configuration for service worker
let firebaseConfig = null;
let firebaseInitialized = false;

// PWA Configuration based on user role
const PWA_CONFIGS = {
  management: {
    name: 'HHS Booking Management',
    description: 'Admin dashboard for Harvard House Sports booking management',
    startUrl: '/',
    scope: '/'
  },
  customer: {
    name: 'HHS Booking',
    description: 'Customer portal for Harvard House Sports bookings',
    startUrl: '/',
    scope: '/'
  }
};

// Install event - cache resources
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        console.log('Opened cache');
        return cache.addAll(urlsToCache);
      })
  );
  self.skipWaiting();
});

// Fetch event - serve from cache, fallback to network
self.addEventListener('fetch', event => {
  event.respondWith(
    caches.match(event.request)
      .then(response => {
        if (response) {
          return response;
        }
        return fetch(event.request);
      })
  );
});

// Activate event - clean up old caches
self.addEventListener('activate', event => {
  const cacheWhitelist = [CACHE_NAME];
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.map(cacheName => {
          if (cacheWhitelist.indexOf(cacheName) === -1) {
            return caches.delete(cacheName);
          }
        })
      );
    })
  );
  self.clients.claim();
});

// Enhanced push notification event with role-based notifications
self.addEventListener('push', event => {
  console.log('[DEBUG] 📱 Push message received:', {
    event,
    timestamp: new Date().toISOString(),
    hasData: !!event.data
  });

  let options = {
    body: 'You have a new booking request to review!',
    icon: '/icon-192x192.png',
    badge: '/icon-192x192.png',
    vibrate: [200, 100, 200, 100, 200],
    data: {
      dateOfArrival: Date.now(),
      primaryKey: 1,
      url: '/?role=management'
    },
    actions: [
      {
        action: 'explore',
        title: 'View Requests',
        icon: '/icon-192x192.png'
      },
      {
        action: 'close',
        title: 'Close',
        icon: '/icon-192x192.png'
      }
    ],
    requireInteraction: true,
    silent: false,
    tag: 'booking-notification'
  };

  if (event.data) {
    const data = event.data.json();
    options.body = data.body || options.body;
    options.data = { ...options.data, ...data };

    // Role-based notification handling
    if (data.role === 'customer') {
      options.body = data.body || 'Your booking request has been updated!';
      options.data.url = '/?role=customer';
      options.actions[0].title = 'View My Requests';
    }
  }

  event.waitUntil(
    self.registration.showNotification('Harvard House Sports', options)
  );
});

// Notification click event
self.addEventListener('notificationclick', event => {
  console.log('[DEBUG] 🖱️ Notification click received:', {
    event,
    action: event.action,
    timestamp: new Date().toISOString()
  });

  event.notification.close();

  if (event.action === 'explore') {
    console.log('[DEBUG] 📱 Opening app for "View Requests" action');
    // Open the app when user clicks "View Requests"
    event.waitUntil(
      clients.openWindow('/')
    );
  } else if (event.action === 'close') {
    console.log('[DEBUG] ❌ Closing notification');
    // Just close the notification
    return;
  } else {
    console.log('[DEBUG] 📱 Opening app for default action');
    // Default action - open the app
    event.waitUntil(
      clients.openWindow('/')
    );
  }
});

// Enhanced background sync for offline functionality
self.addEventListener('sync', event => {
  console.log('Background sync triggered:', event.tag);

  if (event.tag === 'background-sync') {
    event.waitUntil(
      // Perform background sync operations
      syncBookingData()
    );
  } else if (event.tag === 'booking-request-sync') {
    event.waitUntil(
      syncBookingRequests()
    );
  }
});

// Background sync functions
async function syncBookingData() {
  try {
    console.log('Starting background sync for bookings...');

    // Get pending operations from IndexedDB
    const pendingOperations = await getPendingOperations();

    if (pendingOperations.length === 0) {
      console.log('No pending operations to sync');
      return;
    }

    console.log(`Found ${pendingOperations.length} pending operations to sync`);

    // Process each pending operation
    for (const operation of pendingOperations) {
      try {
        let success = false;

        if (operation.table === 'bookings') {
          success = await syncBookingToServer(operation.data);
        } else if (operation.table === 'booking_requests') {
          success = await syncRequestToServer(operation.data);
        }

        if (success) {
          // Remove the operation from pending list
          await removePendingOperation(operation.id);
          console.log(`Successfully synced operation: ${operation.id}`);
        } else {
          console.error(`Failed to sync operation: ${operation.id}`);
        }
      } catch (error) {
        console.error(`Error processing operation ${operation.id}:`, error);
      }
    }

    console.log('Background sync completed');
  } catch (error) {
    console.error('Background sync failed:', error);
  }
}

async function syncBookingRequests() {
  // This function is now handled by syncBookingData
  // Keeping for backward compatibility
  await syncBookingData();
}

// IndexedDB helpers for offline storage
const DB_NAME = 'HHSBookings';
const DB_VERSION = 1;

async function openDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
  });
}

async function getStoredData() {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(['offlineData'], 'readonly');
      const store = transaction.objectStore('offlineData');
      const request = store.get('main');

      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const result = request.result || {
          id: 'main',
          bookings: [],
          bookingRequests: [],
          lastSync: new Date().toISOString(),
          pendingOperations: []
        };
        resolve(result);
      };
    });
  } catch (error) {
    console.error('Error getting stored data:', error);
    return null;
  }
}

async function getPendingOperations() {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(['pendingOperations'], 'readonly');
      const store = transaction.objectStore('pendingOperations');
      const request = store.getAll();

      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result || []);
    });
  } catch (error) {
    console.error('Error getting pending operations:', error);
    return [];
  }
}

async function removePendingOperation(id) {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(['pendingOperations'], 'readwrite');
      const store = transaction.objectStore('pendingOperations');
      const request = store.delete(id);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve();
    });
  } catch (error) {
    console.error('Error removing pending operation:', error);
  }
}

async function syncBookingToServer(booking) {
  try {
    console.log('Syncing booking to server:', booking);

    // Get Supabase credentials from service worker context or localStorage
    const supabaseUrl = self.supabaseUrl || (typeof localStorage !== 'undefined' ? localStorage.getItem('supabase_url') : null);
    const supabaseKey = self.supabaseKey || (typeof localStorage !== 'undefined' ? localStorage.getItem('supabase_key') : null);

    if (!supabaseUrl || !supabaseKey) {
      console.error('Supabase credentials not available for sync');
      return false;
    }

    // Determine if this is an INSERT or UPDATE operation
    const isUpdate = booking.id && booking.id > 0;
    const method = isUpdate ? 'PATCH' : 'POST';
    const url = isUpdate
      ? `${supabaseUrl}/rest/v1/bookings?id=eq.${booking.id}`
      : `${supabaseUrl}/rest/v1/bookings`;

    const response = await fetch(url, {
      method,
      headers: {
        'Content-Type': 'application/json',
        'apikey': supabaseKey,
        'Authorization': `Bearer ${supabaseKey}`,
        'Prefer': 'return=representation'
      },
      body: JSON.stringify(booking)
    });

    if (response.ok) {
      console.log('Booking synced successfully');
      return true;
    } else {
      const errorText = await response.text();
      console.error('Failed to sync booking:', response.status, errorText);
      return false;
    }
  } catch (error) {
    console.error('Error syncing booking:', error);
    return false;
  }
}

async function syncRequestToServer(request) {
  try {
    console.log('Syncing request to server:', request);

    // Get Supabase credentials from service worker context or localStorage
    const supabaseUrl = self.supabaseUrl || (typeof localStorage !== 'undefined' ? localStorage.getItem('supabase_url') : null);
    const supabaseKey = self.supabaseKey || (typeof localStorage !== 'undefined' ? localStorage.getItem('supabase_key') : null);

    if (!supabaseUrl || !supabaseKey) {
      console.error('Supabase credentials not available for sync');
      return false;
    }

    // Determine if this is an INSERT or UPDATE operation
    const isUpdate = request.id && request.id > 0;
    const method = isUpdate ? 'PATCH' : 'POST';
    const url = isUpdate
      ? `${supabaseUrl}/rest/v1/booking_requests?id=eq.${request.id}`
      : `${supabaseUrl}/rest/v1/booking_requests`;

    const response = await fetch(url, {
      method,
      headers: {
        'Content-Type': 'application/json',
        'apikey': supabaseKey,
        'Authorization': `Bearer ${supabaseKey}`,
        'Prefer': 'return=representation'
      },
      body: JSON.stringify(request)
    });

    if (response.ok) {
      console.log('Request synced successfully');
      return true;
    } else {
      const errorText = await response.text();
      console.error('Failed to sync request:', response.status, errorText);
      return false;
    }
  } catch (error) {
    console.error('Error syncing request:', error);
    return false;
  }
}

// Firebase initialization function - simplified for service worker
function initializeFirebase(config) {
  try {
    if (firebaseInitialized) {
      console.log('[Service Worker] Firebase already initialized');
      return;
    }

    firebaseConfig = config;
    firebaseInitialized = true;

    console.log('[Service Worker] Firebase config stored for messaging:', {
      projectId: config?.projectId,
      hasApiKey: !!config?.apiKey
    });

    // Note: Firebase messaging will be handled by the main thread
    // Service worker will only handle notification display

  } catch (error) {
    console.error('[Service Worker] Failed to initialize Firebase:', error);
  }
}

// Message event for communication with the main thread
self.addEventListener('message', event => {
  console.log('[DEBUG] Service worker received message:', {
    type: event.data?.type,
    timestamp: new Date().toISOString(),
    data: event.data,
    source: event.source ? 'main-thread' : 'unknown'
  });

  if (event.data && event.data.type === 'SKIP_WAITING') {
    console.log('[DEBUG] Processing SKIP_WAITING message');
    self.skipWaiting();
  }

  // Handle Firebase configuration (simplified)
  if (event.data && event.data.type === 'FIREBASE_CONFIG') {
    console.log('[Service Worker] Received Firebase config');
    initializeFirebase(event.data.config);
  }

  // Handle notification display requests from main thread
  if (event.data && event.data.type === 'SHOW_NOTIFICATION') {
    const { title, body, icon, badge, tag, data } = event.data;

    const options = {
      body: body || 'You have a new notification',
      icon: icon || '/logo.png',
      badge: badge || '/logo.png',
      tag: tag || 'notification',
      data: data || {},
      requireInteraction: true,
      actions: [
        {
          action: 'view',
          title: 'View',
          icon: '/logo.png'
        },
        {
          action: 'dismiss',
          title: 'Dismiss'
        }
      ],
      vibrate: [200, 100, 200],
      timestamp: Date.now()
    };

    event.waitUntil(
      self.registration.showNotification(title || 'Notification', options)
    );
  }

  // Handle Supabase credentials for offline sync
  if (event.data && event.data.type === 'SUPABASE_CREDENTIALS') {
    console.log('[DEBUG] Received Supabase credentials for offline sync');
    // Store credentials for use during background sync
    self.supabaseUrl = event.data.supabaseUrl;
    self.supabaseKey = event.data.supabaseKey;

    // Also store in localStorage for the service worker context
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem('supabase_url', event.data.supabaseUrl);
      localStorage.setItem('supabase_key', event.data.supabaseKey);
    }
  }

  // Handle PWA exit messages
  if (event.data && event.data.type === 'EXIT_APP') {
    console.log('[DEBUG] Service worker processing enhanced EXIT_APP message');
    console.log('[DEBUG] Exit context:', event.data);

    event.waitUntil(
      (async () => {
        try {
          const pwaContext = event.data.pwaContext || {};
          console.log(`[DEBUG] PWA Context: ${JSON.stringify(pwaContext)}`);

          // Strategy 1: Close all windows/tabs for this PWA
          const clients = await self.clients.matchAll({
            type: 'window',
            includeUncontrolled: true
          });

          console.log(`[DEBUG] Found ${clients.length} clients to close`);

          if (clients.length > 0) {
            // Close all clients (windows/tabs) associated with this PWA
            const closePromises = clients.map(async (client) => {
              try {
                console.log(`[DEBUG] Closing client: ${client.url}`);

                // Try to focus and close the client
                await client.focus();

                // Send close message to client
                client.postMessage({
                  type: 'FORCE_CLOSE',
                  timestamp: Date.now(),
                  source: 'service-worker'
                });

                // Navigate to blank page first (more reliable)
                try {
                  await client.navigate('about:blank');
                } catch (navError) {
                  console.log(`[DEBUG] Navigation failed for client: ${navError.message}`);
                }

                return Promise.resolve();
              } catch (error) {
                console.log(`[DEBUG] Error closing client: ${error.message}`);
                return Promise.resolve();
              }
            });

            await Promise.all(closePromises);
          }

          // Strategy 2: Context-specific exit handling
          if (pwaContext.displayMode === 'ios-standalone') {
            console.log('[DEBUG] iOS Standalone detected, using iOS-specific exit strategy');
            // For iOS, we rely mainly on client-side handling
          } else if (pwaContext.displayMode === 'android-standalone') {
            console.log('[DEBUG] Android Standalone detected, using Android-specific strategy');
            // For Android, try to trigger native close behavior
          }

          // Strategy 3: Clean up service worker state
          setTimeout(async () => {
            try {
              // Clear any cached data related to this session
              const cacheNames = await caches.keys();
              for (const cacheName of cacheNames) {
                if (cacheName.includes('hhs-booking')) {
                  await caches.delete(cacheName);
                  console.log(`[DEBUG] Cleared cache: ${cacheName}`);
                }
              }

              // Unregister service worker as last resort
              if ('serviceWorker' in navigator) {
                const registration = await self.registration;
                if (registration) {
                  console.log('[DEBUG] Unregistering service worker');
                  await registration.unregister();
                }
              }
            } catch (cleanupError) {
              console.log(`[DEBUG] Cleanup error: ${cleanupError.message}`);
            }
          }, 1000);

          console.log('[DEBUG] Enhanced PWA exit process completed');
        } catch (error) {
          console.error('[DEBUG] Error during enhanced PWA exit:', error);
        }
      })()
    );
  }

  // Handle admin notification messages
  if (event.data && event.data.type === 'SHOW_NOTIFICATION') {
    const { title, body } = event.data;
    const startTime = performance.now();

    console.log('[DEBUG] Service worker processing SHOW_NOTIFICATION:', {
      title,
      body,
      timestamp: new Date().toISOString(),
      registrationReady: !!self.registration,
      notificationPermission: 'Notification' in self ? 'supported' : 'not-supported',
      currentPermission: 'Notification' in self ? Notification.permission : 'unknown'
    });

    try {
      const options = {
        body: body || 'You have a new booking request to review!',
        icon: '/icon-192x192.png',
        badge: '/icon-192x192.png',
        vibrate: [100, 50, 100],
        data: {
          dateOfArrival: Date.now(),
          primaryKey: 1
        },
        actions: [
          {
            action: 'explore',
            title: 'View Requests',
            icon: '/icon-192x192.png'
          },
          {
            action: 'close',
            title: 'Close',
            icon: '/icon-192x192.png'
          }
        ],
        tag: 'admin-notification',
        requireInteraction: true,
        silent: false
      };

      // Use event.waitUntil to ensure the notification is shown
      event.waitUntil(
        self.registration.showNotification(title || 'Harvard House Sports', options)
          .then(() => {
            const endTime = performance.now();
            console.log('[DEBUG] ✅ Service worker notification shown successfully:', {
              title,
              duration: `${endTime - startTime}ms`,
              timestamp: new Date().toISOString()
            });
          })
          .catch(error => {
            const endTime = performance.now();
            console.log('[DEBUG] ❌ Service worker notification failed:', {
              title,
              error: error.message,
              stack: error.stack,
              duration: `${endTime - startTime}ms`,
              timestamp: new Date().toISOString()
            });
          })
      );
    } catch (error) {
      const endTime = performance.now();
      console.log('[DEBUG] 💥 Error in service worker notification handler:', {
        title,
        error: error.message,
        stack: error.stack,
        duration: `${endTime - startTime}ms`,
        timestamp: new Date().toISOString()
      });
    }
  }
});