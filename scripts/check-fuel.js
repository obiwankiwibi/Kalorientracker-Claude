'use strict';
const webpush = require('web-push');
const fetch   = require('node-fetch');

const MIN_NOTIFY_GAP  = 100 * 60 * 1000; // 100 Minuten Anti-Spam (Intervall 2h)
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

// Tankempfehlung: kombiniert 7-Tage-Statistik + Tageszeit-Heuristik
function getTankEmpfehlung(currentPrices, history, hour, fuels, stationIds) {
  const primaryFuel = fuels[0];

  // Besten aktuellen Preis ermitteln
  let bestCurrent = null;
  for (const id of stationIds) {
    const v = currentPrices[`${id}_${primaryFuel}`];
    if (v != null && (bestCurrent === null || v < bestCurrent)) bestCurrent = v;
  }
  if (bestCurrent === null) return null;

  // 7-Tage-Durchschnitt aus History (max. 56 Einträge = ~7 Tage bei 2h-Intervall)
  const entries = Array.isArray(history) ? history.slice(-56) : [];
  const histVals = [];
  for (const e of entries) {
    for (const id of stationIds) {
      const v = e.prices && e.prices[`${id}_${primaryFuel}`];
      if (v != null) histVals.push(v);
    }
  }

  // Tageszeit-Klassifikation (ADAC-Muster für Deutschland)
  const isEveningWindow = hour >= 18 && hour < 21;   // günstigstes Fenster
  const isMorningWindow = hour >= 6  && hour < 9;    // zweites günstiges Fenster
  const isPeakTime      = (hour >= 9 && hour < 11) || (hour >= 12 && hour < 14);

  if (histVals.length < 5) {
    // Noch zu wenig Daten → nur Tageszeit-Heuristik
    if (isEveningWindow) return '🕕 Günstigstes Zeitfenster – jetzt tanken lohnt sich!';
    if (isMorningWindow) return '🌅 Guter Morgenzeitpunkt zum Tanken.';
    if (isPeakTime)      return '⏰ Preisspitze – heute Abend 18–20 Uhr abwarten.';
    return null;
  }

  const avg    = histVals.reduce((a, b) => a + b, 0) / histVals.length;
  const diffCt = Math.round((bestCurrent - avg) * 100); // Abweichung in Cent
  const isCheap     = diffCt <= -2;
  const isExpensive = diffCt >= 3;
  const absDiff     = Math.abs(diffCt);

  if (isCheap && isEveningWindow)
    return `🟢 Jetzt tanken! ${absDiff} ct unter 7-Tage-Ø & günstigstes Tagesfenster.`;
  if (isCheap && isMorningWindow)
    return `🟢 Guter Zeitpunkt – ${absDiff} ct unter 7-Tage-Ø.`;
  if (isCheap && !isPeakTime)
    return `✅ ${absDiff} ct unter Ø. Heute Abend 18–20 Uhr evtl. noch günstiger.`;
  if (isCheap && isPeakTime)
    return `✅ ${absDiff} ct unter Ø, aber Preisspitze. Heute Abend 18–20 Uhr warten.`;
  if (isExpensive && hour < 17)
    return `🔴 ${absDiff} ct über 7-Tage-Ø – heute Abend 18–20 Uhr oder morgen früh abwarten.`;
  if (isExpensive && isEveningWindow)
    return `⚠️ ${absDiff} ct über Ø – eher teuer. Falls möglich morgen früh (6–9 Uhr) tanken.`;
  if (isExpensive)
    return `⚠️ ${absDiff} ct über 7-Tage-Ø – morgen früh 6–9 Uhr abwarten.`;
  if (isEveningWindow)
    return '🕕 Günstiges Abend-Zeitfenster – guter Moment zum Tanken.';
  return null;
}

async function main() {
  // Zeitfenster: nur 7–22 Uhr (Europe/Berlin)
  const nowBerlin = new Date(new Date().toLocaleString('en-US', { timeZone: 'Europe/Berlin' }));
  const hour = nowBerlin.getHours();
  if (hour < NOTIFY_HOUR_START || hour >= NOTIFY_HOUR_END) {
    console.log(`Außerhalb der Benachrichtigungszeit (${NOTIFY_HOUR_START}–${NOTIFY_HOUR_END} Uhr). Aktuell: ${hour} Uhr.`);
    return;
  }

  const [sub, config, lastNotif, lastPrices, priceHistory] = await Promise.all([
    fbGet('/push_sub'),
    fbGet('/fuel_config'),
    fbGet('/fuel_last_notif'),
    fbGet('/fuel_last_prices'),
    fbGet('/fuel_price_history')
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
  const prev = lastPrices || {};
  const newPrices = {};

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
        const key = `${id}_${f}`;
        const prevPrice = prev[key];
        const arrow = prevPrice == null ? '' : price < prevPrice ? ' 🟢↓' : price > prevPrice ? ' 🔴↑' : '';
        newPrices[key] = price;
        parts.push(`${FUEL_LABEL[f]}: ${price.toFixed(2).replace('.', ',')} €${arrow}`);
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

  const empfehlung = getTankEmpfehlung(newPrices, priceHistory, hour, fuels, config.stations);
  const bodyLines = [...lines];
  if (empfehlung) bodyLines.push('', empfehlung);

  const payload = JSON.stringify({
    title: `⛽ ${fuelTitle}-Preise${thresholdNote} – ${nowBerlinStr} Uhr`,
    body: bodyLines.join('\n'),
    icon:  'https://obiwankiwibi.github.io/Kalorientracker-Claude/icon-192.png',
    url:   'https://obiwankiwibi.github.io/Kalorientracker-Claude/tankstellen_finder.html'
  });

  // History aktualisieren (max. 56 Einträge behalten)
  const updatedHistory = Array.isArray(priceHistory) ? [...priceHistory] : [];
  if (Object.keys(newPrices).length) {
    updatedHistory.push({ ts: Date.now(), prices: newPrices });
    if (updatedHistory.length > 56) updatedHistory.splice(0, updatedHistory.length - 56);
  }

  try {
    await webpush.sendNotification(sub, payload);
    await Promise.all([
      fbSet('/fuel_last_notif', Date.now()),
      Object.keys(newPrices).length ? fbSet('/fuel_last_prices', newPrices) : Promise.resolve(),
      updatedHistory.length ? fbSet('/fuel_price_history', updatedHistory) : Promise.resolve()
    ]);
    console.log('Push-Benachrichtigung gesendet!');
    if (empfehlung) console.log('Empfehlung:', empfehlung);
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
