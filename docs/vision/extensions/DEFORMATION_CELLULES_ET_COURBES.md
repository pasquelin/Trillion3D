# Déformation, cellules et courbes

> Conception Web Geometry : ce chapitre décrit des contrats et algorithmes proposés. Voir [l’état de l’implémentation](../../../packages/README.md).

Ces extensions définissent leur propre géométrie et leur propre erreur. Les [matériaux et extensions](MATERIAUX_ET_EXTENSIONS.md) fixent le périmètre ; le [pipeline GPU](../runtime/PIPELINE_GPU_ET_EXTENSIONS.md) décrit leur consommation, leurs capacités et leurs replis. Les tests mentionnés ci-dessous sont des recettes à réaliser, sauf ceux explicitement conservés dans les oracles.

## 1. Déplacement adaptatif : des estimations aux bornes

Avec barycentriques bᵢ≥0 de somme 1 : p(b)=Σbᵢpᵢ, u(b)=Σbᵢuᵢ, n(b)=normalize(Σbᵢnᵢ), D(b)=n(b)·m(h(u(b))−c), pour amplitude m, centre c et texture scalaire h. Une fenêtre de mélange g ajoute le facteur g(u). La borne doit inclure exactement g, adressage, filtrage, UV, interpolation et normalisation employés par le déplacement ; une branche omise invalide la garantie.

L’erreur d’approximation est e(b)=‖D(b)−ΣbᵢD(eᵢ)‖. Échantillonner les arêtes et l’intérieur aide à trouver un point à raffiner, mais ne borne pas le maximum. Le nombre de tests doit tenir compte de la longueur des arêtes et de l’aire en texels : un triangle très fin peut avoir une faible aire tout en traversant de nombreuses variations.

Borne indépendante par régularité : pour une fonction vectorielle F deux fois dérivable sur le triangle convexe et ‖D²F(x)[v,v]‖≤H‖v‖², Taylor donne ‖F(p)−ΣbᵢF(pᵢ)‖≤(H/2)Σbᵢ‖pᵢ−p‖²≤H·diamètre(T)²/2. Pour un déplacement de longueur, H a l’unité inverse d’une longueur. Une texture discontinue ou une normale interpolée pouvant s’annuler sort de ce domaine.

Alternative par intervalles : chaque cellule barycentrique fournit [L,U] contenant e² sur toute la cellule, avec opérations à arrondi dirigé. Écarter si U≤tol² ; raffiner si le doute persiste. Une valeur échantillonnée fournit une borne inférieure du maximum global. Arrêter sous budget avec état « non certifié » si l’écart reste non résolu. Un intervalle contenant zéro dans un diviseur impose subdivision ou repli, jamais une normalisation arbitraire.

Une forme affine x=x₀+Σaᵢεᵢ, εᵢ∈[−1,1], préserve les corrélations linéaires ; son intervalle est [x₀−Σ|aᵢ|,x₀+Σ|aᵢ|]. Pour un produit, borner les termes quadratiques omis par (Σ|aᵢ|)(Σ|bᵢ|) et introduire un nouveau symbole d’erreur. Tout prolongement non linéaire exige une enveloppe démontrée, particulièrement racine, réciproque et normalisation.

Formules de contrôle barycentrique : pour δ=b−c, Σδᵢ=0, ‖p(b)−p(c)‖²=−Σ_{i<j}δᵢδⱼ‖pᵢ−pⱼ‖². Si les colonnes de B sont les trois sommets d’un sous-triangle en barycentriques du parent, son aire est A·|det B| et un point local b devient Bb dans le parent. Distance intérieure à l’arête opposée i : bᵢ·2A/longueur(arête_i). Pour un angle entre côtés u,v d’un triangle non dégénéré, cotθ=(u·v)/‖u×v‖.

Une bascule de diagonale Delaunay peut améliorer des triangles dans un domaine paramétrique plan convexe ; elle ne garantit pas l’erreur après déplacement. Interdire les bascules sur contraintes/coutures, vérifier orientation et réévaluer l’erreur réelle. Éviter les angles via des prédicats d’orientation et de cercle robustes. Une amélioration de triangulation ne remplace pas une borne de déplacement.

Un choix de maillage surraffiné puis simplifié doit partager le budget : ε_total≤ε_tessellation+ε_simplification+ε_quantification lorsque chaque terme est un majorant compatible. Les seuils dépendent des unités, pas d’un pourcentage opaque. Tester texture constante, affine, pic entre échantillons, damier, UV miroir, bord partagé opposé et normales antipodales.

## 2. BVH, cellules et échantillonnage

Pour un BVH à deux enfants, SAH≈C_visite+(A_g/A_p)N_gC_primitive+(A_d/A_p)N_dC_primitive, avec A_p>0. C’est une estimation sous hypothèses de distribution de rayons ; une heuristique N‖étendue‖² est un autre coût, malgré un éventuel nom commun. Comparer médiane et balayage des séparations admissibles, avec repli stable pour centres confondus.

Un BVH large réduit la profondeur mais augmente les tests par nœud ; comparer largeur, occupation et octets. L’ordre des enfants adapté au signe du rayon est une optimisation de parcours, jamais une garantie de proximité. Les mises en page, permutations et masques d’un moteur ne sont pas nécessaires pour définir notre arbre.

Oracle voxel conservatif : tester l’intersection du triangle avec le cube fermé. Le théorème de séparation utilise les 3 axes du cube, la normale du triangle et les 9 produits croisés arête/axe ; ignorer un axe nul. Pour un cube centré c de demi-étendue h et axe a, le rayon de projection est R=|aₓ|hₓ+|aᵧ|hᵧ+|a_z|h_z. Si les projections des trois points pᵢ−c sont toutes >R ou toutes <−R, les objets sont disjoints. Traiter les triangles dégénérés comme segment/point selon contrat. La conservation est exacte en arithmétique réelle ; en flottants, utiliser intervalles avec arrondi extérieur ou une marge justifiée sur les projections. Une séparation incertaine conserve le candidat, particulièrement pour les contacts de face, d’arête ou de coin.

La connectivité d’une grille doit être explicite : 6 voisins par face, 18 en ajoutant les arêtes, 26 avec les coins. Deux règles de voxelisation peuvent préserver des propriétés de séparation différentes. Occupation signifie présence géométrique potentielle ; elle ne signifie ni opacité pleine ni volume solide. Tester triangles sur faces, arêtes et coins de cellules, lamelles minces et orientation inversée.

Une brique vide, partielle ou pleine peut se représenter par un masque et une liste compacte d’attributs. L’indice compact d’une cellule occupée i est le nombre de bits occupés avant i ; l’occupation se teste avant l’accès. Les unions de voxels d’enfants transformés doivent couvrir les boîtes transformées, pas seulement leurs centres. La taille des briques reste un paramètre de mesure.

Pour un échantillonnage uniforme de surface triangulée, choisir la face avec probabilité A_f/ΣA puis des barycentriques (1−√u,√u(1−v),√uv), u,v uniformes dans [0,1). Pour la sphère : z=1−2u, φ=2πv et direction=(√(1−z²)cosφ,√(1−z²)sinφ,z). Disque de rayon R : rayon R√u, angle 2πv. Des coordonnées polaires uniformes en rayon ne donnent pas une aire uniforme.

Une gaussienne radiale isotrope tronquée au rayon R peut utiliser r=σ√[−2 ln(1−u(1−exp(−R²/(2σ²))))], σ,R>0, et angle uniforme. Déclarer la densité réellement utilisée : cette troncature radiale n’est pas une fenêtre carrée. Les séquences à faible discrépance améliorent souvent la couverture mais n’apportent pas automatiquement une barre d’erreur statistique indépendante.

Pour un estimateur d’intégrale I≈(1/N)Σ f(Xᵢ)/p(Xᵢ), p doit être positive partout où f contribue. Un comptage k/N estime la couverture pour la distribution des rayons choisie. Avec N Bernoulli indépendants, variance=p(1−p)/N ; des échantillons corrélés, directionnels ou quasi aléatoires ne justifient pas cette formule sans analyse. Tester changement de seed, orientation et convergence en N.

La combinaison c=a+b−ab est celle de deux couvertures indépendantes ; avec dépendance inconnue, seules max(a,b)≤c≤min(1,a+b) sont assurées pour l’union. Redistribuer de la couverture de cellules supprimées constitue une approximation d’apparence, à mesurer par direction et silhouette, pas une conservation automatique de surface.

## 3. Distribution SGGX : ne pas confondre covariance et distribution

Pour des normales unitaires non orientées nᵢ et poids d’aire aᵢ≥0 de somme strictement positive, calculer C=Σaᵢnᵢnᵢᵀ/Σaᵢ, puis ses axes propres uⱼ. Réestimer les projections σⱼ=Σaᵢ|uⱼ·nᵢ|/Σaᵢ et construire S=Σσⱼ²uⱼuⱼᵀ. C donne les axes ; ses valeurs propres ne sont généralement pas celles de S. Le facteur d’échelle des aires et la densité doivent être déclarés.

Pour S symétrique définie positive et directions unitaires, σ(ω)=√(ωᵀSω), D(n)=1/[π√det(S)·(nᵀS⁻¹n)²]. D n’est pas une PDF normalisée. La distribution visible, max(0,ω·n)D(n)/σ(ω), l’est. Les matrices semi-définies singulières demandent une limite analytique ou une régularisation explicitement approximative.

L’interpolation convexe des matrices conserve leur positivité et interpole les projections au carré ; elle n’est pas un mélange exact des distributions. Tester isotropie, disque limite, anisotropie et changement d’échelle.

Pour un axe unitaire u et rugosité α>0, des familles indépendantes utiles aux fixtures sont S_surface=α²(I−uuᵀ)+uuᵀ et S_fibre=(I−uuᵀ)+α²uuᵀ ; elles sont isotropes pour α=1. Utiliser la quadrature numérique de σ sur la sphère comme oracle plutôt que recopier une approximation interne d’aire d’ellipsoïde.

## 4. Courbes, fibres et transformations

Bézier cubique : B(t)=(1−t)³P₀+3(1−t)²tP₁+3(1−t)t²P₂+t³P₃, t∈[0,1]. B′(t)=3[(1−t)²(P₁−P₀)+2(1−t)t(P₂−P₁)+t²(P₃−P₂)]. La tangente est B′/‖B′‖ uniquement si sa norme est suffisante. Un rayon interpolé doit rester fini et non négatif.

L’abscisse curviligne est s(t)=∫₀ᵗ‖B′(u)‖du ; des t régulièrement espacés ne produisent pas des longueurs égales. Construire une table adaptative monotone de s, puis inverser par intervalle et bissection pour rééchantillonner. Verrouiller les extrémités et les discontinuités voulues ; retirer les segments de longueur nulle avec un diagnostic.

Pour une courbe Bézier, l’enveloppe convexe des points de contrôle borne la position ; élargir de r_max pour un tube. Pour une réduction de polyline, contrôler distance de toute la polyline originale aux segments restants, rayon et tangente, puis le sens inverse si une distance symétrique est requise. RMSE=√(Σdᵢ²/N) et max dᵢ échantillonnés sont deux métriques distinctes ; aucun ne certifie les portions non échantillonnées.

Sélectionner moins de fibres modifie aussi la couverture. Regrouper seulement par distance entre racines est une heuristique spatiale : deux racines proches peuvent produire des boucles très différentes. Comparer racine, forme rééchantillonnée, longueur, orientation et rayon. Un k-means minimise Σ‖xᵢ−μ_π(i)‖² mais ne garantit pas la capacité ; imposer en plus courbes et segments par cluster, puis revalider toute redistribution.

Un repère le long de la courbe peut transporter une normale par rotation minimale entre tangentes successives ; il évite les bascules d’un axe de secours choisi indépendamment à chaque point. Le cas tangentes opposées exige un axe déterministe ; une courbe fermée peut accumuler une torsion qu’il faut répartir si la couture doit se fermer. Tester droite, cercle, hélice, boucle serrée, cuspide, deux fibres de même racine et rayons variables.

Pour les [assemblages](ASSEMBLAGES_ET_PROCEDURAL.md), pour partie affine A, erreur de longueur ≤‖A‖₂ε ; une borne calculable sans SVD est ‖A‖₂≤√(‖A‖₁‖A‖∞). Utiliser les valeurs absolues des échelles dans le cas diagonal ; le maximum des échelles extraites n’est pas un majorant général du cisaillement.

Normale transformée : normalize(A⁻ᵀn) pour A inversible ; une transform singulière demande une politique spécifique. L’orientation de face change si det A<0. Pour l’aire d’un triangle de normale géométrique unitaire n, facteur exact |det A|‖A⁻ᵀn‖, tandis que ‖A‖₂² majore l’aire même sans supposer une échelle uniforme. Composer les bornes par union des enfants transformés.

Tester les compléments affines sur identité, réflexion, cisaillement et transform singulière. Les contrats d’import, masque, matériau, squelette et préparation asynchrone figurent dans le chapitre des assemblages.
