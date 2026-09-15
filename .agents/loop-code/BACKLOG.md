# BACKLOG

Une entrée par ligne, triée par priorité puis par chemin. **Une entrée sans preuve
`fichier:ligne` n'entre pas.**

Une entrée sort d'ici de deux façons : **corrigée**, ou **arbitrée par l'utilisateur** — et dans
le second cas la décision s'écrit ailleurs et l'entrée disparaît. Une entrée laissée « pour plus
tard » reste, et compte.

## P0 — casse un invariant, perd du travail, ou rend une mesure non fiable

| Fichier:ligne | Constat | Preuve | Apparu le |
|---|---|---|---|

## P1 — fait diverger deux surfaces, ou dégrade une mesure au-delà des seuils

| Fichier:ligne | Constat | Preuve | Apparu le |
|---|---|---|---|
| `pnpm-lock.yaml` (racine) | Second arbre de dépendances suivi par git, que rien n'installe et que personne ne lit, mais que quelqu'un régénère encore | `.github/workflows/quality.yml` n'utilise que `npm ci` ; `AGENTS.md` ne parle qu'en `npm run …` ; pourtant `git log -1 -- pnpm-lock.yaml` = `04fa5f0` (14 sept. 20:08), **plus récent** que `package-lock.json` (`5ae3b83`, 14 sept. 15:58) | 2026-09-15 |

## P2 — dette de forme, sans effet observable

| Fichier:ligne | Constat | Preuve | Apparu le |
|---|---|---|---|

## Lots d'outillage — ouverts par un gate NON VÉRIFIABLE

**Un gate non vérifiable ne se referme pas en le changeant en N/A.** Il se referme quand l'outil
est là, ou sur décision écrite de l'utilisateur de s'en passer.

| Gate concerné | Outil manquant | Ce qu'il permettrait de vérifier | Ouvert le |
|---|---|---|---|
| cycles d'imports JS/TS (`gates.md` #16, `gate-merge.md` point 16) | `eslint-plugin-import` + règle `import/no-cycle`, ou `madge --circular`, exposé en script npm (`check:cycles`) | « aucun cycle d'imports nouveau », rejouable à chaque lot par une commande exacte. Surface bien présente : modules ESM à imports croisés dans `packages/sdk-core`, `sdk-browser`, `sdk-node`, `page-codec` | 2026-09-15 |

**Avant d'ouvrir ce lot** : ajouter une dépendance exige un accord explicite de l'utilisateur
(`~/.claude/shared/escalade.md`, point 4). Le lot commence par une escalade, pas par une
installation.
