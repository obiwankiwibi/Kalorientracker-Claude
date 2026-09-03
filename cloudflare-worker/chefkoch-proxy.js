/*
  Chefkoch Recipe Proxy — Cloudflare Worker
  ==========================================
  Deployment:
    Cloudflare Dashboard → Workers & Pages → chefkoch-proxy → Edit code
    → diesen Code einfügen → Deploy

  Nutzt die inoffizielle Chefkoch-API (api.chefkoch.de/v2/recipes/{id})
  statt HTML-Scraping, um Blockierungen durch Bot-Erkennung zu umgehen.
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

  // Extract numeric recipe ID from URL
  // e.g. https://www.chefkoch.de/rezepte/2509601393881853/Pesto-Rosso.html
  const idMatch = targetUrl.match(/\/rezepte\/(\d+)\//);
  if (!idMatch) {
    return json({ error: 'Rezept-ID nicht in der URL gefunden – bitte eine direkte Rezept-URL verwenden' }, 400);
  }

  const recipeId = idMatch[1];
  const apiUrl = `https://api.chefkoch.de/v2/recipes/${recipeId}`;

  let data;
  try {
    const resp = await fetch(apiUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Linux; Android 12) AppleWebKit/537.36',
        'Accept': 'application/json',
      },
    });
    if (!resp.ok) return json({ error: `Chefkoch-API nicht erreichbar (${resp.status})` }, 502);
    data = await resp.json();
  } catch (e) {
    return json({ error: 'Netzwerkfehler: ' + String(e) }, 502);
  }

  // Flatten all ingredient groups into "amount unit name" strings
  const ingredientGroups = data.ingredientGroups || [];
  const ingredients = ingredientGroups.flatMap(group =>
    (group.ingredients || []).map(ing => {
      const name = (ing.name || '').trim();
      if (!name) return null;
      const amount = ing.amount ? String(ing.amount).replace('.', ',') : '';
      const unit   = (ing.unit || '').trim();
      if (!amount) return name;
      if (!unit)   return `${amount} Stück ${name}`;
      return `${amount} ${unit} ${name}`;
    }).filter(Boolean)
  );

  return json({
    title:       data.title     || '',
    servings:    data.servings  || 4,
    ingredients,
  });
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json; charset=utf-8' },
  });
}
