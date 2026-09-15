# Audit des calculs, lot G : passage global sur `packages/sdk-browser`

Périmètre : `packages/sdk-browser/*.ts` hors tests, fixtures, mocks, oracles, `bench/`, et hors
chaînes de shaders WGSL/GLSL (fichiers dont le contenu est une chaîne `@group/@binding/@vertex/
@fragment/@compute` ou un export `*_WGSL`/`*Shader`, ex. `gpuDagShader.ts`, `webgpuAtlasWgsl.ts`,
`lightingShader*.ts`, `directLightWgsl.ts`, `sceneLightingShader.ts`). Cible : le code exécuté par
image (rendu, sélection de coupe, Hi-Z, résidence, lots de dessin, streaming, autonome), comparé aux
tableaux `orchestration/mesures/calculs-2026-09-15.md`, `calculs-c-2026-09-15.md`,
`calculs-f-2026-09-15.md` et au plan `orchestration/AUDIT_MATH_PLAN.md`.

Méthode : lecture intégrale d'une soixantaine de fichiers du chemin par image (Hi-Z, visibilité
CPU, sélection de coupe, résidence GPU, lots de cluster, streaming, backend autonome, métriques),
plus un balayage mécanique de l'ensemble des 273 fichiers du périmètre pour les motifs `.sort(`,
`.find(`, `.includes(`, `.indexOf(` explicitement visés par la consigne. Aucun changement d'ordre
des opérations flottantes n'est proposé ci-dessous.

## Points nouveaux ou défaits

| Fichier:lignes | Ce que ça calcule | Fréquence | Motif | Changement proposé | Pourquoi le résultat est identique | Gain attendu |
|---|---|---|---|---|---|---|
| `hizUnoccluded.ts:37` (`countUnoccluded`) et `hizSplit.ts:96` (`splitOccludersInto`, via `rangParProfondeur`) | Projection des 8 coins monde de chaque page en rectangle écran (`projectBoxesFlat`) | Par image, chemin CPU de secours (`renderCpuCut` → `cullWithTemporalHiz` → `applyTemporalHiz`, actif quand `vis.gpuHiz` est absent) | (a) calcul refait alors que les coins d'une page n'ont pas changé depuis l'image précédente ; (f) optimisation prévue par le lot A (`AUDIT_MATH_PLAN.md`, A4 : « countUnoccluded passe par projectBoxesFlat avec le cache d'époque ») et explicitement reportée au lot C dans le journal du 15 septembre (« cache de coins d'époque dans countUnoccluded »), puis jamais reprise dans `calculs-c-2026-09-15.md` | `projectBoxesFlat` accepte déjà un 4ᵉ paramètre `world: { corners: BoxCorners, pageIndex, epoch }` qui met les coins en cache par page et ne les recalcule qu'à changement d'époque — exactement ce que `webgpuVisibilityPartition.ts:20-37` fait pour le chemin GPU. Le chemin CPU (`applyTemporalHiz`/`countUnoccluded`/`splitOccludersInto`) ne le reçoit jamais : il faut y ajouter un indice de page stable et un compteur d'époque (comme `rows.packedPageIndex`/`rows.tableEpoch` côté GPU), puis passer ce `world` aux deux appels | `worldCornersInto` est la même fonction, sur les mêmes `min`/`max`/`matrix` ; le cache ne change ni les opérandes ni leur ordre, il évite de les répéter quand la page n'a pas bougé | Moyen (chemin de secours seulement, pas le chemin GPU principal déjà optimisé) |
| `webgpuPagesMetrics.ts:8-17` (`metricsOf`) | `vertexBytes` : somme des tailles de tous les tampons de positions résidents (`gpu.positionBuffers`) et de tous les maillages transparents (`blendState.blendGpu`) | Par appel à `explorer.metrics()` (API hôte, typiquement interrogée à chaque image de la boucle de rendu) | (a)/(e) parcours intégral d'un ensemble (potentiellement des milliers de pages résidentes) à chaque appel, alors qu'il n'existe qu'à l'entrée/la sortie de résidence — reporté au lot C dans le journal du 15 septembre (« compteur incrémental de vertexBytes ») et jamais fait | Tenir un total courant, incrémenté quand une page ou un maillage transparent est ajouté/retiré de `positionBuffers`/`blendGpu` (ces points d'entrée/sortie existent déjà : acceptation de page, éviction de cache, `disposeWebgpuPages`) au lieu de resommer l'ensemble à chaque relevé | Même somme des mêmes `buffer.size`, seulement maintenue au lieu d'être refaite | Moyen |
| `autonomousGeometry.ts:53-64` (`sync`) | Détache de la scène les pages qui étaient attachées et ne sont plus dans la coupe affichée | Par image, backend `autonomous-pages-webgl` (`render()` appelle `sync()` à chaque image, lignes 124 et 151 de `autonomousPages.ts`) | (e) boucle qui parcourt l'ensemble entier des pages du DAG (`allPages`, potentiellement des dizaines de milliers) pour n'en détacher qu'une poignée, alors que l'ensemble des pages actuellement attachées est un delta borné par la taille de la coupe | Garder un `Set<PageRec>` des pages actuellement attachées (mis à jour dans `attach`/`detach`), et à chaque `sync()` ne parcourir que ce set pour détacher celles absentes de la nouvelle coupe `affichees`, au lieu de parcourir `allPages` en entier | Mêmes pages détachées (celles attachées et absentes de `shown`), la scène finale est identique ; seul l'ensemble parcouru pour les trouver change | Fort (pour ce backend : `allPages` = tout le DAG, `shown` = une coupe) |
| `streamingQueue.ts:156-162` (`finish`, dans `subscribe`) | Retire une requête encore en file (`queue`) quand son dernier consommateur l'annule | Par annulation, potentiellement par image sur une caméra qui bouge vite (chaque requête superflue de l'image précédente est annulée) | (c) `queue.indexOf(shared)` dans une boucle d'annulation : une rafale de N annulations (ex. `startFetch` de plusieurs centaines d'URLs remplacé par une nouvelle sélection) coûte O(N²) | Donner à chaque `job` son rang courant dans `queue` (mis à jour à chaque insertion/`splice`), ou retirer par un index tenu sur le job plutôt que par une recherche linéaire — le même mécanisme que celui déjà appliqué dans `arrivalQueue.ts:19-22` (« `touched.includes` redevenait quadratique ») | Le même élément est retiré du même tableau ; seul le moyen de le trouver change | Faible à moyen (dépend de la taille des rafales d'annulation) |
| `explorerDraw.ts:70-71` | Empile dans `streaming.queuedFetch` les URLs manquantes qui ne s'y trouvent pas déjà, pendant qu'une requête réseau est en cours | Par image tant qu'une requête est active et que des pages manquent | (c) `Array.prototype.includes` par URL ajoutée, dans une boucle qui peut tourner plusieurs images de suite | Remplacer `queuedFetch: string[]` par un `Set<string>` (ou garder le tableau et ajouter un `Set` d'appartenance en parallèle, comme `vuesSansEstampille` dans `pageSelectionRequests.ts:78`), en conservant l'ordre d'insertion pour la consommation dans `explorerStreaming.ts:107-108` | Mêmes URLs, dans le même ordre d'ajout ; seul le test d'appartenance change de coût | Faible (liste bornée par les pages manquantes d'une image, généralement petite) |
| `visibilityLighting.ts:133-150` (`shadeLit`) | Éclairage hémisphérique fixe (direction, longueur, couleur du sol) utilisé par le chemin de rendu CPU du visbuffer (`rasterRgba`/`shadeVisibility`, oracle et diagnostic) | Par pixel de chaque image où `mat.lit` est vrai, à chaque appel de `rasterRgba()`/`shadeVisibility()` | (a) `Lraw`, `lLen`, `L`, `sky` sont des constantes indépendantes du pixel, recalculées à chaque appel (`Math.hypot` compris) ; (b) `new THREE.Color(0x495061)` alloue un objet à chaque pixel, `sky`/`ground`/`hemi`/`diffuse` (via `.map`) allouent un tableau par pixel | Sortir `Lraw`, `lLen`, `L`, `groundColor` (et son `.r/.g/.b`), `sky` au niveau du module (constantes littérales, jamais réaffectées) ; ne garder par pixel que ce qui dépend réellement du pixel (`up`, `hemi`) | Mêmes valeurs flottantes, mêmes opérandes, mêmes divisions/racines — seulement calculées une fois au chargement du module plutôt qu'à chaque pixel | Moyen à fort si l'hôte interroge `rasterRgba()`/`shadeVisibility()` par image (chemin de diagnostic/oracle CPU du visbuffer) |

## Vérifié conforme

Fichiers lus en entier, sans point à signaler (déjà optimisés par les lots A/B/C/F, ou hors chemin
par image, ou changements déjà mesurés et refusés à raison) :

`hiz.ts`, `hizCorners.ts`, `hizCounts.ts`, `hizDepth.ts`, `hizOcclusion.ts`, `hizProjection.ts`,
`hizProjectionHold.ts`, `hizTemporal.ts`, `hizTypes.ts`, `visibilityMath.ts`, `visibilityRaster.ts`,
`visibilityShadePixel.ts`, `visibilityShade.ts`, `visibilityFrame.ts`, `visibilityBuffer.ts`,
`visibilityTypes.ts`, `visibilityProjection.ts`, `webgpuPagesHelpers.ts`, `webgpuPagesRenderCpu.ts`,
`gpuDagRuntime.ts`, `gpuDagUniforms.ts`, `gpuDagSelection.ts`, `gpuDagPack.ts`, `gpuDagDispatch.ts`,
`pageSelectionMath.ts`, `pageSelectionHelpers.ts`, `pageSelectionCut.ts`, `pageSelectionCutVisit.ts`,
`pageSelectionCutSelect.ts`, `pageSelectionRequests.ts`, `pageSelectionCollect.ts`,
`exactPagesRequests.ts`, `streamingPriority.ts`, `arrivalQueue.ts`, `autonomousResidency.ts`,
`webgpuResidencySets.ts`, `webgpuBudgetRanking.ts`, `webgpuCutDelta.ts`, `webgpuBlendUniforms.ts`,
`webgpuVisibilityItems.ts`, `webgpuVisibilityPartition.ts`, `webgpuPagesEncodeDraws.ts`,
`clusterBatchUpdate.ts`, `clusterBatchRange.ts`, `geometryPage.ts`, `manifestPageIndex.ts`,
`primitiveLookup.ts`, `sha256Hex.ts`, `pageCone.ts`, `pageRaster.ts`, `matrixElements.ts`,
`triangleDiagnostic.ts`, `surfaceBuffer.ts`, `cpuProfile.ts`, `gpuTimingSample.ts`.

Un balayage mécanique des motifs `.sort(`, `.find(`, `.includes(`, `.indexOf(` a couvert l'ensemble
des 273 fichiers du périmètre (hors chaînes de shaders) ; en dehors des points listés ci-dessus et
de ceux déjà tranchés dans `calculs-f-2026-09-15.md` (F1, F2, F3, F6), les occurrences restantes
(tri de setup en une fois, listes de quelques éléments en diagnostic GPU, tri de construction du DAG
de culling) ne tournent pas par image ou portent sur des ensembles de taille bornée et négligeable.
