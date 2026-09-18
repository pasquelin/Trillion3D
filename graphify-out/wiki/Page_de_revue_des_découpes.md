# Page de revue des découpes

> 9 nodes · cohesion 0.28

## Key Concepts

- **ligne(texture) — une ligne de la liste** (5 connections) — `packages/asset-compiler-rust/src/cutout/page.html`
- **Page « Découpes à trancher » (revue découpe / vitre des textures)** (4 connections) — `packages/asset-compiler-rust/src/cutout/page.html`
- **DONNEES (__DONNEES__ injecté : sheet.textures[sha256], textures[], model, dossier)** (3 connections) — `packages/asset-compiler-rust/src/cutout/page.html`
- **choix(texture) — radios Découpe / Vitre** (2 connections) — `packages/asset-compiler-rust/src/cutout/page.html`
- **enregistrer(blob) — showSaveFilePicker ou téléchargement de decoupes.json** (2 connections) — `packages/asset-compiler-rust/src/cutout/page.html`
- **repondue() — feuille clonée avec les réponses cutout** (2 connections) — `packages/asset-compiler-rust/src/cutout/page.html`
- **pixels(texture) — base64 → Uint8ClampedArray** (1 connections) — `packages/asset-compiler-rust/src/cutout/page.html`
- **resume() — compteur textures / découpes / modèle** (1 connections) — `packages/asset-compiler-rust/src/cutout/page.html`
- **toile(texture, octets, alphaSeul) — canvas sur damier** (1 connections) — `packages/asset-compiler-rust/src/cutout/page.html`

## Relationships

- [Fixtures dorées KTX2, PNG, TGA](Fixtures_dorées_KTX2,_PNG,_TGA.md) (1 shared connections)

## Source Files

- `packages/asset-compiler-rust/src/cutout/page.html`

## Audit Trail

- EXTRACTED: 10 (91%)
- INFERRED: 0 (0%)
- AMBIGUOUS: 1 (9%)

---

*Part of the graphify knowledge wiki. See [index](index.md) to navigate.*