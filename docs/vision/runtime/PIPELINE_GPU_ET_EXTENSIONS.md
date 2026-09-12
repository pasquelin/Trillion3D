# Pipeline GPU et extensions

> Conception Web Geometry : ce chapitre décrit des contrats et algorithmes proposés. Voir [l’état de l’implémentation](../../../packages/README.md).

Ce chapitre précise les contrats d’ordonnancement, de couverture, de publication et de consommation des extensions. Il complète le [rendu de référence](RENDU_ET_SELECTION.md), les [stratégies avancées](../extensions/STRATEGIES_AVANCEES.md) et les [pages](PAGES_MEMOIRE_ET_CACHE.md). Les variantes natives exigent une capacité démontrée du backend ; les frontières entre dispatchs et le raster matériel fournissent les références portables.

## 1. Traverser un graphe : travail logique et ordonnancement

Une hiérarchie de regroupement peut être un DAG : plusieurs relations peuvent mener à une représentation partagée. La coupe logique doit être validée indépendamment de l’ordonnancement du parcours. Un ensemble de nœuds « déjà vus » n’est pas, à lui seul, une règle de remplacement collectif. L’identité de travail doit inclure au minimum l’instance, la vue et la relation ou région pertinente ; deux instances du même asset ne sont pas des doublons.

La référence GPU utilise des frontières successives. La frontière Fₗ est l’entrée d’un dispatch ; ses enfants acceptés forment Fₗ₊₁ après compaction, puis un dispatch distinct les consomme. Le nombre de dispatchs dépend de la profondeur effectivement parcourue. Les feuilles peuvent être accumulées puis traitées ensemble. Le coût approximatif est travail utile + coût de lancement × nombre de frontières + trafic des listes ; c’est une base simple pour comparer des variantes.

Une variante persistante maintient des tâches de nœuds et de feuilles. Donner priorité aux nœuds fait avancer les dépendances profondes ; traiter des feuilles lorsque rien n’est prêt masque une partie de cette latence. L’invariant de terminaison est W = tâches de nœuds en attente + tâches de nœuds en cours, où une tâche en cours reste comptée jusqu’à la publication complète de sa descendance. Réserver une plage ne rend pas son contenu lisible. Il faut un protocole de publication et une garantie de progrès correspondant au modèle mémoire du backend. W=0 peut terminer la production de feuilles, mais les feuilles déjà publiées doivent encore être consommées.

Un compteur de réservation, un compteur d’éléments initialisés et un compteur d’éléments consommables ne sont donc pas interchangeables. Les comptes peuvent dépasser une capacité pour mesurer la demande, mais aucun consommateur ne doit dépasser les éléments réellement écrits. Une barrière de groupe ne prouve ni publication globale ni planification d’un producteur encore en attente. Le socle portable conserve les frontières entre dispatchs.

Tests : arbre vide, chaîne très profonde, éventail large, DAG partagé, deux instances du même asset, zéro feuille acceptée, producteur artificiellement retardé, saturation au dernier emplacement. Comparer l’ensemble logique obtenu à la référence séquentielle ; un débordement reprend une représentation complète.

## 2. Compacter et réserver par destination

Dans un sous-groupe de L lanes actives, regrouper les destinations égales. Pour une destination b, réserver une fois la somme C_b des contributions ; chaque lane utilise le préfixe des contributions précédentes de même destination. Le nombre d’atomiques passe de L à K, où K est le nombre de destinations distinctes, avec 1≤K≤L. Ce gain potentiel suppose de la cohérence locale ; un groupe entièrement disparate paie la classification sans réduire les réservations.

Le calcul doit utiliser le masque réel des lanes participantes et la largeur observée ou contractuellement garantie. Aucune largeur particulière n’est universelle. Comparer atomiques simples, histogrammes locaux et réservations groupées sur clés uniformes, alternées et toutes distinctes ; vérifier comptes, absence de collisions et coût total.

Un cache glissant de sommets est une autre optimisation conditionnelle : elle exige que chaque référence reste dans la fenêtre active et que la capacité de coopération soit suffisante. Cette contrainte appartient au contrat compilateur–décodeur, elle ne découle pas du simple fait d’avoir des indices locaux. Tester une référence exactement à la limite puis hors fenêtre ; prévoir un chemin de décodage général.


### Capacités et commandes de dessin

Le nombre logique N d’éléments, le nombre d’invocations et le nombre de workgroups sont distincts. Une limite du backend se traite par plusieurs dispatchs, une grille multidimensionnelle ou une distribution bornée du travail. Avec P>0 invocations, la plage de i∈[0,P) peut être [⌊iN/P⌋,⌊(i+1)N/P⌋) : ces plages couvrent exactement [0,N), y compris lorsque N<P. Les produits iN doivent être calculés sans débordement. Une grille multidimensionnelle doit définir sa linéarisation et ignorer ses invocations supplémentaires.

Deux listes partageant un buffer depuis ses extrémités nécessitent une réservation collective garantissant N_gauche+N_droite≤capacité. Deux compteurs atomiques indépendants, chacun inférieur à la capacité totale, ne prouvent pas l’absence de collision. Une demande excessive garde son compteur de diagnostic, mais seuls les éléments écrits sont publiés.

Pour K clusters ayant au plus M triangles, un dessin procédural de taille fixe réserve 3KM sommets alors que le travail utile vaut 3ΣTᵢ. Son occupation est ΣTᵢ/(KM), pour KM>0. Les triangles supplémentaires doivent être dégénérés avec des lectures valides ; aucune lecture hors plage, NaN ou coordonnée immense ne sert de désactivation. Comparer commandes exactes, classes de tailles et remplissage fixe ; inclure coût CPU, nombre de dessins et invocations inutiles.

Tests : N=0, N<P, N non divisible par P, limite exacte de dispatch, produit proche de la limite entière, deux listes qui se rencontrent et cluster vide au milieu des commandes.

## 3. Vues, projections et budget de détail

Séparer trois notions : vue qui dessine, vue qui mesure le besoin de détail, et vue dont l’historique sert de priorité d’occlusion. Les confondre introduit des dépendances cachées, par exemple une ombre dont la distance de désactivation de déformation change avec une autre caméra. Chaque politique doit nommer explicitement sa vue de référence.

Un viewport définit origine, étendue, résolution effective et convention de profondeur. La projection vers la cible puis le rectangle vers une pyramide ou une tuile sont deux transformations distinctes. Tester des vues décalées dans un atlas, des résolutions différentes et plusieurs couches ; une identité de vue ne peut pas être reconstruite uniquement à partir d’un pixel local.

Le besoin partagé de pages est l’union des besoins des vues, alors que le travail visible demeure propre à chaque vue. Un cache d’ombre dépend de la lumière, des objets occluders, des matériaux de couverture et de leur déformation ; sa validité est indépendante du cache de géométrie. Une cible virtuelle non mappée n’est pas une preuve physique d’occlusion. On peut ignorer un travail uniquement parce que cette cible n’a pas demandé la page, avec un statut distinct.

Sous pression mémoire, une politique peut augmenter temporairement le seuil d’erreur autorisé. Exemple de contrôleur proposé : τ=τ₀ exp(q), avec q borné ; augmenter q après surcharge persistante, le diminuer plus lentement après marge persistante, et conserver une zone neutre entre deux seuils d’occupation. Les vitesses doivent être exprimées par seconde si l’on veut un comportement indépendant du framerate. Les constantes relèvent d’une campagne de mesures, pas d’une preuve géométrique.

Tests : surcharge d’une seule image, oscillation près du budget, charge soutenue, arrêt de caméra, changement de résolution et de nombre de vues. Mesurer dépassement de qualité, défauts de pages, latence de retour à la qualité et mémoire totale ; augmenter τ ne garantit pas une réduction instantanée de résidence.

## 4. Règles de couverture et répartition du raster

La répartition logiciel/matériel est une décision de coût distincte de l’éligibilité. Taille projetée, nombre de triangles, surface de pixels visitée, clipping, divergence du matériau et pression sur les atomiques peuvent tous intervenir. Une borne de coût proposée est C≈aN_triangles+bN_pixels+cN_evaluations_couverture, avec coefficients mesurés séparément pour chaque chemin. Une petite AABB ne suffit pas à prouver qu’un chemin sera plus rapide.

Le programme de couverture comprend tous les calculs pouvant modifier existence ou profondeur d’un échantillon : masque alpha, déformation, déplacement et offset de profondeur. Les attributs nécessaires doivent être accessibles dès cette étape. Un cluster contenant plusieurs matériaux peut contribuer à plusieurs lots de couverture ; chaque contribution ne doit émettre que ses primitives et leurs sommets effectivement utilisés. Le shading différé utilise ensuite l’identité et la géométrie correspondant exactement à cette couverture.

Un rejet de profondeur anticipé est permis seulement si la profondeur finale ne peut pas devenir gagnante après l’évaluation restante. Déclarer une borne monotone sur l’offset ou effectuer le rejet après calcul. Tester un matériau qui déplace la profondeur dans chaque direction, des triangles très fins et des égalités exactes ; la profondeur extrapolée n’a pas automatiquement les garanties d’un échantillon intérieur.

Le winding, le clipping, l’arrondi et le départage des égalités doivent coïncider entre chemins. Modifier l’ordre des sommets exige aussi de permuter les poids barycentriques et tous les attributs associés. Une correction de face appliquée deux fois est une régression possible avec instances réfléchies.

## 5. Couverture extérieure et intérieure

Pour un triangle orienté dont les demi-plans sont Eᵢ(x,y)=aᵢx+bᵢy+cᵢ≥0, et un pixel rectangulaire de centre p et demi-tailles hₓ,hᵧ, poser rᵢ=|aᵢ|hₓ+|bᵢ|hᵧ. Si un Eᵢ(p)+rᵢ<0, le pixel ne rencontre pas le triangle. Conserver les autres pixels donne une couverture extérieure conservative, éventuellement trop large près des sommets. Si tous les Eᵢ(p)−rᵢ≥0, le pixel entier est dans le triangle. Ces inégalités se déduisent directement des extrema d’une fonction affine sur un rectangle.

Ajouter la marge due à l’arrondi des sommets et au calcul des fonctions d’arête. La couverture extérieure est utile pour produire des candidats ; elle ne doit pas devenir une profondeur opaque pleine sans preuve de couverture intérieure.

Tests : triangle plus petit qu’un pixel, passage sur un coin, arête exactement partagée, triangle presque dégénéré et translation sous-pixel. Comparer avec intersections exactes triangle–carré ; exiger zéro faux négatif pour la couverture extérieure et zéro faux positif pour la couverture intérieure.

## 6. Gagnant de visibilité indivisible

Définir un ordre total du gagnant : profondeur d’abord, identité stable ensuite pour les égalités. L’identité ne doit jamais déborder sur les bits qui ordonnent la profondeur. Une représentation atomique large peut publier la paire indivisiblement sur un backend compatible ; une cible d’identité sous le même depth test matériel garantit une paire cohérente, mais ne compare pas les IDs pour départager les profondeurs égales.

Référence déterministe, volontairement coûteuse : traiter les primitives par ID global stable décroissant, avec un dessin matériel séparé et ordonné par primitive, et un test de profondeur inclusif (LESS_EQUAL en standard, GREATER_EQUAL en inversé). À profondeur égale, le plus petit ID écrit en dernier gagne. Un fragment valide peut ainsi remplacer le fond même à sa profondeur de clear (1 en standard, 0 en inversé). Le chemin logiciel applique le même ordre profondeur/ID, où toute paire valide précède le fond invalide. Chaque chemin produit sa paire gagnante et la composition applique encore cet ordre. Les clés comprennent l’instance ; le fond a un état invalide distinct.

La profondeur comparée doit être dans le même domaine et à la même précision avant de sélectionner le gagnant. Quantifier seulement après sélection peut changer les égalités et perdre le bon ID. Vérifier que les formats et écritures de profondeur du backend préservent l’ordre des valeurs retenues ; sinon utiliser la référence par échantillon ou un autre mécanisme de départage démontré. Le mode matériel ordinaire peut employer son ordre de soumission pour les égalités, mais ne doit alors pas revendiquer une invariance des IDs au regroupement ou au changement de chemin.

L’ordre des bits d’un flottant ne représente l’ordre numérique que dans un domaine convenu. Pour des flottants positifs finis, la représentation entière non signée est monotone ; les valeurs négatives, NaN, infinis et zéros signés exigent une politique explicite. Quantifier la profondeur peut créer des égalités supplémentaires : mesurer l’erreur et fixer le départage. Un test anticipé comparant uniquement la profondeur doit préserver le départage final en cas d’égalité.

Tests : deux fragments intercalés adversarialement, même profondeur et identités différentes, extrêmes représentables, fond, NaN rejeté, passage du chemin matériel au logiciel. Vérifier simultanément profondeur, identité, attributs reconstruits et stabilité temporelle.

## 7. Shading compact en pixels ou en quads

Les matériaux sans opérations nécessitant des voisins peuvent être compactés en pixels isolés. Un programme utilisant des dérivées en quads exige des groupes spatiaux cohérents et des lanes auxiliaires calculant les valeurs nécessaires sans écrire de résultats visibles. Les capacités et dispositions imposées par une API native ne constituent pas une garantie portable.

Pour chaque lot, séparer masque d’exécution et masque d’écriture. Un même quad touchant plusieurs matériaux peut être évalué plusieurs fois, chacun avec son masque. Les pixels de fond et hors cible sont invalides, même si leurs champs numériques ressemblent à une clé de lot. L’occupation utile peut être mesurée par η=N_pixels_ecrits/N_lanes_evaluees ; elle explique pourquoi les petits triangles ou les matériaux dispersés peuvent coûter plus que leur nombre de pixels.

Les gradients analytiques du triangle gagnant restent la référence pour les attributs continus. Si l’on emploie des différences finies, les valeurs auxiliaires doivent provenir d’une continuation de la même surface et du même programme ; la couleur du pixel voisin visible n’est pas cette continuation. Une interpolation déplacée ou tessellée doit fournir ses gradients correspondants, pas ceux d’une géométrie antérieure.

Un shading à taux variable associe une évaluation à plusieurs pixels avec un masque de diffusion. Choisir composante par composante la résolution la plus fine demandée par les participants, préserver les discontinuités de matériaux et les écritures de fond. C’est une approximation de shading distincte du choix LOD et de la couverture.

Tests : damier de matériaux, bord du viewport impair, un seul pixel utile dans un quad, UV discontinu, fond adjacent, subdivision déplacée, changement de taux en X seulement. Mesurer η, coût de compaction, filtrage texture et erreur visuelle.

## 8. Installation de pages et changement collectif de résidence

Une livraison peut être décomposée en préparation indépendante, puis étapes de décodage dépendantes. Les étapes dépendantes suivent un ordre topologique : une étape ne lit que des pages déjà prêtes dans une étape antérieure ou une livraison antérieure publiée. Si aucune page restante ne devient prête, signaler un cycle ou une dépendance manquante ; ne pas boucler indéfiniment.

La publication d’une représentation requiert toutes ses pages, toutes ses dépendances de décodage, ses tables de références et ses états de remplacement. Un compteur de dépendances manquantes par groupe peut fournir cette condition : remplacement autorisé exactement quand le compteur vaut zéro et que toutes les générations coïncident. Lors d’une éviction, rétablir la représentation de secours et invalider les références avant réutilisation de la mémoire, après les usages en vol.

Il faut distinguer mémoire réservée, octets transférés, données décodées et représentation utilisable. Une copie terminée ne valide pas automatiquement les corrections de références. Réserver la fermeture de dépendances entière avant publication évite qu’une installation partielle consomme le budget sans débloquer aucun détail.

Tests : dépendance livrée après son enfant, deux livraisons entrelacées, disparition d’asset pendant l’upload, éviction/rechargement du même slot, groupe sur plusieurs pages, compteur sous zéro et cycle de dépendances. La coupe visible reste complète à chaque état observable.

## 9. Fusion ordonnée des corrections

Des mises à jour d’un même mot ne peuvent être dispersées en parallèle sans régler leurs conflits. Une écriture entière ultérieure peut remplacer les précédentes ; une modification partielle ne le peut que si elle écrase effectivement tous les bits concernés. Deux mises à jour de bits distincts doivent être composées.

Pour des opérations de bits, une forme autonome est f(x)=(x∧A)∨O. La composition f₂(f₁(x)) utilise A=A₁∧A₂ et O=(O₁∧A₂)∨O₂, avec ordre conservé. Cette identité permet de réduire une séquence par adresse avant un scatter sans conflit. L’équivalent « dernière écriture uniquement » ne vaut pas pour des modifications partielles générales.

Tests : poser puis effacer le même bit, effacer puis poser, modifier deux bits distincts, remplacer tout le mot au milieu, collisions de table de regroupement. Comparer le mot final avec l’application séquentielle pour toute valeur initiale sur un petit domaine exhaustif.

## 10. Feedback et mémoire de secours

Une file de readback possède des emplacements disponibles, en cours et lisibles. Ne jamais recycler un emplacement avant la fin de sa copie. Si la file est pleine, l’omission d’un nouvel échantillon de feedback vaut mieux qu’une attente imposée au rendu ; le repli doit rester correct. La lecture de l’échantillon complet le plus récent est une politique possible uniquement si les demandes non satisfaites sont régénérées et ne représentent pas des événements uniques à conserver.

Conserver le nombre réellement demandé même si la liste écrite est bornée : il permet de distinguer faible demande et saturation. Adapter la capacité avec marge, croissance après surcharge persistante et décroissance lente. Une suppression de feedback ou une fusion probabiliste ne doit jamais autoriser une page absente ; elle peut seulement retarder la qualité.

Un cache de meshes de secours a son propre budget et ses transitions asynchrones. Les éléments requis par la frame ne sont pas des candidats ordinaires à l’éviction ; les opérations déjà en cours doivent être comptées dans l’engagement mémoire. Une préférence systématique pour les petits chargements augmente parfois le nombre d’objets servis mais peut affamer un gros objet : inclure âge ou échéance.

Tests : plusieurs frames sans readback disponible, saturation suivie d’accalmie, demande unique persistante, retour tardif d’une ancienne génération, grosse ressource avec flux continu de petites ressources. Mesurer âge des demandes, octets en vol et défauts effectivement résolus.

## 11. Cache d’accélération pour les rayons

Une accélération possède une validité distincte des pages géométriques. Sa clé conceptuelle comprend l’asset et sa génération, la coupe retenue, la déformation, les règles d’intersection du matériau et le niveau d’erreur autorisé. Un cache ne devient utilisable qu’après construction ou copie terminée dans l’allocation qui lui correspond.

Une génération d’allocation doit changer lors de la réutilisation du même slot et survivre à l’éviction des métadonnées ordinaires. Une égalité d’adresse et de taille ne prouve jamais que le contenu construit est encore le bon. Prévoir l’enroulement de génération par purge ou par domaine suffisamment large accompagné d’une règle explicite.

Une tolérance de réutilisation ne doit pas violer la qualité demandée : si e_c est la borne réellement portée par l’accélération et e_t le seuil demandé, e_c≤e_t suffit du point de vue de cette borne, sous toutes les autres validations. Une proximité relative symétrique peut accepter un cache trop grossier ; si cette dégradation est choisie, elle doit être déclarée et mesurée.

Séparer budgets de construction, scratch, stockage temporaire, stockage persistant et déplacement/compaction. Les allocations collectives peuvent être réservées entièrement ou annulées proprement ; un échec doit invalider les références associées, jamais laisser d’anciennes adresses actives. Les rayons peuvent demander de la géométrie hors des vues raster, et leur LOD peut référencer des os ou des matériaux absents du chemin d’affichage.

Tests : cache hit, changement de coupe à taille égale, réemploi du même slot par un autre asset, seuil plus strict, déformation, échec d’allocation, copie encore en vol et apparition d’un objet hors écran dans une réflexion. Mesurer constructions évitées, scratch maximal, mémoire persistante et erreur d’intersection.

## 12. Transparence et extraction de géométrie

Une coupe de géométrie peut alimenter un chemin transparent matériel distinct, avec ses règles de tri et de blending. Recycler les listes de clusters est possible ; recycler la sémantique du gagnant opaque ne l’est pas. Un tri de lots par programme ne constitue pas un tri correct de transparence, notamment pour surfaces qui s’interpénètrent.

Pour exporter une coupe vers un mesh conventionnel ou une construction d’accélération : compter sommets/indices par destination et domaine de matériau, calculer les offsets, allouer, puis produire les données dans une seconde phase. Les contraintes de joints, orientations et identités restent identiques à celles de la coupe. La capacité de sortie et l’état des pages doivent être gelés pendant cette opération ou versionnés.

Tests : deux plans transparents croisés, matériaux multiples dans un cluster, export d’une coupe mêlant plusieurs niveaux, annulation pendant l’extraction et dépassement de capacité. Un format de commande natif peut nécessiter une conversion propre ; une liste de travail n’est pas directement une commande portable.

## 13. Tessellation dynamique : motifs, orientation et progrès

Un facteur de subdivision par arête peut être proposé à partir de sa longueur projetée ℓ et d’un objectif s>0 : n=max(1,ceil(ℓ/s)). C’est une estimation du nombre de segments, pas une borne générale de leur taille projetée ni de l’erreur du déplacement. Sous perspective, un milieu objet n’est pas un milieu écran : l’arête (x,z)=(0,1)→(2,2), projetée par x/z, mesure 1 ; deux segments égaux dans l’objet mesurent 2/3 puis 1/3 à l’écran. Pour garantir une taille maximale, placer les coupes dans un paramétrage écran commun, majorer la dérivée de projection ou revalider et raffiner les sous-arêtes. Les voisins doivent alors partager les mêmes positions de coupe, pas seulement le nombre de segments. Calculer le même n pour les deux côtés d’une arête partagée, puis utiliser un motif conforme. Lorsque les facteurs dépassent la capacité locale d’un motif, subdiviser d’abord en sous-patches, puis appliquer les motifs bornés.

On peut réduire une table de motifs par permutations des trois arêtes. Il faut conserver la permutation inverse et sa parité : une permutation impaire inverse le winding. Les coordonnées barycentriques des sous-patches se composent par multiplication des matrices barycentriques ; si B contient les sommets d’un sous-patch en coordonnées du parent, un point local b devient Bb dans le parent, avec la convention colonnes.

Une quantification barycentrique doit garantir qᵢ≥0 et Σqᵢ=Q exactement ; les points d’arête doivent garder leur composante nulle. La méthode des plus grands restes fournit une référence déterministe. Deux chemins de subdivision qui arrivent au même point partagé doivent appliquer le même arrondi canonique.

Une subdivision peut cesser de progresser lorsque les positions quantifiées des enfants égalent celles du parent ou fusionnent entre elles. Détecter cet état, les dégénérés, la profondeur maximale et le budget. Retourner un statut « tolérance non atteinte » ou un repli complet plutôt que réinjecter éternellement la même tâche.

Tests : permutations et réflexions des trois arêtes, facteurs au plafond, arête partagée inversée, tous les points proches d’une unité de quantification, deux niveaux donnant le même patch, déplacement discontinu et changement de frame. Vérifier bord commun, aire orientée, somme barycentrique et terminaison.

## 14. Courbes : tuiles, couverture et identité

Une courbe épaisse peut produire des listes de segments par tuile : bornes élargies par le rayon et le filtre, comptage, scan, puis scatter. Pour une courbe longue, une marche incrémentale dans les tuiles évite parfois de visiter toute l’AABB ; pour un bouquet compact, l’AABB collective peut être moins coûteuse. Comparer les deux sur segments longs et minces puis bouquets denses.

Un segment dont les deux extrémités se projettent au même point doit devenir une primitive ponctuelle avec rayon ou un cas explicitement ignoré si son domaine le permet ; il ne doit pas normaliser une direction nulle. Un plafond de pas impose subdivision ou statut incomplet, sans disparition silencieuse. Une largeur minimale pour stabiliser des ombres modifie la couverture : elle est une approximation distincte du rayon géométrique.

La segmentation ne doit pas multiplier artificiellement l’opacité d’une même courbe. Regrouper ses contributions par identité stable avant composition. La référence peut mesurer l’union de ses empreintes dans un pixel ; additionner naïvement les contributions des segments aux jonctions surcompte la couverture. Une déduplication probabiliste peut sous-estimer les contributions et requiert une mesure d’erreur.

Un modèle statistique optionnel est α=1−exp(−W), où W≥0 représente une épaisseur optique ou un paramètre calibré de densité des lignes. Il sature, reste dans [0,1] et vaut approximativement W pour W petit. Il ne représente pas l’aire exacte d’un ensemble arbitraire de courbes et ne résout pas l’ordre de plusieurs couches. Comparer au suréchantillonnage géométrique et distinguer couverture, profondeur et matériau dominant.

Tests : une courbe divisée en 1, 2 puis 32 segments, jonction aiguë, croisement de deux courbes différentes, rayon nul, bouquet dense, segment parallèle à l’axe de vue et très longue projection. Mesurer invariance à la segmentation, silhouette et saturation des listes.

## 15. Voxels : traversée, contact et opacité

La marche de grille conserve pour chaque axe le prochain paramètre de frontière tᵢ et l’incrément Δtᵢ=hᵢ/|dᵢ|, où hᵢ est la taille de cellule et dᵢ la composante de direction. Le prochain événement est min(tₓ,tᵧ,t_z). Pour dᵢ=0, l’axe ne progresse pas et sa prochaine frontière est +∞.

Définir le traitement des égalités : pour des cellules semi-ouvertes et un segment d’intérieur, avancer simultanément les axes atteints évite les intervalles de longueur nulle. Si un simple contact de frontière doit compter, visiter aussi les cellules de contact selon une règle conservative. Un rayon exactement posé sur un plan de grille exige la même convention. Remplacer arbitrairement une direction nulle par un epsilon change le rayon et n’est pas une preuve de correction.

Dans une grille hiérarchique, un bloc vide saute directement à sa sortie ; un bloc occupé descend, puis reprend au bon intervalle du parent. Transformer un rayon par l’inverse d’une transform affine en gardant la direction non normalisée conserve son paramètre t. Si la direction locale est normalisée, convertir aussi les intervalles et les distances. Une cellule occupée constitue un candidat : pour des listes de surfaces, le premier objet intersecté n’est pas forcément le plus proche tant que l’intersection est au-delà de la cellule courante.

Occupation, premier contact opaque et atténuation volumétrique sont trois contrats différents. Pour un milieu homogène d’extinction σ≥0 sur une longueur ℓ≥0, T=exp(−σℓ), α=1−T. Sur plusieurs cellules, T_total=∏Tᵢ=exp(−Σσᵢℓᵢ). Cette composition est indépendante du découpage lorsque les coefficients décrivent le même milieu. Une statistique de normales seule ne fournit pas σ ni une règle de surface.

Tests : rayon axis-aligned, origine sur frontière, passage par arête ou coin, signe de direction inversé, zéro et très petite composante, transform non uniforme, bloc vide entre deux blocs pleins. Comparer les intervalles à une référence intersection rayon–cellule. Pour l’atténuation : σ=0 donne T=1 ; σ=2,ℓ=0.5 donne exp(−1), identique après séparation en deux demi-intervalles.

## 16. Déformation et diagnostics transversaux

Les besoins d’animation sont l’union de toutes les passes consommatrices, y compris ombres cachées et rayons. L’historique précédent n’est requis que pour les passes temporelles, mais le présent peut rester requis hors écran. Deux LOD peuvent employer des sous-ensembles d’os différents : évaluer les dépendances d’os de leur union, pas uniquement celles du mesh affiché.

Les historiques doivent porter une révision de géométrie, de pose et de paramètres de déformation. Une pose précédente éloignée de plusieurs mises à jour ou une courbe de déformation précédente inconnue ne permet pas une vélocité correcte ; réinitialiser l’historique explicitement. Tester disparition/réapparition, saut de pose, LOD de rayons différent et mouvement de la forme de déformation elle-même.

Pour chaque liste, enregistrer capacité, demande brute, compte publié, maximum observé, nombre de débordements et âge de la dernière donnée. Distinguer surcoût de raster, évaluation de couverture, quads auxiliaires, étapes de traversal, défauts de pages et reconstructions d’accélérations. Les compteurs activés peuvent modifier les performances ; fournir une mesure avec instrumentation et une sans, sur les mêmes scènes.
