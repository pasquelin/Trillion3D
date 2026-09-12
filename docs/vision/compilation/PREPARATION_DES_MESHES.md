# Préparation des meshes

> Conception Web Geometry : ce chapitre décrit des contrats et algorithmes proposés. Voir [l’état de l’implémentation](../../../packages/README.md).

Les variantes de partition, de réduction multiattribut et d'encodage sont précisées dans [construction et compression avancées](CONSTRUCTION_ET_COMPRESSION_AVANCEES.md).

## 1. Objectif et résultat

Transformer un mesh triangulé en représentations de détail sélectionnables, avec une erreur explicite et des blocs chargeables. Le travail lourd se fait à l'import ou dans un cache de compilation, pas à chaque image.

Entrée : positions, indices, attributs, affectations de matériaux, unités et politique de conservation des frontières. Sortie : clusters, représentations grossières, régions de remplacement, bornes, erreurs, pages et correspondance avec les objets éditables. La géométrie d'entrée reste immuable pour le rendu de secours et les comparaisons.

Le pipeline est `valider → classer → connecter → partitionner → regrouper → simplifier → mesurer → encoder → relire → publier`. Une phase en échec ne produit pas un asset déclaré valide.

## 2. Validation et identités

Vérifier avant toute allocation importante : tailles non négatives, triplets d'indices, chaque indice dans le tableau, attributs de cardinalité correcte, tous les flottants finis, nombres de matériaux et d'influences compatibles. Les calculs de taille utilisent des opérations contrôlées : `count <= capacity / stride`, puis multiplication.

Un triangle est dégénéré s'il répète un sommet ou si son aire géométrique est sous la tolérance. Avec `normal = cross(p1-p0,p2-p0)`, l'aire vaut `||normal||/2`. Le seuil a des unités d'aire ; comparer à un seuil de longueur est incorrect. Rapporter les triangles retirés et conserver un mapping d'identité, plutôt que changer silencieusement l'objet.

Trois identités distinctes :

- position géométrique : sert à retrouver le contact spatial ;
- sommet d'attribut : position plus normale, UV, tangente, couleur, influences ;
- primitive éditable : sert à retrouver l'objet ou la face de travail après compilation.

Deux sommets peuvent partager la même position tout en gardant des UV différents. Les fusionner sur la seule position efface une couture. Une égalité exacte normalise les zéros signés avant hash et vérifie ensuite les valeurs ; le hash seul n'est pas une preuve d'égalité. Une soudure avec tolérance est une autre opération, désactivée par défaut et mesurée séparément.

Si des normales lissées doivent être reconstruites, sommer les produits vectoriels orientés des faces incidentes dans chaque domaine de lissage, puis normaliser. Cette référence pondère par aire ; une pondération par angle est une autre variante. Les dégénérés ne contribuent pas ; une somme nulle impose diagnostic ou repli explicite. Préserver les copies de coutures et les UV répétés sans les ramener automatiquement dans [0,1].

## 3. Adjacence et frontières

Associer à chaque demi-arête `(start,end,face)` une clé non orientée `(min(positionId),max(positionId))`. Regrouper les occurrences. Une occurrence : bord ouvert. Deux occurrences opposées : voisinage manifold. Plus de deux, ou orientations incompatibles : diagnostic de topologie, pas réparation implicite.

Classer séparément bord ouvert, couture d'attribut, séparation de matériau, frontière entre clusters et frontière de région. Les liens de proximité entre îlots ne sont pas des arêtes géométriques et ne doivent jamais créer de faces.

Vérifier aussi chaque sommet : son graphe de lien contient une arête entre les deux autres sommets de chacune de ses faces incidentes. Un sommet manifold intérieur possède un seul cycle connexe, tous les degrés égaux à 2. Un sommet manifold de bord possède un seul chemin connexe, exactement deux degrés 1 et les autres degrés 2. Les autres cas sont verrouillés et diagnostiqués ; un sommet sans face est inutilisé. Deux surfaces fermées qui ne partagent qu'un sommet produisent deux cycles disjoints : le seul comptage des faces par arête ne détecte pas ce défaut. Cette classification précède les contractions et s'actualise dans les voisinages modifiés.

Exemple : deux triangles d'un carré partagent la diagonale. Leur graphe possède une arête. En séparant leurs UV le long de la diagonale, le contact géométrique demeure mais l'identité des attributs change. Les deux relations doivent rester accessibles.

Construction par table de hachage : coût moyen linéaire dans le nombre de demi-arêtes, avec mémoire linéaire. Une variante triée coûte `O(T log T)` et donne un ordre explicite ; elle sert de comparaison déterministe.

## 4. Partition en clusters

Fixer deux plafonds indépendants : triangles et sommets uniques. Un plafond de triangles seul ne borne pas correctement le buffer de sommets. Les tailles 64, 128, 256 ou 512 triangles sont des variantes à tester, pas une architecture imposée.

Référence : démarrer avec le plus petit identifiant non affecté, ajouter un voisin admissible qui crée le moins de nouveaux sommets, départager par identifiant. Arrêter quand aucun ajout ne respecte les plafonds ; démarrer un autre cluster. Toutes les faces sont attribuées exactement une fois.

Variante de localité : choisir le triangle de départ par `(clé Morton du centroïde, ID)` plutôt que par ID seul, en gardant le même critère d'ajout. Cette variante ne remplace pas silencieusement la baseline. Sur chaque axe :

```text
quantize(value, low, high, bits):
    if high == low:
        return 0
    limit = 2^bits - 1
    return clamp(floor((value - low) * limit / (high - low)), 0, limit)

morton(point, low, high, bits):
    coords = quantize_each_axis(point, low, high, bits)
    key = 0
    for bit in range(bits):
        for axis in range(3):
            key |= ((coords[axis] >> bit) & 1) << (3 * bit + axis)
    return key
```

Cette clé exige un entier assez large pour `3*bits`. Les opérateurs bit à bit JavaScript utilisent des mots de 32 bits ; employer plusieurs mots ou BigInt si nécessaire. Un tri stable départage les clés identiques.

Pour chaque cluster produire : remapping global/local, indices locaux, section de matériau, AABB et voisins. Mesurer remplissage, duplication des sommets, longueur des frontières et taille des bornes, pas seulement le temps du partitionneur.

## 5. Réduction par énergie quadratique

Pour chaque face non dégénérée, calculer le plan normalisé `plane=[normal,-dot(normal,p0)]`. Sa matrice vaut `weight * plane * transpose(plane)`. Chaque sommet accumule les matrices de ses faces incidentes. Les dix coefficients indépendants d'une matrice symétrique suffisent.

Pour contracter une arête, additionner les deux matrices. L'énergie est `E(point)=pointHᵀ Q pointH`. Avec les blocs `Q=[A b; bᵀ c]`, résoudre `A*point=-b`. Ne pas inverser explicitement la matrice. Tester aussi les extrémités et le milieu ; un système singulier n'est pas une erreur fatale.

Le minimum sur le segment ajoute un candidat : `direction=right-left`, `alpha=directionᵀ A direction`, `beta=directionᵀ(A left+b)`, `ratio=clamp(-beta/alpha,0,1)` lorsque `alpha` est suffisamment positif. Une solution de faible énergie n'est retenue qu'après les contraintes.

Contraintes de référence :

1. Ne pas contracter une arête non manifold ou une couture verrouillée.
2. Conserver les positions des sommets verrouillés ; deux positions verrouillées différentes interdisent leur fusion.
3. Vérifier le lien topologique complet `Lk(a) ∩ Lk(b) = Lk({a,b})`, y compris ses arêtes ; la seule égalité des sommets voisins est un filtre insuffisant. La V1 verrouille les sommets des bords ouverts et non manifold, ainsi que les coutures à conserver.
4. Recalculer les faces survivantes ; refuser aire trop faible et inversion de normale.
5. Refuser doublons de faces et tout contact topologique non autorisé ; ajouter un test global d'intersection si la politique exige une surface sans auto-intersection.
6. Garder les matériaux discrets et les copies d'attributs nécessaires.

Les contraintes sont prioritaires sur le nombre de triangles cible. Arrêter sans atteindre la cible est un résultat valide si déclaré `target-not-reached` ; inventer un résultat vide ne l'est pas.

La file de priorité porte coût, identifiant d'arête et versions des sommets. Après contraction, actualiser faces, adjacency, matrices et versions ; les anciens candidats sont recalculés lorsqu'ils sont extraits. Un tri des coûts doit départager les égalités et rejeter les NaN.

La variante simple recalcule tous les candidats après chaque contraction. Elle est lente mais facile à vérifier. La file locale est une optimisation ultérieure dont la sortie doit être comparée à la référence à politique égale.

## 6. Attributs et stabilité numérique

Ne pas additionner sans normalisation mètres, radians, UV et couleurs. Les poids d'attribut sont des paramètres versionnés. Pour deux normales unitaires, `||n1-n2||² = 2*(1-cos(angle))`. Cette énergie n'est pas une distance de surface.

Une contraction sur une arête peut interpoler UV/couleurs dans chaque domaine continu. Normaliser la normale interpolée ; orthogonaliser la tangente contre elle et préserver son signe. Aux coutures, garder des copies séparées. Les identifiants d'os ne s'interpolent pas : réunir les influences, sommer les poids par identifiant, sélectionner puis normaliser.

Recentrer une région et la mettre à une échelle numérique maîtrisée peut améliorer le conditionnement. Documenter la transformation et convertir les erreurs vers l'unité d'objet avant stockage. Une énergie pondérée par aire ne se transforme pas comme une simple longueur. Référence f64 pour la préparation ; comparer une variante f32 sur meshes minuscules, immenses, plats et presque dégénérés.

## 7. Erreur indépendante et certification de référence

L'énergie QEM sert à choisir une contraction ; elle n'est pas une borne maximale de distance à l'original. Conserver séparément coût de réduction, distance mesurée, borne éventuelle et erreur des attributs.

Pour un point, projeter sur chaque triangle ; si la projection est intérieure, calculer sa distance au plan, sinon la distance minimale aux trois segments. Une surface vide ne donne jamais distance zéro. Accélérer ensuite cette recherche par BVH médian, sans changer le résultat du minimum.

Subdiviser chaque triangle de la surface d'entrée jusqu'à obtenir des cellules de diamètre au plus `spacing`. Mesurer la distance de leurs sommets vers la surface réduite. Pour tout point d'une cellule, un sommet est à une distance au plus `spacing`. La distance à un ensemble étant 1-Lipschitz :

`distance_dirigée <= maximum_distances_mesurées + spacing`.

Répéter dans l'autre sens pour borner la distance symétrique. Cette majoration est mathématique en arithmétique exacte ; ajouter une marge numérique démontrée ou des intervalles pour une certification formelle. En f64 ordinaire, la désigner comme référence numérique, pas comme preuve flottante absolue.

Si l'erreur de chaque transition est une borne compatible, une borne cumulée peut additionner erreur locale et borne des enfants. Prendre seulement leur maximum rend une métrique monotone mais ne borne pas une succession de déplacements. Exemple : `0→1→2`, chaque étape vaut 1 mais la distance finale vaut 2.

## 8. Régions et hiérarchie de détail

La V1 emploie des régions emboîtées sans chevauchement : chaque région contient une représentation grossière et soit des sous-régions complètes, soit des clusters feuilles. Cela donne une coupe simple à vérifier. Un groupe peut contenir plusieurs clusters à chaque niveau ; « parent » ne signifie pas forcément un triangle ou un cluster unique.

Pour construire une région : réunir les enfants, verrouiller son contour externe, libérer les anciennes frontières internes, réduire, repartitionner, mesurer l'erreur et valider le contour. En cas d'échec, garder la représentation fine ; ne pas itérer sans progrès.

Exemple : `[A,B,C,D]` est remplacé collectivement par `[E,F]`. Les deux ensembles couvrent la même région. Choisir `[A,B,F]` sans une relation de remplacement plus fine est invalide. Tous les clusters d'une représentation partagent la décision d'activation.

Une hiérarchie générale autorisant le regroupement de frères au niveau suivant peut former un DAG. C'est une variante distincte : définir l'identité des régions, interdire les activations en double et prouver la compatibilité des transitions avant de remplacer la V1. Ne pas appliquer aveuglément un parcours d'arbre à un DAG.

Chaque région stocke une borne contenant sa géométrie fine et grossière, une erreur dans l'espace objet et les relations de remplacement. L'arbre spatial de culling et cette hiérarchie de détail ont des rôles différents, même s'ils partagent certaines bornes.

## 9. Encodage et pages

La première version stocke des indices explicites et des champs adressables. Ajouter ensuite quantification et compression, jamais les deux en même temps que la première réduction.

Grille commune : `encoded=floor((position-origin)/step+0.5)`, `decoded=origin+step*encoded`, `step>0`. Les copies d'une frontière utilisent les mêmes coordonnées, origine, pas et arrondi. Une grille propre à chaque cluster crée des fissures. Pour un arrondi au plus proche, erreur euclidienne maximale de position `sqrt(3)*step/2`, hors erreur flottante.

Une plage entière `[low,high]` demande mathématiquement `ceil(log2(high-low+1))` bits ; calculer ce nombre par la longueur binaire entière de `high-low`, sans logarithme flottant. Une plage constante demande zéro bit et stocke sa valeur de base. Rejeter débordements au lieu de saturer silencieusement une position.

Trier les triangles par matériau peut améliorer les plages de dessin. Recalculer ensuite tous les remappings. Quantifier les normales, UV, poids et tangentes avec leur tolérance propre. Conserver des indices explicites en référence avant delta, réutilisation de sommets ou strips.

La page est une unité de stockage/résidence, pas automatiquement une région LOD. Une représentation peut demander plusieurs pages ; toutes doivent être utilisables avant son activation. Les détails de format et publication sont dans [pages et mémoire](../runtime/PAGES_MEMOIRE_ET_CACHE.md).

## 10. Validation et expériences

Relire le résultat encodé avec un décodeur indépendant. Vérifier les plafonds, toutes les plages d'indices, l'acyclicité, les frontières décodées, l'erreur et le fallback racine. Comparer l'image avec la même caméra et les mêmes matériaux.

Premiers tests : carré à deux triangles ; cube à normales dures ; grille avec trou ; îlots isolés ; couture miroir ; arête à trois faces ; triangle plat ; deux matériaux ; très grande translation ; réduction bloquée ; page tronquée.

Mesurer séparément validation, adjacency, partition, simplification, erreur, encodage, copies et pic mémoire. Les optimisations candidates sont structure de données compacte, file incrémentale, BVH pour l'oracle, tâches de régions indépendantes et réutilisation du cache. Ne pas dégrader une borne ou une couture pour afficher un temps inférieur.
