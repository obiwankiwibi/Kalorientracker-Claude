/*
  Chefkoch Recipe Proxy — Cloudflare Worker
  ==========================================
  Deployment (einmalig, kostenlos):
    1. https://dash.cloudflare.com → Workers & Pages → Create Worker
    2. Diesen Code einfügen, Deploy klicken
    3. Die Worker-URL (z. B. https://chefkoch.DEIN-NAME.workers.dev) in der
       Einkaufsliste-App unter "Rezept importieren → Worker einrichten" eintragen

  Der Worker fetcht eine Chefkoch-Seite und extrahiert die Zutaten aus dem
  strukturierten JSON-LD-Block (Schema.org/Recipe), der auf jeder Rezept-Seite
  eingebettet ist. Keine Daten werden gespeichert.
*/

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

addEventListener('fetch', event => {
  if (event.request.method === 'OPTIONS') {
    event.respondWith(new Response(null, { status: 204, headers: CORS }));
    return;
  }
  event.respondWith(handleRequest(event.request));
});

async function handleRequest(request) {
  const { searchParams } = new URL(request.url);
  const targetUrl = searchParams.get('url') || '';

  if (!targetUrl || !targetUrl.includes('chefkoch.de')) {
    return json({ error: 'Nur Chefkoch-URLs erlaubt' }, 400);
  }

  let html;
  try {
    const resp = await fetch(targetUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; RecipeImporter/1.0)',
        'Accept-Language': 'de-DE,de;q=0.9',
      },
      redirect: 'follow',
    });
    if (!resp.ok) return json({ error: `Seite nicht erreichbar (${resp.status})` }, 502);
    html = await resp.text();
  } catch (e) {
    return json({ error: 'Netzwerkfehler: ' + String(e) }, 502);
  }

  // Extract all JSON-LD blocks and find the Recipe schema
  const recipe = extractRecipe(html);
  if (!recipe) return json({ error: 'Rezept nicht gefunden – prüfe ob die URL eine Rezept-Seite ist' }, 404);

  let servings = 4;
  if (recipe.recipeYield) {
    const m = String(recipe.recipeYield).match(/\d+/);
    if (m) servings = parseInt(m[0], 10);
  }

  return json({
    title: recipe.name || '',
    servings,
    ingredients: recipe.recipeIngredient || [],
  });
}

function extractRecipe(html) {
  const scriptRe = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = scriptRe.exec(html)) !== null) {
    try {
      const data = JSON.parse(m[1]);
      const candidates = Array.isArray(data) ? data : [data];
      for (const item of candidates) {
        const types = Array.isArray(item['@type']) ? item['@type'] : [item['@type']];
        if (types.includes('Recipe')) return item;
        // Nested inside @graph
        if (item['@graph']) {
          const found = item['@graph'].find(x => {
            const t = Array.isArray(x['@type']) ? x['@type'] : [x['@type']];
            return t.includes('Recipe');
          });
          if (found) return found;
        }
      }
    } catch (_) { /* skip malformed blocks */ }
  }
  return null;
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json; charset=utf-8' },
  });
}
