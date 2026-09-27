---
name: rezept-einpflegen
description: Neues Rezept aus PDF, Bild oder Text in den Rezeptbuch-PWA einbauen. Parst Zutaten, prüft Katalogabdeckung, ergänzt fehlende FOOD_ALIASES und fügt den fertigen Seed in rezeptbuch.html ein.
---

# Rezept einpflegen

Du bekommst ein Rezept — als PDF, Bild, Text oder Chefkoch-Link. Deine Aufgabe:

1. **Rezept lesen** — lies alle Zutaten (Name, Menge, Einheit) und Zubereitungsschritte vollständig aus.

2. **Zutaten normalisieren** — wähle für jede Zutat Name und Einheit so, dass sie möglichst direkt im Katalog (`catalog.js`) gefunden wird. Nutze dabei:
   - Mengenangaben in `g`, `ml`, `l`, `kg` wo immer möglich (genaueste Kalorien)
   - Stückangaben (`Stück`, `Zehe`, `EL`, `TL`, `Bund`, `Dose`, `Becher`, `Scheibe`, `Kugel`, `Paar`) wenn die Menge nicht in Gramm angegeben ist
   - Knoblauch immer in `Zehe` (nicht `Stück`)
   - Lauch in Gramm (z.B. 750g), nicht in Stück

3. **Katalogabdeckung prüfen** — führe das folgende Node-Script aus, um fehlende Zutaten zu identifizieren:

```bash
node /tmp/test_single_recipe.js
```

   Erstelle dafür vorher `/tmp/test_single_recipe.js` mit den Zutaten des neuen Rezepts.
   Das Script nutzt das gleiche Pattern wie der Volltest:
   ```js
   const fs = require('fs');
   const catCode = fs.readFileSync('/home/user/Kalorientracker-Claude/catalog.js', 'utf8');
   const SUGGESTIONS = new Function(catCode + '\nreturn SUGGESTIONS;')();
   // ... (FOOD_ALIASES + _catalogLookup aus rezeptbuch.html)
   ```

4. **Fehlende Aliases ergänzen** — für jede nicht gefundene Zutat: prüfe welcher Katalog-Eintrag am besten passt und füge den Alias in `FOOD_ALIASES` in `rezeptbuch.html` ein. Regeln:
   - Seltene Spezialzutaten (< 5g / sehr teuer / keine Kalorien) → können ignoriert werden (Menge 0 lassen)
   - Generische Namen → auf nächsten passenden Katalog-Eintrag mappen
   - Neue Lebensmittel die wirklich fehlen → direkt in `catalog.js` ergänzen mit `{name, emoji, cat, price, unit, kcal, protein, carbs, fat}`

5. **Rezept-Seed erstellen** — baue einen vollständigen Seed nach diesem Muster:

```js
{id:'ck_REZEPT_ID', name:'Rezeptname', emoji:'🍽️', category:'KATEGORIE', servings:PORTIONEN, description:'Kurzbeschreibung',
 ingredients:[
   _ing('Zutatname','EMOJI',MENGE,'EINHEIT'),
   // ...
 ],
 steps:['Schritt 1','Schritt 2',...]},
```

   Kategorien: `'Suppe'`, `'Hauptgericht'`, `'Beilage'`, `'Nudelgericht'`, `'Auflauf'`, `'Snack'`, `'Dessert'`, `'Aufstrich'`, `'Sonstiges'`

6. **Seed einfügen** — füge den fertigen Seed in `rezeptbuch.html` in das `seeds`-Array ein (vor der schließenden `];` in der `seedRecipes()`-Funktion, d.h. direkt vor Zeile mit `];` nach den anderen Seeds).

7. **Volltest laufen lassen** — prüfe nach dem Einfügen, dass das neue Rezept im Gesamttest ohne fehlende Zutaten erscheint.

8. **SW-Cache bumpen** — erhöhe `kt-vXXX` in `sw.js` um 1.

9. **Committen und pushen** auf BEIDE Branches:
   ```bash
   git add rezeptbuch.html sw.js catalog.js
   git commit -m "feat: Rezept 'NAME' hinzugefügt"
   git push origin HEAD:main
   git push -u origin claude/repo-access-hf67ge
   ```

## Portionen schätzen

| Rezepttyp         | Default |
|-------------------|---------|
| Suppe (Topf)      | 4–6     |
| Pasta (Pfanne)    | 2–4     |
| Auflauf           | 4–6     |
| Beilage           | 3–4     |
| Aufstrich/Dip     | 6–10    |
| Dessert (Batch)   | nach Stückzahl |

## FOOD_ALIASES Konventionen

- Eintragsformat: `'kleinbuchstaben':'katalog eintrag kleinbuchstaben'`
- Kommentargruppen beibehalten (Vegetables, Meat, Dairy, Pantry, ...)
- Bei Käse allgemein → `'gouda'`; bei Hartkäse (Parmesan-artig) → `'parmesan'`
- Bei Brühe: flüssig → `'fleischbrühe'` / `'gemüsebrühe dose'`; Pulver/Würfel → `'brühepulver'`
