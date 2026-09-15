# Baseline

## Compilateur natif, scène Emerald — `9a7821a` ↔ `develop`

**INCOMPLÈTE, non conforme au protocole** (`~/.claude/shared/protocole-mesure.md` : médiane de 5
exécutions consécutives par côté, plancher de bruit sur 5 exécutions identiques). Seules
2 exécutions par côté ont pu tourner (alternées A,B,A,B) avant que la mesure de fond soit arrêtée
sur instruction explicite du coordinateur (machine chargée bien au-delà du seuil : 12 cœurs, load
1 min entre 58 et 88 pendant la mesure — 5 à 7× le nombre de cœurs). **Ne pas utiliser ces
chiffres comme référence de non-régression tant que la médiane de 5 n'a pas été prise sur machine
calme.** Détail complet (runs bruts, tableau, verdict) dans `.agents/loop-code/PERF.md`, section
« 2026-09-15 — compilateur natif, scène Emerald, comparaison `9a7821a` ↔ `develop` (MESURE
INCOMPLÈTE) ».

- Binaire A : commit `9a7821a` (avant le chantier « textures progressives »), construit dans un
  worktree séparé (`cargo build --release --locked --manifest-path
  packages/asset-compiler-rust/Cargo.toml`).
- Binaire B : `develop`, construit à `8ed6b8d` ; `develop` est passé depuis à `4d466dd` sans
  toucher au compilateur (`git diff --stat 8ed6b8d..4d466dd` = `.agents/loop-code/BACKLOG.md` et
  `.agents/loop-code/INVENTAIRE.md` seulement) — le binaire B reste valable pour `4d466dd`.
- Scène : `/Users/pasquelin/Applications/render-tech-lab/public/benchmark-assets/emerald-square`
  (Lab en lecture seule), mêmes arguments CLI des deux côtés (`full 150000 8 32768
  /assets/emerald/ qem-endpoints`).

### Indicatif sur 2 exécutions (PAS une médiane de 5)

| Métrique | A (médiane n=2) | B (médiane n=2) | Δ% B vs A |
|---|---|---|---|
| `wallMs` (CLI) | 24129.278 | 53057.472 | +119.89 % |
| real (s) | 26.515 | 54.925 | +107.15 % |
| user (s) | 12.795 | 20.255 | +58.30 % |
| sys (s) | 12.560 | 12.960 | +3.18 % |
| RSS max (Mo) | 1082.8 | 1236.6 | +14.21 % |
| cache de sortie (Mo) | 742.6 | 751.2 | +1.15 % |
| `importMs` (CLI) | 3208.397 | 5546.727 | +72.88 % |
| `clusterHierarchyPagesMs` (CLI) | 20920.684 | 47510.460 | +127.10 % |

Plancher de bruit : non mesurable (protocole exige 5 exécutions identiques). Indicatif seul, à
partir des 2 exécutions A : écart max/min déjà de +26.4 % sur `real` et +25.5 % sur `wallMs` sans
aucun changement de code — la machine était très bruitée.

**Verdict : non concluant.** L'écart brut (B ~2× plus lent) dépasse largement le bruit indicatif
observé sur A seul, mais l'échantillon (n=2, pas 5) et la charge machine extrême interdisent toute
conclusion de régression ou de gain au sens du protocole.

## Ce qui manque avant une comparaison conforme

1. ~~Construire `web-geometry-compiler` aux deux commits~~ — fait (voir ci-dessus).
2. **Refaire les 5 exécutions consécutives par côté** (10 au total, alternées A,B,A,B,…), machine
   calme (load ≤ nombre de cœurs), cache de sortie scratchpad supprimé à chaque fois — seules
   2 sur 5 ont pu tourner cette fois.
3. **Plancher de bruit** : 5 exécutions supplémentaires sans changement de code sur un seul côté,
   avant de comparer les deux médianes — non fait.

## Compteurs de référence, `develop` (2026-09-15, à `2f4224e` lors du dernier comptage)

- tests JS/TS : **705** passés, 0 échec (`npm test`) ;
- tests Rust : **151** passés (147 unitaires/intégration + 4 `tests/cli.rs`), 2 ignorés, 0 échec
  (`npm run test:native`) ;
- duplication : **0 clone** sur 723 fichiers analysés (`npm run check:duplicates`) ;
- code mort : 0 signalement `knip` (JS/TS), 0 avertissement `cargo clippy -D warnings` (Rust) ;
- liens documentaires : 54 liens locaux, 0 erreur (`npm run check:links`).

Ces compteurs n'ont pas été rejoués à cette session (le périmètre demandé était la mesure de
performance) ; ils servent de point de comparaison pour le prochain lot qui les rejouera.
