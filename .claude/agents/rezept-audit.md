---
name: rezept-audit
description: Prüft alle Rezepte in rezeptbuch.html auf Korrektheit — fehlende Katalogzuordnungen, unplausible Kalorienwerte und Preise. Repariert gefundene Probleme automatisch und pusht Fixes.
---

# Rezeptbuch-Audit

Führe eine vollständige Qualitätsprüfung aller Rezept-Seeds in `rezeptbuch.html` durch.

## 1. Volltest ausführen

Baue das Test-Script dynamisch aus dem aktuellen Stand der Datei (Zeilen für `_ing`, `UNIT_G`, `FOOD_ALIASES`, `COLOR_NORM`, `SKIP_WORDS`, `getCatalogMap`, `_tryMatch`, `_catalogLookup`, `calcNutrition` und das `seeds`-Array). Nutze dabei dasselbe Pattern wie der etablierte Volltest:

```bash
node /tmp/rezept_audit.js
```

Das Script gibt für jedes Rezept aus: Name, Portionen, kcal/Portion, Protein, KH, Fett, Preis/Portion, und eine Liste nicht gefundener Zutaten.

## 2. Probleme klassifizieren

**Kritisch (sofort reparieren):**
- Zutat nicht im Katalog gefunden → fehlende `FOOD_ALIASES` oder Katalog-Eintrag ergänzen
- kcal/Portion = 0 oder null → calcNutrition gibt kein Ergebnis zurück

**Plausibilitätsprüfung (melden, ggf. reparieren):**

| Kategorie        | Erwarteter Bereich kcal/Portion |
|------------------|---------------------------------|
| Beilage          | 50 – 500                        |
| Suppe            | 100 – 800                       |
| Hauptgericht     | 300 – 1200                      |
| Nudelgericht     | 400 – 1400                      |
| Auflauf          | 300 – 1000                      |
| Snack            | 100 – 600                       |
| Dessert          | 50 – 500 (pro Stück/Portion)    |
| Aufstrich/Dip    | 50 – 400                        |

Werte außerhalb des Bereichs → prüfe ob die Portionszahl falsch ist oder eine Einheit falsch zugeordnet wurde (z.B. `Stück` statt `Zehe` bei Knoblauch, `Stück` statt `g` bei Lauch).

**Preis-Plausibilität:**
- < 0.10 €/Portion → Preisinformationen fehlen möglicherweise
- > 8.00 €/Portion → Einheit-Fehler wahrscheinlich (z.B. unit-Parse-Problem)

## 3. Automatische Reparaturen

Für jedes kritische Problem:

1. **Fehlende Alias** → in `FOOD_ALIASES` in `rezeptbuch.html` eintragen (Abschnitt mit passendem Kommentar, z.B. `// Vegetables`, `// Meat`, etc.)
2. **Falsche Einheit im Seed** → Seed-Zeile korrigieren (z.B. `3,'Stück'` → `15,'g'` für Knoblauch; `3,'Stück'` → `750,'g'` für Lauch)
3. **Falsche Portionsanzahl** → `servings` im Seed anpassen
4. **Fehlendes Katalog-Lebensmittel** → in `catalog.js` mit realistischen Nährwerten ergänzen

## 4. Ergebnis-Bericht

Erstelle einen kompakten Bericht:

```
=== Rezeptbuch-Audit ===
Datum: YYYY-MM-DD
Rezepte geprüft: N

✅ VOLLSTÄNDIG (N Rezepte)
❌ FEHLENDE ZUTATEN (N Rezepte):
   - Rezeptname: Zutat1, Zutat2
⚠️  PLAUSIBILITÄTSPROBLEME (N Rezepte):
   - Rezeptname: 2500 kcal/Portion (Hauptgericht, erwartet 300–1200)

REPARATUREN DURCHGEFÜHRT:
   - Alias 'XYZ' → 'ABC' ergänzt
   - Rezept 'XYZ': servings 1 → 10 korrigiert
```

## 5. Pushen (nur wenn Änderungen)

Wenn Reparaturen durchgeführt wurden:

```bash
git add rezeptbuch.html sw.js catalog.js
git commit -m "fix(audit): Rezeptbuch-Audit – N Probleme behoben"
git push origin HEAD:main
git push -u origin claude/repo-access-hf67ge
```

SW-Cache nur bumpen wenn `rezeptbuch.html` oder `catalog.js` geändert wurden.

## Hinweise

- Zutaten mit Menge 0 werden von `calcNutrition` übersprungen — das ist korrekt (Gewürze "nach Belieben")
- `Blumenkohlwasser`, `Kochwasser` und ähnliche Kochflüssigkeiten sind immer korrekt mit 0 kcal
- Wenn ein Preis ungewöhnlich hoch ist: überprüfe ob `_parseUnitG()` die Einheit aus dem Katalog korrekt parst
