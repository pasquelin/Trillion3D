# Règles de travail et portes de validation

> 18 nodes · cohesion 0.13

## Key Concepts

- **Les quatre commandes : test, test:gpu, perf:all, validate** (6 connections) — `docs/TESTS.md`
- **Mesurer avant d'optimiser** (5 connections) — `AGENTS.md`
- **Dépôt autonome, sans voisin sur disque** (3 connections) — `AGENTS.md`
- **pnpm run test:gpu (preuves matérielles)** (3 connections) — `docs/SDK.md`
- **B4 : banc du dépôt scripts/mesure/banc.mjs** (3 connections) — `docs/SPEC_MOTEUR_SANS_THREE.md`
- **Bancs de performance confrontés à un oracle** (3 connections) — `docs/TESTS.md`
- **Baselines hors dépôt et propres à la machine** (3 connections) — `docs/TESTS.md`
- **Portes qualité : check:lines, duplicates, structure, unused** (3 connections) — `docs/TESTS.md`
- **Sondes de justesse GPU (test/justesse/) et preuves navigateur** (3 connections) — `docs/TESTS.md`
- **Limite de 200 lignes par fichier source** (2 connections) — `AGENTS.md`
- **Porte pnpm run validate** (2 connections) — `AGENTS.md`
- **Diagnostics onDiagnostic, cpu-timing, gpu-timing** (2 connections) — `docs/SDK.md`
- **web-geometry-oracle : path tracer du compilateur** (2 connections) — `docs/SDK.md`
- **B2bis : antialiasing temporel, contrat de preuve** (2 connections) — `docs/SPEC_MOTEUR_SANS_THREE.md`
- **R9 : métriques honnêtes, null plutôt que déduit** (2 connections) — `docs/SPEC_MOTEUR_SANS_THREE.md`
- **BROWSER_ECARTES : montage, régression, double périmé** (2 connections) — `docs/TESTS.md`
- **Mesure 1 : le Lab supprimé, aucune liaison** (2 connections) — `TODO.md`
- **Arborescence des tests : le test unitaire vit à côté de sa source** (1 connections) — `docs/TESTS.md`

## Relationships

- [Mission, parité et backlog](Mission,_parité_et_backlog.md) (4 shared connections)
- [Stratégie lumière L0–L6 et rebond](Stratégie_lumière_L0–L6_et_rebond.md) (2 shared connections)
- [Explorateur : streaming, cache et TAA](Explorateur_-_streaming,_cache_et_TAA.md) (1 shared connections)
- [Format compilé : grappes, pages, DAG](Format_compilé_-_grappes,_pages,_DAG.md) (1 shared connections)
- [Protocole du compilateur : flux et pointeur](Protocole_du_compilateur_-_flux_et_pointeur.md) (1 shared connections)

## Source Files

- `AGENTS.md`
- `TODO.md`
- `docs/SDK.md`
- `docs/SPEC_MOTEUR_SANS_THREE.md`
- `docs/TESTS.md`

## Audit Trail

- EXTRACTED: 25 (86%)
- INFERRED: 4 (14%)
- AMBIGUOUS: 0 (0%)

---

*Part of the graphify knowledge wiki. See [index](index.md) to navigate.*