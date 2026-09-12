# Les calculs qui font fonctionner le système — Web Geometry

Spécification de conception, à distinguer des [capacités actuellement implémentées](../../../packages/README.md). Les numéros historiques des sections sont conservés.

Ce document est le point d'entrée pour comprendre, implémenter puis optimiser les mathématiques. Il distingue **équation**, **hypothèse** et **garantie**. Les nombres des exemples sont des calculs illustratifs, jamais des mesures de performance.

Le système gagne surtout en évitant du travail : préparer une hiérarchie réutilisable, choisir juste le détail nécessaire, supprimer le travail invisible, puis traiter efficacement le reste. Remplacer une division ne compense pas une mauvaise coupe LOD, des transferts excessifs ou des milliers de soumissions CPU.

## 2. Conventions communes

Un point objet est transformé par `P_view = V × M × [P_object,1]`, puis par la projection. Choisir vecteurs colonnes et matrices composées dans cet ordre pour le nouveau code. Les sources HLSL peuvent employer l'ordre transposé : traduire la convention, pas seulement la syntaxe.

Dans les équations ci-dessous `Z > 0` est la profondeur **vers l'avant** de la caméra. Three.js regarde habituellement vers `-Z` dans son espace caméra : utiliser `Z = -P_view.z` pour ces formules. Ne jamais prendre la longueur d'une position déjà projetée comme distance affine.

`H,W` sont les dimensions physiques de la cible de rendu, pas les pixels CSS. `fx = W |P00|/2`, `fy = H |P11|/2` sont les focales en pixels. Une projection symétrique donne `fy = H/(2 tan(FOVy/2))`. Une erreur `e` est une longueur, un coût QEM est une énergie : ils ne sont pas interchangeables.

Les plans de frustum ont leur normale vers l'intérieur. Le modèle de profondeur doit déclarer explicitement standard ou reversed-Z, le domaine NDC, la valeur de fond, la comparaison et la réduction Hi-Z. Les exemples se placent en coordonnées écran avec `y` vers le haut sauf mention contraire.

## 3. M01 — Triangles, voisinage et partition

Pour les sommets `A,B,C` :

```text
cross = (B-A) × (C-A)
area = 0.5 × ||cross||
normal = cross / ||cross||
```

Si `area` est trop petite relativement à l'échelle locale, le triangle est dégénéré : ne pas normaliser `cross`. Une tolérance absolue commune à une planète et à une vis est inadaptée.

Une arête topologique se code par `(min(id_a,id_b), max(id_a,id_b))`. Une table arête → triangles construit l'adjacence manifold en temps attendu `O(T)` par hachage, ou `O(T log T)` par tri déterministe. Les arêtes à plus de deux faces sont diagnostiquées et verrouillées, sans créer une clique de toutes leurs faces : celle-ci coûterait un nombre quadratique de liens. Un sommet géométrique et un sommet d'attributs ne sont pas la même chose : une couture UV peut partager une position et avoir deux jeux d'attributs.

Le partitionnement recherche des groupes de triangles avec peu d'arêtes coupées :

```text
cut_cost = sum(weight(edge)) pour les arêtes entre partitions
contraintes : triangles(cluster) <= T_max
              vertices(cluster) <= V_max
```

Des contraintes matériaux et topologie peuvent augmenter ce coût. Aucune partition de taille fixe n'est universellement optimale. Le nombre de sommets et le taux de duplication importent autant que le nombre de triangles.

**Optimiser après recette :** partir de la référence par ID et croissance minimisant les nouveaux sommets, puis comparer départ spatial Morton et partitionneur de graphe avec les mêmes plafonds. Mesurer le temps de build, les duplications, la compacité des bornes et le coût de culling obtenu, pas uniquement le nombre de clusters.


## 4. M02 — Quadric Error Metric : où placer le sommet simplifié ?

Pour un plan de triangle normalisé `plane = [nx,ny,nz,d]`, le carré de la distance du point homogène `v = [x,y,z,1]` au plan vaut :

```text
K = plane × transpose(plane)
E_plane(v) = transpose(v) × K × v = (dot(normal,position)+d)^2
Q_vertex = sum(weight_triangle × K_triangle)
Q_merge = Q_left + Q_right
```

Une matrice symétrique 4×4 nécessite dix coefficients indépendants. L'addition de quadriques évite de relire toutes les faces historiques à chaque contraction.

En séparant les blocs :

```text
Q = [ A  b ]     A : 3×3 symétrique
    [ bᵀ c ]
E(position) = positionᵀ A position + 2 bᵀ position + c
gradient(E) = 2 A position + 2 b
position_opt = solution de A position = -b
```

Utiliser une résolution pivotée et un critère relatif de mauvais conditionnement. Ne pas calculer explicitement l'inverse. Si le système est singulier, comparer les deux extrémités et le milieu; une optimisation sur le segment ajoute un candidat :

```text
direction = right-left
alpha = directionᵀ A direction
beta = directionᵀ (A left+b)
t = clamp(-beta/alpha, 0, 1) si alpha suffisamment positif
candidate = left + t direction
```

**Exemple :** plans `x=1`, `y=2`, `z=3`, poids unité. `E=(x-1)^2+(y-2)^2+(z-3)^2`. Le minimum est `(1,2,3)` avec énergie zéro. Un seul plan `z=0` donne un système singulier : tous les points du plan sont minimisateurs, donc les contraintes topologiques choisissent le candidat.

Une contraction valide doit aussi vérifier : frontières verrouillées, matériau/couture autorisés, absence de triangle retourné, aire minimale, indices non dégénérés, préservation du contrat manifold si exigé. Le meilleur coût numérique ne rend pas une contraction automatiquement valide. Une file de priorité doit invalider les candidats dont le voisinage a changé.

**Coûts des attributs.** Ajouter des différences de normales, couleurs et UV est une métrique de qualité pondérée. Si les normales sont unitaires, `||n1-n2||² = 2(1-cos(angle))`. Les UV répétés, les normales de part et d'autre d'une couture et les tangentes signées demandent des règles explicites. Les poids mélangent des unités différentes : les normaliser, les versionner et mesurer leur effet sur le rendu.

**Point critique :** `sqrt(QEM)` n'est pas automatiquement une borne maximale de déplacement. Avec des poids d'aire, l'énergie peut même avoir des unités `longueur^4`. Déclarer séparément coût d'optimisation, erreur géométrique estimée et borne certifiée. Ne pas présenter QEM comme une distance de Hausdorff garantie.


## 5. M03 — Pourquoi regroupement et frontières évitent les fissures

La boucle de préparation est : `clusters enfants → groupe connecté → fusion → simplification → nouveaux clusters parents`. Le contour **extérieur du groupe** reste identique. Les frontières internes peuvent disparaître, puis être déplacées lors du nouveau découpage.

```text
pour chaque groupe G :
  verrouiller les arêtes qui touchent une région hors de G
  simplifier union(G) sous contraintes
  partitionner le résultat en parents
  enregistrer la relation entre tous les enfants et tous ces parents
```

Un groupe peut produire plusieurs parents : la représentation est un DAG, pas nécessairement un arbre avec un unique parent par cluster. Les décisions de remplacement doivent être partagées par l'ensemble du groupe. Raffiner seulement l'un des parents d'un remplacement collectif peut ouvrir un trou ou doubler de la surface.

L'invariant testable est : pour chaque remplacement, le contour quantifié du résultat égale celui de la région remplacée, avec orientations cohérentes. Ne pas exiger que les triangles internes restent identiques.

**Arrêt obligatoire du build :** si un groupe ne réduit plus, garder cette représentation terminale et signaler la contrainte. Ne pas boucler jusqu'à atteindre une cible impossible. Inclure composantes isolées, bords ouverts et géométrie non manifold dans les fixtures.


## 6. M04 — Monotonie n'est pas une preuve d'erreur totale

Deux propriétés différentes sont nécessaires.

**Monotonie de sélection :** le score projeté parent est au moins celui des enfants. Stocker `e_parent >= max(e_child)` aide, mais les bornes et la projection doivent aussi respecter cette monotonie.

**Borne de l'approximation :** si `delta` borne réellement la distance entre la représentation enfant et son parent, et `e_child` borne l'erreur enfant face à l'original, l'inégalité triangulaire donne :

```text
e_parent <= max(e_child) + delta
```

On peut donc stocker `max(e_child)+delta` comme majorant **si ces deux entrées sont des bornes compatibles**. `max(e_child,delta)` ne couvre pas en général l'accumulation. Deux déplacements successifs de 1 mm dans le même sens peuvent déplacer de 2 mm; le maximum seul reste à 1 mm.

Un maximum de métriques locales ne justifie pas à lui seul un majorant de Hausdorff. Si `delta` est déjà mesuré directement par rapport à la géométrie initiale, la combinaison peut être différente. Nommer l'origine de chaque erreur dans le format.

**Bornes imbriquées :** pour une AABB, `parent.min = min(child.min)` et `parent.max = max(child.max)` composante par composante, en incluant aussi les nouveaux sommets et leur incertitude. Pour deux sphères : si l'une contient l'autre, la garder; sinon `R=(distance+r1+r2)/2` et `C=c1+(R-r1)(c2-c1)/distance`. Traiter les centres confondus séparément.

**Test :** vérifier inclusion et monotonie sur chaque relation, puis sur des trajectoires caméra. Une correction en pixels appliquée indépendamment par cluster peut casser l'invariant même si les erreurs objet sont monotones.

## 7. M05 — Erreur à l'écran : le calcul LOD central

### Approximation simple, utile comme baseline

Près de l'axe optique, avec une petite erreur latérale et une profondeur presque constante :

```text
error_px ≈ fy × error_world / depth
```

**Exemple :** `H=1080`, `FOVy=60°`, `fy≈935.307`, `error_world=0.01 m`, `depth=10 m`. L'erreur est environ `0.9353 pixel`. À 20 m elle est environ `0.4677 pixel`.

Cette formule mesure l'erreur de simplification, pas le diamètre du mesh. La distance euclidienne caméra-centre n'est pas la profondeur optique. Hors axe, un déplacement en profondeur peut aussi déplacer fortement la projection.

**Erreur à éviter :** calculer `fy × error / sqrt(d_clip²-error²)` avec une position après MVP avant division mélange les espaces. Cette expression ne traite pas correctement décentrage, near plane et transformations arbitraires.

### Une borne de référence explicite pour les tests

Projection perspective : `u=fx X/Z`, `v=fy Y/Z`, après retrait des offsets principaux. Sa jacobienne vaut :

```text
J = [ fx/Z    0     -fx X/Z² ]
    [  0     fy/Z   -fy Y/Z² ]
```

Construire une boîte convexe en espace caméra contenant les points originaux, simplifiés et les segments qui les relient. Si la boîte initiale ne couvre qu'une représentation, l'élargir de l'erreur garantie. Noter `Zmin>0`, `Xmax=max(abs(minX),abs(maxX))`, `Ymax` analogue, `Rmax²=Xmax²+Ymax²`, `fmax=max(fx,fy)`.

```text
L = fmax/Zmin × sqrt(1 + Rmax²/Zmin²)
error_px_bound = L × error_world
```

La norme de la jacobienne est bornée par `L` sur toute cette boîte; le théorème des accroissements finis borne le déplacement projeté. Cette référence est volontairement prudente. La garantie dépend d'une vraie borne géométrique en entrée. Si l'erreur est seulement estimée, le résultat demeure estimé.

**Near plane :** si la région admissible croise le plan proche, raffiner ou passer à une référence avec clipping. Ne pas remplacer silencieusement un dénominateur négatif par un epsilon et déclarer le résultat garanti. Pour une caméra orthographique, `error_px_bound = max(fx,fy) × error_world`, avec les coefficients de la projection orthographique.

**Transformations :** avec la partie linéaire `A` du modèle, `error_world <= ||A||₂ error_object`. Pour rotation + échelles orthogonales, utiliser la plus grande échelle absolue. Avec cisaillement, une borne sûre est `||A||F = sqrt(sum(Aij²))` ou `sqrt(||A||1 ||A||∞)`. Le maximum des longueurs des colonnes n'est pas une garantie générale sous cisaillement. Une matrice singulière nécessite un chemin explicite, en particulier pour les normales.

**Statut des précalculs :** déplacer une opération hors d'une boucle n'est accepté qu'après mesure du coût complet, préparation et invalidation comprises. Les comparaisons de performance trouvent un gain CPU pour la tangente du prototype de diamètre radial, mais pas de gain établi de fluidité. Le cache de la borne AABB, testé dans une transcription JavaScript, ralentit le calcul lorsqu'il est reconstruit à chaque changement de vue. Aucun de ces résultats ne remplace cette borne ni son oracle Python.

Toute future variante doit garder les conventions, l'ordre des opérations flottantes ou une preuve numérique adaptée, et les cas hors axe, near plane, caméra dans la borne, grandes coordonnées, orthographique, viewport non carré, jitter et échelle négative. Le coût d'un cache inclut ses octets supplémentaires et tous les changements qui l'invalident ; une mesure de réutilisation à vue fixe ne prouve pas un gain en déplacement.


## 8. M06 — La coupe LOD : choisir une représentation unique

Pour un score monotone le long d'un chemin et un seuil `tau` :

```text
select(cluster) = score(cluster) <= tau AND score(parent_transition) > tau
```

Le parent de cette expression représente le remplacement collectif approprié, pas un champ arbitraire pris dans un DAG. La racine possède une règle terminale explicite; les feuilles exactes sont acceptables même si aucun niveau supplémentaire n'existe.

**Exemple :** scores racine `8`, niveau suivant `2`, feuilles `0`, seuil `3`. Le niveau à `2` est retenu. À seuil `1`, les feuilles sont retenues. L'égalité appartient au côté `<=`; ne pas utiliser deux comparaisons strictes qui laissent un trou.

```text
frontier = racines résidentes
répéter par niveau :
  rejeter seulement les régions sûrement invisibles
  si raffinement nécessaire ET remplacement complet résident :
    émettre ses enfants une seule fois
  sinon : émettre sa représentation courante
```

Pour un DAG partagé, une visite doit être dédupliquée par identifiant logique `(instance,vue,groupe)` ou résolue par une représentation de traversal qui garantit déjà l'unicité. Un compteur atomique ne supprime pas les doublons.

**Résidence :** si les enfants nécessaires manquent, conserver la représentation ancêtre complète et demander les pages. La qualité peut temporairement dépasser le seuil; la surface doit rester complète. Ne pas supprimer le parent avant publication de tous les remplaçants.

**Hystérésis :** raffiner au-dessus de `tau_high`, regrouper sous `tau_low`, `tau_low<tau_high`. Stocker l'état au niveau du groupe de remplacement, par vue si nécessaire. L'hystérésis n'autorise jamais un mélange incohérent de parent et enfants.


## 9. M07 — Frustum et cône de normales

Pour un plan intérieur `(normal,offset)` :

```text
sphere_outside = dot(normal,center)+offset < -radius × ||normal||
aabb_radius_on_plane = dot(abs(normal),extent)
aabb_outside = dot(normal,center)+offset+aabb_radius_on_plane < 0
```

Si les plans sont normalisés, `||normal||=1`. La formule AABB reste valable avec des plans non normalisés. Le test strict conserve les objets tangents.

Avec vecteurs colonnes et lignes `row0..row3` de la matrice world→clip : gauche/droite `row3±row0`, bas/haut `row3±row1`. Pour un clip Z `[0,w]`, les deux plans Z sont `row2` et `row3-row2`; pour `[-w,w]`, `row3±row2`. Leur rôle proche/loin dépend de la projection reversed-Z. Ne pas recopier les six plans WebGL vers WebGPU sans adaptation.

Une AABB objet transformée a `center_world=A center+t` et `extent_world=abs(A) extent`. Cette expression est exacte pour l'AABB englobant une boîte affine, y compris avec cisaillement.

**Cône de normales, variante optionnelle.** Soit l'axe unitaire `axis`, demi-angle `alpha`, et `view` la direction unitaire surface→caméra. La référence exige `0<=alpha<pi/2`. Si la direction est constante, toutes les faces sont arrière lorsque `dot(axis,view) < -sin(alpha)`, avec marge de sécurité. Pour une sphère de rayon `r` vue à distance `d>r`, élargir l'angle par `beta=asin(r/d)`; utiliser `alpha+beta` uniquement si inférieur à `pi/2`. Sinon ne pas rejeter, y compris en orthographique pour un cône initial trop large. Désactiver pour faces doubles et bornes de déformation inconnues. Un déterminant de transformation négatif change la convention d'orientation.

**Tests :** aucun faux rejet face à une référence par triangle, y compris réflexion et caméra intérieure. Mesurer si le cône économise davantage de raster qu'il ne coûte en calcul et en mémoire.

## 10. M08 — Hi-Z : la preuve qu'un objet est caché

| Convention | Fond | Test depth | Réduction Hi-Z | Rejet d'une borne |
|---|---:|---|---|---|
| Standard, proche 0 | 1 | less/less-equal selon pipeline | max | `bound_nearest > hiz_max + bias` |
| Reversed-Z, proche 1 | 0 | greater/greater-equal | min | `bound_nearest < hiz_min - bias` |

Le mip stocke la profondeur **la plus éloignée** des occluders couverts. Un seul pixel de fond doit empêcher un rejet qui masquerait une ouverture. Un mip moyen ou une réduction dans le mauvais sens produit de faux rejets.

```text
parent_texel = reduce(tous les texels enfants de sa zone)
```

Pour une pyramide ceil-divisée, chaque niveau fait `ceil(width/2) × ceil(height/2)`. Les textures à mipmaps matériels utilisent habituellement des dimensions floor-divisées : pour une taille impaire, adapter les empreintes ou compléter le niveau de base jusqu'à une taille compatible avec une profondeur de fond. Une boucle `2×2` qui oublie la dernière ligne/colonne n'est pas conservative.

Projeter une borne avec clipping correct; en cas de crossing near non traité, conserver visible. Dilater le rectangle de l'incertitude numérique/jitter. À un mip donné, visiter **tous** les texels intersectant le rectangle; le mip choisi ne rend pas un échantillon central automatiquement suffisant. Utiliser `textureLoad`, sans filtre bilinéaire.

**Exemple :** occluders `[0.2,0.3,0.4,1.0]` en standard → parent `1.0`. Une borne à `0.8` n'est pas rejetable; elle peut apparaître dans le pixel de fond. Remplacer `max` par `min` donnerait un rejet faux.

**Deux passes temporelles :** le Hi-Z précédent sert à prioriser, pas à prouver la visibilité courante. Rasteriser les candidats retenus au temps courant, construire une pyramide courante, retester les candidats rejetés précédemment avec leur transformation courante, rasteriser les nouveaux visibles. Invalider ou assouplir l'historique après téléportation, changement de projection/résolution, caméra nouvellement créée ou déplacement d'occluders. Toutes les géométries utilisées comme occluders doivent avoir une profondeur valide (alpha test, déformation, double face compris).

**Test décisif :** comparer aux images sans occlusion, sur désoccultation rapide et occluders mouvants. Compter faux rejets, pas seulement le taux de culling.

## 11. M09 — Scan exclusif et compaction

Pour un prédicat `keep[i]` valant 0 ou 1 :

```text
offset[i] = sum(keep[j], j < i)
total = offset[N-1] + keep[N-1] si N>0, sinon 0
si keep[i] : output[offset[i]] = input[i]
```

**Exemple :** `keep=[1,0,1,1,0]` → `offset=[0,1,1,2,3]`, `total=3`. Les sorties occupent exactement les cases `0,1,2`.

Trois variantes à comparer : atomicAdd par élément; scan local et une réservation atomique par groupe; scan global en plusieurs passes. La réservation par groupe réduit les atomiques globales d'environ le nombre moyen d'éléments retenus par groupe, mais ajoute barrières et mémoire partagée. Pour une très petite liste, ces coûts peuvent dominer.

La variante atomique par groupe n'est pas stable entre groupes; le scan global ordonné peut l'être. Si l'ordre est contractuel pour transparence, reproductibilité ou tests, ne pas comparer ces variantes comme équivalentes.

Toutes les invocations d'un workgroup doivent atteindre les barrières uniformément : la fin de tableau contribue zéro, sans `return` anticipé avant les barrières. Aucune barrière de workgroup ne synchronise tous les workgroups. Les étapes globales utilisent des dispatchs distincts.

**Débordement :** vérifier les capacités et ne jamais publier de compte supérieur au stockage réel. Un simple clamp protège la mémoire mais peut perdre la surface : pour la recette de rendu, prévoir une stratégie qui conserve une coupe complète (budget garanti, relance, ou fallback global). Les compteurs u32 ne doivent pas reboucler.

## 12. M10 — Indirect et tri des matériaux

Une commande `drawIndexedIndirect` est un bloc de 20 octets :

```text
offset 0 : indexCount     u32
offset 4 : instanceCount  u32
offset 8 : firstIndex     u32
offset12 : baseVertex     i32
offset16 : firstInstance  u32
```

`baseVertex` est signé; dire « cinq u32 » est une simplification incorrecte du typage. Un tableau de mots peut stocker son motif binaire, mais le chargement est signé. Le buffer doit avoir l'usage indirect approprié, et l'offset être valide et aligné. Ne pas supposer un multi-draw-count standard; une liste d'appels indirects peut encore nécessiter plusieurs commandes CPU. Garder `firstInstance=0` sans capacité explicitement disponible.

Un bin se définit par les états qui imposent un pipeline/draw distinct : format, shader, alpha/cull/depth, bindings compatibles. Un regroupement par couleur seule ne suffit pas.

Pour le counting-sort par bin : histogramme `count[bin]`, scan des comptes → `start[bin]`, puis réservation d'un rang local et scatter à `start[bin]+rank`. La somme des comptes doit être égale au nombre d'éléments valides. Réduire l'espace des clés avant d'allouer un tableau immense et presque vide.

Un premier chemin WebGPU peut utiliser du vertex pulling avec une liste compacte et un petit nombre de bins. Le coût en vertices fictifs/padding et les changements de matériaux doivent être mesurés. Les appels indirects ne rendent pas automatiquement gratuits les milliers de clusters.

## 13. M11 — Couverture raster et visibilité

Pour un triangle orienté positivement dans un écran `y` vers le haut :

```text
edge(A,B,P) = (Bx-Ax)(Py-Ay) - (By-Ay)(Px-Ax)
signed_area2 = edge(A,B,C)
lambda0 = edge(B,C,P)/signed_area2
lambda1 = edge(C,A,P)/signed_area2
lambda2 = edge(A,B,P)/signed_area2
```

Les coordonnées barycentriques somment à 1. Dans le triangle orienté positivement, les trois fonctions d'arête sont positives ou nulles. `signed_area2=0` est dégénéré.

Incréments : `edge(x+1,y)=edge(x,y)-(By-Ay)`, `edge(x,y+1)=edge(x,y)+(Bx-Ax)`. Une addition peut ainsi remplacer le produit scalaire complet à chaque pixel.

Évaluer aux centres d'échantillons et appliquer une règle demi-ouverte cohérente aux arêtes partagées. Par exemple, avec intérieur positif et `y` vers le haut, inclure les arêtes dirigées vers le bas, ou horizontales vers la gauche; pour l'orientation inverse il faut adapter les signes. Pour correspondre au raster matériel, reprendre sa convention exacte après viewport, pas cette convention abstraite sans transformation.

La profondeur NDC `z_clip/w_clip` s'interpole linéairement avec ces barycentriques écran. Les attributs objets se corrigent en perspective (§ suivant). Clipper les triangles avant division lorsque le plan proche est traversé; rasteriser des sommets avec `w<=0` comme s'ils étaient visibles est incorrect.

**Visibilité :** le chemin matériel utilise un depth attachment et un/des IDs entiers. L'ID doit distinguer instance, cluster et triangle (directement ou par table), avec sentinelle de fond et bornes de capacité. `primitive_index` ne doit pas être supposé disponible sur toutes les implémentations; une voie portable fournit un ID plat depuis une géométrie déroulée/vertex pulling, avec le même ID pour les trois sommets.

Une variante de raster logiciel peut coupler profondeur et visibilité dans une seule mise à jour atomique si le backend expose la largeur nécessaire. Deux atomic u32 indépendants ne garantissent pas que l'ID final corresponde au gagnant depth. Un spinlock par pixel est aussi un problème de progression GPU, pas une solution de référence portable. Partir du raster matériel; toute alternative logicielle doit prouver le couplage depth/ID, le traitement des égalités et l'absence de blocage.

## 14. M12 — Attributs en perspective et dérivées analytiques

Pour un attribut `attribute_i` et le `w_i` de chaque sommet :

```text
inverse_w_i = 1/w_i
numerator = sum(lambda_i × attribute_i × inverse_w_i)
denominator = sum(lambda_i × inverse_w_i)
attribute_pixel = numerator / denominator
```

**Exemple :** `lambda=[1/3,1/3,1/3]`, `w=[1,2,4]`, attribut `[0,1,0]`. L'interpolation perspective vaut `2/7≈0.285714`, et non `1/3`.

Les barycentriques sont affines en coordonnées écran; leurs dérivées sont constantes pour un triangle. Si `U` est le numérateur UV et `R` le dénominateur :

```text
dUV/dx = ((dU/dx)R - U(dR/dx)) / R²
dUV/dy = ((dU/dy)R - U(dR/dy)) / R²
```

Ces dérivées proviennent du triangle gagnant. Ne pas soustraire les UV de pixels appartenant à deux objets ou à deux coutures. C'est essentiel avec un visibility buffer suivi d'une passe plein écran. Pour une texture `Tw×Th`, une estimation isotrope de LOD est `log2(max(length(dUVdx×[Tw,Th]), length(dUVdy×[Tw,Th]), epsilon))`; pour l'anisotropie, transmettre les deux gradients au sampler approprié.

Interpoler puis renormaliser les normales; transformer par `transpose(inverse(A))`, avec traitement du déterminant/orientation. Une tangente normale-map se construit avec Gram–Schmidt `T=normalize(T-N dot(N,T))` puis `B=handedness×cross(N,T)`. Fixer une politique sur UV dégénérés, tangentes absentes et conventions de texture.

**Test :** comparer l'attribut et ses dérivées à une différence finie calculée **dans le même triangle**; tester une couture avec forte différence UV pour démontrer que les différences entre pixels voisins sont impropres.

## 15. M13 — Quantification sans fissures

Avec pas commun `step` et origine commune `origin` :

```text
q = round_defined((position-origin)/step)
decoded = origin + step × q
local_q = q - cluster_min_q
bits = ceil(log2(max_q-min_q+1))
```

La règle d'arrondi (égalité au milieu et valeurs négatives) est un élément du format. Ne pas supposer que Python, JavaScript et C++ ont le même `round`. La reconstruction de frontières partagées doit utiliser les mêmes entiers et la même grille pour le même asset. Des grilles différentes par cluster réintroduisent des fissures.

Si le plus proche entier est choisi correctement et qu'il n'y a ni saturation ni erreur arithmétique supplémentaire : `|error_axis| <= step/2` et `error_3d <= sqrt(3) step/2`. Ajouter cette incertitude à la métrique géométrique et aux bornes. Exemple `step=1 mm` → borne environ `0.8660 mm`.

`bits=0` est permis pour une coordonnée constante si le décodeur le définit. Avec mots u32, traiter explicitement `bits=32` : un masque `(1<<32)-1` et les décalages de largeur mot n'ont pas la même sémantique selon langage. Tester des champs traversant une frontière de mot et les limites d'offset.

Le nombre de bits se calcule exactement comme la longueur binaire de `max_q-min_q`, zéro compris. La formule logarithmique décrit les mathématiques, pas une recette en flottants : pour `[0,2^63]`, il faut 64 bits, alors qu'un logarithme arrondi peut en annoncer 63.

**Normales octaédriques :** normaliser `n`, poser `p=n/(|nx|+|ny|+|nz|)`. Si `pz<0`, replier `p.xy=(1-|p.yx|)×sign_not_zero(p.xy)`. Quantifier les deux composantes. Au décodage reconstruire `z=1-|x|-|y|`, appliquer le repli inverse si nécessaire puis normaliser. `sign_not_zero(0)=+1` doit être défini. Mesurer l'erreur angulaire après reconstruction, pas seulement la taille du flux.


## 16. M14 — Pages : garder la géométrie disponible

Le coût d'une page est plus que sa taille réseau :

```text
latency = attente + lecture + décodage + validation + upload + publication
peak_RAM = source + temporaires + résultats + files_en_vol + cache_CPU
resident_VRAM = géométrie + hiérarchie + sorties + depth/HiZ + staging_GPU
```

Les racines et les dépendances nécessaires à la coupe en cours restent épinglées. Une page passe par `absente → demandée → reçue → validée → uploadée → publiée`; une page reçue n'est pas encore lisible par les shaders.

Une priorité possible, **heuristique à benchmarker**, est `benefit_px × probability_visible / estimated_cost`. Ajouter âge pour éviter la famine. Préciser les unités et plafonner les erreurs infinies; la multiplication d'infinis et de probabilités nulles ne doit jamais générer NaN.

L'éviction vérifie références CPU, requêtes en cours et GPU en vol. Une case réutilisée porte une génération; un vieux retour asynchrone ne doit pas republier une page remplacée. Le GPU garde son ancienne table tant que la nouvelle coupe complète n'est pas publiable.

**Test :** budget inférieur au working set, réseau lent, annulation, reload d'asset, perte GPU et vues multiples. Exiger zéro trou, zéro lecture de page recyclée; accepter un LOD plus grossier mesuré.

