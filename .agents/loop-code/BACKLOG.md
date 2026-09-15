# Backlog

Format d'une entrée : priorité, preuve `fichier:ligne`, règle enfreinte, date d'apparition. Une
entrée sans preuve n'entre pas.

## P0

### P0 · outillage · cycles d'imports JS/TS

- **Preuve** : `eslint.config.mjs` (racine) — aucun plugin `eslint-plugin-import`, aucune règle
  `import/no-cycle` ; `package.json` — aucune dépendance `madge` ni équivalent ; recherche
  `grep -r madge package.json` et lecture de `eslint.config.mjs` en entier, 0 résultat.
- **Règle enfreinte** : `references/core/gates.md` #16 et `references/core/gate-merge.md` point
  16 — « aucun cycle d'imports nouveau » doit être rejouable à chaque lot avec une commande
  exacte ; `references/core/capacites.md` — un gate dont la surface existe (modules ESM avec
  imports croisés dans `packages/sdk-core`, `sdk-browser`, `sdk-node`, `page-codec`) et dont
  l'outil manque est NON VÉRIFIABLE, jamais N/A, et génère ce lot P0 automatiquement.
- **Apparue le** : 2026-09-15, `/loop-code init`.
- **Ce que corrige ce lot** : ajouter un outil de détection de cycles d'imports JS/TS (candidat :
  `eslint-plugin-import` + règle `import/no-cycle`, ou `madge --circular`) et l'exposer comme
  script npm dédié (`check:cycles` ou intégré à `lint`). **Ajouter une dépendance nouvelle exige
  un accord explicite de l'utilisateur** (`~/.claude/shared/escalade.md`, point 4) : ce lot
  commence par une escalade, pas par une installation.

## P1

Aucune entrée. Cet `init` n'a pas rejoué de rapport de dérive (`/loop-code watch`) : les gates
exécutés (duplication, code mort, structure, liens, format, lignes, tests) sont tous à 0
signalement sur `develop` à `2f4224e` au moment de l'audit — voir `.agents/loop-profile.md` et
`.agents/loop-code/BASELINE.md`.

## P2

Aucune entrée à ce stade.
