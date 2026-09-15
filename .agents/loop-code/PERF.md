# PERF

Historique des mesures, une ligne par itération. **Jamais réécrit : on ajoute.**

Chaque ligne porte sa médiane de 5, son plancher de bruit et ses conditions. Une ligne sans
conditions n'est pas comparable aux autres.

| # | Date | Mesure | Médiane avant | Médiane après | Δ% | Plancher | Verdict |
|---|---|---|---|---|---|---|---|

Verdict : `OK` · `SOUS LE PLANCHER` · `DÉPASSEMENT (> 3 % perf, > 5 % autre)`.

Aucune itération n'a encore mesuré quoi que ce soit : `init` n'est pas une itération.

## Mesures écartées

Une mesure dont les conditions différaient ne se corrige pas : elle se refait. On note ici
celles qui ont été écartées, pour ne pas les redécouvrir.

| Date | Mesure | Pourquoi écartée |
|---|---|---|
| 2026-09-15 | Compilateur natif, scène Emerald, binaire construit à `2f4224e` : `wallMs` 22136,09 ; `real 22.67` / `user 19.31` / `sys 13.83` ; `clusterHierarchyPagesMs` 20640,94 ; `importMs` 1494,998 ; 10 046 405 triangles, 281 primitives, 1030 nœuds, `status: ready` | Une seule exécution, pas une médiane de 5 ; plancher de bruit jamais mesuré ; machine partagée avec d'autres sessions actives au moment du relevé. Ne pas comparer ce chiffre à une mesure future : refaire les deux côtés dans les conditions du protocole |
