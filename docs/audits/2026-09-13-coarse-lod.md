# Emerald — niveaux grossiers supplémentaires

Le compilateur natif ajoute des niveaux au-dessus de la meilleure coupe complète déjà disponible. Il conserve les anciennes pages, les anciennes hiérarchies, les matériaux et les données source. Le seuil de sélection du moteur reste inchangé.

## Intégration dans develop

La fusion conserve le modèle plus strict `bounds-diagonal-boundary-v1`, arrivé dans `develop` après la campagne initiale. Ce modèle exige aussi la préservation des frontières indexées et refuse les bords non-manifold. Chaque niveau ajouté porte la diagonale des bornes de la racine source complète, sans addition de l'estimation locale du simplificateur. Les niveaux précédents restent disponibles pour le repli.

Une nouvelle compilation d'Emerald compare le compilateur de `develop` au commit `898945b` avec cette correction, à source et options identiques (`full`, `qem-endpoints`, 2 threads, budget 1 024 Mo). Le recensement de la coupe minimale avant élimination des éléments invisibles donne :

| Mesure du cache, modèle strict identique avant/après | Avant | Après | Variation |
|---|---:|---:|---:|
| Triangles opaques instanciés | 4 032 209 | 4 031 037 | −1 172 (−0,0291 %) |
| Pages opaques instanciées | 16 862 | 16 862 | 0 % |

Les 252 anciennes hiérarchies sont conservées ; 16 niveaux sont ajoutés sur 11 primitives. Le contrôle indépendant ne relève aucune perte de composante non dégénérée, de frontière géométrique ou de borne. Les 4 364 anciennes pages, dont 3 918 exactes, conservent leurs métadonnées et leurs octets. Les données source, matériaux et transformations sont identiques.

**Le gain historique de −12,66 % ne décrit donc pas la version fusionnée.** Les protections strictes limitent fortement les réductions acceptées sur Emerald. La campagne de rendu et les performances de cette version intégrée sont `not-run` ; le recensement ne prouve pas une accélération ni l'absence de différence visuelle. Améliorer les réductions sous ces contraintes reste un travail ultérieur.

Les validations sur la branche isolée passent : 345 tests JavaScript/TypeScript, 49 tests unitaires Rust et un test Rust d’intégration, compilations TypeScript et native, structure, déclarations et 88 liens locaux. Les régressions ajoutées vérifient aussi la borne certifiée constante, les racines disjointes et le refus des frontières indexées non-manifold.

Preuves locales : `benchmark-runs/coarse-lod/integration-develop/` contient les recensements `census-before.json`, `census-after.json`, `preservation.json`, les empreintes et les journaux de validation. Les caches et compilateurs isolés restent dans `/private/tmp/webgeometry-coarse-lod/benchmark-runs/coarse-lod-integration/`.

Clés de cette nouvelle comparaison : avant `bbb4b59930dfc2ce4a200798f04fc52fce617317457ce504ee86189bfcc4d146`, après `ce23c343139fe40a9eaa697cf374b5731c0c21959eb280b8736b6303a621b88f`.

## Campagne initiale avant intégration

Les sections historiques ci-dessous concernent le modèle `qem-local-plus-child-max` et le runtime figé utilisés avant la fusion. Elles documentent la variante mesurée et acceptée par l'utilisateur ; elles ne constituent pas une validation graphique du modèle strict intégré.

### Résultat mesuré

Emerald complet, même source, même machine Apple M2 Max, même résolution 1 012 × 1 000, même caméra et `pixelError=1`. La coupe minimale est comptée avant culling, puis reproduite dans la vue distante ×16 du parcours du banc 15.

| Mesure | Avant | Après | Variation |
|---|---:|---:|---:|
| Triangles opaques de la coupe minimale | 1 640 414 | 1 432 767 | −12,66 % |
| Pages instanciées de cette coupe | 7 363 | 6 600 | −10,36 % |
| Triangles sélectionnés et soumis, vue ×16 | 1 640 414 | 1 432 767 | −12,66 % |
| Dessins du backend WebGL, vue ×16 | 2 479 | 2 479 | 0 % |

La vue urbaine générale passe de 1 886 749 à 1 756 538 triangles et de 8 709 à 8 258 pages. Les gains dépendent donc de la caméra. Les mesures CPU sont archivées, mais cette campagne séquentielle ne permet pas un verdict général de performance : certaines vues sont plus rapides, d'autres plus lentes. Aucune mesure GPU ou preuve sur machine modeste n'est revendiquée.

### Correction

L'appariement topologique s'arrêtait dès que les régions ne partageaient plus d'arêtes. Les parents spatiaux regroupaient alors les régions sans fournir de représentation grossière. Le compilateur n'essayait pas non plus de poursuivre après le premier niveau d'une primitive tenant dans une seule page.

Le compilateur extrait désormais la coupe complète existante et tente au maximum 16 réductions supplémentaires. Chaque niveau accepté devient un parent dont l'enfant est l'arbre précédent, intégralement conservé. La variante initiale gardait `LockBorder`, la limite locale 0,01 et l'accumulation d'erreur `erreur locale + erreur héritée`. La version intégrée conserve `LockBorder` et la limite locale, mais applique la borne certifiée décrite ci-dessus. L'annulation est vérifiée entre les passes. Une passe sans réduction arrête la chaîne.

Chaque candidat est comparé à la coupe initiale après identification des positions géométriques communes. Il est refusé s'il supprime une composante portant une surface non dégénérée, relie des composantes initialement distinctes ou modifie un bord géométrique orienté. Trois indices distincts ne suffisent pas à prouver une surface : le contrôle vérifie également que l'aire n'est pas nulle.

La première variante sans ces contrôles supprimait de petites surfaces de panneaux. Elle a été rejetée. Seule la variante protégée est retenue.

La modification concerne le compilateur **natif**. Le compilateur JavaScript de référence conserve son algorithme actuel. Le format reste 1 ; l'empreinte du code natif change la clé du cache. Les sources ne sont jamais réécrites.

### Conservation et qualité visuelle

La vérification indépendante du cache QEM de la campagne initiale établissait :

- 252 anciennes hiérarchies opaques sur 252 conservées à l'identique ;
- 241 niveaux supplémentaires sur 154 primitives ;
- 3 918 pages exactes conservées, avec vérification des octets réels ;
- données source, matériaux et transformations identiques ;
- aucune composante non dégénérée ni frontière géométrique perdue dans les niveaux ajoutés ;
- bornes conservées et erreurs cumulées monotones.

La campagne navigateur comporte 40 captures : 12 vues de référence, 12 avant, 12 après, et deux contrôles exacts avant/après. Le runtime est figé et ses empreintes vérifiées pour toutes les variantes. Les dix vues du parcours urbain viennent du véritable banc 15 ; deux caméras supplémentaires éloignent la vue générale de ×4 et ×16.

Les deux contrôles `pixelError=0` sont identiques pixel par pixel avant/après. À `pixelError=1`, 1 539 pixels diffèrent sur 12 144 000 pixels comparés, soit 0,01267 %, avec un maximum de 508 pixels sur une vue (0,0502 %). Trois pixels de silhouette deviennent du fond sur l'ensemble des vues. L'erreur moyenne maximale entre une vue avant/après est 0,004806 sur une échelle de couleur 0–255. Quelques comparaisons A/A montrent également une faible instabilité de rasterisation.

Les images inspectées ne montrent pas de disparition grossière d'objet. **Une absence stricte de toute perte de rendu n'est pas établie** : l'erreur par rapport à la référence augmente légèrement sur neuf vues. L'erreur QEM et le seuil nominal d'un pixel ne constituent pas une garantie d'égalité des couleurs, des silhouettes ou de l'interpolation des attributs.

### Coût du cache

Conserver les anciens niveaux et en ajouter augmente le catalogue : métadonnées 7 318 082 → 8 939 292 octets, indices uniques référencés 17 421 084 → 22 860 636 octets, pages comprimées uniques référencées 51 118 749 → 69 544 997 octets. La coupe minimale utilise toutefois moins de pages comprimées uniques : 15 365 503 → 14 715 859 octets. Le fichier source de 195 404 028 octets reste identique.

### Vérifications et reproduction

Lors de la campagne initiale, les vérifications du dépôt partagé avaient réussi : 374 tests JavaScript/TypeScript, 48 tests unitaires Rust et un test Rust d'intégration, compilation TypeScript et native, contrôle de structure et contrôle des espaces du diff. Les tests spécifiques couvrent notamment le repli exact, les régions disjointes, les petits composants, les sommets coïncidents, les bords, l'erreur cumulée et l'annulation.

Outils de reproduction : [recensement du cache](../../test/coarseLodCensus.mjs), [campagne navigateur](../../test/coarseLodEmerald.browser.mjs), [régression de compilation](../../packages/asset-compiler-rust/tests/coarse_levels.rs).

Les preuves locales sont dans `benchmark-runs/coarse-lod/` : `generated-before.json`, `after.json`, `final-baseline-review.json`, `visual-summary.json`, `visual/result.json`, les PNG et les RGBA compressés. Les tentatives de transport navigateur échouées sont conservées séparément dans l'historique des exécutions ; les variantes finales ont terminé sans erreur de page ou de requête.

Clés mesurées : avant `235d998c0cb2032926bd86119fe7b7ec9d5ef7184fd10e56e425d9381c97055b`, après `c029005ecafd1ab205a763bd4675b4deb954c4bdbf957cfcb70ecb2fb07dd37b`. Les compilateurs avant/après ont été isolés des autres corrections simultanées du dépôt ; le rendu utilise le même runtime figé dans les deux cas.

Avant l'intégration dans `develop`, le code et le binaire natif du dépôt partagé avaient été mis à jour. Après accord de l'utilisateur pour améliorer la fidélité visuelle ultérieurement, le cache mesuré a été activé dans le banc local. Les 16 189 fichiers référencés ont été vérifiés ; le pointeur HTTP du lab publiait alors la clé QEM après ci-dessus. Cette activation historique n'est pas une activation du cache strict intégré. L'ancien cache et son pointeur sauvegardé sont conservés pour retour arrière. La preuve de l'activation est dans `benchmark-runs/coarse-lod/activation.json`.
