# État de la boucle loop-code

Dépôt `/Users/pasquelin/Applications/webGeometry`. Profil : `.agents/loop-profile.md` (v1,
généré le 2026-09-15).

## Dernière itération

**Lot P0 · cache/provenance · `prune_cache` face à un sidecar incompatible** — 2026-09-15,
branche `loop-code/p0-prune-cache` (depuis `develop` à `4d466dd`), worktree
`.claude/worktrees/agent-ac1babe36eb77551a`. **En revue, non fusionnée.**

Comportement retenu : un scope qu'on ne recompile pas est lu **avant** toute suppression ; si son
`clusters.bin` est absent ou porte une autre `MANIFEST_BINARY_VERSION`, `prune_cache` échoue avec
le code `UNSUPPORTED_FORMAT` et ne supprime rien (le CLI n'expose aucune purge forcée, cf.
`src/compiler_args.rs` : aucune option à ajouter pour ce lot). Fichiers : `src/compiler_prune.rs`,
`src/tests/part7.rs` (test neuf), `src/tests/part6.rs` (appel adapté au `Result`).

Gates rejoués dans `packages/asset-compiler-rust` puis à la racine, tous verts :
`cargo clippy --release --all-targets -- -D warnings`, `cargo fmt --check` (exit 0),
`cargo test --release` (**152 passés, 0 échec, 2 ignorés** contre 151/0/2 en référence),
`npm run check:lines`, `npm run check:duplicates` (0 clone), `npm run check:unused` (exit 0).
Mesure de performance : **non applicable**, lot de robustesse (aucun chemin chaud touché).

## Prochain lot, et pourquoi lui

**P0 · outillage · cycles d'imports JS/TS · aucun outil de détection (`madge` ou
`eslint-plugin-import` + règle `import/no-cycle`) · permettrait de vérifier le gate #16 du
gate-merge (« aucun cycle d'imports nouveau »).**

C'est le seul P0 ouvert : per `capacites.md`, un gate NON VÉRIFIABLE bloque le merge et se traite
seul, avant tout P1/P2. Voir `.agents/loop-code/BACKLOG.md` pour le détail et les options.

Après ce P0 : aucun P1 ni P2 n'a été détecté par cet `init` (il ne rejoue pas les rapports de
duplication/code mort en mode dérive — ceux relevés ici sont à 0 signalement le 2026-09-15 sur la
branche `loop-code-init` = `develop` inchangée). Un audit de dérive (`/loop-code watch`) ou une
itération complète (`/loop-code`) partira de cet état.

## Ce qu'une session fraîche doit savoir pour reprendre

- Le profil couvre tout le dépôt mais distingue deux stacks noyau sans module dédié (TypeScript/
  Node, Rust) et une stack avec module (`gpu-realtime`, `packages/sdk-browser`). Pas de React, pas
  d'Electron, pas d'UI dans `packages/` : les gates de design/listes/captures sont N/A.
- Le compilateur natif (`packages/asset-compiler-rust`) se construit avec `npm run build:native`
  et se mesure sur la scène Emerald du Lab (lecture seule) :
  `/Users/pasquelin/Applications/render-tech-lab/public/benchmark-assets/emerald-square`. Le
  cache de sortie va toujours hors dépôt (scratchpad ou dossier ignoré), jamais dans le Lab.
- `npm run validate` = format:check, check:lines, check:duplicates, lint, check:unused, build,
  build:native, check:structure, check:dts, check:links, test, test:native — tous verts au
  moment de cet `init` (voir `.agents/loop-profile.md`, section Capacités, pour chaque sortie).
- Deux lockfiles sont suivis par git (`package-lock.json`, `pnpm-lock.yaml`) ; npm fait foi, voir
  la section Contradictions du profil.
