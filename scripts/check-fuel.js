'use strict';
const webpush = require('web-push');
const fetch   = require('node-fetch');

const MIN_NOTIFY_GAP  = 25 * 60 * 1000; // 25 Minuten Anti-Spam (Testmodus)
const NOTIFY_HOUR_START = 7;
const NOTIFY_HOUR_END   = 22;

const FUEL_LABEL = { e10: 'E10', e5: 'E5', diesel: 'Diesel' };

const {
  VAPID_PUBLIC_KEY,
  VAPID_PRIVATE_KEY,
  VAPID_EMAIL,
  FIREBASE_DB_URL
} = process.env;

if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) {
  console.error('VAPID keys fehlen. Bitte GitHub Secrets setzen.');
  process.exit(1);
}
if (!FIREBASE_DB_URL) {
  console.error('FIREBASE_DB_URL fehlt. Bitte GitHub Secret setzen.');
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

async function fbSet(path, data) {
  await fetch(FIREBASE_DB_URL + path + '.json', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data)
  });
}

async function main() {
  // Zeitfenster: nur 7–22 Uhr (Europe/Berlin)
  const nowBerlin = new Date(new Date().toLocaleString('en-US', { timeZone: 'Europe/Berlin' }));
  const hour = nowBerlin.getHours();
  if (hour < NOTIFY_HOUR_START || hour >= NOTIFY_HOUR_END) {
    console.log(`Außerhalb der Benachrichtigungszeit (${NOTIFY_HOUR_START}–${NOTIFY_HOUR_END} Uhr). Aktuell: ${hour} Uhr.`);
    return;
  }

  const [sub, config, lastNotif] = await Promise.all([
    fbGet('/push_sub'),
    fbGet('/fuel_config'),
    fbGet('/fuel_last_notif')
  ]);

  if (!sub || !sub.endpoint) {
    console.log('Keine Push-Subscription gespeichert. Beende.');
    return;
  }
  if (!config || !config.apiKey || !Array.isArray(config.stations) || !config.stations.length) {
    console.log('Keine Favoriten-Stationen konfiguriert. Beende.');
    return;
  }

  // Anti-Spam: max. alle 25 Minuten (Testmodus)
  if (lastNotif && Date.now() - lastNotif < MIN_NOTIFY_GAP) {
    const nextIn = Math.round((MIN_NOTIFY_GAP - (Date.now() - lastNotif)) / 60000);
    console.log(`Letzte Benachrichtigung erst vor kurzem. Nächste frühestens in ${nextIn} Minuten.`);
    return;
  }

  // Konfigurierte Kraftstoffarten und Preisschwelle
  const fuels = Array.isArray(config.notifyFuels) && config.notifyFuels.length
    ? config.notifyFuels
    : ['e10'];
  const threshold = typeof config.notifyThreshold === 'number' ? config.notifyThreshold : null;

  console.log(`Konfiguration: Kraftstoffe=[${fuels.join(', ')}], Schwelle=${threshold !== null ? threshold + ' €' : 'keine'}`);

  // Tankerkönig API: Preise der Favoriten abfragen
  const ids = config.stations.join(',');
  const url = `https://creativecommons.tankerkoenig.de/json/prices.php?ids=${ids}&apikey=${config.apiKey}`;
  let prices;
  try {
    const r = await fetch(url);
    const data = await r.json();
    if (!data.ok) { console.log('Tankerkönig API-Fehler:', data.message); return; }
    prices = data.prices;
  } catch (err) {
    console.error('Fetch-Fehler:', err.message);
    return;
  }

  // Stationen auswerten
  const lines = [];

  for (const id of config.stations) {
    const p = prices[id];
    if (!p) { console.log(`  ${id}: keine Daten`); continue; }
    if (p.status !== 'open') { console.log(`  ${id}: geschlossen`); continue; }

    const name = (config.stationNames && config.stationNames[id])
      ? config.stationNames[id]
      : id.substring(0, 8);

    // Preise für alle konfigurierten Kraftstoffarten sammeln
    const parts = [];
    let belowThreshold = false;
    for (const f of fuels) {
      const price = p[f];
      if (price == null) {
        parts.push(`${FUEL_LABEL[f]}: —`);
      } else {
        parts.push(`${FUEL_LABEL[f]}: ${price.toFixed(2).replace('.', ',')} €`);
        if (threshold !== null && price <= threshold) belowThreshold = true;
      }
    }

    // Schwelle: Station nur aufnehmen wenn mindestens ein Preis ≤ Schwelle
    if (threshold !== null && !belowThreshold) {
      console.log(`  ${name}: über Schwelle (${threshold} €)`);
      continue;
    }

    lines.push(`• ${name}: ${parts.join(' | ')}`);
  }

  const fuelTitle = fuels.map(f => FUEL_LABEL[f]).join('/');
  console.log(`${fuelTitle}-Preise:\n` + (lines.join('\n') || '—'));

  if (!lines.length) {
    const reason = threshold !== null
      ? `Alle Stationen über Schwellenwert ${threshold.toFixed(2).replace('.', ',')} €`
      : 'Keine offenen Stationen gefunden';
    console.log(`${reason}. Keine Benachrichtigung.`);
    return;
  }

  const nowBerlinStr = nowBerlin.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
  const thresholdNote = threshold !== null ? ` (≤ ${threshold.toFixed(2).replace('.', ',')} €)` : '';
  const payload = JSON.stringify({
    title: `⛽ ${fuelTitle}-Preise${thresholdNote} – ${nowBerlinStr} Uhr`,
    body: lines.join('\n'),
    icon:  'https://obiwankiwibi.github.io/Kalorientracker-Claude/icon-192.png',
    url:   'https://obiwankiwibi.github.io/Kalorientracker-Claude/tankstellen_finder.html'
  });

  try {
    await webpush.sendNotification(sub, payload);
    await fbSet('/fuel_last_notif', Date.now());
    console.log('Push-Benachrichtigung gesendet!');
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
