# Inventaire des surfaces

Recensement de `packages/` au moment de l'`init` (2026-09-15, `develop` à `2f4224e`). Détail
complet des chemins dans `.agents/loop-profile.md`, section « Surfaces fonctionnelles ».

| Package | Rôle | Langage | Lignes-clé du budget (200 max) |
|---|---|---|---|
| `packages/asset-compiler-rust` | compilateur natif CLI (bibliothèque + 2 binaires) | Rust | vérifié par `npm run check:lines`, 0 dépassement au 2026-09-15 |
| `packages/sdk-core` | contrats/logique sans DOM ni Node ni React | TypeScript | idem |
| `packages/sdk-node` | hôte Node, lance le compilateur natif, CLI `web-geometry-compile` | TypeScript | idem |
| `packages/sdk-browser` | runtime de rendu navigateur WebGL/WebGPU (stack `gpu-realtime`) | TypeScript | idem |
| `packages/page-codec` | codec des pages de géométrie, partagé par les deux runtimes | TypeScript | idem |

Comptage exact du dernier passage de `jscpd` (`npm run check:duplicates`, 2026-09-15) :
javascript 65 fichiers / 6209 lignes, rust 140 fichiers / 16240 lignes, typescript 518 fichiers /
54965 lignes — 723 fichiers, 77414 lignes, 0 clone.

Aucune UI applicative dans `packages/` : pas de design system, pas de jetons, pas de composant de
liste partagé, pas de dossier de locales. `render-tech-lab` (banc externe) et
`public/benchmark-assets` restent hors inventaire : lecture seule, jamais modifiés par un lot de
ce dépôt.

## Audit `packages/asset-compiler-rust` — chantier textures progressives (2026-09-15)

Audit ponctuel (`loop-code-auditor`, mode `audit`), commit `753d8ab` (branche
`claude/rust-mesh-dominant-color-046701`, visant `develop` à `8ed6b8d`). Périmètre : tout
`packages/asset-compiler-rust/src`, attention particulière au code introduit entre `9a7821a` et
`develop` (`git diff --stat 9a7821a..HEAD -- packages/asset-compiler-rust/src` : 20 fichiers,
+1218/-13 lignes).

| Fichier du chantier | Lignes | Rôle |
|---|---|---|
| `src/texture_preview.rs` | 148 | orchestration de l'étape, décodage PNG/JPEG borné |
| `src/texture_preview/collect.rs` | 85 | sélection des textures couleur + seuil MASK par matériau |
| `src/texture_preview/reduce.rs` | 174 | pyramide 16×16→1×1, sRGB↔linéaire, prémultiplication, alpha_scale |
| `src/texture_preview/source.rs` | 85 | lecture des octets source (`bufferView` mappée ou `uri` sur disque) |
| `src/manifest_binary/preview.rs` | 52 | encodage des colonnes binaires `TEXTURE_PREVIEW_*` |
| `src/manifest_binary.rs` | ~190 | `MANIFEST_BINARY_VERSION` 2→3, `split`/`digests` |
| `src/manifest_binary/format.rs` | 102 | primitives de colonne, version bump |
| `src/compiler_build.rs` | 162 | point d'appel de `stage_texture_previews`, hors pool rayon |
| `src/import/textures.rs`, `src/import/materials.rs` | 149 / 94 | inchangés par ce diff, lus pour contexte (résolution FBX→glTF des textures/matériaux) |

Tous les fichiers du chantier restent sous le budget de 200 lignes (`AGENTS.md`,
`npm run check:lines`). `cargo clippy --release --locked --all-targets -- -D warnings` rejoué sur
cette branche : sortie `Finished \`release\` profile [optimized] target(s) in 0.39s`, 0
avertissement — aucun code mort ni `#[allow(...)]` détecté (recherche `grep -rn "#\[allow(" ...`
sur les fichiers du chantier : 0 résultat). Dépendances Cargo (`Cargo.toml`) toutes exercées dans
`src/` (`serde_json`, `sha2`, `rayon`, `memmap2`, `meshopt`, `ufbx`, `image` — `image` déjà limité
aux features `png`+`jpeg`, cohérent avec `decode()` qui rejette explicitement DDS/TGA/inconnu).

**Constats** : voir `.agents/loop-code/BACKLOG.md` — 1 P0 (garde de version absente dans
`prune_cache` face au bump `MANIFEST_BINARY_VERSION` 2→3), 3 P1 (étape textures hors pool rayon ;
copie mémoire évitable d'une image `bufferView` déjà mappée ; aucune fixture dorée bout en bout
avec une vraie image/texture MASK), 1 P2 (deux passages pixel au lieu d'un pour les textures
MASK). Aucun code mort, aucune dépendance inutilisée, aucun `#[allow]`, aucune valeur en dur non
justifiée (le seuil `alphaCutoff` par défaut de 0,5 suit le défaut glTF et reste surchargeable par
matériau ; la pyramide 16×16/5 niveaux est verrouillée par `TEXTURE_PREVIEW_VERSION`, qui oblige à
l'incrémenter si elle bouge).
