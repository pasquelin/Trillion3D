# BASELINE

La référence contre laquelle chaque lot se compare. **Regénérée uniquement sur décision
explicite** : une baseline qui suit le code ne mesure plus rien.

Générée le : 2026-09-15 · commit : `2f4224e` · conditions : `npm run validate` sur machine
partagée avec d'autres sessions actives ; aucune mesure de performance prise dans les conditions
du protocole.

> **Ce n'est pas encore une baseline de performance.** `init` a vérifié que les commandes
> existent et s'exécutent. Les deux tables ci-dessous sont vides parce que personne n'a mesuré,
> pas parce que la mesure vaut zéro. Une vraie baseline se prend au premier lot qui en a besoin.

## Plancher de bruit

| Mesure | Étendue sur 5 exécutions sans changement |
|---|---|

**Tout écart inférieur au plancher se rapporte « sous le plancher de bruit », jamais comme une
amélioration.**

## Mesures de référence — médiane de 5

| Mesure | Commande | run1 | run2 | run3 | run4 | run5 | MÉDIANE |
|---|---|---|---|---|---|---|---|

Une observation isolée du compilateur sur la scène Emerald existe, en conditions non contrôlées :
elle est consignée dans `PERF.md`, section « Mesures écartées », et ne sert de référence à rien.

## Compteurs

| Compteur | Valeur | Commande |
|---|---|---|
| fichiers de test | non relevé à `2f4224e` | — |
| **cas de test** | 705 JS/TS · 151 Rust (147 + 4 CLI), 2 ignorés | `npm test` · `npm run test:native` |
| blocs dupliqués | 0 clone sur 723 fichiers | `npm run check:duplicates` |
| exports sans appelant | 0 | `npm run check:unused` (`knip`) |
| cycles d'imports | **non mesurable** — aucun outil dans le dépôt | voir `BACKLOG.md`, lots d'outillage |
| dépendances en double version | npm : 3 (`eslint-visitor-keys`, `ignore`, `hookified`), toutes transitives · cargo : 1 (`miniz_oxide`) | `npm dedupe --dry-run` · `cargo tree -d` |
| taille de l'artefact | non relevé — `dist/` est la sortie ESM 1:1 de `tsc`, aucun bundle applicatif | — |

**Le compte de cas de test se compare à chaque lot. Une baisse sans justification écrite est un
rejet.** Attention : `develop` a avancé depuis `2f4224e` ; rejouer les commandes avant de
comparer, ces valeurs ne se revalident pas toutes seules.

## Capacités au moment de la baseline

| Capacité | État | Raison si N/A · outillage si non vérifiable |
|---|---|---|
| typecheck · lint · build · build natif · format · lignes · structure · `.d.ts` · liens | VÉRIFIÉ | — |
| test JS/TS · test Rust · e2e | VÉRIFIÉ | e2e via `packages/sdk-node/*.test.mjs`, sous-processus réel du binaire |
| duplication · code mort JS/TS · code mort Rust | VÉRIFIÉ | `jscpd` · `knip` · `cargo clippy -D warnings` |
| dépendances en double version (npm, cargo) | VÉRIFIÉ | outillage ad hoc, pas de script npm dédié |
| mesure — compilateur (Emerald) | commande VÉRIFIÉE, mesure NON | médiane de 5 jamais prise |
| package | N/A | `"private": true`, aucune chaîne de distribution |
| analyse de bundle | N/A | aucun bundler en dépendance |
| listes · design · captures · i18n · Electron | N/A | aucune UI ni locale dans `packages/` |
| **cycles d'imports JS/TS** | **NON VÉRIFIABLE** | aucun outil ; **bloque le merge** ; lot d'outillage ouvert |
