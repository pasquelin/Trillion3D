# Format compilé : grappes, pages, DAG

> 24 nodes · cohesion 0.12

## Key Concepts

- **Architecture cible : compilateur → cache → runtime → éditeur / cuisson → banc** (14 connections) — `docs/SPEC_MOTEUR_SANS_THREE.md`
- **Pyramide de textures cuite : queue dans le sidecar, tête en PNG** (6 connections) — `docs/FORMAT.md`
- **DAG de grappes (128 triangles, groupes 8–32)** (6 connections) — `docs/FORMAT.md`
- **clusters.json : manifeste compilé** (6 connections) — `docs/FORMAT.md`
- **Constantes de structure : 128 tri, groupes 8–32, page 128 Kio** (5 connections) — `docs/REFERENCE_UE5.md`
- **Octets par triangle : 8,7 chez la référence, ~48 chez nous** (5 connections) — `docs/REFERENCE_UE5.md`
- **A Deep Dive into Nanite Virtualized Geometry (Karis, Stubbe, Wihlidal, SIGGRAPH 2021)** (5 connections) — `docs/REFERENCE_UE5.md`
- **clusters.bin : annexe binaire WGMB v5** (4 connections) — `docs/FORMAT.md`
- **Page de géométrie meshopt WGP2** (4 connections) — `docs/FORMAT.md`
- **Paquets de diffusion 128 Kio et racines épinglées** (4 connections) — `docs/FORMAT.md`
- **C6 : textures en mips streamables, compression par blocs admise** (4 connections) — `docs/SPEC_MOTEUR_SANS_THREE.md`
- **Interdiction de copier le code Unreal** (3 connections) — `AGENTS.md`
- **Objets adressés par SHA-256 en .bin** (3 connections) — `docs/FORMAT.md`
- **C3 : DAG par objet, multi-matériaux** (3 connections) — `docs/SPEC_MOTEUR_SANS_THREE.md`
- **C4 : erreur certifiée monotone** (3 connections) — `docs/SPEC_MOTEUR_SANS_THREE.md`
- **C5 : paquets autonomes, ≤ 12 octets par triangle** (3 connections) — `docs/SPEC_MOTEUR_SANS_THREE.md`
- **Budget de résidence compté en pages, pas en octets** (2 connections) — `docs/REFERENCE_UE5.md`
- **C7 : manifeste binaire en colonnes typées** (2 connections) — `docs/SPEC_MOTEUR_SANS_THREE.md`
- **Risques et décisions (quantification, compression avec perte, FBX, WebGL2)** (2 connections) — `docs/SPEC_MOTEUR_SANS_THREE.md`
- **clustered-blend : mélange statique dans le DAG (format 2)** (1 connections) — `docs/FORMAT.md`
- **Hiérarchie de culling (BVH plat, 15 nombres par nœud)** (1 connections) — `docs/FORMAT.md`
- **errorModel dag-group-qem-v1** (1 connections) — `docs/FORMAT.md`
- **shared-blend : géométrie source non découpée** (1 connections) — `docs/FORMAT.md`
- **R7 : rendu WebGL2, parité au pixel** (1 connections) — `docs/SPEC_MOTEUR_SANS_THREE.md`

## Relationships

- [Mission, parité et backlog](Mission,_parité_et_backlog.md) (6 shared connections)
- [Protocole du compilateur : flux et pointeur](Protocole_du_compilateur_-_flux_et_pointeur.md) (5 shared connections)
- [Explorateur : streaming, cache et TAA](Explorateur_-_streaming,_cache_et_TAA.md) (3 shared connections)
- [Règles R1–R6 : socle, sélection, Hi-Z](Règles_R1–R6_-_socle,_sélection,_Hi-Z.md) (3 shared connections)
- [Stratégie lumière L0–L6 et rebond](Stratégie_lumière_L0–L6_et_rebond.md) (2 shared connections)
- [Notices des fixtures](Notices_des_fixtures.md) (1 shared connections)
- [integration · valeurConstante](integration_·_valeurConstante.md) (1 shared connections)
- [Mode lot, clé de cache et mesures](Mode_lot,_clé_de_cache_et_mesures.md) (1 shared connections)
- [Règles de travail et portes de validation](Règles_de_travail_et_portes_de_validation.md) (1 shared connections)

## Source Files

- `AGENTS.md`
- `docs/FORMAT.md`
- `docs/REFERENCE_UE5.md`
- `docs/SPEC_MOTEUR_SANS_THREE.md`

## Audit Trail

- EXTRACTED: 50 (89%)
- INFERRED: 6 (11%)
- AMBIGUOUS: 0 (0%)

---

*Part of the graphify knowledge wiki. See [index](index.md) to navigate.*