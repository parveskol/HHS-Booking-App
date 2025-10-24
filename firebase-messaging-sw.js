// Firebase Messaging Service Worker
// This handles background push notifications
// Served as application/javascript

importScripts('https://www.gstatic.com/firebasejs/10.13.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.13.0/firebase-messaging-compat.js');

// Ensure proper MIME type detection
console.log('[Service Worker] Firebase Messaging Service Worker loaded with proper MIME type');

// Default Firebase configuration (fallback) - API key will be provided at runtime
const defaultFirebaseConfig = {
  apiKey: null, // Will be set at runtime
  authDomain: "hhs-booking-push-notification.firebaseapp.com",
  projectId: "hhs-booking-push-notification",
  storageBucket: "hhs-booking-push-notification.firebasestorage.app",
  messagingSenderId: "12685257995",
  appId: "1:12685257995:web:ed4b452b3b02e83d2ec60e"
};

// Global error handler for service worker
self.addEventListener('error', (event) => {
  console.error('[Service Worker] Global error:', event.error);
});

self.addEventListener('unhandledrejection', (event) => {
  console.error('[Service Worker] Unhandled promise rejection:', event.reason);
});

// Store for dynamic configuration
let firebaseConfig = null;
let messagingInitialized = false;

// Function to initialize Firebase with config
function initializeFirebase(config) {
  try {
    if (messagingInitialized) {
      console.log('[Service Worker] Firebase already initialized');
      return;
    }

    // Use provided config or fallback to default
    firebaseConfig = config || defaultFirebaseConfig;

    // Validate that we have a proper API key
    if (!firebaseConfig.apiKey) {
      console.warn('[Service Worker] No API key provided, using default config');
      firebaseConfig = defaultFirebaseConfig;
    }

    firebase.initializeApp(firebaseConfig);
    firebaseInitialized = true;
    messagingInitialized = true;

    console.log('[Service Worker] Firebase initialized successfully with config:', {
      projectId: firebaseConfig.projectId,
      hasApiKey: !!firebaseConfig.apiKey
    });

    // Initialize messaging after Firebase is properly configured
    initializeFirebaseMessaging();

  } catch (error) {
    console.error('[Service Worker] Failed to initialize Firebase:', error);
    firebaseInitialized = false;
    messagingInitialized = false;
  }
}

// Don't initialize Firebase until we receive proper configuration
let firebaseInitialized = false;

// Listen for configuration from main thread FIRST
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'FIREBASE_CONFIG') {
    console.log('[Service Worker] Received Firebase config from main thread');
    initializeFirebase(event.data.config);

    // Initialize messaging after Firebase is properly configured
    if (firebaseInitialized) {
      initializeFirebaseMessaging();
    }
  }

  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }

  if (event.data && event.data.type === 'EXIT_APP') {
    console.log('[Service Worker] Exit app request received');
    clients.matchAll({ type: 'window' }).then((clientList) => {
      clientList.forEach((client) => {
        client.postMessage({ type: 'APP_EXIT' });
      });
    });
  }
});

// Initialize Firebase Cloud Messaging only after proper config
function initializeFirebaseMessaging() {
  if (firebaseInitialized && typeof firebase !== 'undefined') {
    try {
      const messaging = firebase.messaging();
      console.log('[Service Worker] Firebase Messaging initialized');

      // Handle background messages
      messaging.onBackgroundMessage((payload) => {
        console.log('[firebase-messaging-sw.js] Received background message:', payload);

        const notificationTitle = payload.notification?.title || 'New Notification';
        const notificationOptions = {
          body: payload.notification?.body || '',
          icon: payload.notification?.icon || '/logo.png',
          badge: '/logo.png',
          tag: payload.data?.tag || 'booking-notification',
          data: payload.data,
          requireInteraction: true,
          actions: [
            {
              action: 'view',
              title: 'View Details',
              icon: '/logo.png'
            },
            {
              action: 'dismiss',
              title: 'Dismiss'
            }
          ],
          vibrate: [200, 100, 200],
          timestamp: Date.now(),
          badge: '/logo.png',
          image: payload.notification?.image,
          data: {
            ...payload.data,
            clickAction: payload.data?.clickAction || 'navigate',
            url: payload.data?.url || '/'
          }
        };

        return self.registration.showNotification(notificationTitle, notificationOptions);
      });

    } catch (error) {
      console.error('[Service Worker] Failed to initialize Firebase Messaging:', error);
    }
  }
}

// Handle notification click
self.addEventListener('notificationclick', (event) => {
  console.log('[firebase-messaging-sw.js] Notification clicked:', event.notification);

  const { action, notification } = event;
  const notificationData = notification.data || {};

  event.notification.close();

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      // Handle different actions
      switch (action) {
        case 'view':
          // Navigate to specific URL if provided, otherwise default
          const targetUrl = notificationData.url || '/';
          console.log('[firebase-messaging-sw.js] View action clicked, navigating to:', targetUrl);

          // If a window is already open, focus it and navigate
          for (const client of clientList) {
            if (client.url.includes(self.location.origin) && 'focus' in client) {
              client.focus();
              // Post message to navigate to specific page
              client.postMessage({
                type: 'NAVIGATE',
                url: targetUrl,
                data: notificationData
              });
              return;
            }
          }

          // If no window is open, open a new one at the specific URL
          if (clients.openWindow) {
            return clients.openWindow(targetUrl);
          }
          break;

        case 'dismiss':
          console.log('[firebase-messaging-sw.js] Dismiss action clicked');
          return; // Just close the notification

        default:
          // Default click behavior (no specific action)
          console.log('[firebase-messaging-sw.js] Default notification click');

          // If a window is already open, focus it
          for (const client of clientList) {
            if (client.url.includes(self.location.origin) && 'focus' in client) {
              client.focus();
              // Post message with notification data for handling
              client.postMessage({
                type: 'NOTIFICATION_CLICK',
                data: notificationData
              });
              return;
            }
          }

          // If no window is open, open a new one
          if (clients.openWindow) {
            const defaultUrl = notificationData.url || '/';
            return clients.openWindow(defaultUrl);
          }
      }
    })
  );
});

// Cache version
const CACHE_VERSION = 'v1';
const CACHE_NAME = `hhs-booking-${CACHE_VERSION}`;

// Files to cache
const urlsToCache = [
  '/',
  '/index.html',
  '/manifest.json',
  '/logo.png',
  '/logo.svg',
  '/icon-192x192.png',
  '/icon-512x512.png'
];

// Install event - cache resources
self.addEventListener('install', (event) => {
  console.log('[Service Worker] Installing...');
  
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => {
        console.log('[Service Worker] Caching app shell');
        return cache.addAll(urlsToCache.map(url => new Request(url, { cache: 'reload' })));
      })
      .then(() => self.skipWaiting())
      .catch((error) => {
        console.error('[Service Worker] Cache failed:', error);
      })
  );
});

// Activate event - clean up old caches
self.addEventListener('activate', (event) => {
  console.log('[Service Worker] Activating...');
  
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames
          .filter((cacheName) => cacheName.startsWith('hhs-booking-') && cacheName !== CACHE_NAME)
          .map((cacheName) => {
            console.log('[Service Worker] Deleting old cache:', cacheName);
            return caches.delete(cacheName);
          })
      );
    }).then(() => self.clients.claim())
  );
});

// Fetch event - serve from cache, fallback to network
self.addEventListener('fetch', (event) => {
  // Skip cross-origin requests
  if (!event.request.url.startsWith(self.location.origin)) {
    return;
  }

  event.respondWith(
    caches.match(event.request)
      .then((response) => {
        // Cache hit - return response
        if (response) {
          return response;
        }

        // Clone the request
        const fetchRequest = event.request.clone();

        return fetch(fetchRequest).then((response) => {
          // Check if valid response
          if (!response || response.status !== 200 || response.type !== 'basic') {
            return response;
          }

          // Clone the response
          const responseToCache = response.clone();

          // Only cache GET requests
          if (event.request.method === 'GET') {
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(event.request, responseToCache);
            });
          }

          return response;
        }).catch(() => {
          // Network failed, return offline page if available
          return caches.match('/index.html');
        });
      })
  );
});

// Handle messages from the app
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
  
  if (event.data && event.data.type === 'EXIT_APP') {
    console.log('[Service Worker] Exit app request received');
    // Close all clients
    clients.matchAll({ type: 'window' }).then((clientList) => {
      clientList.forEach((client) => {
        client.postMessage({ type: 'APP_EXIT' });
      });
    });
  }
});

console.log('[Service Worker] Firebase Messaging Service Worker loaded');
