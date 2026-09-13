# Emerald : pages et LOD des transparents

Le compilateur prépare désormais les primitives BLEND statiques dans la passe
`clustered-blend`. Elles disposent de pages exactes de 256 triangles, de bornes
pour le rejet hors champ et des remplacements LOD que la topologie autorise.
La transmission, les skins et les morphs restent dans leur traitement dédié.
Les caches contenant cette passe utilisent le format 2, que les anciens SDK
refusent explicitement. Le lecteur actuel conserve la lecture des caches 1 et 2.

Le rendu conserve les matériaux, leurs UV et l'ordre des triangles exacts. Les
pages retenues sont regroupées par mesh source : toutes les faces arrière, puis
toutes les faces avant pour un matériau transparent à deux passes. Elles ne
participent ni au tampon de visibilité opaque ni aux occludeurs Hi-Z. Une coupe
complète reste affichée tant que les pages de remplacement ne sont pas résidentes.
Les indices regroupés ne sont réenvoyés au GPU que lorsque la coupe change.
Une coupe stable réutilise également ses groupes et leur ordre, sans nouveau
regroupement ni tri à chaque image.

## Vérification de la préparation

Le cache Emerald a été recompilé avec deux workers, depuis les mêmes sources,
dans un dossier distinct du cache public du laboratoire. Les sources et les
6 236 pages d'indices opaques sont identiques octet par octet à l'avant. Les
25 859 objets du nouveau cache ont été relus et vérifiés par taille et SHA-256.

| Donnée | Avant | Après |
| --- | ---: | ---: |
| Primitives BLEND dotées de pages | 0 | 29 |
| Triangles BLEND instanciés éligibles à la sélection par pages | 0 | 5 452 864 |
| Pages exactes de `Grass_blades.DoubleSided` | 0 | 6 313 |
| Triangles de la couverture initiale BLEND, avant rejet hors champ | 5 452 864 | 5 218 128 |

**Limite de Grass :** ses 1 615 992 triangles ne sont pas simplifiés par le QEM
conservateur actuel. Les bords empêchent cette réduction. Son bénéfice provient
du rejet des pages hors champ ; une vue qui englobe tout le mesh conserve tous
ses triangles. Le QEM positionnel ne borne pas l'erreur de texture alpha : les
captures exactes et les captures avec LOD doivent être vérifiées séparément.

## Protocole reproductible

Le test [transparentLod.browser.mjs](../test/transparentLod.browser.mjs) utilise
le banc 15 et les poses Emerald de `urbanPath`, à 1 246 × 1 000 pixels,
`pixelError=1`, avec 100 000 emplacements de pages. Il relève 60 timestamps GPU
par vue après échauffement, puis capture les images hors mesure et vérifie
leur stabilité A/A. Le mode `CAPTURE_ONLY=1 PIXEL_ERROR=0` sert au contrôle
géométrique exact. Les durées concernent les passes GPU, pas la latence totale
ni une promesse de fréquence d'affichage.

Les runs mesurés exigent `EXPECTED_METADATA_SHA256`. Le manifeste privé épingle
la version voulue ; les empreintes du manifeste, des métadonnées et du glTF sont
relues en fin de run. Le navigateur de mesure ignore les rechargements Vite
provoqués par les éditions concurrentes.

Les autres tâches de ce dépôt modifiaient simultanément le rendu opaque et le
compilateur. La comparaison est isolée sur `93bb666` et les seuls changements
transparents. Les sources, builds, empreintes et données brutes sont archivés
dans `benchmark-runs/transparent-lod/`. Le cache utilisé pour les mesures porte la clé
`a2eb09607499f39ffbd3722520e23a98619c982e20dcc1e316b54bc736601a87`.

La protection de compatibilité a ensuite produit le cache final en format 2, clé
`9038f6aff551d3dd73e4d1d78d8325fef4d72ff3fe7f22ab61e135ec6b1ebb37`.
La [comparaison des caches](audits/transparent-lod/cache-format2.json)
confirme l'identité des sources, des pages et des hiérarchies des 281 primitives.
Seules la version, la clé et la télémétrie de préparation changent. Les mesures
GPU restent celles du build archivé antérieur à ce garde de lecture.

La fusion sur `develop` conserve aussi son modèle conservateur
`bounds-diagonal-boundary-v1`, sa sélection GPU et son rendu hybride. Les
chiffres de cette campagne décrivent le correctif isolé sur `93bb666` ; ils ne
sont pas des mesures du moteur combiné après fusion. Les caches de la campagne
restent associés à leurs SDK archivés et doivent être recompilés pour ce moteur.
Le [contrôle navigateur final](audits/transparent-lod/final-capture.json)
charge ce cache avec le SDK final : ses trois captures sont identiques octet
par octet à celles du build mesuré, avec les mêmes textures et sans défaut de
couverture. Ce contrôle ne comporte aucune nouvelle mesure de performance.

Les anciens caches `shared-blend` dont le modèle d’erreur est compatible restent
lisibles. Ils doivent être recompilés
pour bénéficier de la sélection par pages des transparents.

## Résultat visuel et triangles soumis

Les captures texturées ont été contrôlées avec les mêmes 114 textures couleur
et 222 textures de données, sans erreur de chargement. En `pixelError=0`, les
trois images avant/après sont identiques octet par octet. Avec `pixelError=1`,
l'écart maximal est de 1/255 sur la vue générale, et de zéro sur les deux
autres vues. Les captures répétées A/A sont identiques.

| Vue du trajet | Triangles transparents avant | Après, LOD 1 px | Réduction |
| --- | ---: | ---: | ---: |
| 0 — générale | 10 905 728 | 10 436 256 | 4,30 % |
| 3 — végétation proche | 4 004 080 | 1 423 804 | 64,44 % |
| 8 — forte pression de pages | 10 791 680 | 10 314 824 | 4,42 % |

Ces nombres comptent les deux passes des matériaux concernés. Sur la vue 3,
Grass seul passe de 3 231 984 à 663 552 triangles soumis. En géométrie exacte,
le total transparent passe déjà de 4 004 080 à 1 435 336, sans changer un pixel.

## Durées mesurées et coût restant

La paire finale utilise le même build isolé, les mêmes poses et les deux caches
épinglés. Chaque ligne comprend 60 timestamps GPU et 3 600 images pour la mesure
CPU, sur Apple M2 Max avec Chrome/ANGLE Metal. Les captures du contrôle initial
retrouvé sont identiques à celles du premier run ; celles de l'après final sont
identiques aux captures après précédentes.

| Vue | GPU transparent avant, médiane / p95 (ms) | Après (ms) | CPU image avant, médiane / p95 (ms) | Après (ms) |
| --- | ---: | ---: | ---: | ---: |
| 0 — générale | 8,651 / 13,107 | 8,323 / 8,651 | 15,3 / 16,3 | 19,0 / 21,2 |
| 3 — végétation proche | 12,976 / 13,697 | 9,175 / 11,796 | 7,1 / 7,6 | 9,1 / 10,3 |
| 8 — forte pression de pages | 12,648 / 13,500 | 13,173 / 15,598 | 15,4 / 16,9 | 18,1 / 20,5 |

**Le gain de performance global n'est pas établi.** Le nombre de triangles
baisse, mais le travail CPU par image augmente de 2,0 à 3,7 ms dans cette paire.
Le temps GPU diminue sur les deux premières vues et augmente sur la troisième,
avec une dispersion importante. Les appels de dessin transparents restent
identiques (1 928 / 232 / 1 884) : le regroupement évite un appel par page.
Ces résultats valident le découpage et le rejet hors champ, pas 120 FPS. La
sélection et la gestion de ces pages supplémentaires restent à optimiser.

Synthèses de preuve conservées dans le dépôt :

- [Comparaison du cache](audits/transparent-lod/cache-before-after.json)
- [Intégrité des objets](audits/transparent-lod/cache-integrity.json)
- [Comparaison finale GPU, CPU et pixels](audits/transparent-lod/measurements.json)
- [Revalidation du contrôle des capacités GPU](audits/transparent-lod/gpu-revalidation.json)

Les captures RGBA/PNG, événements par image, journaux complets et la reconstruction
détaillée de la référence restent dans le dossier local
`benchmark-runs/transparent-lod/`, conservé avec les données brutes de la campagne.

La compilation et les 380 tests JS/TS du checkout intégré passent, y compris
la reprise d'une scène mixte après chargement de sa couverture initiale, l'ordre
des transparents, la stabilité des groupes et les gardes de format. Les
[journaux de validation](audits/transparent-lod/validation.json)
sont archivés séparément des mesures isolées.
Les 41 tests Rust du compilateur isolé passent également.

Deux retours de contrôle ont été écartés : une autre tâche avait remplacé le
pointeur public du cache Emerald pendant la campagne. Ils rechargeaient donc
un autre cache, ce qui explique les différences opaques observées. Le contrôle
retenu épingle le cache initial `019a531c…` et vérifie son contenu avant
la mesure. Le dossier initial ayant aussi été supprimé, il est reconstitué
depuis le JSON parsé et archivé au premier run, avec les sources et les objets
d'indices vérifiés par SHA-256. Le SHA du JSON résérialisé diffère de celui des
octets HTTP initiaux ; aucune géométrie n'est recalculée. Les données des essais
écartés sont conservées avec leur motif ;
elles ne constituent pas une preuve de variation à cache identique.

L'essai après final a terminé toutes ses mesures et captures, puis son contrôle
de capacités GPU a échoué uniquement sur l'ordre d'énumération de la même liste
de capacités. Son résultat brut est conservé tel quel ; une revalidation
séparée compare les capacités comme un ensemble et recalcule les comparaisons
de pixels. Elle ne constitue pas une nouvelle mesure GPU.

## Validation de la fusion dans develop

Le résultat combiné passe la compilation, 384 tests JS/TS et 52 tests Rust
(51 unitaires et un test d’intégration). La sélection GPU mixte est couverte
par un test de chargement initial avec pages opaques et transparentes. Le rendu
hybride, les textures progressives et le modèle conservateur de develop sont
conservés. La [preuve de validation](audits/transparent-lod/merge-validation.json)
identifie les sources contrôlées. Aucune performance GPU du moteur combiné
n’est déduite des chiffres de la campagne isolée.
