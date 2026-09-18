# Explorateur : streaming, cache et TAA

> 10 nodes · cohesion 0.20

## Key Concepts

- **createExplorer (explorateur navigateur)** (7 connections) — `docs/SDK.md`
- **maxFrameAllocationBytes (288 Mio)** (4 connections) — `docs/SDK.md`
- **Antialiasing temporel** (4 connections) — `docs/SDK.md`
- **textureSource: 'cache'** (4 connections) — `docs/SDK.md`
- **R3b : budget en pages distinctes, jamais en placements** (3 connections) — `docs/SPEC_MOTEUR_SANS_THREE.md`
- **scene.gltf autonome** (2 connections) — `docs/FORMAT.md`
- **pagesDetached vs cacheEvictions** (2 connections) — `docs/SDK.md`
- **R3 : streaming prioritaire, cache LRU borné** (2 connections) — `docs/SPEC_MOTEUR_SANS_THREE.md`
- **captureSurfaceView / flush / capture** (1 connections) — `docs/SDK.md`
- **R7b : une instance n'alloue aucune géométrie de plus** (1 connections) — `docs/SPEC_MOTEUR_SANS_THREE.md`

## Relationships

- [Format compilé : grappes, pages, DAG](Format_compilé_-_grappes,_pages,_DAG.md) (3 shared connections)
- [Mission, parité et backlog](Mission,_parité_et_backlog.md) (3 shared connections)
- [Règles R1–R6 : socle, sélection, Hi-Z](Règles_R1–R6_-_socle,_sélection,_Hi-Z.md) (2 shared connections)
- [Stratégie lumière L0–L6 et rebond](Stratégie_lumière_L0–L6_et_rebond.md) (2 shared connections)
- [Protocole du compilateur : flux et pointeur](Protocole_du_compilateur_-_flux_et_pointeur.md) (1 shared connections)
- [Règles de travail et portes de validation](Règles_de_travail_et_portes_de_validation.md) (1 shared connections)

## Source Files

- `docs/FORMAT.md`
- `docs/SDK.md`
- `docs/SPEC_MOTEUR_SANS_THREE.md`

## Audit Trail

- EXTRACTED: 19 (90%)
- INFERRED: 2 (10%)
- AMBIGUOUS: 0 (0%)

---

*Part of the graphify knowledge wiki. See [index](index.md) to navigate.*