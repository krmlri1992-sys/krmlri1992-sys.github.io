// notify-worker/index.js
// Remplace la Cloud Function Firebase (qui exigeait le forfait Blaze).
// Ce script est exécuté périodiquement par GitHub Actions (gratuit),
// lit les tokens push + positions dans Realtime Database (gratuit sur
// Spark), calcule les horaires de prière, et envoie les notifications
// via Firebase Cloud Messaging (gratuit et illimité sur Spark).

const admin = require("firebase-admin");

const DATABASE_URL = "https://nour-al-islam-c54df-default-rtdb.europe-west1.firebasedatabase.app";

// Doit correspondre à l'intervalle du cron dans le workflow GitHub Actions
// (ex: */15 * * * * -> 15 minutes). C'est la fenêtre de tolérance utilisée
// pour ne pas rater une heure de prière entre deux exécutions.
// GitHub Actions ne respecte pas toujours precisement l'intervalle du cron
// (retards observes de 20 a 48+ minutes en periode de forte charge).
// On elargit donc la fenetre de tolerance a 60 minutes pour ne jamais
// rater une priere, quitte a ce que la notification arrive avec un peu
// de retard plutot que jamais. Le systeme anti-doublon (push_sent_log)
// garantit qu'une seule notification est envoyee par priere et par jour.
const WINDOW_MINUTES = 60;

const serviceAccountRaw = process.env.FIREBASE_SERVICE_ACCOUNT;
if (!serviceAccountRaw) {
  console.error("FIREBASE_SERVICE_ACCOUNT manquant (secret GitHub Actions).");
  process.exit(1);
}

const serviceAccount = JSON.parse(serviceAccountRaw);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: DATABASE_URL
});

const db = admin.database();
const messaging = admin.messaging();

// ---- Même calcul d'horaires de prière que côté client (méthode UOIF) ----
function calcPrayerTimes(lat, lng, dateMs) {
  const date = new Date(dateMs);
  const rad = Math.PI / 180;
  const jd = Math.floor(date.getTime() / 86400000 + 2440587.5);
  const D = jd - 2451545.0;
  const g = (357.529 + 0.98560028 * D) * rad;
  const q = 280.459 + 0.98564736 * D;
  const L = (q + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) * rad;
  const e = (23.439 - 0.00000036 * D) * rad;
  const RA = Math.atan2(Math.cos(e) * Math.sin(L), Math.cos(L)) / rad / 15;
  const decl = Math.asin(Math.sin(e) * Math.sin(L));

  function normalizeHour(h) {
    h = h % 24;
    if (h < 0) h += 24;
    return h;
  }

  const eqt = q / 15 - normalizeHour(RA);
  const noon = 12 - eqt - lng / 15;

  function timeForAngle(angle, isAfternoonSide) {
    const angleRad = angle * rad;
    const latRad = lat * rad;
    const cosH = (-Math.sin(angleRad) - Math.sin(latRad) * Math.sin(decl)) / (Math.cos(latRad) * Math.cos(decl));
    if (cosH < -1 || cosH > 1) return null;
    const H = Math.acos(cosH) / rad / 15;
    return isAfternoonSide ? noon + H : noon - H;
  }

  function timeForAsr() {
    const latRad = lat * rad;
    const t = Math.atan(1 / (1 + Math.tan(Math.abs(latRad - decl))));
    const angle = 90 - t / rad;
    return timeForAngle(angle, true);
  }

  function fmt(h) {
    if (h === null || h === undefined || isNaN(h)) return null;
    h = normalizeHour(h);
    const hh = Math.floor(h);
    let mm = Math.round((h - hh) * 60);
    let hAdj = hh;
    if (mm === 60) {
      mm = 0;
      hAdj = (hh + 1) % 24;
    }
    return { hh: hAdj, mm };
  }

  const fajr = timeForAngle(12, false);
  const dhuhr = noon + 2 / 60;
  const asr = timeForAsr();
  const maghrib = timeForAngle(0.833, true);
  const isha = timeForAngle(12, true);

  const out = {};
  [
    ["fajr", fajr],
    ["dhuhr", dhuhr],
    ["asr", asr],
    ["maghrib", maghrib],
    ["isha", isha]
  ].forEach(([k, v]) => {
    out[k] = fmt(v);
  });
  return out;
}

const PRAYER_LABELS = {
  fajr: { fr: "Fajr", emoji: "\u{1F305}" },
  dhuhr: { fr: "Dhuhr", emoji: "\u2600\uFE0F" },
  asr: { fr: "Asr", emoji: "\u{1F324}\uFE0F" },
  maghrib: { fr: "Maghrib", emoji: "\u{1F306}" },
  isha: { fr: "Isha", emoji: "\u{1F319}" }
};

function todayKey(d) {
  return `${d.getUTCFullYear()}-${d.getUTCMonth() + 1}-${d.getUTCDate()}`;
}

async function main() {
  const snap = await db.ref("push_tokens").once("value");
  const allUsers = snap.val() || {};
  const now = new Date();
  const dateKey = todayKey(now);
  const windowMs = WINDOW_MINUTES * 60 * 1000;
  const tasks = [];
  let checked = 0;

  for (const [userKey, devices] of Object.entries(allUsers)) {
    for (const [deviceId, info] of Object.entries(devices || {})) {
      if (!info || !info.token || typeof info.lat !== "number" || typeof info.lng !== "number") continue;
      checked++;
      const offset = info.offset || 0;
      const times = calcPrayerTimes(info.lat, info.lng, now.getTime());

      for (const [prayerKey, t] of Object.entries(times)) {
        if (!t) continue;
        const target = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), t.hh, t.mm, 0));
        target.setUTCMinutes(target.getUTCMinutes() - offset);
        const delta = now.getTime() - target.getTime();

        // La cible doit être passée depuis peu (dans la fenêtre de tolérance)
        if (delta < 0 || delta >= windowMs) continue;

        const sentRef = db.ref(`push_sent_log/${userKey}/${deviceId}/${dateKey}/${prayerKey}`);
        tasks.push(
          (async () => {
            const sentSnap = await sentRef.once("value");
            if (sentSnap.exists()) return; // déjà envoyé aujourd'hui

            const label = PRAYER_LABELS[prayerKey];
            const title = `${label.emoji} ${label.fr}`;
            const body =
              offset > 0
                ? `${label.fr} dans ${offset} min`
                : `C'est l'heure de la prière ${label.fr}`;

            try {
              await messaging.send({
                token: info.token,
                notification: { title, body },
                webpush: { fcmOptions: { link: "./index.html" } }
              });
              await sentRef.set(true);
              console.log(`Envoyé: ${userKey}/${deviceId} - ${prayerKey}`);
            } catch (err) {
              if (
                err.code === "messaging/registration-token-not-registered" ||
                err.code === "messaging/invalid-registration-token"
              ) {
                await db.ref(`push_tokens/${userKey}/${deviceId}`).remove();
                console.log(`Token invalide supprimé: ${userKey}/${deviceId}`);
              } else {
                console.error(`Erreur envoi ${userKey}/${deviceId}/${prayerKey}:`, err.message);
              }
            }
          })()
        );
      }
    }
  }

  // Nettoyage : logs d'envoi de plus d'un jour
  const logSnap = await db.ref("push_sent_log").once("value");
  const logs = logSnap.val() || {};
  for (const [userKey, devices] of Object.entries(logs)) {
    for (const [deviceId, dates] of Object.entries(devices || {})) {
      for (const d of Object.keys(dates || {})) {
        if (d !== dateKey) {
          tasks.push(db.ref(`push_sent_log/${userKey}/${deviceId}/${d}`).remove());
        }
      }
    }
  }

  await Promise.all(tasks);
  console.log(`Terminé. ${checked} appareil(s) vérifié(s) à ${now.toISOString()}.`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
