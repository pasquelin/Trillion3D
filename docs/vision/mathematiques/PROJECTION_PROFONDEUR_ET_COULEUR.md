# Projection, profondeur et couleur entre chemins de rendu

> Conception Web Geometry : ce chapitre décrit des contrats et algorithmes proposés. Voir [l’état de l’implémentation](../../../packages/README.md).

Ce chapitre complète les calculs essentiels avec des références permettant de comparer matériel, logiciel et imposteurs sans changer silencieusement les conventions. Les garanties sont limitées aux domaines mathématiques indiqués ; le backend réel doit encore être testé.

## 1. Rectangle perspective d'une sphère

Soit un centre vue `(x,y,z)`, une profondeur positive, un rayon `r>=0`, un proche `n>0` et `z-r>n`. Pour une perspective conventionnelle sans cisaillement, les extrêmes du rapport horizontal `X/Z` sont :

`u_min=(x*z-r*sqrt(x²+z²-r²))/(z²-r²)`.

`u_max=(x*z+r*sqrt(x²+z²-r²))/(z²-r²)`.

Les extrêmes verticaux se calculent en remplaçant `x` par `y`. Appliquer ensuite focale, centre de projection et convention de viewport. Avec des focales positives et des coordonnées écran vers le haut, `pixel_x=fx*u+cx` et `pixel_y=fy*v+cy`. Arrondir les bornes vers l'extérieur et ajouter les marges numériques/échantillonnage nécessaires.

La formule vient des rayons tangents au cercle obtenu en projetant la sphère sur le plan horizontal-profondeur. Elle mesure une empreinte, pas une erreur LOD. Un rayon nul donne la projection d'un point. Une sphère croisant le proche, contenant la caméra ou issue d'une transform non traitée conserve un chemin sans rejet jusqu'à un calcul de clipping démontré.

Après une transform affine, le rayon doit être multiplié par une majoration de sa norme opérateur. Pour un objet non uniformément mis à l'échelle, la sphère transformée est une enveloppe de l'ellipsoïde et peut être peu serrée. La référence AABB des calculs reste disponible.

En orthographique : projeter directement `[x-r,x+r]` et `[y-r,y+r]` avec les échelles pixels de la vue. La profondeur n'y diminue pas l'empreinte. Tester sphères hors axe, focales différentes, grands rapports distance/rayon, rayon nul et proximité du plan proche.

## 2. Profondeur normalisée et profondeur vue

Avec proche `n>0`, lointain fini `f>n`, profondeur vue positive `d` et profondeur normalisée standard `q∈[0,1]` :

`q=f/(f-n)-n*f/((f-n)*d)`.

`d=n*f/(f-(f-n)*q)`.

La projection standard ainsi définie donne `q=0` au proche et `q=1` au lointain. Si la projection inversée utilise précisément `q_reverse=1-q`, substituer `1-q_reverse` dans la formule. Ne pas appliquer cette substitution à une projection différente sans la dériver depuis sa matrice.

Cette substitution est algébrique : en flottants, calculer directement la branche inversée préserve les petites valeurs. Pour un lointain fini, `q_reverse=(n/d)*((f-d)/(f-n))` et `d=n/[n/f+(1-n/f)*q_reverse]`. Pour le lointain infini, utiliser directement `q_reverse=n/d` et `d=n/q_reverse`, avec zéro réservé au fond infini. Calculer d'abord `1-n/d`, puis soustraire de 1 peut arrondir une profondeur inversée valide à zéro ; avec `n=0.1` et `d=10^16`, la valeur à conserver est `10^-17`.

Pour un lointain infini, prendre la limite : standard `q=1-n/d`, inversé `q_reverse=n/d`. Le fond inversé nul correspond à une profondeur infinie ; il ne donne pas une position finie à reconstruire. En orthographique standard, `q=(d-n)/(f-n)` et `d=n+q*(f-n)`.

La sensibilité perspective finie vaut `dd/dq=d²*(f-n)/(n*f)`. Une même erreur normalisée déplace donc bien davantage une surface lointaine. Cette dérivée est une approximation locale : pour une borne, reconstruire les deux extrémités de l'intervalle d'erreur en profondeur normalisée.

Sur `b` bits avec tous les niveaux utilisables, le pas est `1/(2^b-1)`. Une sentinelle réservée change le nombre de niveaux ; le format doit le déclarer. L'arrondi au plus proche borne l'erreur normalisée par un demi-pas, hors erreurs arithmétiques. La direction de l'arrondi conservatif dépend du rôle de la valeur et de la convention de profondeur.

Pour Hi-Z standard, la profondeur d'occlusion stockée ne doit pas devenir artificiellement plus proche : la borne lointaine doit couvrir l'incertitude. Inversement, la profondeur la plus proche du candidat ne doit pas devenir artificiellement plus lointaine. Construire le rejet à partir des intervalles de profondeur, puis traduire le sens des comparaisons pour reversed-Z.

Deux formats ayant le même intervalle normalisé n'ont pas nécessairement la même précision. Une profondeur réduite pour un atlas ou un chemin logiciel doit posséder un budget d'erreur et un contrat de composition. Elle ne devient pas équivalente au depth buffer matériel par simple conversion en flottant.

## 3. Reconstruction de position et identité

Depuis un échantillon écran, former ses coordonnées NDC en utilisant viewport, centre d'échantillon, sens vertical et convention Z exacts. Avec profondeur `q`, calculer `h=inverse(viewProjection)*[ndc_x,ndc_y,q,1]`, puis `P=h.xyz/h.w`. Si le domaine Z est `[-1,1]`, convertir d'abord la profondeur vers ce domaine. Une composante `h.w` nulle ou non finie est invalide.

La matrice utilisée est celle qui a réellement produit cette profondeur, jitter compris. Conserver les matrices courantes et précédentes avec leurs générations pour reconstruire la vélocité. Une profondeur d'un autre viewport ou d'une autre projection ne se réinterprète pas directement.

Un visibility buffer fournit l'identité de l'instance et de la primitive, directement ou par table. Reconstruire les trois sommets correspondants et les attributs avec la bonne version de géométrie. La profondeur seule ne retrouve pas une identité perdue, et un ID d'imposteur ne garantit pas une face éditable précise.

La composition entre chemins utilise les mêmes échantillons, conventions et critères d'égalité. Si deux valeurs quantifiées peuvent représenter des surfaces dans un ordre inverse, mesurer ou borner cette ambiguïté. Pour la référence de correction, préférer une précision commune plutôt qu'un tie-break présenté comme une récupération de l'information perdue.

## 4. Atlas angulaire et filtrage

Pour `N>=1` captures disposées régulièrement autour d'un axe, calculer l'azimut relatif `theta` par `atan2(déterminant,produit_scalaire)` des directions projetées dans le plan perpendiculaire à cet axe. Ramener l'angle dans `[0,2*pi)`. Une direction polaire rend l'azimut indéfini : utiliser le repli du domaine de capture.

Poser `t=N*theta/(2*pi)`, `i=floor(t)`, `a=t-i`. Les captures voisines sont `i mod N` et `(i+1) mod N`, avec poids `1-a` et `a`. Tester le passage de la dernière capture à la première. Ces poids interpolent une direction de sélection ; ils ne prouvent pas que l'interpolation de deux images restitue la surface intermédiaire.

Les normales sont décodées, exprimées dans le même repère, interpolées puis normalisées ; une somme nulle utilise une politique explicite. Les entiers empaquetant profondeur, normale ou ID ne sont pas filtrés comme une texture de couleur. Chaque canal possède son format et sa règle de reconstruction.

Les mipmaps et le filtrage d'atlas ne doivent pas mélanger deux captures étrangères. Utiliser des couches distinctes ou des bordures suffisantes à tous les niveaux. Les masques de couverture restent cohérents avec la profondeur. Un tramage de direction a une distribution déclarée et une stabilité temporelle testée, distinctes du bruit ajouté à la couleur.

## 5. Contrat de matériau commun

Le moteur conserve d'abord les matériaux Three.js compatibles comme référence. Un shader pédagogique indépendant sert à isoler les calculs ; il ne remplace pas implicitement le modèle complet d'un matériau de production.

La réflexion lambertienne vaut `albedo/pi`. Un terme microfacette spéculaire s'écrit `D(H)*F(V,H)*G(L,V)/(4*(N·L)*(N·V))`, dans le domaine où les deux cosinus sont positifs. `L`, `V`, `N` et le demi-vecteur `H=normalize(L+V)` ont des conventions explicites ; `L+V=0` et les directions sous la surface sont traités avant toute division.

Une référence GGX isotrope avec paramètre de distribution `alpha>0` emploie :

`D(H)=alpha²/(pi*((N·H)²*(alpha²-1)+1)²)` sur l'hémisphère de la normale.

Pour `c=N·X>0`, une atténuation Smith monodirectionnelle est `G1(X)=2*c/(c+sqrt(alpha²+(1-alpha²)*c²))`. Une variante séparable utilise `G=G1(L)*G1(V)` ; d'autres modèles corrélés donnent des résultats différents.

L'approximation de Fresnel de Schlick est `F=F0+(1-F0)*(1-clamp(V·H,0,1))^5`. Définir séparément conversion de la rugosité artistique vers `alpha`, propriétés métal/diélectrique et combinaison diffuse/spéculaire. Un plancher de rugosité est une régularisation visible et doit être annoncé. La combinaison de ces expressions n'est pas une preuve automatique de conservation d'énergie pour tous les matériaux, notamment sans compensation des rebonds multiples.

Les normales, masques, UV et paramètres de distribution sont des données. Les textures de couleur sont converties depuis leur espace déclaré vers l'espace linéaire de travail avant éclairage. Composer les passes en linéaire, appliquer une seule exposition et une seule transformation d'affichage. Une simple puissance gamma n'est pas la définition exacte de toutes les fonctions de transfert couleur.

Les images de comparaison doivent partager matériaux, lumières, exposition, tone mapping, bruit et résolution. Fournir aussi des sorties linéaires sans tone mapping ni tramage pour isoler les erreurs. Comparer un shader sans texture à un matériau complet ne mesure pas un gain de rendu à qualité constante.

## 6. Recette

Vérifier projection de points de sphère contre rectangle analytique ; proche, lointain, infini et reversed-Z ; quantification par intervalles ; reconstruction puis reprojection ; jitter et dimensions impaires ; voisinage de captures angulaires ; ID de fond ; trou de masque ; limites d'atlas ; normale opposée ; éclairage et couleur identiques entre chemins.

Les approximations de panneaux, faible profondeur, filtrage ou matériaux restent des variantes nommées avec mesures de qualité. Les calculs conservatifs du socle continuent de décider les rejets garantis.
