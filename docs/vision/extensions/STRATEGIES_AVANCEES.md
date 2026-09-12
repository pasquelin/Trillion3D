# Stratégies de rendu à conserver pour les étapes avancées

> Conception Web Geometry : ce chapitre décrit des contrats et algorithmes proposés. Voir [l’état de l’implémentation](../../../packages/README.md).

Ce chapitre complète le socle avec les stratégies utiles lorsque le coût des instances, des petits triangles ou des ombres domine. Ce sont des variantes à développer et à mesurer, avec des replis définis. Aucun chiffre de performance observé dans une autre réalisation n'est transférable à notre moteur.

## 1. Trois chemins de raster selon le travail projeté

La distance seule ne prédit pas le coût : un grand triangle lointain peut encore couvrir beaucoup de pixels, tandis qu'une petite instance proche peut rester peu coûteuse. Évaluer par vue l'empreinte de l'instance, les arêtes et aires projetées des triangles, la boîte du cluster, les états de matériau et les capacités du backend.

| Chemin | Travail visé | Conditions |
|---|---|---|
| Raster matériel | grands triangles, clipping et matériaux complexes | référence générale, compatible avec les passes du moteur |
| Raster logiciel | petits triangles dont le parcours des pixels coûte moins que le traitement matériel | couverture, profondeur/ID et progression démontrées |
| Imposteur | instance entière ne couvrant qu'une faible zone de l'image | représentation précalculée compatible avec l'angle, la déformation et le matériau |

Le routage attribue chaque élément à un chemin unique, avec compteurs et capacités propres. Composer les résultats par profondeur avec une règle commune pour l'égalité, les IDs, les masques et les échantillons. Une transition d'un chemin à l'autre ne doit ni dessiner deux fois la même surface ni laisser un trou. Les seuils sont des paramètres de benchmark, accompagnés d'une hystérésis.

Pour une borne projetée de largeur `w_px` et hauteur `h_px`, `A_box=w_px*h_px` est une mesure d'aire en pixels carrés. Un seuil d'aire ne se compare pas à une longueur. La boîte surestime parfois fortement la surface visible ; comparer à des estimations de couverture plus fines seulement après la référence. Une borne croisant le proche ou une projection non traitée revient au chemin matériel.

Un raster logiciel portable de référence peut affecter un échantillon à un seul calculateur, qui parcourt les triangles candidats de sa tuile et conserve ensemble le meilleur couple profondeur/ID. Il évite les écritures concurrentes de ces deux champs, au prix d'un binning et de listes potentiellement coûteux. La saturation d'une liste déclenche un repli complet. Une variante à atomiques doit démontrer séparément le couplage, les égalités et la progression ; deux mots atomiques indépendants ne suffisent pas.

**Inspection d'une coupe figée :** déplacer la caméra sans recalculer les LOD peut transformer des microtriangles en triangles couvrant de grandes surfaces. Conserver le culling/LOD figé pour le diagnostic, mais recalculer le routage raster ou forcer le matériel. Un mode d'inspection ne doit pas lancer des parcours de pixels non bornés.

## 2. Imposteurs : définition et domaine

Un imposteur remplace une géométrie par une représentation échantillonnée depuis plusieurs directions. Il est particulièrement utile lorsque la hiérarchie atteint son niveau terminal alors que l'objet ne couvre plus que quelques pixels. Supprimer cet objet parce qu'il est petit peut supprimer un élément structurel visible, par exemple une section de mur.

Deux représentations sont distinctes :

- **Imposteur de shading** : masque de couverture, couleur ou paramètres de matériau, normale et éventuellement profondeur. Un éclairage précalculé limite les changements d'éclairage futurs.
- **Imposteur de visibilité** : masque, profondeur et identité de primitive. Les attributs et matériaux sont ensuite retrouvés dans la géométrie de référence. Les données nécessaires à cette reconstruction doivent être résidentes ; l'atlas seul ne remplace pas ces dépendances.

Les captures peuvent être distribuées sur une couronne autour d'un axe ou sur toute la sphère. La couronne coûte moins, mais ne couvre pas les vues plongeantes ou par-dessous : définir une plage angulaire et un repli hors de cette plage. Un atlas sphérique peut utiliser les coordonnées octaédriques définies dans les calculs, sans supposer que les texels représentent des angles solides uniformes.

Le domaine initial est statique et opaque ou à masque explicitement capturé. Un changement de géométrie, de masque, de matériaux précalculés ou de déformation invalide l'atlas. L'éclairage et les normales sont traités selon le repère et les propriétés réellement stockés. Les ombres, le picking et la vélocité nécessitent leurs propres règles de reconstruction.

## 3. Construction d'un atlas et reconstruction

Pour une direction de capture, définir une base orthonormale `(right,up,forward)`, une origine `C`, des bornes orthographiques et une convention de profondeur. Pour une position locale `P` :

`x=dot(P-C,right)`, `y=dot(P-C,up)`, `z=dot(P-C,forward)`.

Une profondeur capturée permet de reconstruire `P=C+x*right+y*up+z*forward`, puis de la projeter avec les matrices courantes de l'instance et de la vue. Un texel vide est identifié par un masque ou une sentinelle explicite, jamais par une profondeur valide ambiguë. L'identité discrète d'une primitive ne s'interpole pas entre texels.

En perspective, la vue locale d'une instance affine s'obtient en transformant la position caméra par l'inverse de la transform d'instance avant de former sa direction vers l'objet. En orthographique, transformer la direction des rayons par l'inverse de la partie linéaire, sans translation, puis normaliser : déplacer latéralement la caméra sans la tourner ne change pas la direction de capture. Le signe objet-vers-caméra ou caméra-vers-objet doit correspondre à celui des captures. Ne pas utiliser la transform de normales pour transformer un rayon. Une matrice singulière rend ce chemin indisponible. La normale reconstruite utilise l'inverse-transposée avant normalisation.

Pour choisir entre des captures voisines, trois stratégies sont possibles : choisir la direction la plus proche, reconstruire plusieurs échantillons puis choisir une surface cohérente, ou distribuer les directions par tramage. Le tramage peut conserver une moyenne mais ajoute bruit et instabilité temporelle ; il ne garantit pas une silhouette exacte. Les IDs de primitive et les profondeurs de surfaces différentes ne se mélangent pas comme des couleurs.

La parallaxe exige d'interroger la profondeur capturée le long du rayon courant. Un parcours borné compare la profondeur du rayon à celle de l'atlas, détecte un croisement puis affine l'intervalle. Les texels vides, discontinuités, rayons rasants et surfaces nouvellement visibles demandent un échec explicite ou une capture alternative. Une hauteur unique par texel ne représente pas toutes les couches cachées : garder un repli géométrique si la qualité demandée ne peut être tenue.

Le rectangle support de l'imposteur n'est pas la surface de l'objet. Une profondeur plate de billboard ne constitue pas une preuve d'occlusion de la géométrie originale. Le chemin de référence exclut ces approximations des occluders Hi-Z tant que leur couverture et leur profondeur conservatrices ne sont pas démontrées. Le simple fait que le rendu couleur semble correct ne suffit pas.

Coût d'un atlas : `directions * largeur * hauteur * octets_par_texel`, augmenté des mipmaps, bordures, masques et métadonnées. L'atlas de visibilité ajoute les pages de géométrie/attributs nécessaires au shading. Fixer un budget et mesurer la résidence permanente, la génération, le chargement et le coût de changement de direction.

**Recette :** vues polaires et rasantes, silhouettes fines et trous, instances réfléchies ou non uniformément mises à l'échelle, changements de matériau, voisins répétés, transition LOD, désoccultation, profondeur, identité et bruit temporel. Comparer à la géométrie complète, avec mesures de pixels manquants et de discontinuité aux transitions.

## 4. Hiérarchie d'instances et représentations de groupes

Réutiliser un asset économise la géométrie, pas le coût de toutes ses instances. Pour `N` transforms affines contenant douze scalaires f32, les matrices seules occupent `48*N` octets, avant identité, matériau, bornes et alignements. Une scène de très nombreuses instances peut devenir limitée par ces données même si chaque instance est simple à dessiner.

Une hiérarchie d'instances rejette des ensembles par leurs bornes avant de lire les instances fines. Une représentation grossière de groupe remplace collectivement plusieurs instances par un proxy. Ce remplacement est distinct de la hiérarchie des clusters d'un asset : préserver l'identité des régions, la couverture et la transition de tout le groupe.

Les proxies peuvent être partagés si leur contenu et leurs transforms relatives sont identiques. Une fusion arbitraire crée des données uniques qui consomment du stockage et du temps de compilation. Choisir le niveau de fusion avec coût mémoire, erreur projetée, temps de streaming et fréquence de réutilisation, sans supposer que la fusion améliore toujours le système.

Le picking peut revenir aux objets d'origine par une correspondance ou par une requête sur les géométries éditables. Une modification d'une instance invalide les proxies de ses ancêtres concernés, pas tous les assets partagés. Garder le proxy précédent seulement si son contrat autorise cette latence ; sinon utiliser les enfants complets.

## 5. Parcours GPU par niveaux ou par file persistante

La référence par niveaux produit une liste de nœuds à visiter, traite cette liste, compacte les enfants admissibles, puis lance le niveau suivant dans un dispatch séparé. Elle offre des frontières de synchronisation explicites. Chaque capacité, le nombre de niveaux et les compteurs sont bornés ; la profondeur de la hiérarchie ne doit pas créer une boucle infinie.

Une file persistante réutilise un ensemble de groupes GPU : retirer un travail, le traiter, puis ajouter ses enfants. Elle peut réduire les temps entre niveaux et mieux distribuer des sous-arbres de tailles différentes. Elle exige cependant un protocole de publication et de terminaison compatible avec le modèle mémoire et les garanties de progression de la plateforme.

**File vide ne signifie pas terminé** : des travailleurs peuvent encore produire des enfants. La terminaison observe ensemble les travaux publiés, réservés et actifs. La réservation d'un emplacement n'autorise pas sa lecture avant publication de son contenu. Ajouter des atomiques à un compteur ne remplace pas l'ordre mémoire des données.

Les attentes entre groupes peuvent bloquer si les groupes dont elles dépendent ne sont pas programmés. Aucun résultat historique sur un autre GPU ne garantit cette propriété sur WebGPU. Pour le socle portable, conserver les dispatchs successifs ; n'activer une file persistante qu'avec un protocole démontré, une limite de travail et un repli testé.

Une réservation par sous-groupe ou workgroup réduit la contention : compter les lanes admissibles, réserver une plage de cette taille, puis attribuer à chaque lane son rang dans le groupe. Cette variante conserve l'ensemble des sorties, pas forcément l'ordre global. Ne pas supposer une taille de sous-groupe fixe ni utiliser un indice global comme masque de lane.

## 6. Ombres virtuelles paginées

Une carte d'ombre virtuelle partage la texture logique d'une lumière en pages. Les pages de profondeur d'ombre sont distinctes des pages de géométrie ; leurs demandes, tables, générations et budgets ne sont pas interchangeables.

Référence : reconstruire les surfaces réceptrices de l'image, les projeter dans chaque lumière pertinente, choisir le niveau de détail de la carte, marquer les pages nécessaires, réutiliser les pages valides du cache, puis allouer et rendre les pages manquantes. Les objets hors du frustum caméra peuvent toujours occulter une lumière : rechercher les occluders depuis la vue d'ombre et les pages demandées.

Avec coordonnées d'ombre normalisées `(u,v)` et dimensions du niveau de base `(W,H)`, une estimation de l'empreinte d'un pixel est :

`rho=max(norm((W*du/dx,H*dv/dx)), norm((W*du/dy,H*dv/dy)))`.

Un choix initial est `lod=clamp(floor(log2(max(rho,epsilon)))+bias,0,lod_max)`. Les unités sont des texels du niveau de base par pixel caméra. Définir filtres, biais et marges : les empreintes rasantes, discontinuités et frontières de surface peuvent rendre cette estimation instable. Une approximation ne tenant compte que de la projection est une variante de qualité, pas une borne générale.

Pour une page de côté `P`, le texel entier `(i,j)` donne page `(floor(i/P),floor(j/P))` et position locale `(i mod P,j mod P)`. Les accès filtrés doivent aussi disposer des pages voisines ou d'une bordure valide. Un texel jamais produit ne doit pas être traité comme un cache valide.

Une lumière ponctuelle utilise plusieurs directions, une lumière directionnelle peut employer des zones emboîtées autour de la caméra. Stabiliser leurs origines sur la grille limite les changements inutiles ; tout recyclage de page reste protégé par génération. Les dimensions, nombres de zones et biais sont des paramètres, pas des constantes héritées d'une autre réalisation.

Le cache est invalidé par modification de lumière/projection, mouvement d'un occluder, déformation, masque alpha, matériau de couverture, génération d'asset ou représentation géométrique pertinente. Pour un mouvement, invalider les pages recouvertes par les anciennes et nouvelles bornes conservatrices. Ne considérer que les objets visibles dans l'image manquerait des ombres.

Une page nouvelle, recyclée ou invalidée est remise à la profondeur de fond de sa convention, puis reconstruite avec tous les occluders actuels pertinents. Un nouveau depth test seul ne retire pas l'ancienne profondeur d'un objet disparu. La page devient valide après achèvement, avec sa génération ; tester la disparition de son unique occluder et la réaffectation du slot à une autre page virtuelle.

Le culling peut tester le recouvrement entre la borne projetée d'un cluster et le masque des pages demandées. Pour le raster, soit traduire chaque pixel virtuel vers sa page physique, soit produire un travail par page recouverte avec un rectangle de clipping. La duplication de géométrie et la traduction par pixel ont des coûts différents à mesurer.

Regrouper les vues dans un même flux réduit les soumissions, mais chaque travail conserve son ID de vue, ses matrices, son seuil et ses destinations. Prévoir des budgets par vue pour éviter qu'une lumière monopolise les capacités. Si le budget d'ombre est dépassé, réduire explicitement la résolution ou employer le chemin d'ombre de secours ; ne jamais réutiliser une profondeur obsolète comme si elle était correcte.

**Recette :** occluder hors champ, lumière mobile, objet animé, alpha percé, page filtrée en bordure, caméra téléportée, deux vues, changement de LOD, saturation et recyclage. Vérifier l'image d'ombre, le coût des demandes, les pages rendues, le taux de réutilisation et la mémoire totale.

## 7. Frontières entre assets assemblés

La grille commune d'un asset ne garantit pas automatiquement l'alignement entre deux assets. Pour des grilles `origin_A+step*q` et `origin_B+step*q`, une même orientation et `origin_B-origin_A=step*k` avec `k` entier donnent le même réseau de positions. Une translation ou une échelle quelconque peut rompre cette propriété.

Une rotation qui permute ou inverse les axes peut conserver le réseau entier, mais les règles d'arrondi aux demi-pas doivent aussi rester cohérentes. Avec l'arrondi `floor(x+0.5)`, l'inversion de signe n'est pas équivalente aux demi-entiers. Pour garantir une frontière commune, produire ses entiers une seule fois dans un repère canonique, puis transporter ces entiers dans les représentations compatibles ; ne pas faire deux arrondis indépendants.

Des grilles alignées garantissent seulement la reconstruction des positions communes concernées. Des simplifications indépendantes ou des décisions LOD différentes peuvent encore modifier la frontière. Trois stratégies explicites : conserver le contour partagé à tous les niveaux, construire un remplacement collectif au niveau de l'assemblage, ou accepter une erreur de jonction mesurée avec une technique de raccordement dédiée. Une jupe masque certains trous mais ajoute une surface et peut produire des ombres ou recouvrements incorrects.

**Recette :** deux modules contigus, translation d'un pas et d'un demi-pas, échelle différente, rotation/reflet, coordonnées au demi-entier et niveaux de détail voisins. Tester les positions décodées et les frontières raster, pas uniquement les paramètres de quantification.

## 8. Progrès de simplification et plan de mesure

L'absence de progrès et un progrès faible sont deux cas différents. Si aucune contraction admissible ne réduit la géométrie, arrêter. Si chaque étape réduit un peu la géométrie, un minimum de gain trop exigeant peut interrompre une suite qui aurait fini par être utile. Comparer budget total, stagnation sur plusieurs étapes, erreur accumulée et réduction finale, avec garde de terminaison.

Ajouter aux expériences : routage matériel/logiciel/imposteur, coût des instances et proxies, parcours par niveaux/persistant, ombres paginées et alignement inter-assets. Mesurer séparément préparation, stockage, mémoire résidente, CPU, GPU, qualités de silhouette/profondeur/ombre et transitions. Une stratégie reportée conserve sa référence, son domaine et sa recette même si elle n'est pas activée dans la première version.
