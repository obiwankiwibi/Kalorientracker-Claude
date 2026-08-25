'use strict';
const webpush = require('web-push');
const fetch   = require('node-fetch');

const DEBOUNCE_MS = 10 * 60 * 1000;  // 10 Min. Ruhe nach letzter Änderung
const MAX_WAIT_MS = 30 * 60 * 1000;  // Spätestens nach 30 Min. senden
const STALE_MS    =  2 * 3600 * 1000; // Älter als 2 Std. → verwerfen

const {
  VAPID_PUBLIC_KEY,
  VAPID_PRIVATE_KEY,
  VAPID_EMAIL,
  FIREBASE_DB_URL
} = process.env;

if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY || !FIREBASE_DB_URL) {
  console.error('Fehlende Umgebungsvariablen. GitHub Secrets prüfen.');
  process.exit(1);
}

webpush.setVapidDetails(
  VAPID_EMAIL || 'mailto:noreply@example.com',
  VAPID_PUBLIC_KEY,
  VAPID_PRIVATE_KEY
);

async function fbGet(path) {
  const r = await fetch(FIREBASE_DB_URL + path + '.json');
  if (!r.ok) return null;
  return r.json();
}

async function fbPatch(path, data) {
  await fetch(FIREBASE_DB_URL + path + '.json', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data)
  });
}

async function fbSet(path, data) {
  await fetch(FIREBASE_DB_URL + path + '.json', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data)
  });
}

async function main() {
  const [sub, ping] = await Promise.all([
    fbGet('/push_sub'),
    fbGet('/settings/shoppingPing')
  ]);

  if (!sub || !sub.endpoint) {
    console.log('Keine Push-Subscription. Beende.');
    return;
  }
  if (!ping || !ping.changedAt) {
    console.log('Keine Einkaufslisten-Änderung in Firebase. Beende.');
    return;
  }

  const { changedAt, firstChangedAt, pushSentAt = 0 } = ping;
  const now = Date.now();

  // Bereits per Push gesendet?
  if (changedAt <= pushSentAt) {
    console.log('Push für diese Änderung bereits gesendet.');
    return;
  }

  // Zu alt → verwerfen
  if (now - changedAt > STALE_MS) {
    console.log('Änderung älter als 2 Stunden – wird übersprungen.');
    await fbPatch('/settings/shoppingPing', { pushSentAt: now });
    return;
  }

  const sinceLastChange  = now - changedAt;
  const sinceFirstChange = now - (firstChangedAt || changedAt);

  // Debounce: noch nicht bereit
  if (sinceLastChange < DEBOUNCE_MS && sinceFirstChange < MAX_WAIT_MS) {
    const waitMin = Math.ceil((DEBOUNCE_MS - sinceLastChange) / 60000);
    console.log(`Noch ${waitMin} Min. warten (Debounce). Beende.`);
    return;
  }

  // Als gesendet markieren (verhindert Doppel-Sends)
  await fbPatch('/settings/shoppingPing', { pushSentAt: now });

  const payload = JSON.stringify({
    title: '🛒 Einkaufsliste aktualisiert',
    body:  'Jemand hat die Einkaufsliste geändert – schau mal rein!',
    icon:  'https://obiwankiwibi.github.io/Kalorientracker-Claude/icon-192.png',
    url:   'https://obiwankiwibi.github.io/Kalorientracker-Claude/einkaufsliste.html'
  });

  try {
    await webpush.sendNotification(sub, payload);
    console.log('Push-Benachrichtigung für Einkaufsliste gesendet!');
  } catch (err) {
    if (err.statusCode === 410 || err.statusCode === 404) {
      console.log('Subscription abgelaufen – wird aus Firebase gelöscht.');
      await fbSet('/push_sub', null);
    } else {
      console.error('Push-Fehler:', err.message);
    }
  }
}

main().catch(err => { console.error(err); process.exit(1); });
