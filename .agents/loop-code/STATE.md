# STATE — mémoire de la boucle

> Ce fichier doit permettre à une session **totalement fraîche** de reprendre sans rien
> redemander à l'utilisateur. Mis à jour à chaque fin d'itération.

## Où en est la boucle

| | |
|---|---|
| Itération | 0 — aucune. Seul `/loop-code init` a tourné |
| Mode | `init` |
| Profil généré le | 2026-09-15, depuis `develop` à `2f4224e` |
| Version des skills | v1 |
| Dernier lot traité | aucun |
| Verdict | — |

## Décompte des gates de la dernière itération

```
Gates : 18 vérifiés · 5 non applicables justifiés · 1 non vérifiable
```

Z > 0 bloque le merge. Le non vérifiable est **les cycles d'imports JS/TS** : aucun outil de
détection dans le dépôt (ni `madge`, ni `eslint-plugin-import` avec `import/no-cycle`). Outillage
manquant et escalade requise : voir `BACKLOG.md`, section « Lots d'outillage ».

## Prochain lot, et pourquoi lui

Le lot d'outillage « cycles d'imports ». Un gate non vérifiable bloque le merge et se traite
seul, avant tout P1 ou P2. Il commence par une escalade auprès de l'utilisateur, parce qu'il
suppose d'ajouter une dépendance.

Ensuite seulement, le P1 des deux lockfiles (`BACKLOG.md`).

## Ce qu'une session fraîche doit savoir pour reprendre

- **Où est l'état.** `.agents/` n'est pas suivi par git (décision du 2026-09-15, au même titre que
  `.claude/`) : ces fichiers sont locaux à la machine. Ce qui doit survivre à un clone s'écrit
  dans `orchestration/`, conformément à `AGENTS.md`.
- **Stacks.** Deux stacks noyau sans module dédié dans `references/stacks/` (TypeScript/Node,
  Rust) et une avec module (`gpu-realtime`, pour `packages/sdk-browser`). Pas de React, pas
  d'Electron, aucune UI dans `packages/` : les gates de design, de listes et de captures sont
  N/A, raison écrite au profil.
- **Compilateur natif.** `packages/asset-compiler-rust` se construit par `npm run build:native`
  et se mesure sur la scène Emerald du Lab, en lecture seule. Le cache de sortie va toujours hors
  dépôt (scratchpad ou dossier ignoré), jamais dans le Lab.
- **Portes.** `npm run validate` enchaîne format, lignes, duplication, lint, code inutilisé,
  build, build natif, structure, `.d.ts`, liens, tests JS/TS et Rust. La liste fait foi dans
  `scripts/validate.mjs`, pas ici : la relire plutôt que la recopier.
- **Conventions non écrites dans `AGENTS.md`.** Branche unique `develop`, worktree isolé par lot,
  jamais de `git stash`, port 5174 réservé à l'utilisateur : tout cela vient de
  `orchestration/JOURNAL.md`. `AGENTS.md` porte les portes de validation, la limite de 200
  lignes, le seuil de duplication, la lecture seule du Lab et l'interdiction de nommer le système
  de géométrie virtualisée d'Epic.
