'use strict';
const webpush = require('web-push');
const fetch   = require('node-fetch');

// Zeitfenster: Erinnerungen die 0–10 Minuten überfällig sind (passt zu 5-Min-Cron)
const WINDOW_MS = 10 * 60 * 1000;

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
  const data = await r.json();
  return data;
}

async function fbSet(path, data) {
  await fetch(FIREBASE_DB_URL + path + '.json', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data)
  });
}

async function main() {
  const [sub, tasks, sentMap] = await Promise.all([
    fbGet('/push_sub'),
    fbGet('/todos/tasks'),
    fbGet('/todo_push_sent')
  ]);

  if (!sub || !sub.endpoint) {
    console.log('Keine Push-Subscription. Beende.');
    return;
  }
  if (!tasks || typeof tasks !== 'object') {
    console.log('Keine Tasks in Firebase. Beende.');
    return;
  }

  const now = Date.now();
  const sent = sentMap || {};
  let notified = 0;

  for (const [taskId, task] of Object.entries(tasks)) {
    if (!task || !task.reminderAt || task.completed) continue;

    const due = task.reminderAt;
    const age = now - due;

    // Nur senden wenn 0–10 Minuten überfällig
    if (age < 0 || age > WINDOW_MS) continue;

    // Bereits gesendet für diese exakte Erinnerungszeit?
    if (sent[taskId] === due) continue;

    const payload = JSON.stringify({
      title: '🔔 Erinnerung',
      body:  task.title || 'To-Do fällig',
      icon:  'https://obiwankiwibi.github.io/Kalorientracker-Claude/icon-192.png',
      url:   'https://obiwankiwibi.github.io/Kalorientracker-Claude/todo.html'
    });

    try {
      await webpush.sendNotification(sub, payload);
      await fbSet('/todo_push_sent/' + taskId, due);
      console.log(`Push gesendet für Task "${task.title}" (fällig: ${new Date(due).toISOString()})`);
      notified++;
    } catch (err) {
      if (err.statusCode === 410 || err.statusCode === 404) {
        console.log('Subscription abgelaufen – wird aus Firebase gelöscht.');
        await fbSet('/push_sub', null);
        break;
      }
      console.error(`Push-Fehler für "${task.title}":`, err.message);
    }
  }

  if (notified === 0) console.log('Keine fälligen Erinnerungen.');
}

main().catch(err => { console.error(err); process.exit(1); });
