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
