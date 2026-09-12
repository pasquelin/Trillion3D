# Rendu et sélection

> Conception Web Geometry : ce chapitre décrit des contrats et algorithmes proposés. Voir [l’état de l’implémentation](../../../packages/README.md).

## 1. Contrat d'une image

Entrées : version de scène, transforms courants, caméra, viewport effectif, seuil en pixels, asset compilé, table de résidence et matériaux. Sorties : couleur, profondeur, identités de sélection, demandes de pages et diagnostics. La coupe géométrique est produite pour une vue et une version de scène déterminées.

Ordre de référence : `mises à jour → frustum instances → choix LOD → frustum clusters → compaction → bins → commandes → raster`. Ajouter Hi-Z, pages et visibilité différée seulement après validation de cette séquence entièrement résidente.

## 2. Espaces et projection

Les calculs de distance utilisent l'espace vue avec une profondeur positive `depth`. Si la caméra regarde vers Z négatif, convertir explicitement `depth=-viewZ`. Ne jamais mesurer une distance avec les composantes avant division d'une matrice modèle-vue-projection. Les formules suivantes supposent une caméra perspective ou orthographique conventionnelle, sans terme de cisaillement dans la projection ; les décentrages et le jitter de translation restent admis. Une projection générale exige sa propre borne de jacobienne.

Pour une perspective de focale pixel `focalY=height/(2*tan(fovY/2))`, l'approximation centrale est `pixels≈error*focalY/depth`. Elle est utile comme baseline, pas comme borne générale hors axe.

Soit une boîte vue englobant les points correspondants avant/après approximation et les segments entre eux. Poser `depthMin=box.min.z`, `reach²=maxAbsX²+maxAbsY²`, `focal=max(abs(focalX),abs(focalY))`. Une majoration issue de la jacobienne de projection est :

`pixels <= errorView*focal/depthMin*sqrt(1+reach²/depthMin²)`.

Elle exige `depthMin>near>0`. Sinon raffiner ou garder la référence fine, sans diviser par zéro. Pour une caméra orthographique, `pixels<=errorView*max(pixelScaleX,pixelScaleY)` et la distance ne réduit pas l'erreur.

La transformation d'erreur utilise une borne de la norme opérateur de la partie linéaire de transform. La norme de Frobenius est une majoration simple ; `sqrt(norm1*normInfinity)` en est une autre. La plus grande longueur des colonnes ne suffit pas en présence de cisaillement. Les normales nécessitent l'inverse-transposée ; une matrice singulière déclenche un traitement explicite.

## 3. Coupe LOD complète

La V1 parcourt des régions emboîtées. Une région possède une représentation coarse complète, éventuellement plusieurs clusters, et des régions filles dont l'union représente la même surface. Le score décide de l'ensemble, pas de chaque morceau isolément.

Dans cet exemple, `region.errorObject` est l'erreur composée, quantification comprise, en unités d'objet. `view.errorScale` majore la norme opérateur de la partie linéaire de `V*M` pour l'instance ; `region.viewBox` contient les représentations comparées dans ce même espace, avec profondeur positive. `view.pixelScale` vaut `[W*abs(P00)/2,H*abs(P11)/2]` pour les deux projections : pixels pour la focale perspective, pixels par unité vue pour l'orthographique. La projection et ces données sont recalculées pour chaque instance/vue.

```text
lodScore(region, view):
    require region.errorObject >= 0 and view.errorScale >= 0
    require all(view.pixelScale > 0)
    require finite(region.errorObject, view.errorScale, view.pixelScale)
    errorView = region.errorObject * view.errorScale
    if view.projection == orthographic:
        return errorView * max(view.pixelScale)
    require view.projection == perspective and view.near > 0
    return screenError(errorView, region.viewBox, view.pixelScale, view.near)

select(region, view, resident):
    if not all(page in resident for page in region.coarsePages):
        return unavailable
    score = lodScore(region, view)
    if score <= view.threshold or empty(region.children):
        return region.coarseClusters
    fine = []
    for child in region.children:
        choice = select(child, view, resident)
        if choice == unavailable:
            request(region.childPages)
            return region.coarseClusters
        fine.extend(choice)
    return fine
```

Le résultat fin est temporaire jusqu'à la réussite de tous les enfants. Une page absente maintient une surface complète ; le seuil de qualité peut être dépassé temporairement, ce qui doit être compté. Les racines et leurs dépendances sont épinglées ; si elles ne sont pas disponibles, dessiner l'objet de secours.

L'autre prédicat `scoreCluster<=threshold<scoreParent` n'est valable que si métadonnées et relations donnent une transition unique et collective. Une racine demande une règle explicite. Ne pas remplacer ces conditions par un grand nombre arbitraire.

Une hystérésis choisit deux seuils : raffiner au-dessus du seuil haut, revenir au grossier sous le seuil bas. Elle utilise l'état de la région, pas celui de chaque cluster. Tester oscillations, égalités et changements de résolution. Une transition géométrique interpolée exige une correspondance des sommets ; elle n'est pas fournie automatiquement par la sélection LOD.

## 4. Rejets géométriques conservatifs

Pour un plan intérieur `dot(normal,point)+offset>=0`, une sphère est hors volume si `dot(normal,center)+offset < -radius*||normal||`. Une AABB centre/extension est hors volume si `dot(normal,center)+offset+dot(abs(normal),extent)<0`. L'égalité est conservée.

Transformer une AABB affine : `center'=matrix*center+translation`, `extent'=abs(matrix)*extent`. Le résultat englobe les huit coins, y compris sous rotation ou cisaillement. Ajouter l'erreur de décodage et l'amplitude de déformation avant un rejet.

Un cône de normales fournit un rejet backface seulement pour géométrie compatible, normale et direction exprimées dans le même espace, angle valide et borne de perspective conservatrice. Désactiver ce rejet pour double face, cône trop large, caméra trop proche ou déformation non bornée. Le frustum constitue la référence, le cône une optimisation facultative.

Pour un ensemble de normales compris dans un cône d'axe unitaire `axis` et de demi-angle `angle`, et une direction vers la caméra unitaire `view`, poser `theta=acos(clamp(dot(axis,view),-1,1))`. Le maximum de `dot(normal,view)` sur le cône vaut `cos(max(0,theta-angle))` : il vaut 1 exactement lorsque `theta<=angle`. Rejeter seulement si ce maximum est strictement négatif, après élargissement du cône par la variation des directions sur la borne spatiale. La référence ne rejette jamais pour un demi-angle total supérieur ou égal à `pi/2`. Le test sur une seule direction au centre sans cet élargissement n'est pas conservatif en perspective.

## 5. Hi-Z

Une pyramide de profondeur stocke une profondeur lointaine sur chaque empreinte. Convention standard : fond 1, réduction maximum. Convention inversée : fond 0, réduction minimum. Les trous de fond doivent rendre le rejet impossible.

Projeter une borne conservatrice en rectangle écran. Pour une boîte entièrement devant le plan proche, projeter ses huit coins ; si elle coupe le plan proche, éviter le rejet Hi-Z de référence. Arrondir le rectangle vers l'extérieur et couvrir tous les pixels concernés.

Avec une pyramide logicielle à réduction 2×2 et dimensions arrondies au supérieur, un texel au niveau `level` couvre un bloc de `2^level` pixels, tronqué aux bords. Les mips matériels arrondis vers le bas exigent une autre règle d'empreinte pour les dimensions impaires ; ne pas mélanger les deux conventions.

Pour un rectangle entier semi-ouvert `[x0,x1)×[y0,y1)`, lire tous les texels de coordonnées de `floor(x0/scale)` à `floor((x1-1)/scale)`, idem Y, avec `scale=2^level`. Monter d'un niveau réduit le nombre de lectures mais peut perdre des occasions de rejet ; cela ne doit pas créer de faux rejets.

Avec profondeur standard, cacher si `nearestDepth > max(coveredDepths)+bias`. En inversé, cacher si `nearestDepth < min(coveredDepths)-bias`. La profondeur testée doit être la plus proche possible de la borne dans la convention de raster, pas la profondeur de son centre. Un biais positif doit rendre le test moins agressif.

Exemple : empreinte standard `[0.2,0.3,1.0,0.2]`, objet à 0.8. Le maximum vaut 1 ; l'objet ne doit pas être caché. Moyenne ou minimum donneraient une conclusion erronée.

## 6. Occlusion en deux passages

La profondeur précédente est une heuristique de priorité, jamais une preuve d'occlusion actuelle. Scène actuelle : dessiner les candidats probablement visibles, construire leur Hi-Z courant, retester tous les candidats rejetés provisoirement puis dessiner les nouveaux visibles.

Un occluder absent de la première passe réduit les gains mais ne doit pas causer de trou. Un occluder périmé réutilisé comme preuve peut en causer. Mettre à jour transforms, alpha test, déformation et convention de profondeur avant la passe courante.

Invalider l'historique après téléportation, changement de projection ou de résolution, perte de device, remplacement d'asset et discontinuité temporelle. Les petites motions restent traitées par le second passage, pas par une marge censée garantir tous les mouvements.

## 7. Compaction et commandes

Référence : scan exclusif des indicateurs 0/1, puis écriture à l'offset calculé. Exemple `[1,0,1,1]` donne offsets `[0,1,1,2]`, total 3. Pour les GPU : scan local, scan des sommes de groupes, ajout des offsets puis scatter en dispatchs successifs.

Une réservation atomique peut être plus simple pour un ordre non déterministe. Toute écriture contrôle la capacité ; conserver un drapeau de débordement. La référence CPU fournit ensemble et ordre attendus selon le contrat. Si la capacité est dépassée, reprendre avec une coupe plus grossière complète ou dessiner la référence ; ne pas publier une surface tronquée.

Les arguments de dessin indexé comportent cinq champs, dans l'ordre : `indexCount u32`, `instanceCount u32`, `firstIndex u32`, `baseVertex i32`, `firstInstance u32`. Taille 20 octets. Le producteur doit écrire exactement les comptes consommables, pas les réservations échouées.

Un dessin indirect n'agrège pas magiquement des plages d'indices hétérogènes. Référence : un argument par cluster et état compatible. Réduire ensuite le nombre d'appels par instancing de géométrie identique, plages regroupées ou vertex pulling avec contrat explicite. Un chemin GPU-driven garde un coût d'encodage CPU si les appels indirects restent individuels.

## 8. Raster et visibilité différée

Commencer par raster matériel. Il résout couverture, clipping, échantillonnage et depth test selon l'état du pipeline. La référence doit garder le même winding, cull mode, alpha et profondeur que les tests précédents.

Une visibilité différée stocke l'identité du triangle gagnant et de son instance ; le shading reconstruit ensuite position/attributs. Réserver une valeur pour le fond et vérifier la capacité des champs avant packing. Deux atomiques indépendantes pour profondeur et identifiant peuvent donner des gagnants différents : ne pas employer ce protocole.

La baseline de visibilité écrit l'identifiant dans une cible entière sous le même depth test que le raster. Un prototype de raster logiciel exige au préalable clipping homogène, règle de bord top-left, arrondi de coordonnées, tests de débordement et résolution cohérente du gagnant. Les atomiques larges ou primitives spécialisées ne sont pas un prérequis du socle portable.

L'exemple de clipping coupe le polygone contre chaque demi-espace homogène : pour les distances signées `da` et `db`, l'intersection vaut `a+da/(da-db)*(b-a)`. Interpoler les positions clip et les attributs continus avant la division perspective, garder les identités discrètes séparément. Trianguler ensuite le polygone en éventail et rejeter les primitives dégénérées. Les facteurs `1/w` se calculent après ce clipping.

Pour `edge(a,b,p)=(b.x-a.x)*(p.y-a.y)-(b.y-a.y)*(p.x-a.x)`, les barycentriques affines divisent les trois fonctions d'arête par l'aire signée. Corriger la perspective : `weight_i=(lambda_i/clipW_i)/sum(lambda_j/clipW_j)`. Le triangle dégénéré ne doit jamais diviser par une aire nulle.

Pour un attribut `value=numerator/denominator`, sa dérivée est `(numeratorDerivative*denominator-numerator*denominatorDerivative)/denominator²`. Calculer les dérivées sur le triangle gagnant, pas entre deux pixels appartenant à des surfaces différentes. Utiliser ensuite ces gradients pour le filtrage des textures.

## 9. Synchronisation et repli

Séparer les passes productrices et consommatrices. Une barrière de workgroup ne synchronise pas tous les workgroups. Éviter toute file persistante qui suppose qu'un autre workgroup sera nécessairement planifié pour la débloquer.

Réinitialiser compteurs avant production, finaliser les arguments après scatter et rasteriser après finalisation. Les buffers réutilisables portent une version d'image ; les ressources en vol ne sont pas modifiées par la préparation d'une autre image.

Les capacités sont détectées à l'exécution : tailles de buffers, limites workgroups, formats, indexation et fonctions facultatives. Sur WebGL2 de référence, garder sélection/compaction CPU et dessins compatibles, pas une imitation silencieuse du compute WebGPU. Un rendu qui fonctionne ne prouve pas quel backend a réellement exécuté le travail.

## 10. Recette

Comparer coupe CPU/GPU, mêmes pages et mêmes transforms. Tester 0/1 éléments, seuil exact, near plane, hors axe, réflexion, cisaillement, boîtes contenant la caméra, dimensions Hi-Z impaires, trou de fond unique, téléportation, saturation et device loss.

Mesurer séparément update CPU, encodage, upload, sélection GPU, Hi-Z, scatter, raster et shading. Le temps total et les images correctes décident du gain ; moins de triangles ne garantit pas moins de temps.
