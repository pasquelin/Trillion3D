# Contrats d'implémentation et programme de tests — Web Geometry

Spécification de conception, à distinguer des [capacités actuellement implémentées](../../../packages/README.md). Les numéros historiques des sections sont conservés.

Ce document décrit une proposition à implémenter avant toute intégration moteur. Un contrat décrit ici n'est pas une fonctionnalité déjà construite. Les performances des futurs backends sont **non mesurées**.

## 1. Chaîne complète

```text
Import d'asset et validation
  → normalisation des attributs et unités
  → adjacence et clusters feuilles
  → groupes de remplacement, simplification, hiérarchie
  → erreurs, bornes, frontières et tests
  → encodage d'un asset versionné
  → chargement partiel et résidence
  → sélection par vue et culling
  → compaction, bins et indirect
  → rasterisation, matériaux et intégration de scène
  → validation visuelle, profiling et décision
```

Le compilateur et le renderer partagent un **contrat d'asset**, pas leur organisation mémoire interne. Un changement de format invalide les caches et impose des tests de décodage. Le compilateur peut évoluer indépendamment du plugin tant qu'il produit une version reconnue.

## 2. Entrée du compilateur

| Champ | Contrat |
|---|---|
| Positions | finies, unité déclarée, repère documenté |
| Indices | entiers valides, triplets, limites vérifiées sans overflow |
| Normales | présentes ou calculées avec politique de faces dures |
| UV | jeux identifiés, coutures et miroirs conservés |
| Tangentes | signe et convention normal-map déclarés |
| Matériaux | affectation de chaque triangle, alpha mode et faces doubles |
| Transform | baking ou instance déclaré; échelle négative gérée |
| Animation | statique, rigide, skinning, morph, déplacement : statut explicite |
| Provenance | hash du contenu, version importeur, configuration, seed |
| Identité | correspondance source triangle/objet pour picking et diagnostic |

Un hash sur les seuls positions/indices ne suffit pas si la compilation dépend des UV, des matériaux, de la précision ou des poids. Les erreurs de validation produisent des diagnostics explicites, pas un asset apparemment réussi contenant des NaN.

## 3. Résultats du compilateur

Le résultat contient : géométrie encodée, clusters, groupes de remplacement, hiérarchie d'accélération, bornes géométriques et de LOD distinctes, métriques d'erreur, tableaux d'attributs/matériaux, graphe de dépendances, index de pages et manifeste de compilation.

### Header proposé

L'en-tête de référence est celui de [pages et mémoire](../runtime/PAGES_MEMOIRE_ET_CACHE.md) : 64 octets little-endian, signature, versions, tailles, flags et offsets. Le CRC32 appartient à chaque descripteur de section de 40 octets ; les hashes et la configuration appartiennent au manifeste, pas à des champs supplémentaires implicites de l'en-tête. Les offsets u64 se lisent par BigInt ou deux mots; ne pas supposer qu'un Number JavaScript représente tous les entiers u64.

La validation impose `offset <= length` puis `size <= length-offset`, sans addition pouvant déborder. Une section inconnue obligatoire rend le fichier incompatible; une section facultative inconnue peut être ignorée selon le flag défini. La V1 n'a pas besoin de supporter les fichiers supérieurs à la limite effective de la plateforme.

### Exemple de record GPU, proposition non figée

| Octets | Donnée | Type |
|---:|---|---|
| 0–15 | sphere géométrique : centre et rayon | vec4 f32 |
| 16–31 | borne ou référence LOD adaptée au modèle | vec4 f32 |
| 32–47 | erreur, erreur du remplacement, paramètres réservés | vec4 f32 |
| 48–63 | offsets indices/vertices, comptes | vec4 u32 |
| 64–79 | groupe, page, matériau/bin, flags | vec4 u32 |

Ce record pédagogique fait 80 octets, multiple de 16. Il ne prétend pas couvrir l'ensemble d'un DAG en cinq vecteurs : les listes de relations et bornes complètes se trouvent dans des buffers associés. Un indice invalide utilise une sentinelle définie; une erreur racine infinie peut se représenter par un flag plutôt que par un flottant artificiellement gigantesque.

Le writer CPU et le shader doivent partager les offsets; ajouter un test qui remplit chaque champ avec un motif distinct puis le relit sur GPU. `vec3<f32>` a une taille logique de 12 mais un alignement de 16 en WGSL; ne pas déduire le layout GPU de celui des objets du langage hôte.

### ErrorRecord proposé

```text
metric_kind : geometric_bound | geometric_estimate | attribute_score
reference : original_surface | preceding_representation
position_error_object : nonnegative finite scalar
quantization_error_object : nonnegative scalar
attribute_errors : separately named metrics
error_composition_rule : explicit versioned identifier
```

Une mesure échantillonnée de distance à la source reste une estimation sauf certification spécifique. Un poids perceptuel n'est pas une distance en mètres. Ces distinctions doivent survivre à la sérialisation.

## 4. Invariants amont à tester

1. Chaque triangle feuille valide appartient à exactement un cluster feuille de son domaine.
2. Les limites triangles/sommets/offsets sont respectées.
3. Toutes les relations de remplacement pointent vers des éléments existants; le graphe est acyclique.
4. Chaque remplacement représente complètement sa région et conserve son contour externe.
5. Les bounds incluent géométrie reconstruite, erreur admise et déformation autorisée.
6. Les métriques et bornes nécessaires au score LOD respectent la monotonie choisie.
7. Les erreurs zéro, niveaux terminaux et groupes non simplifiables ont des règles d'arrêt explicites.
8. Les duplications d'une frontière produisent les mêmes entiers quantifiés et attributs contractuels.
9. Les pages racines et leur fermeture de dépendances se chargent sans page fine et restent épinglées ; les dépendances ne créent pas de cycle impossible à charger. Avec l'encodage indépendant de référence, cette fermeture se réduit aux racines.
10. Le decode→encode→decode préserve les champs discrets exactement et les champs quantifiés sous tolérance.

Vérifier dans un espace de régions/groupe est plus juste que comparer seulement les IDs de triangles entre niveaux, puisque la simplification change la triangulation.

## 5. Invariants runtime

- La coupe sélectionnée couvre la surface visible une fois, y compris quand des pages sont absentes.
- Une capacité dépassée ne peut pas écrire hors buffer, publier un compteur excessif ou supprimer silencieusement une partie de la coupe.
- Les décisions sont par vue : caméra principale, ombres, réflexion, picking et stéréo n'ont pas forcément le même LOD.
- Une table de pages devient visible au GPU seulement après données et dépendances disponibles.
- Les buffers en vol ne sont ni recyclés ni détruits prématurément.
- La profondeur de culling et celle du raster ont les mêmes conventions et transformations.
- Un rejet conservatif signifie aucune contribution possible; une heuristique de qualité ne se présente pas comme un rejet garanti.
- Les états alpha test, déformation et double face utilisés dans le culling correspondent au raster.
- Une perte de device ou un changement d'asset invalide les handles et reconstruit les ressources proprement.

## 6. Synchronisation WebGPU

Les passes sont ordonnées dans un command encoder : reset des compteurs, compute de sélection, compaction, finalisation indirect, raster. Une écriture CPU `queue.writeBuffer` doit être placée conformément au calendrier de soumission; ne pas réutiliser une même zone de frame sans modèle d'ownership.

Le scan workgroup utilise des barrières uniformes. Les opérations globales utilisent des dispatchs successifs. Une invocation qui publie un compteur ne publie pas magiquement toutes ses données sous n'importe quel protocole; concevoir le consommateur dans une passe postérieure évite cette ambiguïté.

Les readbacks passent par des buffers compatibles et sont asynchrones. L'image ne dépend pas de leur résultat. Les contrôles de validation peuvent attendre le GPU dans un banc de correction, jamais être cachés dans la fenêtre d'un benchmark de performance.

L'utilisation de subgroups, de timestamps et des chemins indirects dépend des capacités réellement exposées. Un feature flag doit sélectionner un fallback testé, pas contourner silencieusement une fonction obligatoire.

