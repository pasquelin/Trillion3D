# Assemblages, géométrie procédurale et intégration

> Conception Web Geometry : ce chapitre décrit des contrats et algorithmes proposés. Voir [l’état de l’implémentation](../../../packages/README.md).

Ce chapitre conserve les stratégies nécessaires pour étendre les assets individuels à des assemblages, terrains et ensembles d'instances produits dynamiquement. Les interfaces sont celles de notre conception ; les conventions d'un importeur doivent être converties avant d'entrer dans ce contrat.

## 1. Prototype, instance et assemblage

Un prototype contient une géométrie partagée. Une instance contient une identité, une transform et des affectations de matériaux. Un assemblage décrit plusieurs instances de prototypes et leurs relations ; il ne doit pas transformer chaque occurrence en copie unique de tous les sommets.

Avec vecteurs colonnes, un point du prototype `p` devient `p_world=M_assembly*M_node*M_prototype*p`. Chaque facteur a un repère d'entrée et de sortie déclaré. Pour rattacher un objet de transform monde `M_child` à un assemblage `M_parent`, la transform relative est `inverse(M_parent)*M_child`. Les matrices singulières ne se convertissent pas implicitement.

Une transform propre à une branche ne doit pas être cuite dans un prototype partagé par d'autres branches. Soit la conserver sur l'instance, soit créer une nouvelle variante de prototype identifiée par le contenu transformé. Une même géométrie sous deux sous-arbres de transforms différentes reste une géométrie partageable si les transforms sont composées au bon niveau.

Pour un assemblage imbriqué, parcourir les relations avec un ensemble actif qui détecte les cycles, une profondeur et un budget d'instances. Un nœud partagé peut être visité plusieurs fois avec des transforms différentes : dédupliquer le stockage du prototype, pas les instances réelles. Définir séparément la sémantique d'une référence externe qui remplace un sous-arbre ; ne pas rendre le sous-arbre une seconde fois.

Les parties doivent être construites et validées avant publication de l'assemblage qui les référence. Si une partie n'est pas disponible, appliquer une politique explicite : garder l'ancien assemblage complet, rendre des représentations de secours identifiées, ou refuser la publication. L'absence d'une partie ne doit pas passer pour une optimisation de visibilité.

## 2. Tableaux d'instances et masques

Un import instancié peut fournir `N` transforms, `N` indices de prototype et `N*K` influences ou attributs groupés par instance. `K` est un stride logique déclaré. Un masque de `N` éléments s'applique aux groupes entiers de `K` valeurs, avec exactement le même filtrage sur tous les tableaux associés.

Vérifier la cardinalité avant le filtrage. Après le retrait de `R` instances, les tailles attendues sont `N-R` et `(N-R)*K`. Une suppression dans le tableau des transforms sans la suppression correspondante des influences associe les bonnes données aux mauvais objets.

Si un prototype contient plusieurs géométries avec des transforms propres, une occurrence peut être développée en plusieurs instances finales. Construire un remapping d'un indice source vers une plage d'instances/parties, appliquer les offsets après concaténation et conserver l'identité source. Un indice invalide reste invalide ; il ne doit pas devenir accidentellement l'indice valide d'un autre assemblage.

Les conventions de type des métadonnées sont vérifiées : texte, nombre, enum, chemin et symbole ne sont pas interchangeables. Toute conversion de récupération produit un diagnostic ; un importeur ne doit pas choisir une valeur par défaut silencieuse qui change statique en animé ou inversement.

## 3. Matériaux et paramètres par instance

Trois politiques de fusion de slots sont différentes : identité du matériau, nom de slot, ou indice de slot dans un groupe déclaré. Les deux dernières ne prouvent pas que les matériaux sont équivalents. La politique et le groupe de fusion font partie de la configuration d'import et du cache.

Construire une correspondance totale `slot_local → slot_assemblage`. Une entrée de remplacement absente utilise le matériau de référence annoncé ; une entrée invalide produit un diagnostic. Les états raster effectifs restent calculés après les overrides et la transform d'instance, notamment pour les réflexions et les faces doubles.

Une priorité de paramètres peut être : valeur liée valide, override explicite, matériau du prototype. Cette priorité doit rester la même à l'import, au rendu et à l'export. Des paramètres propres à un émetteur peuvent partager une instance de matériau par émetteur ; des paramètres propres à chaque particule doivent être transportés par instance, sans modifier un matériau global partagé.

Le cache de compilation dépend seulement des paramètres qui affectent géométrie, partitions, couverture ou données précalculées. Le cache d'un atlas de couleur dépend davantage du matériau qu'un cache de positions. Les ressources inutilisées sur une cible ne sont pas chargées uniquement parce qu'un override existe dans les données d'édition.

## 4. Parties attachées à un squelette

Les matrices de liaison du chapitre matériaux convertissent les positions du mesh au repos vers les repères d'os, puis vers le mesh courant. Pour une partie possédant une transform de repos `P_bind`, composer cette transform avant le skinning :

`p_local(t)=sum_j(weight_j*S_j(t)*P_bind*p_part)`.

Cette formule suppose que `P_bind` va du repère de la partie au repère de repos du mesh auquel les `S_j` s'appliquent. Une transform déjà exprimée dans le repère d'un os demande une autre conversion explicite ; appliquer les deux conventions successivement double la liaison.

Une partie rigide attachée à un os a un poids unitaire. Une partie attachée à plusieurs os utilise des poids finis, non négatifs et normalisés. Ce mélange de matrices peut créer cisaillement ou singularité même si chaque os possède une transform rigide ; les bornes et les normales doivent respecter cette réalité.

Les noms d'os sont résolus par identité stable, avec une table de correspondance contrôlée. Un nom ambigu ou absent ne devient pas silencieusement le premier os. Références de sockets, transforms d'offset et bindings multiples ont des contrats distincts. Le test de pose de liaison doit restituer toutes les parties dans leur emplacement de repos.

## 5. Instances issues de particules ou de calculs GPU

Le producteur fournit positions, orientations, échelles, indices de prototype, visibilité, paramètres de matériau et éventuellement état précédent. La normalisation des orientations, la validité des indices et les valeurs par défaut font partie du contrat, indépendamment du lieu d'exécution du producteur.

Distinguer capacité allouée, nombre d'instances vivantes et nombre d'instances effectivement dessinées. Une capacité CPU conservatrice n'est pas un compte GPU exact. Les entrées non produites ne doivent pas devenir des instances visibles à l'origine ; les compteurs et générations sont remis dans un état défini avant production.

Ordre de consommation : simulation courante → production des instances → bornes → culling/LOD → commandes → rendu. Le CPU ne lit pas le compte de l'image courante pour pouvoir dessiner ; les arguments indirects et masques valides sont produits dans l'ordre GPU. Une voie CPU peut préfiltrer visibilité et choix de mesh avant transfert, mais elle conserve le même résultat contractuel.

Les fonctionnalités qui nécessitent toutes les instances côté CPU, comme certains chemins de picking, navigation ou collision, disposent d'une voie dédiée ou sont explicitement indisponibles. Il ne faut pas présenter un readback tardif comme l'état synchrone de la simulation.

Pour la vélocité, conserver identité et état précédent compatibles. Apparition, disparition, changement de prototype ou réutilisation d'un emplacement invalident l'historique de cette instance. Si les transforms précédentes manquent, annoncer la politique choisie au lieu d'inventer un mouvement nul comme donnée exacte.

## 6. Grandes coordonnées et précision

En f32, l'espacement des nombres autour d'une magnitude `2^e` est environ `2^(e-23)`. À des coordonnées de l'ordre de dix millions d'unités, des déplacements millimétriques peuvent disparaître avant même la projection. Soustraire ensuite l'origine caméra ne restaure pas les bits déjà perdus.

Conserver les sommets dans un repère local et composer la translation relative à la vue avec une précision suffisante avant conversion f32. Une autre stratégie sépare une cellule ou une partie haute de coordonnées d'un offset local. Le repère et les unités de chaque producteur CPU/GPU doivent être explicites.

Un changement d'origine actualise ensemble transforms, bornes, caméras, lumières, historiques et adresses spatiales concernées. Les hashes d'asset local ne changent pas si seule l'origine de rendu change ; les caches dépendant du repère monde doivent être remappés ou invalidés. Tester une scène traduite loin de l'origine et comparer positions relatives, culling et mouvements.

## 7. Terrain, collision et mises à jour régionales

Un terrain peut conserver une représentation d'édition et de collision distincte de sa représentation triangulée de rendu. Le proxy de rendu ne devient pas automatiquement la source de collision ou de navigation. Les transitions entre tuiles respectent la stratégie de frontière commune, y compris après déformation ou simplification.

Conserver les normales et les jeux UV utiles, avec une correspondance explicite pour coordonnées de terrain, poids de couches, lightmaps et autres attributs. Un changement de renderer ne justifie pas de recalculer silencieusement des normales ou de réaffecter les canaux UV.

Une édition locale invalide les régions touchées et les ancêtres/proxies qui en dépendent. Compiler en arrière-plan une nouvelle génération, puis remplacer le résultat après validation et cohérence des voisins. Pendant cette compilation, le moteur conserve une représentation autorisée par son contrat d'édition.

La génération du cache comprend export géométrique, sérialisation, paramètres et version du compilateur. Distinguer le cache d'export et celui de géométrie compilée : changer la clé de l'un ne suffit pas à invalider l'autre. Une tentative échouée ne devient pas une entrée saine réutilisable.

## 8. Préparation asynchrone et vie des objets

Ne pas confondre un job en attente d'admission avec un job bloqué pendant son exécution. Le suivi enregistre mise en file, début de phase, progrès réel et fin de phase. Un grand ensemble de jobs en file peut attendre longtemps sans blocage ; un délai mesuré seulement depuis la création produit de faux diagnostics.

L'admission réserve mémoire, threads et nombre de publications simultanées. Une tâche ne doit pas occuper un travailleur tout en attendant un autre travail qui ne pourra démarrer qu'après libération de ce même pool. Les dépendances sont exprimées dans l'ordonnanceur, puis les phases prêtes sont admises.

Les objets de scène et ressources exigés sur le thread propriétaire sont créés ou publiés sur celui-ci. Le travail mathématique parallèle produit des données immuables validées. Une référence chargée n'est pas nécessairement une ressource initialisée : pipeline, matériau et dépendances doivent atteindre leur état prêt avant activation.

La fin d'un job vérifie encore génération, annulation et existence du destinataire. Les callbacks sont désinscrits et les références relâchées une seule fois, même après erreur partielle. Ne pas détruire une structure qui contient le callback en cours avant sa sortie sûre.

## 9. Cache de shading et diagnostic

Un cache de shading par atlas ou par surface doit préserver chart, primitive, matériau et génération. Répliquer la valeur d'un texel voisin pour remplir une bordure peut être acceptable à l'intérieur d'un même domaine ; traverser la frontière de page ou copier un triangle sans relation injecte une autre surface. Définir rayon maximal de remplissage, masque et comportement quand aucun échantillon valide n'existe.

Une vue de diagnostic indique ce qu'elle mesure réellement : instance candidate, cluster sélectionné, primitive rasterisée, pixel ombré, page manquante ou approximation. Les compteurs sont associés au chemin exécuté ; une valeur de capacité n'est pas un nombre de primitives visibles. Capturer les paramètres et générations avec l'image pour qu'un défaut soit reproductible.

## 10. Recette autonome

Tester : prototype partagé sous deux transforms ; assemblage imbriqué et cycle ; masque avec stride supérieur à un ; partie absente ; indices invalides après concaténation ; slots de même nom mais matériaux différents ; pose de liaison et os absent ; compteur GPU inférieur à la capacité ; instance nouvellement créée ; translation monde très grande ; édition d'une tuile ; résultat de compilation périmé ; shutdown pendant publication ; remplissage d'atlas en frontière de chart.

Les enveloppes d'éditeur, modules générés, commandes d'administration et formats de package d'une autre application ne sont pas nécessaires à notre implémentation de ces principes. Ce chapitre conserve leurs enseignements de données, d'ownership et de validation sans reproduire ces mécanismes particuliers.
