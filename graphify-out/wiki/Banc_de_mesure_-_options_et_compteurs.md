# Banc de mesure : options et compteurs

> 22 nodes · cohesion 0.11

## Key Concepts

- **Banc de mesure commun (scripts/mesure/banc.mjs)** (11 connections) — `scripts/mesure/README.md`
- **Tests transverses (test/)** (6 connections) — `test/README.md`
- **test/browser — 20 preuves de rendu dans un Chromium réel (18 lancées, 2 écartées via BROWSER_ECARTES)** (4 connections) — `test/README.md`
- **Assets du banc : .mesure/assets (WG_ASSETS), emerald-square et emerald-square-derived, clé du manifeste** (3 connections) — `scripts/mesure/README.md`
- **Compteurs de triangles et de repli (selectedTriangles, drawnTriangles, uncoveredTriangles, submittedTriangles, imageTenue, hiZ, repliSelectionGpu)** (3 connections) — `scripts/mesure/README.md`
- **null = non mesuré, jamais déduit ; « non mesuré » n'est pas zéro** (3 connections) — `scripts/mesure/README.md`
- **Témoins Three.js : three-nu (tout dessiné) et three-lod (THREE.LOD à trois niveaux, meshoptimizer)** (3 connections) — `scripts/mesure/README.md`
- **docs/TESTS.md — documentation complète des tests et bancs** (2 connections) — `test/README.md`
- **--moteur-avant / --moteur-apres : le moteur face au témoin dans une seule exécution** (2 connections) — `scripts/mesure/README.md`
- **test/appui — serveur de fixtures, pages servies au navigateur, jeux de cas** (2 connections) — `test/README.md`
- **test/justesse — 18 sondes de précision matérielle et 25 modules d'appui (une sonde porte un tiret)** (2 connections) — `test/README.md`
- **Règle test-gpu : lancés ∪ écartés == disque (test/test-gpu.mjs, test-gpu.test.mjs, pnpm run test:gpu)** (2 connections) — `test/README.md`
- **allowBuilds: esbuild — seul script de dépendance autorisé** (1 connections) — `pnpm-workspace.yaml`
- **Bancs de performance packages/<paquet>/bench (pnpm run perf:all)** (1 connections) — `scripts/mesure/README.md`
- **--camera-mobile : seule façon de voir le coût d'une sélection** (1 connections) — `scripts/mesure/README.md`
- **--chemin-math auto|js|wasm : le gouverneur arbitre par la mesure, aucun seuil dans le code** (1 connections) — `scripts/mesure/README.md`
- **Lampes génériques du contrat (lampes.mjs) : grille de ponctuelles, soleil directionnel, aucune scène nommée** (1 connections) — `scripts/mesure/README.md`
- **Mesurer une autre scène : compiler le glTF, --cache-avant/--cache-apres, --ressources** (1 connections) — `scripts/mesure/README.md`
- **Moteurs mesurés : webgl (exact-cluster-pages), webgpu (webgpu-page-raster), webgl2 (autonomous-pages-webgl)** (1 connections) — `scripts/mesure/README.md`
- **Options d'ombres : --budget-ombres, --ombres-pages off (porte d'identité des cartes), --empreinte-ombres (atlas 64 Mo)** (1 connections) — `scripts/mesure/README.md`
- **Chaque série est jouée dans une page neuve, fermée juste après** (1 connections) — `scripts/mesure/README.md`
- **test/integration — 10 tests d'architecture et de contrat (engineStructure, engineNoThree, public, dts-extensions), pnpm test** (1 connections) — `test/README.md`

## Relationships

- [Fixtures dorées KTX2, PNG, TGA](Fixtures_dorées_KTX2,_PNG,_TGA.md) (2 shared connections)
- [Fixtures TIFF et PSD, refus nommés](Fixtures_TIFF_et_PSD,_refus_nommés.md) (1 shared connections)

## Source Files

- `pnpm-workspace.yaml`
- `scripts/mesure/README.md`
- `test/README.md`

## Audit Trail

- EXTRACTED: 24 (86%)
- INFERRED: 4 (14%)
- AMBIGUOUS: 0 (0%)

---

*Part of the graphify knowledge wiki. See [index](index.md) to navigate.*