# Système de tests et bancs de performance

Ce document décrit l'organisation, l'arborescence et les commandes du système unifié de tests et de bancs de performance de Web Geometry.

## 1. Vue d'ensemble de l'arborescence

Le dépôt distingue strictement les tests unitaires et d'intégration, les sondes de justesse matérielle GPU, et les bancs de performance :

```
packages/
  sdk-core/
    *.test.ts                # Tests unitaires du cœur portable
    bench/
      *.perf.mjs             # Bancs de performance unifiés du sdk-core
      oracles/*.mjs          # Fonctions oracles de référence bit-à-bit
      mesure.mjs             # Socle unifié de mesure (médiane, p95, assertions)
      ecart.mjs              # Comparateur bit-à-bit strict (-0, NaN, TypedArrays)
      baseline.mjs           # Suivi des régressions contre les baselines
  sdk-browser/
    *.test.ts                # Tests unitaires du runtime navigateur
    bench/
      *.perf.mjs             # Bancs de performance unifiés du sdk-browser
      oracles/*.mjs          # Fonctions oracles de référence bit-à-bit
test/
  justesse/                  # 40 sondes matérielles de justesse WebGPU
  *.test.mjs                 # Tests d'architecture, structure et typage
  *.browser.mjs              # Tests d'intégration sous navigateur réel
scripts/
  test-gpu.mjs               # Exécuteur unifié pour les tests matériels GPU
  mesure/
    perf/
      agrege.mjs             # Agrégateur des rapports de performance
      baselines/             # Données de référence par plateforme
```

---

## 2. Catégories de tests

### Tests unitaires et d'intégration (`npm test`)
- **Emplacement** : co-localisés `packages/*/*.test.ts`, `test/*.test.mjs`, `scripts/*.test.mjs`.
- **Rôle** : valident les algorithmes, la logique métier, la conformité de l'API et l'équivalence stricte avec les oracles de référence.
- **Exécution** :
  ```bash
  npm test
  ```

### Sondes de justesse matérielle GPU (`npm run test:gpu`)
- **Emplacement** : `test/justesse/` et `test/*.browser.mjs`.
- **Rôle** : vérifient la justesse du calcul sur la carte graphique (précision des shaders WGSL, planchers d'erreur, matrices de projection, coordonnées texels, relectures GPU).
- **Exécution** :
  ```bash
  npm run test:gpu
  ```
  Le runner `scripts/test-gpu.mjs` accepte également des filtres ou fichiers ciblés :
  ```bash
  node scripts/test-gpu.mjs test/justesse/hiz-*.mjs
  ```

### Bancs de performance unifiés (`npm run perf:all`)
- **Emplacement** : `packages/*/bench/*.perf.mjs`.
- **Rôle** : mesurent avec précision milliseconde/nanoseconde le temps d'exécution (médiane, p95, ops/s), valident l'égalité bit-à-bit avec l'oracle avant optimisation, comparent les déviations face aux baselines et produisent un rapport d'agrégation.
- **Exécution** :
  ```bash
  npm run perf:all      # Lance l'ensemble des 39 bancs et génère le rapport
  npm run perf:core     # Bancs sdk-core uniquement
  npm run perf:browser  # Bancs sdk-browser uniquement
  ```
- **Sorties** : les résultats agrégés sont écrits dans `.mesure/out/perf/perf-<date>.md` et `.json`.

---

## 3. Portes qualité et vérifications

Avant toute intégration ou commit, les portes qualité suivantes sont vérifiées :

| Commande | Rôle |
|---|---|
| `npm run check:lines` | Vérifie que chaque fichier JS/TS/Rust maintenu fait au plus 200 lignes physiques. |
| `npm run check:duplicates` | Vérifie l'absence de blocs dupliqués (≥12 lignes et ≥100 tokens via `jscpd`). |
| `npm run check:structure` | Contrôle l'étanchéité des frontières de paquets et l'absence de fuite hôte. |
| `npm run check:unused` | Détecte les exports et fichiers morts via `knip`. |
| `npm run check:changed` | Exécute les vérifications et tests uniquement sur les fichiers modifiés. |
| `npm run validate` | Porte finale de validation complète avant fusion. |
