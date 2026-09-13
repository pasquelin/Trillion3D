# Suivi de l’audit et du rapport 15 — 13 septembre 2026

Décision : conserver l’architecture et prioriser les garanties de correction avant une nouvelle optimisation. La réconciliation initiale ci-dessous est complétée par la livraison du lot 1 en fin de document. Elle réconcilie l’audit parallèle fourni par l’utilisateur avec le code du commit `7f411d4` et la campagne plus récente `df423613-575c-4cb8-93ed-d96e2af7ddf3` du Render Tech Lab, démarrée le 13 septembre à 13:19:10 UTC.

L’audit a observé `20178a2` avec des modifications concurrentes ; ses conclusions doivent être vérifiées sur le code final, et son passage de 298 tests n’est pas la validation du commit ultérieur. Le rapport original fourni s’intitule « Audit WebGeometry — 13 septembre 2026 », neuf constats. Ce fichier en conserve le suivi, sans remplacer ses preuves détaillées.

## Constats et statut

| Audit | Constat | Vérification actuelle et suite |
| --- | --- | --- |
| 1 | Couverture incomplète jusqu’au dessin GPU ; erreurs de pages absorbées | Confirmé par lecture et exécution du test `webgpu pages draw the resident subset before every visible page is loaded`. Le test passe en acceptant deux clusters sélectionnés pour une seule page GPU résidente. Les anciens pins étaient relâchés avant la fin des nouveaux uploads. Lot 1 implémenté : secours initial épinglé, remplacement uniquement avec une coupe GPU complète, admission et erreurs explicites ; validation détaillée en fin de document. |
| 2 | Hi-Z annoncé plus complet que le chemin GPU réel | Confirmé par lecture : empreintes limitées à 16 × 16, accès au niveau zéro, historique copié sans consommateur de reprojection. Les nouveaux horodatages mesurent des passes, pas l’utilité de leurs résultats. Corriger la description et isoler les coûts avant de choisir un nouvel algorithme. |
| 3 | Compteurs de périmètres différents et causalité inventée dans le profileur | Confirmé par lecture : référence comptée avant rejet effectif, transparents absents du total WebGL par pages, doubles passes incluses côté WebGPU, nombre d’objets utilisé pour les appels THREE.LOD. `memory_pressure` reste déduit d’une saccade sans mesure mémoire. À corriger avant comparaison entre moteurs. |
| 4 | QEM JavaScript : inversion de face avec erreur nulle | Reproduit sur le code courant : éventail concave de six triangles réduit à quatre ; aires signées `[0.5, -0.5, 1, 2]`, `errorObject = 0`. Ne pas extrapoler ce résultat au compilateur Rust. |
| 5 | Accessor hors bufferView et empreinte de compilation incomplète | Lecture actuelle cohérente avec l’audit : lecteur JS sans borne locale de vue ; empreinte JS limitée à `index.mjs`, empreinte Rust sans verrou des dépendances. La publication invalide signalée a été reproduite par l’audit, pas réexécutée lors de cette réconciliation. Reproduire séparément sur Rust. |
| 6 | Budgets limités aux ressources déclarées, streaming surtout des indices | Limite toujours présente et documentée : géométrie et textures largement résidentes ; budget des images distinct de la mémoire totale. L’admission globale et les essais sur petites machines restent ouverts. |
| 7 | Travail GPU pouvant s’ajouter au parcours CPU | Chemin actuel toujours présent : résultat de sélection GPU accepté seulement pour une vue identique, sinon sélection CPU ; résolution et compaction GPU sérielles. Les nouveaux timings excluent encore le dispatch de sélection séparé. |
| 8 | Politique de repli non pilotée automatiquement par une comparaison réelle | Toujours ouverte : mécanismes de décision présents, comparaison et application automatiques non intégrées ; secours d’une session WebGPU seule à traiter explicitement. |
| 9 | Documentation surévaluant certaines capacités | Confirmé dans README, frontières de packages et FORMAT : IBL spéculaire, parité CPU/WGSL et reprojection temporelle ne correspondent pas au chemin courant. Aligner livré, exigences et preuves ; l’A/A passé ne valide pas la fidélité entre moteurs. |

Points de code principaux : [résidence et dessin GPU](../packages/sdk-browser/webgpuPages.ts), [tests de couverture](../packages/sdk-browser/webgpuPages.test.ts), [Hi-Z](../packages/sdk-browser/gpuHiz.ts), [compteurs des adaptateurs](../packages/sdk-browser/index.ts), [profileur](../packages/sdk-browser/telemetry.ts), [QEM de référence](../packages/asset-compiler-core/qem.mjs), [lecture glTF JS](../packages/asset-compiler-core/index.mjs), [empreinte JS](../packages/sdk-node/index.mjs), [préparateur Rust](../packages/asset-compiler-rust/src/lib.rs).

## Ce que change la nouvelle campagne

La campagne se termine sans erreur ni secours : une instance Emerald, 1246 × 1000, qualité high, quatre moteurs, 2 400 échantillons, 40 captures et 40 contrôles A/A réussis. Elle reste `visual-only`.

| Appel CPU de rendu, 600 échantillons par moteur | Médiane (ms) | p95 (ms, rang supérieur) |
| --- | ---: | ---: |
| Three de référence | 8,30 | 17,60 |
| THREE.LOD | 9,35 | 19,00 |
| WebGeometry WebGL | 13,35 | 25,90 |
| WebGeometry WebGPU | 15,20 | 28,60 |

Les journaux contiennent maintenant 11 échantillons GPU par passe, dont 10 complets, et six relevés des étapes CPU. L’échantillon initial conserve une durée indisponible pour une passe d’effacement ; aucune valeur artificielle ne la remplace.

Exemple identifié : frame moteur 61, soumission 71, vue générale. Transparents : 8,454144 ms ; somme des intervalles des passes instrumentées : 12,124160 ms. Sur les dix échantillons complets, la médiane des transparents vaut 5,505024 ms ; celle de l’éclairage différé 0,524288 ms. Ces statistiques concernent un petit échantillon de vues différentes, pas toutes les images ni une mesure comparative de performance.

Ces horodatages ne comprennent ni le dispatch séparé de sélection GPU, ni les transferts, ni la latence d’affichage. Le champ `gpuMs` des images reste null pour éviter de rattacher une mesure différée à la mauvaise image. La VRAM physique reste non mesurée. La campagne du Lab ne fige toujours pas l’empreinte du SDK exécuté ; `sourceKey` identifie l’asset préparé.

La baisse de 39 % des triangles soumis annoncée auparavant comparait WebGPU à lui-même avant/après filtrage des transparents, avec la même définition de compteur. Elle ne prouve ni un gain de temps, ni une supériorité sur WebGL ou Three. Elle ne répond pas au défaut de couverture.

## Ordre de correction et critères d’acceptation

1. **Couverture GPU et erreurs de streaming.** Conserver une représentation complète par région, y compris lors d’une nouvelle vue. Publier une coupe seulement lorsque toutes ses pages sont dessinables sur GPU ; maintenir ses remplaçants épinglés jusque-là. Prévoir le secours initial et l’admission des ressources nécessaires à la transition. Si le budget empêche une transition complète, conserver un secours admissible ou signaler l’impossibilité ; ne jamais publier silencieusement un sous-ensemble. Vérifier uploads retardés, erreurs durables, éviction, changement rapide de caméra/LOD et annulation sous petit budget. Un simple gel de l’ancienne sélection visible ne suffit pas pour une nouvelle zone découverte.
2. **Oracles et publication.** Rejeter inversions/dégénérescences QEM ; valider les bornes locales des accessors, strides et données sparse avant publication. Reproduire les entrées malformées sur JS et Rust séparément. Compléter les empreintes de compilation et vérifier l’invalidation des caches sans réutilisation silencieuse.
3. **Contrat de preuve commun.** Séparer géométrie source, sélection LOD et commandes réellement soumises par passe. Compter transparents, doubles passes et appels effectifs selon le même contrat entre moteurs. Retirer les causes de ralentissement non mesurées du profileur. Figer le code exécuté et corriger les capacités annoncées, notamment Hi-Z/IBL.
4. **Recette visuelle.** Comparer des captures sans perte, à résolution et caméra identiques, entre moteurs ; tester matériaux, transparence, transitions de résidence, occlusion/désocclusion et restauration des vues secondaires. Garder l’A/A comme contrôle de répétabilité distinct. Les JPEG réduits du rapport ne suffisent pas à une preuve de fidélité fine.
5. **Performance et budgets.** Captures hors périodes mesurées, ordre alterné, répétitions, vues et budgets identiques ; cache froid/chaud et 1/4/9 villes sur machines modestes. Mesurer les étapes réellement consommées, puis décider du Hi-Z, de la sélection GPU, des transparents et de l’admission globale. Ne pas ajouter le futur éclairage global avant les garanties précédentes.

Cette réconciliation n’a modifié aucun code moteur. Vérifications nouvelles : lecture du rapport brut/journaux, recalcul des statistiques, lecture des chemins cités, reproduction QEM en mémoire et exécution du test de sous-ensemble résident. Aucun nouveau test Rust, aucune nouvelle campagne GPU et aucune mesure mémoire n’ont été exécutés pour ce document.


## Lot 1 — couverture GPU et chargements

La correction est générique : aucune branche ne dépend du nom de la scène, d’Emerald, de sa clé ou de ses dimensions. Les essais artificiels couvrent notamment des arbres à une ou plusieurs feuilles, des feuilles simplifiées, des primitives sans hiérarchie et des régions découvertes après déplacement de caméra.

Le backend WebGPU prépare une couverture de toutes les régions avant que `createExplorer` soit prêt. Il charge les pages simplifiées les plus hautes de chaque branche, ou les feuilles exactes en l’absence de simplification, avec déduplication par URL entre instances. Cette couverture et ses indices CPU restent épinglés. Le SDK fournit le lecteur de pages vérifiant taille et empreinte SHA-256.

Le choix d’une nouvelle coupe consulte la résidence GPU, et plus seulement la présence des indices CPU. Il conserve une représentation complète par région jusqu’au chargement de ses remplaçants. Si les anciens et nouveaux détails ne peuvent pas coexister, il repasse sur le secours avant de libérer les anciens emplacements. Si le secours et les détails demandés dépassent ensemble le budget, il conserve une coupe complète disponible et signale la limitation ; le détail peut être inférieur à la consigne. Si le secours seul dépasse le budget, la préparation échoue explicitement. Les feuilles possédant leur propre page simplifiée et les primitives sans hiérarchie sont également couvertes.

Les erreurs de chargement sont limitées à trois tentatives par URL et par explorateur. Elles restent visibles dans `streamingError` et les diagnostics ; la boucle d’animation ne relance pas indéfiniment les mêmes échecs. Une erreur du secours initial empêche la préparation. Une éviction CPU différée pour protéger une page active est appliquée lorsque cette page de détail n’est plus épinglée.

Les indicateurs `coverageReady`, `coverageBudgetLimited` et les événements `coverage-bootstrap-*`, `coverage-budget`, `coverage-upload-failed`, `coverage-streaming-failed` permettent de suivre cette garantie. Les événements d’admission sont délivrés pendant `flush()`, hors rendu mesuré. Le contrat détaillé est dans [SDK.md](../SDK.md).

### Preuves et limites

- Validation finale : 310 tests Node réussis, compilation TypeScript, contrôle des frontières du cœur, déclarations publiques et liens réussis. Tests automatisés : démarrage incomplet, arrivée CPU précédant l’upload GPU, remplacement progressif de deux pages, budget insuffisant, changement rapide de caméra avec évictions, requêtes devenues obsolètes, éviction CPU différée, échec permanent, annulation et captures concurrentes.
- Le premier essai matériel a déclenché `GPU_COVERAGE_INCOMPLETE` sur Emerald. La reproduction a identifié 37 feuilles portant leurs propres pages simplifiées : le retour anticipé de la sélection ignorait leur secours. Le test de régression échoue avant correction et passe après.
- Recette matérielle réussie : GPU Apple/Metal 3, Emerald complet, 1246 × 1000, qualité high, même source `019a531c875acb0168297ecf2feab131d7c5866a344a28048e0e99ae55ff5710`. 600 images, 10 contrôles A/A exacts, 10 captures sans perte, aucune erreur GPU/streaming. Le secours contient 1 597 pages uniques opaques pour 6 236 emplacements effectivement alloués. Les 600 images rapportent la couverture prête et aucune limitation de détail. 16 relevés GPU par passe sont enregistrés, sans verdict de performance.
- Deuxième parcours matériel, budget réduit à 2 000 emplacements : 600 images et 10 A/A exacts réussis, couverture prête sur toutes les images, limitation de détail explicitement signalée sur 584 images et 106 évictions au maximum. Aucune erreur GPU/streaming. Données locales : `benchmark-runs/webgpu-capture/coverage-gpu-budget-2000/`. Ce budget concerne les pages d’indices ; il ne représente pas une limite de mémoire totale.
- Petite scène matérielle : quatre vérifications de pixels, arrivées séparées des deux détails avec trois emplacements, puis budget de deux emplacements empêchant le raffinement. Zéro différence de pixel avec la couverture complète de référence dans ces quatre cas.
- Comparaison aux captures antérieures `transparent-after-stable`, mêmes source, caméras et résolution : trois vues identiques et sept différentes, de 12 à 806 pixels par vue sur 1 246 000. L’origine de ces écarts n’est pas établie par cette recette. Aucune équivalence visuelle générale avec l’ancienne version ni avec Three n’est déclarée.

Les données brutes, empreintes des modules exécutés et pixels sont conservés localement dans `benchmark-runs/webgpu-capture/coverage-gpu-leaf-fallback/`. Le scénario reproductible est [webgpuCapture.browser.mjs](../test/webgpuCapture.browser.mjs). Cette recette utilise le moteur et le parcours réel du Lab, mais ne remplace pas une campagne comparative officielle des quatre moteurs.

Le lot ne certifie ni les approximations produites par le compilateur, ni le rejet d’occlusion, ni la mémoire totale de scène. Le secours impose un minimum de pages résidentes et de temps de préparation. Le streaming des sommets/textures, les défauts QEM/accessors, les compteurs entre moteurs et les autres constats de l’audit restent ouverts.
