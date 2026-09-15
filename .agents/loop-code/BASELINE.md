# Baseline

**À venir.** Cet `init` a vérifié que les commandes de mesure existent et s'exécutent ; il n'a
pas produit de baseline au sens du protocole (`~/.claude/shared/protocole-mesure.md` : médiane de
5 exécutions consécutives, plancher de bruit mesuré séparément, conditions identiques des deux
côtés). Une vraie baseline se prend au premier lot qui en a besoin, pas à `init`.

## Ce qui est déjà établi, pour amorcer ce premier lot

- **Compilateur natif, scène Emerald** — commande et une exécution isolée consignées dans
  `.agents/loop-profile.md` (section « Mesure du compilateur natif ») : `wallMs` 22136,
  `real 22.67 s`. Machine non garantie calme (autres sessions actives). À refaire en médiane de 5
  sur machine calme avant toute comparaison `9a7821a` ↔ `develop`.
- **Compteurs de référence, `develop` à `2f4224e`** (2026-09-15) :
  - tests JS/TS : **705** passés, 0 échec (`npm test`) ;
  - tests Rust : **151** passés (147 unitaires/intégration + 4 `tests/cli.rs`), 2 ignorés, 0 échec
    (`npm run test:native`) ;
  - duplication : **0 clone** sur 723 fichiers analysés (`npm run check:duplicates`) ;
  - code mort : 0 signalement `knip` (JS/TS), 0 avertissement `cargo clippy -D warnings` (Rust) ;
  - liens documentaires : 54 liens locaux, 0 erreur (`npm run check:links`).

Ces six compteurs servent de point de comparaison « nombre de tests / duplication / code mort ne
baissent pas » pour le premier lot réel, tant qu'aucune mesure de performance dédiée n'a encore
été prise en médiane de 5.

## Ce qui manque avant une comparaison `9a7821a` ↔ `develop` du compilateur

1. Construire `web-geometry-compiler` aux deux commits (`git worktree` séparé pour `9a7821a`,
   `npm run build:native` sur chacun).
2. 5 exécutions consécutives par côté sur la même scène Emerald, machine calme, cache de sortie
   scratchpad à chaque fois (jamais dans le Lab), médiane retenue par côté.
3. Plancher de bruit : 5 exécutions supplémentaires sans changement de code sur un seul côté,
   avant de comparer les deux médianes.
