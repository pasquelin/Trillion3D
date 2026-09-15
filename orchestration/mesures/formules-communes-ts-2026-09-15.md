# Formules communes — lot TS (sdk-browser, sdk-core, scripts/mesure)

Branche `lot/formules-communes-ts`, base `2dcc8fc`. Preuve d'égalité : `packages/sdk-browser/bench/formules-ts.bench.mjs`
contre les oracles `bench/oracles/formules-ts.mjs` (le code d'avant, recopié tel quel), `Object.is`
valeur par valeur sur NaN, −0, infinis, dénormaux, matrices singulières, boîtes inversées et
triangles d'aire nulle ; relevé dans `orchestration/mesures/formules-communes-ts-2026-09-15.json`.
Pour les fragments WGSL, la preuve est la comparaison caractère par caractère du texte de chaque
nuanceur avant et après (`VIS_SHADER`, `SHADE_SHADER`, `rasterSource`, `RESOLVE`, `DAG_SELECTION_SHADER`,
`DRAW_SHADER`, `BOUNCE_*`, `BLEND_SHADER`, `TRANSMISSION_WGSL`, `DIRECT_LIGHTING_SHADER`, …).

| Doublon                                        | Nom générique            | Fichier commun                           | Sites remplacés | Identique | Retenu |
| ---------------------------------------------- | ------------------------ | ---------------------------------------- | --------------- | --------- | ------ |
| Structure `PageInfo` WGSL                      | `PAGE_INFO_STRUCT_WGSL`  | `packages/sdk-browser/visibilityPageWgsl.ts` | 3           | oui       | oui    |
| Aire signée écran WGSL (`edge`)                | `EDGE_WGSL`              | `packages/sdk-browser/visibilityPageWgsl.ts` | 2           | oui       | oui    |
| Position d'un sommet WGSL (`vertPos`)          | `PAGE_VERTEX_WGSL`       | `packages/sdk-browser/visibilityPageWgsl.ts` | 2           | oui       | oui    |
| UV d'un sommet WGSL (`vertUv`)                 | `PAGE_UV_WGSL`           | `packages/sdk-browser/visibilityPageWgsl.ts` | 2           | oui       | oui    |
| Répétition/serrage d'UV WGSL (`wrapCoord`)     | `WRAP_COORD_WGSL`        | `packages/sdk-browser/visibilityPageWgsl.ts` | 2           | oui       | oui    |
| Masquage alpha MASK WGSL                       | `MASK_KEEP_WGSL`         | `packages/sdk-browser/visibilityPageWgsl.ts` | 2           | oui       | oui    |
| Poids barycentriques affines WGSL              | `BARY_WEIGHTS_WGSL`      | `packages/sdk-browser/visibilityPageWgsl.ts` | 2           | oui       | oui    |
| Constante 1/π WGSL (`0.31830989`)              | `INVERSE_PI_WGSL`        | `packages/sdk-browser/bounceGridWgsl.ts`     | 2           | oui       | oui    |
| Tours d'escalade de seuil                      | `ESCALATION_ROUNDS`      | `packages/sdk-browser/pageSelectionTypes.ts` | 2           | oui       | oui    |
| Socle d'identifiant de ligne                   | `packedRowBase`          | `packages/sdk-browser/webgpuPageRow.ts`      | 2           | oui       | oui    |
| Lot borné par un budget en ms                  | `bounceBatchOf`          | `packages/sdk-core/bounceBudget.ts`          | 2           | oui       | oui    |
| Aire signée du triangle écran TS               | `signedArea`             | `packages/sdk-browser/visibilityProjection.ts` | 5         | oui       | oui    |
| Poids barycentriques affines TS                | `barycentricAt`          | `packages/sdk-browser/visibilityProjection.ts` | 3         | oui       | oui    |
| Boîte hors des six plans                       | `boxClip`                | `packages/sdk-browser/pageSelectionMath.ts`  | 2           | oui       | oui    |
| Distance de vue du centre                      | `viewDistanceOf`         | `packages/sdk-browser/pageSelectionProjection.ts` | 2      | oui       | oui    |
| Pixels d'appareil d'une dimension logique      | `devicePixels`           | `packages/sdk-browser/backendCommon.ts`      | 2           | oui       | oui    |
| Nanosecondes → millisecondes                   | `nanosecondsToMs`        | `packages/sdk-browser/gpuTimingTypes.ts`     | 4           | oui       | oui    |
| Plancher du modèle mesuré                      | `plancherDuModele`       | `scripts/mesure/poses.mjs`                   | 2           | oui       | oui    |

## Doublons laissés séparés

- Erreur projetée du DAG (`gpuDagOracleMath.projectedError`) contre `clusterErrorAtDistance` (sdk-core) : l'une rend l'infini sur une erreur négative ou NaN, l'autre lève — deux contrats, l'oracle doit rester le miroir sans exception du nuanceur ; miroir commenté des deux côtés.
- Les trois états de `boxClip` (« traversé » / « dedans ») : `outsidePlanes` n'en lit que le rejet, la seconde passe reste où elle est, rien n'est aligné.
- Rejet par cône de normales : `pageCone.ts` (TS) contre `gpuDagShader.coneRejectsBox` (WGSL) — deux langages ; miroir commenté.
- Réduction Hi-Z 2×2 : `hizOracles.hizReduceCeil` contre `hizPyramidFlat.hizBuildFlat` — l'oracle est le témoin indépendant de la production, les fusionner supprimerait la preuve ; miroir commenté.
- BRDF GGX/Smith/Schlick : `standardLighting.ts` est WGSL et divise par `3.14159265`, `visibilityLighting.ts` est TypeScript et divise par `Math.PI` — langages et littéraux différents.
- 1/π des autres sites : `standardLighting.ts` (`/3.14159265`) et `lightingShaderSurface.ts` (`PI=3.141592653589793`) ne sont pas le littéral `0.31830989` des deux sites factorisés.
- Rayon/boîte par tranches : `bounceNodeWgsl.ts` (garde 1e-20, WGSL) contre `lightingShaderIntersections.ts` (garde 1e-19, GLSL) — seuils et langages différents ; commenté.
- Hachage murmur3 fmix : `lightingShaderDirect.ts` (GLSL) contre `trianglePalette.ts` (WGSL, décalage additif d'entrée en plus) ; commenté.
- Hachage polynomial ×31 : `visibilityMath.clusterHash` parcourt les points de code, `backendCommon.hashId` les unités UTF-16 — résultats différents hors du plan de base ; commenté des deux côtés.
- Identifiant de visibilité : `visibilityTypes.packVisibilityId` (TS, multiplication) contre les fragments WGSL (décalage en ligne) — deux langages ; miroir commenté.
- Créneau de dessin `slotOf` : `gpuDrawCpu.ts` (TS) contre `gpuDrawShader.ts` (WGSL) ; miroir commenté des deux côtés.
- Fusion de sphères `growSphere` (`pageSelectionCutBounds.ts`) contre `dag/bounds.rs` (Rust) ; miroir commenté.
- `uvDerivatives` : `visibilityMath.ts` (TS) contre le nuanceur d'ombrage (WGSL) ; miroir commenté.
- Disposition des colonnes du manifeste : `manifestBinaryLayout.ts` pose les décalages, `manifestBinaryRead.ts` ne fait que les vérifier (`offset % 8`) — contrôle indépendant, pas une copie.
- Contrôle de normale 1e-6 : `lightingTransportValidation.ts` teste `|norme − 1| > 1e-6`, `sceneLightValidate.ts` teste `longueur > 1e-6`, `sceneProxy.ts` n'en a aucun — trois tests différents.
- Alignement 256 octets : `gpuPresentation.ts` calcule un pas de ligne (`ceil(w·4/256)·256`), `gpuDrawCpu.ts` aligne une liaison (`bytes += align − bytes % align`), les autres ne déclarent qu'un pas constant — trois calculs différents.
- Padding 4 octets : un seul site TypeScript (`webgpuPagesSetup.ts`), les autres copies sont en Rust (hors périmètre).
- Décodage 0xRRGGBB : seul `webgpuPagesEncoder.clearValueOf` divise par 255 ; `webgpuPagesHelpers.ts` rend une chaîne hexadécimale, ce n'est pas le même calcul.
- Comptage par référence : `webgpuHeldKeys.ts`, `webgpuKeyUnion.ts` et `webgpuBudgetRanking.ts` diffèrent par le masque `covered`, la garde de sous-dépassement au relâchement et la remise à zéro — comportements différents.

## Preuve navigateur WebGPU

Les nuanceurs `SHADE_SHADER` et `rasterSource` changent de texte à trois endroits (`maskKeep`,
`baryWeights`, et le nom `INVERSE_PI`) : à chaque fois une expression déplacée telle quelle dans une
fonction WGSL, mêmes opérandes dans le même ordre, ou un simple renommage de constante. Le reste des
nuanceurs est identique caractère par caractère, vérifié par dépôt du texte avant et après.

Commande : `node scripts/mesure/banc.mjs --moteur webgpu --avant develop --apres HEAD --vues generale,sol,rue --images 60 --pixelError 0,1 --max-pages 100000`.
Commit mesuré : `avant` = `3979661879f6` (develop), `apres` = `17c9e3d4b034` (fusion de develop dans
`lot/formules-communes-ts`). Sortie complète copiée dans
`.mesure/out/formules-communes-ts/webgpu-2026-09-15T16-56-12-490Z/`.

| Vue | Seuil | Pixels différents avant/après | Bruit A/A | Identique (oui/non) |
| --- | --- | --- | --- | --- |
| generale | 0 | 0 px, max canal 0 | 0 px, max canal 0 | oui |
| sol | 0 | 0 px, max canal 0 | 0 px, max canal 0 | oui |
| rue | 0 | 0 px, max canal 0 | 0 px, max canal 0 | oui |
| generale | 1 | 0 px, max canal 0 | 0 px, max canal 0 | oui |
| sol | 1 | 0 px, max canal 0 | 0 px, max canal 0 | oui |
| rue | 1 | 0 px, max canal 0 | 0 px, max canal 0 | oui |

Hash de coupe (`selectedPageIds`) identique avant/après sur chaque vue et chaque seuil. Charge
machine élevée pendant la campagne (jusqu'à ~11 en fin de série) : les temps CPU/GPU relevés ne sont
pas concluants et ne sont pas commentés ici, seule l'identité des pixels fait foi.

## Portes

`npm run validate` passe en entier sur cette branche (format, lint JS/TS et Clippy, code inutilisé,
build TS et natif, structure, déclarations, liens, 751 tests JS/TS et 171 tests Rust).
`npm run check:duplicates` ne trouve aucun clone. Aucun fichier de test n'a été écrit.
