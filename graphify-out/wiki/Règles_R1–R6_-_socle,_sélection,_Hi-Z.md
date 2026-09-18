# Règles R1–R6 : socle, sélection, Hi-Z

> 14 nodes · cohesion 0.16

## Key Concepts

- **Surfaces séparées et éclairage différé (pipeline v1)** (5 connections) — `docs/SDK.md`
- **R5b : invariant du test Hi-Z (minorant strict vs majorant)** (5 connections) — `docs/SPEC_MOTEUR_SANS_THREE.md`
- **R5 : sélection GPU en compute (WebGPU), CPU (WebGL2)** (4 connections) — `docs/SPEC_MOTEUR_SANS_THREE.md`
- **Statut de l'occlusion Hi-Z** (3 connections) — `docs/FORMAT.md`
- **R1 : zéro dépendance Three.js dans sdk-browser** (3 connections) — `docs/SPEC_MOTEUR_SANS_THREE.md`
- **R6 : rendu WebGPU visibility buffer + éclairage différé** (3 connections) — `docs/SPEC_MOTEUR_SANS_THREE.md`
- **Géométrie 1 : la carte garde la coupe, le CPU ne la connaît plus** (3 connections) — `TODO.md`
- **Géométrie 9 : Hi-Z par visibilité passée, deux passes** (3 connections) — `TODO.md`
- **Visibility buffer shading** (2 connections) — `docs/FORMAT.md`
- **R1b : socle mathématique maison (profondeur inversée [0,1], lointain infini)** (2 connections) — `docs/SPEC_MOTEUR_SANS_THREE.md`
- **R5c : à profondeur égale, le vainqueur dépend de l'ordre de dessin** (2 connections) — `docs/SPEC_MOTEUR_SANS_THREE.md`
- **R6c : ce qu'un lecteur garde porte l'âge de ce qu'il décrit** (2 connections) — `docs/SPEC_MOTEUR_SANS_THREE.md`
- **R1e : workers et WebAssembly après mesure seulement** (1 connections) — `docs/SPEC_MOTEUR_SANS_THREE.md`
- **R5e : le tronc est réglé par la hiérarchie de culling** (1 connections) — `docs/SPEC_MOTEUR_SANS_THREE.md`

## Relationships

- [Format compilé : grappes, pages, DAG](Format_compilé_-_grappes,_pages,_DAG.md) (3 shared connections)
- [Mission, parité et backlog](Mission,_parité_et_backlog.md) (3 shared connections)
- [Explorateur : streaming, cache et TAA](Explorateur_-_streaming,_cache_et_TAA.md) (2 shared connections)
- [Stratégie lumière L0–L6 et rebond](Stratégie_lumière_L0–L6_et_rebond.md) (1 shared connections)

## Source Files

- `TODO.md`
- `docs/FORMAT.md`
- `docs/SDK.md`
- `docs/SPEC_MOTEUR_SANS_THREE.md`

## Audit Trail

- EXTRACTED: 19 (79%)
- INFERRED: 5 (21%)
- AMBIGUOUS: 0 (0%)

---

*Part of the graphify knowledge wiki. See [index](index.md) to navigate.*