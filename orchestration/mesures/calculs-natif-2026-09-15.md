# Calculs natifs, lot B — 2026-09-15

Commit 3d76bce09ceca8fd5270a022ec383cbfdc256f66 · rustc 1.98.1 (48a229cea 2026-09-01) · release --locked · médiane sur au moins 50 tours ou 2 s, les deux implémentations alternant tour par tour.

Une ligne « témoin » compare la copie du banc à une bibliothèque inchangée : son écart donne le plancher de bruit de la machine, qui atteint ±20 % sur les cas courts quand d'autres travaux tournent à côté. La compilation des fixtures dorées et d'un maillage de 500 000 triangles, avant et après, est dans `calculs-natif-2026-09-15-fixtures.json` (octets comparés un à un) et les chronomètres de `perf.rs` par phase dans `calculs-natif-2026-09-15-phases.json`.

| Calcul | Fichier | Avant (ms) | Après (ms) | Gain | Identique | Retenu |
|---|---|---|---|---|---|---|
| B1 matrices monde partagées | compiler_world.rs, coplanar/pairs.rs, coplanar/surface.rs | 7.836 | 3.983 | +49.2 % | oui | oui |
| B2 colonnes du manifeste binaire | manifest_binary/format.rs, page.rs | 27.626 | 1.767 | +93.6 % | oui | oui |
| B3 refine_bisection sans HashSet | dag/groups.rs | 0.974 | 0.158 | +83.8 % | oui | oui |
| B3 bord du groupe sans HashSet | dag/groups.rs | 0.426 | 0.186 | +56.3 % | oui | oui |
| B4 compaction d'une région | qem.rs | 0.310 | 0.288 | +7.1 % | oui | oui |
| B4 octets d'indices (u16) | import/mesh.rs | 0.035 | 0.035 | -0.1 % | oui | non (capacité neutre à cette taille (±0,3 %)) |
| B4 octets d'indices (u32) | import/mesh.rs | 0.043 | 0.043 | -0.9 % | oui | non (capacité neutre à cette taille (±0,3 %)) |
| B5 classify_link à blocs réutilisés | topology/link.rs | 15.311 | 4.643 | +69.7 % | oui | oui |
| B5 renumérotation d'une page | geometry_page.rs | 291.251 | 139.595 | +52.1 % | oui | oui |
| B6 adjacence par arêtes de bord (témoin) | dag/clusters.rs | 27.827 | 27.835 | -0.0 % | oui | non (table de hachage mesurée à 52,0 ms contre 28,8 ms pour le tri global, sans SmallVec que le verrou de Cargo.lock interdit : changement écarté, la ligne est le témoin du banc) |
| B7 digests SHA-256 réutilisés | compiler_primitive*.rs | null | null | null | null | non (reporté : le seul recalcul est la relecture d'un objet déjà en cache, qui valide l'entrée persistée) |
| B8 CornerHasher par mots de 32 bits | import.rs | null | null | null | null | non (déjà fait : write_u32 est déjà redéfini) |
| B9 sphères englobantes (#[inline]) | dag/bounds.rs | 2.969 | 2.968 | +0.0 % | oui | non (l'écart entre la copie du banc et la bibliothèque change de signe d'une exécution à l'autre : aucun gain à prouver, les attributs n'ont pas été posés) |

