# Mesures de performance

Historique des mesures prises par la boucle. Vide à `init` au sens du protocole (pas de médiane
de 5) ; une observation isolée est consignée ci-dessous car elle a coûté une vraie exécution et
sert de point de départ, **pas** de baseline.

## 2026-09-15 — compilateur natif, scène Emerald, une exécution (non une médiane)

- Commande : voir `.agents/loop-profile.md`, section « Mesure du compilateur natif ».
- Binaire : `packages/asset-compiler-rust/target/release/web-geometry-compiler`, construit par
  `npm run build:native` sur `develop` à `2f4224e`.
- Résultat : `wallMs` 22136,09 (métrique interne du compilateur), `real 22.67 s` /
  `user 19.31 s` / `sys 13.83 s` (`/usr/bin/time -p`) ; `clusterHierarchyPagesMs` 20640,94,
  `importMs` 1494,998 ; 10 046 405 triangles source = triangles sélectionnés, 281 primitives,
  1030 nœuds, `status: ready`.
- Conditions : machine partagée avec d'autres sessions actives au moment de la mesure (voir
  `ps aux` cité dans le profil) — **pas** les conditions du protocole de mesure. Ne pas comparer
  ce chiffre à une mesure future sans le refaire dans des conditions contrôlées.
- Cache de sortie : scratchpad de session, supprimé après la mesure (751 Mo). Jamais écrit dans
  `render-tech-lab`.

## Moteur de rendu (WebGL/WebGPU)

Aucune mesure prise à cet `init`. Outil : `node scripts/mesure/banc.mjs …` (voir
`scripts/mesure/README.md` et `.agents/loop-profile.md`). Non exécuté : hors périmètre de
l'audit compilateur demandé, et machine déjà occupée par d'autres sessions au moment de l'audit.
