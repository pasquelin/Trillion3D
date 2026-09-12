# Construction et compression avancées

> Conception Web Geometry : ce chapitre décrit des contrats et algorithmes proposés. Voir [l’état de l’implémentation](../../../packages/README.md).

Ces stratégies prolongent la [préparation de référence](PREPARATION_DES_MESHES.md). Chaque variante conserve les invariants de topologie, de remplacement et de décodage ; son intérêt se décide sur le coût complet et une reconstruction indépendante.

## 1. Partitionner et réduire avec un objectif explicite

Pour le graphe dual non orienté G=(V,E), V représente les triangles et E leurs adjacences ; une partition π minimise C(π)=Σ_{(i,j)∈E} wᵢⱼ [π(i)≠π(j)], avec wᵢⱼ≥0. Chaque partition respecte séparément triangles, sommets uniques, attributs et octets. Le nombre de sommets uniques est une cardinalité d’union, pas la somme des coûts individuels des triangles. Une contrainte additive de partitionneur ne suffit donc pas : vérifier puis scinder tout résultat dépassant les plafonds.

Une variante indépendante procède par contraction de sommets du graphe, partition grossière, projection de la solution puis déplacements locaux réduisant la coupe sous contraintes. La bissection récursive doit produire deux enfants non vides, avec un départage stable et un repli médian si elle ne progresse pas. Les liens spatiaux entre îlots servent seulement à la localité ; ils ont un poids plus faible que les contacts géométriques et ne changent jamais la topologie.


Pour une adjacency compacte, le tableau offsets contient N+1 entiers, commence à zéro, reste croissant au sens large et se termine au nombre de voisins stockés. La tranche [offsets[i],offsets[i+1]) représente les voisins de i ; un sommet isolé a une tranche vide. Vérifier symétrie des relations non orientées, plages, absence de doublons involontaires et poids. Cette représentation compacte ne justifie pas de transformer une arête non manifold en clique quadratique.

Mesurer coupe pondérée, sommets dupliqués, surface/volume des bornes, remplissage, nombre de matériaux et octets décodés. Tester îlots, longue bande, éventail à forte valence, arêtes non manifold, matériaux alternés, centres confondus et budgets impossibles. Ni le nombre minimal de partitions ni l’optimum global ne sont garantis par une heuristique.

QEM multiattributs : placer le sommet dans un espace sans unités y=(p/ℓ, √λ₁ a₁/s₁, …), avec ℓ,sᵢ>0 et λᵢ≥0 versionnés. Dans cet espace, un triangle non dégénéré définit une origine y₀ et deux directions orthonormées formant U. L’énergie de distance à son plan affine est E_f(y)=w_f ‖(I−UUᵀ)(y−y₀)‖². Son expansion fournit une quadratique additive ; on résout le système accumulé comme pour le QEM géométrique. Cette formulation est un choix indépendant de métrique, non une garantie sur l’image ou la distance maximale.

Une autre métrique sépare position et champ d’attribut affine : E(p,a)=E_geom(p)+Σ_f,j λⱼw_f(aⱼ−g_f,jᵀp−c_f,j)². Les gradients g sont calculés uniquement dans un domaine continu. Choisir l’une des deux formulations, puis documenter ses unités et pondérations ; elles ne sont pas numériquement équivalentes.

Après projection des normales sur la sphère et réorthogonalisation des tangentes, réévaluer l’énergie : corriger les attributs change le candidat. Un attribut catégoriel n’entre pas dans une moyenne. Le signe de det(UV) distingue les domaines miroirs ; le cas proche de zéro demande une politique propre. Des UV utilisés comme identifiants, masques discrets ou adresses non interpolables restent verrouillés.

Pour une pondération UV sensible à l’échelle, une longueur caractéristique s_uv=√(Σ_f aire_uv(f)/N_f) peut fournir une normalisation, avec plancher positif et conservation des valeurs originales. La rescaling automatique n’est pas une tolérance en texels : l’erreur de texture se mesure aussi dans diag(largeur,hauteur)·ΔUV. Fixer les pondérations par des fixtures représentatives et les versionner.

Préservation optionnelle de forme : aire totale A=½Σ‖(p₁−p₀)×(p₂−p₀)‖ ; pour une surface fermée orientée, volume signé V=(1/6)Σ p₀·(p₁×p₂). Mesurer leurs variations relatives avec un dénominateur non nul. Une aire préservée ne prouve ni silhouette ni volume, et un volume n’a pas ce sens pour une surface ouverte ou incohérente.

## 2. Erreur, DAG et bornes de construction

Séparer trois quantités : erreur utilisée pour ordonner les contractions, erreur mesurée sur une référence, majorant utilisé pour décider du LOD. Un minimum d’erreur ne peut jamais justifier de violer une couture ou la topologie. Les bornes cumulées de distance s’additionnent sur une chaîne ; un maximum suffit seulement à rendre une métrique monotone.

Une coupe valide de DAG couvre chaque région exactement une fois. Une transition collective remplace tout un ensemble fin par tout son ensemble grossier. Le partage d’un cluster ou d’un asset ne crée pas une seconde surface ; suivre identités de région, représentation et instance séparément. Tous les participants à un remplacement reçoivent une décision cohérente, même s’ils se trouvent dans des pages différentes.

Une file de raffinement peut sélectionner la région d’erreur projetée la plus forte, puis effectuer un remplacement complet compatible avec le budget. Le dernier remplacement peut dépasser une cible de triangles ; cette granularité doit être déclarée. Si simplifier puis repartitionner n’améliore ni coût ni erreur, conserver le niveau fin et arrêter cette branche. Une forêt terminale de plusieurs racines est valide ; ne pas forcer un unique cluster au prix d’une géométrie invalide. Distinguer absence de progrès et faible gain : g=1−T_après/T_avant pour T_avant>0 mesure une réduction de triangles, locale ou globale selon le domaine annoncé. Un faible g motive une expérience, pas une disparition de branche.

Le BVH spatial et le DAG de remplacement optimisent des choses différentes. Comparer un BVH mélangeant les niveaux à des BVH séparés par plage de détail, puis réunis sous une racine ; de très grosses représentations grossières peuvent dégrader les bornes des petites feuilles fines. Cette séparation est une hypothèse à mesurer, jamais une condition de correction.

Nombre de triangles cible et tolérance d’erreur sont deux contraintes distinctes. Un arrêt sur la tolérance peut laisser la cible non atteinte. Une progression de tolérance entre niveaux est une variante à mesurer, avec plafond, erreur produite recontrôlée et mêmes contraintes de frontière. Elle n’autorise pas à dépasser le budget d’erreur déclaré.

Quantifier une borne exige l’arrondi vers l’extérieur : q_min=⌊(min−o)/h⌋, q_max=⌈(max−o)/h⌉, h>0. Si b bits doivent couvrir une étendue L>0, un pas binaire possible est h=2^⌈log₂(L/(2ᵇ−1))⌉. Cette formule propose un pas, elle ne valide pas le format : l’origine o, les arrondis et le logarithme flottant peuvent nécessiter une cellule de plus. Traiter L=0 à part ; vérifier les entiers réellement obtenus dans [0,2ᵇ−1] et l’inclusion après décodage avec la marge flottante. Augmenter le pas ou déplacer l’origine si ces deux conditions ne tiennent pas. Une borne supérieure d’erreur se quantifie vers le haut ; une borne inférieure vers le bas.

Tests : remplacement traversant plusieurs pages, DAG partagé sans double activation, régions sans réduction possible, ordre de tâches permuté, même coupe après sérialisation, bornes tangentes et axes d’étendue nulle. Comparer les bytes seulement si le contrat garantit le déterminisme interarchitecture ; sinon comparer les invariants et valeurs sous tolérance.

## 3. Compression : coût complet et reconstruction indépendante

Pour des entiers dans [m,M], le nombre de bits résiduels vaut b=⌈log₂(M−m+1)⌉ ; b=0 encode un champ constant via m seulement. Coût total=entêtes+alignements+flux+tables+données dupliquées. Une réduction de bits par index peut perdre son intérêt si elle duplique beaucoup de sommets ou impose des dépendances longues.

Un flux prédictif encode r=x−x_prédit ; le prédicteur doit utiliser exactement les valeurs déjà décodées et la même arithmétique. Pour un champ cyclique de période entière P, r=((x−x_prédit+⌊P/2⌋) mod P)−⌊P/2⌋ donne un résidu court avec modulo euclidien et départage explicite à demi-tour. Ne jamais appliquer ce modulo à des UV ordinaires si leur répétition n’est pas le contrat de l’attribut.

Pour les UV, comparer quantification uniforme par domaine, flottants standards réduits et codage d’une plage d’entiers ordonnés. Définir précision absolue dans la zone usuelle, comportement hors plage, valeurs négatives, arrondis et saturation. Tester monotonie du code si elle est utilisée, erreur après décodage, et frontières partagées. Aucun type flottant particulier n’est imposé par l’architecture.

Une normale octaédrique se quantifie mieux en évaluant les quatre couples plancher/plafond entourant sa projection, puis en choisissant celui maximisant n·n_décodée. Ce choix minimise l’angle parmi ces candidats, pas nécessairement parmi tout le codebook. Tester pôles, plis de l’octaèdre, composantes nulles, égalités et erreur angulaire maximale.

Une tangente unitaire orthogonale à n est définie par un angle dans un repère (u,v,n) déterministe : θ=atan2(t·v,t·u), t=cosθ·u+sinθ·v. Avec N=2ᵇ pas et arrondi circulaire, erreur d’angle≤π/N, hors erreur de normale. Stocker séparément le signe du bitangent. Construire le repère à partir de la normale déjà décodée à l’encodage comme au décodage ; sinon les angles décrivent deux plans différents.

Un strip de k≥1 triangles sans redémarrage utilise k+2 indices avant métadonnées, contre 3k pour une liste. Les redémarrages, parités de winding, coutures, matériaux et indices réutilisés doivent être vérifiés. L’identité de primitive nécessite un remapping si l’ordre change. Un decodeur indépendant doit reconstruire le même multiensemble de triangles orientés et leurs attributs.

Une fenêtre de réutilisation W limite la distance vers les sommets précédents. Réordonner pour rester dans W, ou dupliquer un sommet avec tous ses attributs quand il sort de la fenêtre. La duplication peut elle-même sortir d’autres sommets de la fenêtre : revalider le triangle complet puis tous les plafonds. Mesurer W, duplication, coût d’indices, débit de décompression et lectures mémoire ensemble.

Les lots de transformation de sommets respectent à la fois un nombre de triangles et l’union des sommets uniques ; couper un lot avant dépassement. Les lots de matériaux et ceux de réutilisation ne sont pas automatiquement identiques. Le décodeur doit spécifier son propre état initial, ses transitions, ses contrôles de plage et une version de format ; ces choix se comparent à la liste d’indices brute.

Skinning : palette locale d’os puis indices locaux, fusion préalable des os identiques, suppression des poids nuls, ordre stable. Un unique poids peut être implicite s’il vaut exactement 1. Si δⱼ=ŵⱼ−wⱼ et Σδⱼ=0, l’erreur de position vaut Σδⱼ(qⱼ−c) et est ≤RΣ|δⱼ| dès que ‖qⱼ−c‖≤R. Cette borne dépend des positions qⱼ transformées, pas seulement du nombre de bits.

Si l’on retire une masse totale r de poids puis renormalise les autres, le déplacement est ≤r·diamètre({qⱼ}), pour poids initiaux positifs de somme 1 et r<1. Tester poses divergentes, très petites influences, quantification égalitaire, palettes vides et dépassement de palette. Une palette réduite pour estimer les bornes ne doit jamais exclure silencieusement une influence géométrique.

## 4. Pages : préparer les conditions de publication

L’affectation de pages est un problème d’empaquetage sous plafonds multiples, intégrant taille réellement encodée, métadonnées, alignement et dépendances. Trier les représentations grossières avant les fines facilite un socle résident ; garder ensemble les participants souvent demandés ensemble réduit la fermeture de dépendances. Mesurer la taille de cette fermeture, pas seulement la taille de la page demandée.

Un remplacement est activable lorsque toutes ses pages et toutes les données requises sont prêtes pour la même génération. Les correctifs de références représentent cette condition logique ; ils ne sont pas des positions magiques dans un format. Reconstituer les références depuis un manifeste validé, publier atomiquement l’état, et pouvoir rejouer ou annuler sans compteur négatif ni double application.

Le graphe des dépendances géométriques et celui du décodage doivent être distingués. Une compression relative interpage augmente la chaîne séquentielle de décodage : profondeur d(p)=0 pour une page autonome, sinon 1+max d(dépendance). Fixer une profondeur maximale et insérer des pages autonomes ; détecter les cycles avant de calculer d. Le repli racine doit être décodable sans page absente.

La page suivante doit aussi être découvrable : une dépendance présente ne suffit pas si le parcours de hiérarchie s’arrête avant la référence qui déclenche sa demande. Vérifier qu’à chaque état partiellement chargé il existe un chemin de découverte depuis les racines pour toute extension autorisée. Tester ordres de chargement permutés, échec d’une dépendance, déchargement partiel, ancien correctif et plusieurs instances du même asset.

## 5. Outils numériques et stratégie de recette

Pour Ax=b, résoudre par factorisation avec pivot relatif, puis mesurer η=‖b−Ax‖/(‖A‖‖x‖+‖b‖), avec cas nul explicite. Une petite η indique un faible résidu relatif, pas une faible erreur sur x si A est mal conditionnée. L’affinement calcule r=b−Ax, résout Aδ=r et corrige x←x+δ ; arrêter si stagnation, résultat non fini ou budget atteint.

Pour une matrice symétrique semi-définie, A=UΛUᵀ, pseudo-inverse tronquée A⁺_τ=U diag(1/λᵢ si λᵢ>τλ_max, sinon 0) Uᵀ, avec τ relatif versionné ; contrôler les valeurs négatives. x=A⁺_τb est la solution de moindres carrés de norme minimale pour la matrice dont les petites valeurs propres ont été annulées, pas nécessairement pour A originale. Les directions nulles de QEM gardent également les candidats d’extrémité/segment déjà documentés.

Recherche de racine : utiliser une fonction continue et un intervalle de signes opposés ; la bissection garantit une largeur divisée par deux par itération. Les étapes sécante/interpolation inverse accélèrent seulement si elles restent dans l’intervalle et progressent. Évaluer tolérance sur x et sur f séparément. Un minimum sans dérivées par simplex est une heuristique locale, sans promesse d’optimum global.

Construire d’abord les oracles f64, puis comparer chaque optimisation isolément : graphe glouton/partition, liste/strip, champs bruts/compressés, médiane/SAH, subdivision exhaustive/adaptative et surface/cellules. Une recette doit inclure défauts, limites mémoire, relecture indépendante, stabilité d’ordre, erreur observée et statut de certification. Les réglages d’un asset de démonstration ne deviennent pas des constantes universelles.
