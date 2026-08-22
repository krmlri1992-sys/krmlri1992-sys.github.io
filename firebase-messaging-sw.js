// firebase-messaging-sw.js
// Service worker DÉDIÉ à Firebase Cloud Messaging.
// Reçoit les notifications push même quand l'application est totalement
// fermée (aucun onglet ouvert), tant que l'utilisateur a autorisé
// les notifications et que le navigateur/l'OS le permettent.
//
// ⚠️ Remplacez les valeurs ci-dessous par CELLES DE VOTRE PROJET FIREBASE
// (Console Firebase → Paramètres du projet → Général → Vos applications → Config SDK)
// Elles doivent être IDENTIQUES à FIREBASE_CONFIG dans index.html.

importScripts("https://www.gstatic.com/firebasejs/10.13.0/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/10.13.0/firebase-messaging-compat.js");

firebase.initializeApp({
  apiKey: "AIzaSyA71syqtFOfDFseuqV9B-lVWhNlY1DxB_A",
  authDomain: "nour-al-islam-b9969.firebaseapp.com",
  databaseURL: "https://nour-al-islam-c54df-default-rtdb.europe-west1.firebasedatabase.app",
  projectId: "nour-al-islam-b9969",
  storageBucket: "nour-al-islam-b9969.firebasestorage.app",
  messagingSenderId: "802128939449",
  appId: "1:802128939449:web:b5df4c7a86deaa3b32ce68"
});

const messaging = firebase.messaging();

// Affiche la notification quand un message arrive alors que
// l'app est en arrière-plan ou fermée.
messaging.onBackgroundMessage((payload) => {
  const title = (payload.notification && payload.notification.title) || "QALAM";
  const body = (payload.notification && payload.notification.body) || "";
  self.registration.showNotification(title, {
    body,
    icon: "icône-192.png",
    badge: "icône-192.png",
    tag: "qalam-prayer",
    renotify: true
  });
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if ("focus" in client) return client.focus();
      }
      if (self.clients.openWindow) return self.clients.openWindow("./index.html");
    })
  );
});
