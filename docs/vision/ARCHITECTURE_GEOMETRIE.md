# Définition de référence du système de géométrie virtualisée

> Conception Web Geometry : ce chapitre décrit des contrats et algorithmes proposés. Voir [l’état de l’implémentation](../../packages/README.md).

Ce document fixe une implémentation de départ testable, avec des décisions explicites. Les choix sont des propositions pour le projet. Ils ne constituent ni un moteur déjà intégré ni une preuve de performance. Les exemples sont des algorithmes pédagogiques indépendants; les documents de calculs et de contrats définissent les garanties à implémenter.

## 1. Domaine de la première implémentation

Géométrie triangulée statique ou transformée rigidement, matériaux opaques, projection perspective et orthographique, une ou plusieurs vues traitées séparément. Rasterisation matérielle, assets entièrement résidents dans la première étape. Le fallback conserve le rendu Three de référence.

Transparence triée, alpha test, skinning, morphs, déplacement dynamique, ray tracing et voxels ont des chemins d'extension distincts. Le renderer détecte explicitement ces cas et conserve leur représentation existante tant que leur recette n'est pas validée. Ne pas les traiter silencieusement comme des meshes statiques opaques.

La géométrie virtualisée ne fournit pas l'ensemble du moteur : édition, scripts de jeu, audio, physique, import complet des formats et UI restent les services existants. Ce dossier définit le sous-système géométrie/rendu et ses interfaces avec ces services.

## 2. Modules et fonctions publiques proposés

| Module neutre | Fonctions | Ownership / résultat |
|---|---|---|
| `MeshCompiler` | `validateInput`, `compile`, `cancel`, `estimateCost` | prend des buffers transférés ou un fichier immuable; produit un asset |
| `AssetValidator` | `validateHeader`, `validateSections`, `validateHierarchy` | données en lecture seule; diagnostics structurés |
| `GeometryAsset` | `getMetadata`, `retain`, `release` | représente une géométrie compilée partagée |
| `VirtualGeometryObject` | `setTransform`, `setMaterialMap`, `setVisible` | identité d'instance éditable, référence d'asset |
| `ResidencyManager` | `request`, `publish`, `pin`, `evict`, `invalidate` | possède tables et allocations de pages |
| `GeometrySelector` | `selectReference`, `selectGPU` | produit une coupe pour une vue et une version de scène |
| `ThreeGeometryAdapter` | `prepareFrame`, `renderView`, `dispose` | adapte buffers et passes aux capacités du driver |
| `GeometryDiagnostics` | `captureCut`, `captureCounters`, `validateFrame` | readback facultatif, hors fenêtre de performance |
| `GeometryJobScheduler` | `submit`, `reserve`, `cancel`, `shutdown` | borne la concurrence et les pics mémoire |

Les noms sont proposés; ils doivent respecter la structure du moteur lors de la future spécification. `VirtualGeometryObject` peut être un adaptateur Object3D, sans nécessiter une modification globale de Three ni une classe dérivée de Mesh supposée compatible avec toutes les passes.

## 3. Construction déterministe des feuilles

1. Vérifier chaque scalaire et indice; trier les diagnostics par triangle/attribut pour une sortie reproductible.
2. Construire des IDs de position et des IDs d'attribut distincts. La V1 ne soude pas automatiquement des positions proches : l'égalité choisie fait partie du contrat import.
3. Construire la table des arêtes orientées et non orientées. Classer frontières ouvertes, coutures et arêtes non manifold.
4. Partitionner d'abord par contraintes de matériau/attribut, puis spatialement.
5. Baseline sans bibliothèque de graphes : départ par plus petit ID de triangle non affecté, croissance aux voisins qui ajoutent le moins de nouveaux sommets sous plafonds. Départ d'un nouveau cluster si aucune addition n'est admissible. Le départ par clé Morton ou la minimisation de frontière sont des variantes distinctes, à nommer dans la configuration.
6. Briser les égalités par ID d'entrée, jamais par ordre de hachage non déterministe.
7. Produire remapping global→local, indices locaux, liste des voisins et bounds.

Une clé Morton 3D s'obtient en normalisant chaque axe dans une plage entière, puis en entrelaçant les bits. Un axe d'étendue nulle reçoit zéro; ne pas diviser par zéro. Le tri Morton est une heuristique de localité, pas une preuve de meilleure partition. Comparer ultérieurement au partitionnement de graphe en gardant les mêmes plafonds.

## 4. Simplification de référence et contraintes

La référence pédagogique utilise une contraction d'arêtes avec QEM géométrique et résolution pivotée. Le document des calculs définit les matrices et cas singuliers. La file de priorité contient `(coût, id_arête, versions_des_sommets)`; un candidat devenu périmé est recalculé ou ignoré.

```text
initialiser quadriques et classification des contraintes
construire les candidats admissibles
tant que triangles > cible ET file non vide :
  extraire le candidat de coût minimal, avec départage déterministe
  si versions périmées : recalculer et continuer
  calculer les positions candidates et choisir une position admissible
  vérifier bords, coutures, orientation, aire et contraintes topologiques
  si aucun candidat admissible : rejeter cette contraction
  sinon appliquer, actualiser voisinage/quadriques/versions
  surveiller annulation et budget de travail
retourner la géométrie atteinte et les métriques, même si cible non atteinte
```

Pour une arête contractée sur une surface manifold, le test de lien exige `Lk(a) ∩ Lk(b) = Lk({a,b})` sur les simplexes, pas seulement sur les sommets voisins. Le lien d'un sommet contient aussi des arêtes : le seul test des voisins communs accepte à tort une contraction de tétraèdre qui superpose deux faces. Les algorithmes de base définissent ce test et le refus des faces dupliquées après contraction. Une arête interne manifold possède deux faces; une arête de bord en possède une. La V1 verrouille les bords ouverts, coutures et sommets non manifold ; une politique autorisant leur simplification doit définir ses conditions de bord séparément.

Pour chaque face survivante autour des sommets modifiés, comparer ancienne/nouvelle aire et normales : aire nouvelle au-dessus du seuil relatif et `dot(normal_old,normal_new)` au-dessus de la limite angulaire choisie. Une orientation locale préservée ne garantit pas l'absence de toute auto-intersection globale : celle-ci est un test supplémentaire si le domaine l'exige.

Les frontières externes du groupe sont verrouillées. Avec un sommet verrouillé, seul ce sommet peut être retenu; avec deux sommets verrouillés distincts, la contraction est interdite. Les coutures à préserver conservent leurs copies d'attributs. Les matériaux restent des contraintes discrètes, pas une moyenne de leurs identifiants.

La première référence peut garder positions des extrémités et interpoler les attributs sur une arête admissible. Ajouter des attributs dans l'optimisation nécessite une métrique et des poids versionnés, ainsi qu'une recette de rendu. Une réduction géométrique différente constitue une nouvelle variante, même si elle est plus rapide.

## 5. Une borne de distance indépendante de la réduction

Le résultat QEM peut fournir un excellent ordre de contractions sans être une distance maximale. Pour certifier une tolérance de géométrie de référence, utiliser un oracle de distance point-triangle, puis une majoration par couverture de surface.

Pour trouver la distance d'un point à un triangle : projeter sur son plan; si les coordonnées barycentriques de la projection sont toutes dans le triangle, retenir cette projection. Sinon tester les trois segments. Pour un segment `[A,B]`, `t=clamp(dot(P-A,B-A)/||B-A||²,0,1)` et `closest=A+t(B-A)`. Si sa longueur est nulle, prendre `A`. Le triangle dégénéré se réduit au minimum des segments/points.

Un BVH accélère le minimum point→surface : une borne inférieure point→AABB vaut la norme des composantes `max(min-P,0,P-max)`. Visiter d'abord le nœud de borne minimale et abandonner ceux dont la borne dépasse la meilleure distance déjà connue. Une partition médiane sur l'axe le plus étendu constitue une référence complète sans dépendance externe.

Pour chaque triangle source, subdiviser en petits triangles et échantillonner leurs sommets. Soit `h` le plus grand diamètre des cellules et `dmax` la plus grande distance d'un échantillon vers la surface candidate. La distance à un ensemble fermé est 1-Lipschitz; chaque point de la surface source est à au plus `h` d'un échantillon de sa cellule. Ainsi :

```text
directed_distance(source,candidate) <= dmax + h
```

Répéter dans l'autre sens pour une borne symétrique. Affiner les cellules jusqu'à obtenir une borne acceptable ou épuiser le budget de certification. Une certification abandonnée reste `not-certified`; elle ne devient pas automatiquement une réussite. C'est coûteux et destiné aux oracles/offline, pas à chaque image.

La précision flottante de l'oracle reste à majorer si l'on exige une preuve numérique stricte. Une implémentation f64 avec marges contrôlées est une référence de test; une arithmétique d'intervalles ou des prédicats robustes sont nécessaires pour une certification formelle sur entrées adversariales.

Les attributs, silhouettes alpha et matériaux demandent des métriques supplémentaires.

## 6. Groupes de remplacement et hiérarchie

Les groupes assemblent les clusters adjacents pour limiter leur contour externe. Chaque groupe fusionne ses enfants, simplifie la région puis la repartitionne. Tous les parents issus du même remplacement partagent les métadonnées nécessaires à la transition; tous les enfants enregistrent ce remplacement collectif.

Les bornes LOD englobent les enfants et la représentation parent; la politique d'erreur est calculée selon son type. La monotonie est vérifiée sur chaque relation avant sérialisation.

La V1 conserve des régions emboîtées non chevauchantes, organisées en arbre, avec plusieurs clusters possibles dans chaque représentation. La variante à regroupements plus libres peut former un DAG et demande sa propre preuve de coupe. L'accélérateur spatial qui retrouve les candidats demeure une structure distincte ; ne pas utiliser ses liens pour décider d'un remplacement géométrique.

Deux chemins de référence possibles doivent être distingués : évaluer une prédication LOD sur l'ensemble des clusters d'un petit asset; ou traverser la hiérarchie avec gestion explicite des groupes. Le premier est plus coûteux mais utile pour vérifier le second. Une table de visite `(instance,vue,groupe)` et une génération de frame permettent de détecter les doubles émissions.

La recette ne se réduit pas à « nombre de clusters cohérent ». Elle vérifie que les groupes de la coupe recouvrent la même surface, que les transitions ont des frontières compatibles, que l'égalité au seuil est attribuée à un côté, et qu'une absence de page laisse un ancêtre complet.

## 7. Pipeline de frame proposé

1. Consommer les changements CPU : transforms, visibilité, matériaux, pages prêtes. Produire une version de scène cohérente.
2. Calculer les données de vue : matrices, focales, plans, viewport, convention depth, validité de l'historique.
3. Réinitialiser compteurs et flags d'overflow des buffers réutilisables.
4. Rejeter les instances hors frustum; sélectionner les représentations LOD résidentes.
5. Tester les clusters et compacter les sorties; classer dans les bins compatibles.
6. Finaliser les commandes indirectes à partir des comptes effectivement écrits.
7. Rasteriser avec le chemin matériel et les matériaux compatibles.
8. Quand l'occlusion est activée, construire la profondeur actuelle et retester les candidats rejetés par l'historique; dessiner les désoccultés.
9. Composer les passes moteur et produire les éventuels IDs de sélection, ombres et statistiques.
10. Publier les demandes de pages et métriques sans bloquer l'image; récupérer les ressources dont l'utilisation est terminée.

La première implémentation réalise les étapes sans occlusion temporelle ni streaming; elle garde leurs interfaces pour les ajouter ultérieurement. Une sortie trop petite provoque une stratégie de fallback complète ou une relance hors fenêtre mesurée, jamais une troncature silencieuse de la surface.

## 8. Préparation parallèle dans Electron

Un job porte `jobId`, `assetId`, `generation`, `inputHash`, `compilerVersion`, `configHash`, `budget` et `cancelToken`. Les réponses portent les mêmes identités; toute génération périmée est rejetée.

États : `queued → admitted → loading → compiling → validating → committing → completed`, ou `cancelled/failed`. Le résultat n'est publié qu'après validation et écriture complète. Un fichier temporaire remplacé atomiquement évite de laisser un cache apparemment valide après crash.

L'admission doit réserver mémoire et CPU avant le lancement. Le nombre de processus n'est pas le nombre de cœurs : un processus peut déjà lancer plusieurs threads natifs. Une règle initiale prudente est un seul gros job à la fois sur une petite machine; toute augmentation dépend d'une mesure de pic RAM et de frametime pendant l'import.

```text
admissible(job) =
  memory_reserved + estimated_peak(job) <= memory_budget
  AND threads_reserved + requested_threads(job) <= cpu_budget
```

Sous-estimation de mémoire : arrêt contrôlé, découpage ou report du job; pas de spirale d'allocation. Annulation coopérative à chaque phase/grain de travail; si une bibliothèque monolithique ne peut pas l'observer, l'isolation par processus permet un arrêt dur avec suppression de son résultat incomplet.

Les données massives passent par des tableaux transférés ou des fichiers immuables identifiés par hash. Les messages de contrôle contiennent des tailles et références, pas des millions de nombres sérialisés en JSON. Un transfert de propriété détache le buffer de l'émetteur; conserver une copie si le mesh original doit rester dessiné.

## 9. Cache et reprises

Clé de cache : hash des octets géométrie/attributs nécessaires, configuration d'import, paramètres de simplification, format, version du compilateur et cible d'encodage. Une modification de matériau n'invalide la compilation que si elle affecte ses partitions ou paramètres; distinguer les couches de cache pour éviter des recompilations inutiles.

Au démarrage, valider les entrées du cache et supprimer/reconstruire uniquement celles incompatibles ou incomplètes selon les règles du futur produit. En cas de panne du compilateur, garder le rendu de référence. Une panne d'une tâche ne doit pas invalider les assets sains d'une autre tâche.

## 10. Propriété et intégration produit

Les assets sont partagés par références; les instances possèdent transforms et identités, pas des copies complètes de géométrie. Le picking renvoie l'identité éditable d'origine; une sélection de triangle peut utiliser une correspondance fine ou une géométrie collision indépendante selon le contrat produit.

Les vues d'ombre utilisent leur propre coupe ou une politique de qualité documentée. Les projections stéréo, les captures, les mini-vues et l'export du jeu sont des consommateurs distincts à recetter. Le fait qu'un viewport utilise WebGPU ne prouve pas que le renderer d'export le fasse.

Le runtime conserve l'invalidation à la demande du moteur : préparation terminée, page publiée ou transform modifiée demande une nouvelle image. Une boucle de compute permanente pour une scène immobile serait une régression énergétique.

## 11. Critères avant la rédaction des spécifications détaillées

Le dossier décrit les algorithmes et une voie de référence; les décisions suivantes doivent devenir des paramètres explicites de spécification : domaine de matériaux V1, plafonds de clusters/sommets, métrique d'erreur et certification, format versionné, budget RAM/VRAM, backend de compilation, version Three cible et politique de fallback.

Les alternatives ne sont pas des trous dissimulés : elles sont identifiées comme expériences. On peut implémenter la voie simple décrite ici avant de choisir une meilleure variante mesurée. Un exemple de conception ne doit pas être présenté comme une fonctionnalité déjà intégrée.
