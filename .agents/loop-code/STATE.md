# État de la boucle loop-code

Dépôt `/Users/pasquelin/Applications/webGeometry`. Profil : `.agents/loop-profile.md` (v1,
généré le 2026-09-15).

## Dernière itération

Aucune. Ce dépôt vient d'exécuter `/loop-code init` (2026-09-15, branche `loop-code-init`,
worktree `.claude/worktrees/loop-code-init`, depuis `develop` à `2f4224e`). Aucun lot de
correction n'a encore été traité.

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
