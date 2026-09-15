# INVENTAIRE

Photo du dépôt au dernier passage. **Sert à comparer, pas à décrire** : ce qui compte est ce qui
a bougé depuis la dernière exécution.

Généré le : 2026-09-15 · commit : `8ed6b8d`

## Volume

| | Nombre |
|---|---|
| fichiers de code | 617 (`packages/`, hors tests, hors `target/`) |
| fichiers de test | 166 fichiers `*.test.*` JS/TS, plus les modules `#[cfg(test)]` du crate Rust |
| lignes de code | 79 668 (`packages/`, `.ts .mts .mjs .js .rs`) |
| modules exportés | non relevé |

## Éléments partagés déclarés au profil

| Élément | Chemin | Appelants |
|---|---|---|
| composant de liste partagé | — | N/A, aucune UI dans `packages/` |
| design system | — | N/A, idem |
| jetons | — | N/A, idem |
| modules noyau | `packages/sdk-core` | `sdk-node`, `sdk-browser`, `page-codec` ; frontière tenue par `test/engineStructure.test.mjs` et `tsc -p tsconfig.core.json` |

## Relevés statiques

Sortie de `scripts/audit-statique.sh --root packages --ext "ts,mts,js,mjs"`, comptée par famille.
**Ce sont des relevés : ils désignent des endroits, ils ne classent rien.**

| Famille | Compte | Δ depuis la dernière exécution |
|---|---|---|
| valeurs de design en dur | 0 | première exécution |
| styles en ligne | 0 | première exécution |
| dimensions en dur | 0 | première exécution |
| index en clé de liste | 0 | première exécution |
| types d'échappement | 0 | première exécution |
| listes hors composant partagé | N/A — aucune UI dans `packages/`, raison écrite au profil | — |
| exports sans appelant | 0 (`knip`) | première exécution |

**Duplication approchée : 25 lignes non triviales répétées**, dominées par du montage de test
(`new THREE.BufferGeometry()` ×23, destructuration de `quadScene()` ×19, drapeaux
`GPUBufferUsage` ×19). Aucune n'atteint le seuil opposable du dépôt (`jscpd` : ≥ 12 lignes et
≥ 100 tokens, 0 clone). C'est un relevé à surveiller, pas un manquement.
