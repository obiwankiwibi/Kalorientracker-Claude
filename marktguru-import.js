/**
 * Marktguru Offer Importer
 *
 * Lädt aktuelle Angebote von api.marktguru.de und erzeugt offers.json
 * im Format des Einkaufslisten-Angebots-Moduls.
 *
 * Aufruf:   node marktguru-import.js [PLZ] [Händler-Filter]
 * Beispiel: node marktguru-import.js 57271 REWE,Lidl,ALDI
 *
 * Hinweis: Der API-Key ist öffentlich im HTML von marktguru.de eingebettet
 * (im Config-Script-Tag — jeder Besucher der Website sieht ihn).
 * Nutzungsbedingungen von Marktguru gelten trotzdem.
 */

const https = require('https');
const fs    = require('fs');
const path  = require('path');

// ── Konfiguration ───────────────────────────────────────────────────────────

const API_HOST = 'api.marktguru.de';
const API_KEY  = '8Kk+pmbf7TgJ9nVj2cXeA7P5zBGv8iuutVVMRfOfvNE=';
const CDN_BASE = 'https://cdn.marktguru.de';
const PAGE_SIZE = 100;
const MAX_PAGES = 20;   // max. 2000 Angebote pro Lauf

// Bekannte Händler-IDs (aus API-Antworten abgelesen, erweiterbar)
const RETAILER_IDS = {
  'REWE':     '126802',
  'Lidl':     '126860',
  'ALDI':     '126794',
  'Kaufland': '126843',
  'Penny':    '126869',
  'Netto':    '126865',
  'Edeka':    '126820',
  'Norma':    '126866',
  'dm':       '126816',
};

// ── Hilfsfunktionen ─────────────────────────────────────────────────────────

function apiGet(urlPath) {
  return new Promise((resolve, reject) => {
    https.get({
      hostname: API_HOST,
      path:     urlPath,
      headers:  {
        'X-apikey':   API_KEY,
        'Accept':     'application/json',
        'User-Agent': 'Mozilla/5.0 (compatible; EinkaufsApp-Importer/1.0)',
      },
    }, res => {
      let body = '';
      res.on('data', chunk => (body += chunk));
      res.on('end', () => {
        if (res.statusCode !== 200) {
          return reject(new Error(`HTTP ${res.statusCode}: ${body.slice(0, 200)}`));
        }
        try { resolve(JSON.parse(body)); }
        catch (e) { reject(new Error(`JSON-Fehler: ${body.slice(0, 200)}`)); }
      });
    }).on('error', reject);
  });
}

function toDate(isoString) {
  return isoString ? isoString.split('T')[0] : null;
}

function formatGrundpreis(refPrice, unitShort) {
  if (!refPrice) return '';
  const fmt = refPrice.toFixed(2).replace('.', ',');
  return `${fmt} €/${unitShort || 'Stk'}`;
}

function imageUrl(offerId) {
  return `${CDN_BASE}/offers/${offerId}/0.jpg`;
}

// ── Daten abrufen ────────────────────────────────────────────────────────────

async function fetchOffers(zipCode, retailerFilter) {
  const all = [];
  let offset = 0;
  let total  = null;

  const retailerIds = retailerFilter
    .map(n => RETAILER_IDS[n])
    .filter(Boolean);

  console.log(`\nAbrufen für PLZ ${zipCode}${retailerFilter.length ? ' · Filter: ' + retailerFilter.join(', ') : ''}...`);

  for (let page = 0; page < MAX_PAGES; page++) {
    let url = `/api/v1/offers?as=web&limit=${PAGE_SIZE}&offset=${offset}&zipCode=${zipCode}`;
    if (retailerIds.length) url += `&retailerIds=${retailerIds.join(',')}`;

    const data = await apiGet(url);

    if (total === null) {
      total = data.totalResults || 0;
      console.log(`  Gesamt: ${total} Angebote`);
    }

    const results = data.results || [];
    if (!results.length) break;

    all.push(...results);
    offset += results.length;
    process.stdout.write(`  [${all.length}/${total}]\r`);

    if (offset >= total) break;
    await new Promise(r => setTimeout(r, 400)); // höfliche Pause
  }

  console.log(`  ${all.length} Angebote geladen.`);
  return all;
}

// ── In App-Format umwandeln ──────────────────────────────────────────────────

function transform(raw) {
  const advertiser   = (raw.advertisers  || [])[0] || {};
  const validity     = (raw.validityDates || [])[0] || {};
  const category     = (raw.categories   || [])[0] || {};
  const unitShort    = raw.unit?.shortName || 'Stk';
  const hasImage     = (raw.images?.count || 0) > 0;

  return {
    id:          String(raw.id),
    name:        raw.product?.name || raw.description || 'Unbekannt',
    beschreibung: raw.description || '',
    haendler:    advertiser.name || '',
    preis:       raw.price ?? null,
    grundpreis:  formatGrundpreis(raw.referencePrice, unitShort),
    einheit:     unitShort,
    marke:       raw.brand?.name || '',
    kategorie:   category.name || '',
    gueltigVon:  toDate(validity.from),
    gueltigBis:  toDate(validity.to),
    bild:        hasImage ? imageUrl(raw.id) : null,
    favorit:     false,
    quelle:      'Marktguru',
    importDatum: new Date().toISOString(),
  };
}

// ── Hauptprogramm ────────────────────────────────────────────────────────────

async function main() {
  const zipCode       = process.argv[2] || '57271';
  const retailerArg   = process.argv[3] || '';
  const retailerFilter = retailerArg ? retailerArg.split(',').map(s => s.trim()).filter(Boolean) : [];
  const outFile       = path.join(__dirname, 'offers.json');

  const raw = await fetchOffers(zipCode, retailerFilter);

  // Transformieren
  const transformed = raw.map(transform);

  // Bestehende offers.json einlesen und mergen
  let existing = [];
  if (fs.existsSync(outFile)) {
    try {
      const prev = JSON.parse(fs.readFileSync(outFile, 'utf8'));
      existing = prev.offers || [];
    } catch (_) {}
  }

  const byId = Object.fromEntries(existing.map(o => [o.id, o]));
  transformed.forEach(o => { byId[o.id] = o; });

  // Abgelaufene entfernen
  const today  = new Date().toISOString().split('T')[0];
  const active = Object.values(byId).filter(o => !o.gueltigBis || o.gueltigBis >= today);
  const removed = Object.values(byId).length - active.length;

  const output = {
    lastUpdate:  new Date().toISOString(),
    zipCode,
    source:      'marktguru-api',
    totalCount:  active.length,
    offers:      active,
  };

  fs.writeFileSync(outFile, JSON.stringify(output, null, 2), 'utf8');

  console.log(`\n✓ offers.json gespeichert`);
  console.log(`  ${active.length} aktive Angebote`);
  if (removed) console.log(`  ${removed} abgelaufene entfernt`);
}

main().catch(err => {
  console.error('\nFehler:', err.message);
  process.exit(1);
});
