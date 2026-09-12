# Matériaux et extensions géométriques

> Conception Web Geometry : ce chapitre décrit des contrats et algorithmes proposés. Voir [l’état de l’implémentation](../../../packages/README.md).

## 1. Domaine du socle

La référence est une surface triangulée statique opaque avec raster matériel. Les fonctions ci-dessous définissent des extensions séparées. Elles ne deviennent pas supportées simplement parce qu'un record contient un flag pour les activer.

Toute extension doit préciser sa géométrie, ses bornes, son erreur, ses passes, ses dépendances mémoire et son repli. Le même objet peut exiger un chemin différent pour affichage, ombre, sélection ou rayons.

## 2. Matériaux et lots

Le lot raster réunit les éléments ayant les mêmes règles de couverture : culling, alpha test, déformation, profondeur, formats et bindings requis. Le lot shading réunit les mêmes programmes et ressources d'évaluation. Deux matériaux peuvent partager la couverture mais pas le shading.

Référence de regroupement : classifier les clés, histogramme par clé, scan exclusif des comptes, scatter dans les plages obtenues. La variante CPU fournit un ordre stable. La variante GPU teste les capacités et définit si l'ordre interne est utile ou non.

Les lots de clusters se comptent en clusters ; les lots de shading se comptent en pixels ou quads. Une plage de travail n'est pas une commande de dessin indexé : sa conversion nécessite la géométrie, les indices et les arguments attendus par le backend.

Une modification de matériau prépare de nouvelles clés, bindings et références, les publie ensemble, puis libère les anciens états après leurs derniers usages. Un pipeline non prêt garde un repli explicite ; ne pas utiliser un handle invalide. Les tables à identifiants creux sont dimensionnées d'après l'indice maximal ou utilisent une indirection, pas seulement le nombre vivant.

## 3. Repères et filtrage

Pour un triangle : `edge1=p1-p0`, `edge2=p2-p0`, `uv1=tex1-tex0`, `uv2=tex2-tex0`. Avec `det=uv1.x*uv2.y-uv1.y*uv2.x` :

```text
tangent = (edge1*uv2.y-edge2*uv1.y)/det
bitangent = (edge2*uv1.x-edge1*uv2.x)/det
tangent = normalize(tangent-normal*dot(normal,tangent))
sign = -1 if dot(cross(normal,tangent),bitangent)<0 else 1
bitangent = sign*cross(normal,tangent)
```

Refuser une division mal conditionnée ; utiliser une base orthonormale de secours ou neutraliser la normal map selon le contrat. Une base reconstruite par triangle ne reproduit pas nécessairement une base lissée utilisée au calcul de la texture ; tester les coutures et les miroirs.

Chaque valeur de matériau peut propager `(value,dx,dy)`. Somme, produit, quotient et normalisation suivent leurs jacobiennes ; voir [les dérivées](../mathematiques/SCHEMAS_ET_DERIVEES.md). Une discontinuité de `fract`, `step` ou d'une branche demande un filtrage explicite, pas une dérivée arbitrairement nulle.

Les normales se compressent par projection octaédrique et quantification de deux composantes, puis reconstruction/normalisation. Mesurer l'erreur angulaire après décodage. La borne de position ne dit rien de cette erreur.

## 4. Alpha et transparence

L'alpha test influence la profondeur : un texel transparent ne peut pas devenir un occluder plein. Le prepass et le rendu final utilisent le même seuil, les mêmes UV et la même déformation. Sans cela Hi-Z peut supprimer un objet visible à travers un trou.

La transparence mélange plusieurs surfaces ; un unique identifiant de triangle gagnant ne représente pas la composition. Référence : conserver le chemin transparent habituel et son tri, sans l'inclure dans l'occlusion opaque. Une approximation d'ordre ou un stockage de plusieurs couches est un autre banc, avec métrique d'erreur visuelle.

## 5. Skinning et morphs

Position skinnée homogène : `position=sum(weight_j*matrix_j*restPosition)`, avec poids finis non négatifs de somme 1 et matrices exprimées dans le même repère. Réunir les poids des identifiants d'os identiques avant de réduire le nombre d'influences.

Composition de référence avec vecteurs colonnes : `M_bind` transforme le mesh au repos vers le monde, `B_j` transforme l'os en pose de liaison vers le monde, `J_j(t)` cet os à l'instant courant et `M(t)` le mesh courant vers le monde. Définir `inverseBind_j=inverse(B_j)*M_bind`, puis `matrix_j(t)=inverse(M(t))*J_j(t)*inverseBind_j`. Le résultat pondéré est local au mesh courant ; multiplier par `M(t)` donne sa position monde. Les matrices inversées doivent être non singulières. Des matrices de liaison fournies par l'import sont converties vers cette convention, sans appliquer deux fois la liaison.

Test de liaison : lorsque `M(t)=M_bind` et `J_j(t)=B_j`, chaque `matrix_j` vaut l'identité et le mesh de repos est restitué. Exemple sur un axe : translations du mesh de 10, de l'os au repos de 12 et de l'os courant de 15 ; `inverseBind` translate de −2, la matrice locale de skinning de +3. Un point local 1 devient local 4 puis monde 14. Ce test sépare une translation d'instance d'une déformation et détecte une liaison appliquée deux fois.

Quantification des poids : normaliser, multiplier par `maxInteger`, prendre les planchers, distribuer le reste aux plus grandes fractions avec départage stable. La somme entière reste exactement `maxInteger`. Exemple `[0.2,0.3,0.5]` sur 255 donne `[51,77,127]` si l'égalité des fractions donne priorité au deuxième poids.

La référence de normales recalcule les normales sur la géométrie déformée en préservant les domaines de lissage. Additionner des normales transformées constitue une approximation de shading à recetter ; la somme des inverses-transposées n'est pas l'inverse-transposée de la somme des matrices.

La référence de bornes recalcule l'AABB de toutes les positions déformées. Un mélange affine commun peut transformer une borne seulement si les poids sont identiques pour tout l'ensemble. Pour poids variables, employer des enveloppes d'os démontrées ou le recalcul, pas la borne du repos.

Morphs : `position=base+sum(weight_j*delta_j)`. Pour des poids bornés, chaque composante de delta donne un intervalle ; additionner leurs minima/maxima produit une AABB conservative. Si les poids sortent des intervalles déclarés, invalider la borne.

Pour une extension combinant morphs et skinning, la référence applique les deltas de morph dans le repère du mesh au repos, puis le skinning, puis la transform d'instance. Un déplacement supplémentaire doit déclarer son repère, son ordre et ses bornes ; aucun ordre implicite ne peut être partagé entre culling, ombres et rendu final.

La vélocité compare projections des positions aux temps courant/précédent, avec caméras et déformations correspondantes. Une génération incompatible remet l'historique à zéro. Les ombres d'un objet hors champ peuvent encore demander sa déformation.

## 6. Subdivision et déplacement

Subdivision de référence : marquer les arêtes à couper, partager une décision par arête géométrique, créer un milieu unique par arête puis subdiviser chaque triangle selon ses arêtes marquées. Les attributs de coutures peuvent garder plusieurs copies au même point. Les voisins doivent obtenir la même position de milieu, orientation comprise.

Chaque triangle a zéro, une, deux ou trois arêtes marquées : il produit respectivement un, deux, trois ou quatre triangles, avec winding conservé. Une limite de profondeur et un budget de triangles arrêtent la construction. L'arrêt avant la tolérance produit `target-not-reached`, pas un succès de qualité.

Un seuil de longueur d'arête limite la taille des triangles ; il ne prouve pas l'erreur de déplacement. Pour un déplacement continu `D` et des barycentriques `b`, comparer `D(position(b))` à `sum(b_i*D(p_i))`. L'erreur quadratique vaut la norme au carré de leur différence. Un échantillonnage fournit une estimation ; une borne continue exige régularité, majoration des dérivées ou intervalles.

Une amplitude de déplacement connue `amplitude` élargit une sphère de `radius` à `radius+amplitude`, si la norme du déplacement reste bornée ainsi. Les textures, règles d'adressage, paramètres et version du calcul entrent dans le cache.

Préparation hors ligne et subdivision dynamique ont des budgets différents. La première crée un asset vérifié. La seconde modifie le travail par frame, nécessite files bornées, motifs reproductibles et cohérence temporelle ; elle n'est pas un prérequis des premiers bancs.

## 7. BVH et rayons

Un BVH médian est une référence simple : englober les primitives, choisir l'axe de plus grande étendue de leurs centres, partager à la médiane, répéter jusqu'au plafond de feuille. Une boîte de centre constant devient une feuille ou est partagée par ID pour garantir le progrès.

Rayon `origin+t*direction`, `t>=0`. Pour chaque axe de boîte, si direction vaut zéro, l'origine doit être dans la tranche. Sinon calculer les deux intersections, les ordonner, accumuler `tNear=max(tNear,low)` et `tFar=min(tFar,high)`. Rejeter si `tNear>tFar`. Visiter l'enfant de plus petit `tNear` en premier.

Intersection triangle : `edge1=p1-p0`, `edge2=p2-p0`, `cross1=cross(direction,edge2)`, `det=dot(edge1,cross1)`. Si le déterminant est trop faible, appliquer le contrat de parallélisme. Sinon `delta=origin-p0`, `u=dot(delta,cross1)/det`, `cross2=cross(delta,edge1)`, `v=dot(direction,cross2)/det`, `t=dot(edge2,cross2)/det`. Accepter `u>=0`, `v>=0`, `u+v<=1` et `t` dans l'intervalle du rayon. Le double-face et les tolérances sont explicites.

L'intersection au bord doit être robuste et cohérente entre triangles pour éviter les fuites ; cette formule f64 est une baseline, pas une preuve de watertightness sur toute entrée flottante. Le picking peut employer ce BVH CPU sans imposer d'accélération matérielle.

La géométrie raster et celle des rayons peuvent avoir des LOD distincts. Une page présente n'implique pas une accélération prête. Suivre séparément générations, construction, scratch, résidence et requêtes hors écran.

## 8. Représentation directionnelle de cellules

Une cellule géométrique peut accumuler une statistique de normales `C=sum(area_i*normal_i*transpose(normal_i))/sum(area_i)`. `C` est symétrique, stockable par six coefficients et semi-définie positive en arithmétique exacte.

Le score directionnel est `projected(direction)=sqrt(max(0,directionᵀ*C*direction))` pour direction unitaire. Pour une normale unique il vaut `abs(dot(normal,direction))`. Pour plusieurs normales, la racine d'une moyenne quadratique n'est pas la moyenne des projections absolues ; cette distinction interdit de présenter le score comme une aire exacte universelle.

Une diagonalisation symétrique fournit axes propres et échelles `sqrt(eigenvalue)`. Référence de Jacobi : choisir le plus grand coefficient hors diagonale, effectuer une rotation plane annulant ce coefficient, accumuler les rotations ; arrêter quand la norme hors diagonale passe sous le seuil relatif ou à la limite d'itérations. Une petite valeur propre négative due aux arrondis se traite sous tolérance ; une valeur fortement négative indique une entrée invalide.

Cette statistique ne définit ni occupancy, ni densité, ni shader volumétrique, ni format de streaming. Ce moment `C` n'est pas la matrice de distribution SGGX `S` : le [chapitre cellules et courbes](DEFORMATION_CELLULES_ET_COURBES.md) distingue explicitement les deux calculs. Ce dernier précise voxelisation, échantillonnage, densité et courbes ; le [pipeline GPU](../runtime/PIPELINE_GPU_ET_EXTENSIONS.md) précise traversée et intégration d'opacité. Garder le rendu triangulé comme référence.

## 9. Courbes et autres représentations

Une courbe polyligne se réduit par suppression de points sous erreur point-segment, avec extrémités verrouillées. La distance entre racines de deux courbes ne borne pas la distance entre leurs formes complètes. Pour épaisseur non nulle, intégrer le rayon à la borne de culling et à l'erreur visuelle.

Terrain, instances procédurales et géométrie modifiée par l'éditeur réutilisent le contrat d'asset avec invalidation par régions. Une modification locale ne justifie pas de republier des références vers des buffers en cours d'utilisation.

## 10. Recette des extensions

Matériaux : deux pipelines proches mais incompatibles, alpha percé, double face, UV miroir, tangente nulle. Déformation : poids nuls/négatifs, os singulier, poids variant dans un cluster, saut de génération. Subdivision : toutes les combinaisons de marques, couture dupliquée, budget atteint, déplacement discontinu. Rayons : parallèle, origine dans boîte, bord partagé, triangle presque plat. Cellules : normales identiques, opposées, distribution isotrope et matrice dégénérée.

Les extensions avancées ne sont pas des gains présumés : chacune doit montrer correction, mémoire et temps total dans un banc indépendant avant activation dans le moteur.
