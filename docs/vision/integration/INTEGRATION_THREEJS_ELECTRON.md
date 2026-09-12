# Intégration Three.js et Electron — Web Geometry

Spécification de conception, à distinguer des [capacités actuellement implémentées](../../../packages/README.md). Les numéros historiques des sections sont conservés.

## 1. Forme du plugin

Le système peut prendre la forme d'un plugin de préparation d'assets et d'un adaptateur de rendu. Il ne suffit pas d'ajouter un matériau à chaque mesh : sélection, données persistantes, passes et résidence traversent plusieurs responsabilités du moteur.

Le socle conserve Three.js pour les objets de scène, matériaux compatibles, raster matériel et chemins de secours. La préparation produit un format indépendant. Le moteur reste propriétaire du renderer, des vues, du calendrier des images et des services de fichiers.

La documentation ne présume pas la version installée de Three.js ou d'Electron, ni des points d'extension déjà présents dans le produit. Avant implémentation, faire un banc d'intégration minimal sur les versions effectivement retenues ; ne pas modifier des propriétés privées du renderer par supposition.

## 2. Contrat proposé

```text
Plugin:
    prepare(mesh, settings, budget) -> job
    attach(asset, objectId, transform, materials) -> handle
    update(handle, changes) -> revision
    prepareView(view, sceneRevision) -> frame
    render(frame, targets) -> result
    pick(view, position) -> objectId
    remove(handle)
    dispose()
```

Ces noms sont ceux d'une interface à développer, pas des méthodes garanties de Three.js. `prepare` est asynchrone parce qu'un worker/processus travaille réellement ; une Promise autour d'une boucle dans le thread UI ne libère pas l'interface.

`attach` ne duplique pas l'asset pour chaque instance. L'instance possède identité, transform, visibilité et correspondance de matériaux. L'asset possède la géométrie et les métadonnées partagées. La dernière référence libère les ressources seulement après les usages en vol.

## 3. Première intégration testable

1. Afficher un objet ordinaire et garder cette voie de référence.
2. Préparer ses clusters/LOD en arrière-plan puis valider le résultat décodé.
3. Sélectionner une coupe CPU entièrement résidente.
4. Rendre cette coupe avec géométries et matériaux compatibles, sans occlusion temporelle ni streaming.
5. Vérifier silhouette, normales, UV, identité et profondeur.
6. Mesurer le coût total avant de remplacer la sélection par du compute.

Cette étape peut coûter plus d'appels de dessin qu'un mesh original. Elle établit la correction ; elle ne doit pas être présentée comme une accélération acquise.

## 4. Backends et capacités

Prévoir une table de capacités réellement testées : backend actif, limites de buffers, formats de cibles, indexation, dessin indirect, compute, timestamps et éventuelles extensions. « API WebGPU disponible » ne signifie pas que l'application utilise déjà le chemin voulu.

Chemin GPU : les buffers partagés et passes doivent utiliser le même device et un ordre de soumission maîtrisé. Des ressources créées sur un autre device ne deviennent pas partageables par simple référence JavaScript.

Chemin WebGL2 de référence : préparer et sélectionner côté CPU, grouper les états compatibles puis utiliser les appels supportés. Un chemin compute écrit pour WebGPU n'est pas automatiquement disponible sur ce repli. Vérifier explicitement les capacités du renderer plutôt que le nom de sa classe.

Un prototype bas niveau WebGPU isolé peut prouver un algorithme sans encore constituer un plugin Three.js intégré. Les deux validations sont nécessaires : calcul correct d'abord, composition correcte ensuite.

## 5. Vues, passes et identité

Une coupe est propre à la résolution et à la projection de la vue. Ombres, stéréo, captures et export demandent leurs propres règles. Ne pas appliquer le frustum caméra aux objets susceptibles de projeter une ombre dans l'image.

Le plugin doit fournir ou préserver profondeur, masques, identités et éventuellement vélocité aux étapes suivantes. La visibilité différée ne remplace pas automatiquement un graphe de matériaux existant.

Le picking retourne l'identité de l'objet éditable. Pour sélectionner une face exacte, définir un mapping de primitives ou utiliser le BVH de la géométrie d'édition ; un triangle simplifié ne correspond pas toujours à une seule face originale. Le résultat précise son niveau de précision.

## 6. Invalidation et vie des ressources

Une modification de transform actualise l'instance et ses bornes, pas tout l'asset compilé. Une modification des positions, UV ou matériaux de partition peut relancer une préparation selon la clé de cache. La génération distingue résultat valide et réponse tardive.

L'arrivée d'un asset, d'une page ou d'un pipeline déclenche une nouvelle image dans un moteur à rendu à la demande. Une scène immobile sans tâches ne doit pas conserver une boucle de compute active.

Suppression : retirer l'instance des futures vues, relâcher ses références, attendre les dernières soumissions concernées puis détruire les ressources devenues inutiles. `dispose` annule les jobs, ferme les échanges, libère tables et événements. Il doit être sûr si appelé après un échec partiel.

Perte du device : invalider handles et historique, conserver données d'asset CPU/cache, recréer les ressources et reprendre avec les racines ou le rendu de secours. Tester aussi resize, création d'une seconde vue et fermeture pendant upload.

## 7. Préparation dans Electron

Le processus principal reçoit uniquement un protocole autorisé et borne le travail. Le renderer conserve la manipulation de la scène. Un worker ou processus de préparation produit l'asset sans accès implicite aux objets Three.js vivants.

Message de job : identités, génération, configuration, taille d'entrée, budget, progression et résultat. Les données massives passent par tableaux transférables lorsque le canal le permet, ou par fichiers immuables validés. Ne pas supposer que tous les canaux IPC transfèrent un ArrayBuffer sans copie.

Ne jamais activer des privilèges larges dans le renderer pour simplifier le chargement natif. Les appels privilégiés restent bornés : chemins autorisés, tailles, options connues, exécutable fixe, arguments séparés, aucune commande shell construite depuis un asset.

Les options de distribution, signature et architecture des modules natifs sont vérifiées sur chaque cible. Ce coût fait partie du choix technologique, même s'il n'apparaît pas dans le temps de simplification.

