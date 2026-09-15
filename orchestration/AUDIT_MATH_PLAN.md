# Plan d'optimisation des calculs (15 septembre 2026)

Source : `AUDIT_MATH_INVENTAIRE.md`. Règle absolue : chaque optimisation retenue doit produire un résultat **identique au bit près** à l'ancien code sur les mêmes entrées ; le banc le prouve, sinon elle est rejetée. Fidélité avant vitesse.

## Le banc de comparaison (livré avec le lot A)

- Dossier `packages/<paquet>/bench/`, un fichier par domaine, ≤ 200 lignes, lancés par `npm run bench:calculs` (`node --test packages/*/bench/*.bench.mjs`) ; `scripts/mesure/calculs/` ne garde que les agrégateurs et leur `tableau.mjs`, sans aucun import de paquet.
- Chaque fichier : (1) une implémentation de **référence** (l'ancien code, recopié tel quel dans le banc comme oracle) ; (2) l'implémentation **optimisée** importée du paquet ; (3) des entrées de benchmark réalistes (DAG de plusieurs milliers de pages, image 1280×720, files de streaming de centaines d'entrées) construites par les fixtures existantes ; (4) assertion d'égalité bit à bit (`Object.is` sur chaque flottant, ordre des tableaux, contenu des Set) ; (5) mesure : échauffement, puis N tours, médiane en ms de la référence et de l'optimisée, gain en %.
- Sortie : tableau sur la console + JSON dans `orchestration/mesures/calculs-<date>.json` (commit, machine, Node, DPR non applicable → `null`).
- Rust : pas de `cargo bench` (nightly ou dépendance). Preuve = chronomètres de `perf.rs` sur les fixtures dorées, exécutés avant/après (`--cache-avant`/`--cache-apres` déjà disponibles), et test d'intégration qui compare le manifeste binaire produit octet par octet.

## Lot A — JavaScript, chemin par image, résultat identique au bit près (un Opus)

| # | Fichier | Changement | Pourquoi c'est identique |
|---|---|---|---|
| A1 | `hizDepth.ts:25-84` | projeter les 3 sommets **une fois par triangle** (cache indexé par id de triangle) au lieu d'à chaque pixel | mêmes opérations, mêmes opérandes, juste moins souvent |
| A2 | `visibilityShadePixel.ts`, `visibilityMath.ts:9-48`, `visibilityTypes.ts:89-122` | `visMaterial` calculé une fois par page ; sommets projetés mis en cache par triangle | idem |
| A3 | `hizTemporal.ts:37-104`, `hizSplit.ts` | brancher `splitOccludersFlat` (tri radix, zéro allocation, déjà écrit) et supprimer `splitOccluders` | le banc vérifie l'ordre identique des deux tris (clés égales → même ordre) |
| A4 | `hizOcclusion.ts:152-178`, `hizProjection.ts` | `countUnoccluded` passe par `projectBoxesFlat` avec le cache d'époque ; supprimer `projectBoxToScreen` | même projection, sans allocation |
| A5 | `hizOcclusion.ts:37-81`, `gpuHizTest.ts:35-59` | niveau de mip par `Math.clz32` au lieu d'une recherche linéaire | entier exact, banc sur toutes les tailles |
| A6 | `pageSelectionMath.ts:110-134` | `boxClip` sans branche (sélection min/max précalculée par signe du plan) | mêmes opérandes flottants |
| A7 | `pageSelectionRequests.ts:77-96`, `webgpuPagesRenderCpu.ts:113,142`, `autonomousResidency.ts:24-37`, `autonomousGeometry.ts:54-64` | Set/tableaux scratch persistants, `includes` → Set, plus de spread par image | mêmes ensembles |
| A8 | `autonomousPages.ts:168-182`, `webgpuPagesHelpers.ts:64-86`, `webgpuPagesMetrics.ts` | compteurs incrémentaux au lieu de `filter().length` / resommes par image | mêmes totaux (le banc les compare) |
| A9 | `webgpuPagesPipelineFor.ts:22-36`, `webgpuBlendDraw.ts:65-66`, `webgpuBlendUniforms.ts:28` | `windingCw` en cache sur `PageRec` (invalidé avec la transformation), déterminant calculé une fois, constante littérale | même valeur |
| A10 | `webgpuPagesRender.ts:32-35` | pose caméra copiée dans des scratch au lieu de `camera.clone()` | même comparaison |
| A11 | `gpuDagRuntime.ts:94-101`, `gpuDagUniforms.ts:46-49`, `gpuDagRuntime.ts:77-82` | résidence mise à jour sur le delta, tableau pré-dimensionné, sous-vue sans `Array.from` | mêmes drapeaux |
| A12 | `streamingQueue.ts:22-59`, `arrivalQueue.ts:45-64` | tri une seule fois avant le `while`, dédup par Set | même ordre d'admission |
| A13 | `geometryPage.ts:65-88` | closure `read` sortie de la boucle, indices via `Uint16Array` (little-endian vérifié) | mêmes octets |
| A14 | `telemetry.ts:24-33`, `clusterPages.ts:12-15`, `streamingFetch.ts:4-7` | tampon circulaire, table hex | mêmes chaînes |

## Lot B — Rust, compilation, résultat identique au bit près (un Opus, après A)

| # | Fichier | Changement |
|---|---|---|
| B1 | `compiler_world.rs:89-134` | `world_matrices` calculé une fois, partagé entre `coplanar/pairs.rs` et `coplanar/surface.rs` |
| B2 | `manifest_binary/format.rs:66-79`, `page.rs`, `Column` | écriture directe dans les colonnes sans `Vec` temporaire ; colonnes pré-dimensionnées |
| B3 | `dag/groups.rs:55-100,140-153`, `dag/clusters.rs:155-173` | `Vec<bool>` réutilisés à la place des `HashSet` ; `owner` limité au niveau courant |
| B4 | `dag/groups.rs:104-134`, `qem.rs:13-63`, `import/mesh.rs:40-44`, `import/mesh.rs:131-147` | capacités réservées avant les boucles |
| B5 | `topology/link.rs`, `geometry_page.rs:28-50` | buffers et `HashMap` de scratch réutilisés |
| B6 | `dag/clusters.rs:70-114` | adjacence par `HashMap<u64, SmallVec>` sans tri global (résultat indépendant de l'ordre, vérifié par le test doré) |
| B7 | `compiler_primitive*.rs` | digests SHA-256 réutilisés au lieu d'être recalculés |
| B8 | `import.rs:46-60` | `CornerHasher` par mots de 32 bits |
| B9 | `dag/bounds.rs`, `coplanar/plane.rs:10-25` | `#[inline]` explicites sur les petites fonctions vectorielles |

Interdit dans le lot B (ordre des sommations flottantes) : `plane_of_triangles`, `same_plane`/`groups.rs`, `surface.rs` tris, `merge_spheres`/`enclosing_sphere`, `cover()`, `select_nth` à la place des tris de bisection.

## Lot C — à décider avec les chiffres des lots A et B (changent l'ordre flottant ou l'algorithme)

- `visibilityRaster.ts:15-64` : edge functions incrémentales (une division par triangle) → différence d'arrondi possible, à mesurer pixel par pixel.
- `hizDepth.ts:9-17`, `hizOracles.ts` : pyramide Hi-Z en `Float32Array` plat (touche le type `HizPyramid`).
- `exactPagesRequests.ts:111-127` : deuxième coupe complète du DAG par image pour le préchargement.
- `pageSelectionCutSelect.ts:66`, `pageSelectionCut.ts:83-86` : second parcours de forçage, relance jusqu'à 16× sur budget dépassé.
- Shaders : `gpuDagShader.ts` (5 relectures, trig par passe), `gpuDrawShader.ts:57-77` (scan mono-thread), `sceneLightingShader.ts` (lampes non tuilées), `gpuLightTilesShader.ts:90-101`.
- `sdk-core/lightingTransport*` : accélération spatiale et parcimonie (change l'éclairage, R&D séparée).

## Enchaînement

1. Validation de ce plan par l'utilisateur.
2. Opus 5 (worktree depuis `develop`) : lot A + banc `scripts/mesure/calculs/` + script npm ; aucun test unitaire.
3. Sonnet 5 : lance `npm run bench:calculs`, écrit les tests unitaires d'équivalence, lance `npm run validate`, dépose le JSON de mesures.
4. Chef : tableau avant/après, décision de fusion point par point (un gain sans égalité bit à bit est rejeté).
5. Même cycle pour le lot B, puis décision sur le lot C.
