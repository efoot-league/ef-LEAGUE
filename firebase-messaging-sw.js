// File: firebase-messaging-sw.js
importScripts('https://www.gstatic.com/firebasejs/10.8.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.8.0/firebase-messaging-compat.js');

// Initialize Firebase App in Service Worker
firebase.initializeApp({
    apiKey: "AIzaSyAyGn9KXMA8yVxIYTjI1kaqq0SQs5rIiYM", 
    authDomain: "efootball-web.firebaseapp.com", 
    projectId: "efootball-web", 
    storageBucket: "efootball-web.firebasestorage.app", 
    messagingSenderId: "758841862190", 
    appId: "1:758841862190:web:4eac889193c04c261ed7bf"
});

const messaging = firebase.messaging();

// Intercept background data payloads and trigger system push notifications
messaging.onBackgroundMessage((payload) => {
    const title = payload.data?.title || "⚽ Match Alert!";
    const options = {
        body: payload.data?.body || "You have a new match to play!",
        icon: "https://cdn-icons-png.flaticon.com/512/5323/5323443.png",
        badge: "https://cdn-icons-png.flaticon.com/512/5323/5323443.png",
        vibrate: [200, 100, 200]
    };

    self.registration.showNotification(title, options);
});
