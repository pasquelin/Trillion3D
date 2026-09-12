# Schémas de fonctionnement et dérivées

> Conception Web Geometry : ce chapitre décrit des contrats et algorithmes proposés. Voir [l’état de l’implémentation](../../../packages/README.md).

Ces schémas décrivent directement notre organisation géométrique, les transitions et les calculs de filtrage. Ils ne demandent aucun document extérieur.

## 1. Remplacement collectif et coupe de détail

```text
Géométrie fine             Remplacement intermédiaire           Grossier
enfants A B C D     →      parents E F issus du même groupe  →   parent G

Coupe valide 1 : {A,B,C,D}
Coupe valide 2 : {E,F}
Coupe valide 3 : {G}
Coupe à vérifier/rejeter : {A,B,F} si A,B ne remplacent pas seuls E
```

Les diagrammes de construction montrent pourquoi les frontières internes doivent pouvoir changer de place. Verrouiller à jamais chaque frontière de cluster accumule des détails impossibles à simplifier. Le regroupement verrouille le contour du groupe, libère les anciennes frontières internes, puis découpe de nouveaux clusters.

Une coupe peut mélanger plusieurs niveaux dans des régions indépendantes. Elle ne peut pas mélanger arbitrairement des morceaux d'un remplacement collectif. Chaque transition doit conserver une surface complète et des frontières compatibles.

## 2. Erreur monotone et transition unique

```text
chemin racine → feuilles : score 9 → 4 → 1 → 0
seuil 2                  : refuse → refuse → accepte → déjà couvert

score fautif             : 9 → 1 → 4 → 0
                         : plusieurs transitions possibles
```

Le scalar objet seul n'est pas suffisant : la projection et les bounds qui l'accompagnent doivent préserver l'ordre. La distinction entre monotonie et majoration de l'erreur réelle est détaillée dans le document des calculs.

## 3. Occlusion en deux passages

```text
géométrie courante + historique
            |
     test de priorité
       /          \
probablement    rejetés provisoires
visibles              |
   |                  |
raster courant        |
   |                  |
Hi-Z courant ---------+
   |                  |
   +------ retest courant
                      |
                 désoccultés
                      |
                 raster complémentaire
```

La profondeur précédente ne constitue pas une preuve lorsque l'occluder, l'objet ou la caméra bouge. La deuxième passe utilise la scène actuelle. Les pixels de fond doivent empêcher les rejets à travers une ouverture.

## 4. Dérivées à travers un graphe de matériaux

Chaque valeur de matériau susceptible d'influencer un échantillonnage peut transporter un triplet `(value, dx, dy)`.

```text
sum:     d(a+b) = da+db
product: d(a*b) = b*da+a*db
ratio:   d(a/b) = (b*da-a*db)/b²
sin:     d(sin(a)) = cos(a)*da
sqrt:    d(sqrt(a)) = da/(2*sqrt(a)), si a>0
```

Pour une fonction vectorielle, appliquer la jacobienne. Pour normaliser `n=v/||v||`, `dn=(I-n nᵀ)dv/||v||` si `||v||>0`. Les discontinuités de `floor`, `step`, `fract` aux entiers et les choix conditionnels demandent une politique spécifique de filtrage; une dérivée nulle naïve peut produire de l'aliasing.

Les barycentriques et la correction perspective produisent les gradients UV du triangle visible. Ces gradients parcourent ensuite les transformations de matériau. Les soustractions entre pixels voisins appartenant à deux objets ne reconstruisent pas ces gradients.

Le retour à des différences finies doit rester dans une représentation cohérente de la même surface ou faire partie d'une stratégie de filtrage assumée. Le coût du graphe doit être mesuré pour chaque variante.

## 5. Espace tangent implicite

Pour un triangle, poser `E1=P1-P0`, `E2=P2-P0`, `D1=UV1-UV0`, `D2=UV2-UV0`.

```text
detUV = D1.x*D2.y-D1.y*D2.x
T_raw = (E1*D2.y-E2*D1.y)/detUV
B_raw = (E2*D1.x-E1*D2.x)/detUV
T = normalize(T_raw-N*dot(N,T_raw))
sign = signe de dot(cross(N,T),B_raw)
B = sign*cross(N,T)
```

Si `detUV` est nul ou mal conditionné, ne pas diviser; choisir une base orthonormale de secours ou neutraliser la normal map selon le contrat matériau. La base tangentielle implicite réduit le stockage mais ne reproduit pas forcément une base de tangentes explicites lissée entre faces. Tester les coutures et les assets dont les normal maps ont été calculées avec une base précise.

## 6. Disposition mémoire contre disposition disque

```text
Asset disque : flux groupés par type, répétitions, delta, compression générale
                         |
                   décompression/transcodage
                         |
Asset GPU : blocs adressables, accès aléatoire borné, champs quantifiés
```

Une compression qui maximise le ratio disque peut être impropre à une lecture aléatoire par sommet. Le transcodage transforme le format, il ne doit pas être confondu avec l'upload ou l'allocation de pages. Mesurer les trois coûts séparément et fin à fin.

## 7. Ombres et vues multiples

```text
scène persistante
  ├─ vue principale : résolution écran, LOD, occlusion de la caméra
  ├─ vue d'ombre 1 : résolution texel, projection lumière, autre coupe
  ├─ vue d'ombre 2 : résolution texel, projection lumière, autre coupe
  └─ capture/export : contrats de résolution et de matériaux propres
```

La taille d'un texel d'ombre remplace la taille d'un pixel caméra dans son critère de détail. Le culling de la caméra principale ne peut pas retirer un objet qui projette une ombre visible hors de son frustum. Une table de pages partagée doit tenir compte de l'union des besoins des vues actives.

