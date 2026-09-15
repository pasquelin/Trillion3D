# Mesure finale des temps par image (15 septembre 2026)

Base avant : `15297dd` (première tête de `develop` en manifeste binaire v4 qui compile).
Base après : `develop` à `db44508`. 300 images par série, seuil d'erreur pixel 1, hash de
coupe identique entre avant/après/témoin sur chaque vue, aucun incident GPU (pas de perte de
périphérique). Charge machine relevée entre 15 et 26 pendant la mesure (uptime 16,6 / 26,0 /
22,7 / 14,9). 18 erreurs 404 `lights.json` (9 par moteur, doublées en message console), sans
effet sur les relevés — fichier absent du jeu de test, non lié au calcul mesuré.

Commandes : `node scripts/mesure/banc.mjs --moteur webgpu --avant 15297dd --apres db44508
--vues generale,sol,rue,detail --images 300 --pixelError 1 --max-pages 100000 --out
.mesure/finale3-webgpu`, puis la même avec `--moteur webgl`.

## WebGPU

| Vue | px avant/après | px A/A | cpuFrame p50 avant → après | cpuSelect p50 avant → après | gpuFrame p50 avant → après |
| --- | --- | --- | --- | --- | --- |
| generale | 4391 px (max canal 129) | 0 px | 4,10 → 3,80 ms | — | 10,72 → 11,83 ms |
| sol | 0 px | 0 px | 2,00 → 2,60 ms | — | 3,65 → 6,49 ms |
| rue | 71969 px (max canal 199) | 0 px | 2,10 → 2,60 ms | — | 5,59 → 6,01 ms |
| detail | 68879 px (max canal 159) | 0 px | 1,90 → 2,80 ms | — | 4,30 → 6,58 ms |

## WebGL

| Vue | px avant/après | px A/A | cpuFrame p50 avant → après | cpuSelect p50 avant → après | gpuFrame p50 avant → après |
| --- | --- | --- | --- | --- | --- |
| generale | 177322 px (max canal 217) | 0 px | 9,60 → 8,80 ms | 2,40 → 2,00 ms | — |
| sol | 903881 px (max canal 175) | 0 px | 2,70 → 2,40 ms | 0,80 → 0,70 ms | — |
| rue | 734898 px (max canal 234) | 0 px | 2,50 → 2,30 ms | 0,80 → 0,70 ms | — |
| detail | 612424 px (max canal 216) | 0 px | 2,00 → 1,80 ms | 0,60 → 0,60 ms | — |

`gpuFrame` non mesuré par ce harnais pour WebGL (colonne absente de la sortie) ; `cpuSelect`
non mesuré pour WebGPU (sélection intégrée au frame CPU). Sources : `.mesure/out/finale3-webgpu/`
et `.mesure/out/finale3-webgl/` (`mesure.json`, `resume.md`).

## Ce que la mesure dit

Entre `15297dd` et `develop` (`db44508`) sont passés les lots des autres sessions : ombres,
rebond, eau, transparents GPU, instances, budget de pages. Les écarts de pixels par vue (de
0 px sur `sol` en WebGPU à plus de 900 000 px sur `sol` en WebGL) et la hausse du temps GPU
générale en WebGPU (10,72 → 11,83 ms) viennent de ces lots, pas des optimisations de calcul de
cet audit : le témoin A/A à 0 px sur chaque vue montre que le harnais est stable, l'écart
avant/après est donc réel et porté par le contenu ajouté entre les deux commits (éclairage,
eau, transparents), pas par un bruit de mesure. Cette campagne ne prouve ni ne réfute aucune
optimisation individuelle de l'audit : c'est une mesure de bout en bout sur deux points du
dépôt distants de plusieurs sessions, pas un A/B isolé sur un seul changement. La preuve de
chaque optimisation reste le banc Node par lot (`AUDIT_MATH_BILAN.md`, bancs commis). Les lots
A, B, C et textures 1-3 ne sont pas couverts par cette campagne : ils sont antérieurs au
manifeste v4 et ne rejouent plus sur un cache aussi ancien (voir « Essais ratés »).

## Essais ratés

- **`.mesure/finale-*`** (base `a59c05a`) : refusée à l'exécution — `EngineError: Expected
  manifest binary version 2, received 4`. Le format du manifeste binaire a changé de version
  entre `a59c05a` et `develop` ; une base aussi ancienne ne charge plus le cache produit par le
  compilateur courant.
- **`.mesure/finale2-*`** (base `ed6369f`) : refusée à la compilation — export
  `PREVIEW_LEVEL_SIZES` absent. `ed6369f` est un commit intermédiaire d'un chantier texture
  (passage du sidecar en version 4) qui ne compile pas isolément ; il faut un commit postérieur
  où ce chantier est terminé. `15297dd` est la première tête de `develop` à la fois en
  manifeste v4 et compilable, d'où son choix comme base « avant ».
