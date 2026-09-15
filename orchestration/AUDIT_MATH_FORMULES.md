# Appels à Three.js restants dans le moteur (lot T1)

Base : commit `9bf2eb3` (develop, 15 sept. 2026), lecture seule. Liste de travail des lots M1 à M4 de `SPEC_MOTEUR_SANS_THREE.md` (R1a) ; les sites déjà repris par un lot fusionné sortent de la liste. Le fichier disparaît avec M4.

Ce lot ne recense pas des formules du dépôt mais les appels aux méthodes mathématiques de Three.js, avec la formule équivalente : c'est la carte des calculs à reprendre pour le plan sans Three.js. 118 fichiers importent `three`, 49 appellent une méthode de calcul, environ 150 sites, une trentaine de méthodes.

## Inventaire T1 — calculs délégués à Three.js (`packages/sdk-browser`)

Dépôt `webGeometry`, branche `develop`, lecture seule. Lot T1 : uniquement les méthodes mathématiques
de Three.js réellement **appelées** dans `packages/sdk-browser/*.ts` (hors `*.test.ts`, fixtures, aides
de test, mocks, `bench/`). 118 fichiers importent `three`, mais la plupart ne s'en servent que pour du
typage (`THREE.Mesh`, `THREE.Material`…) sans appeler de méthode de calcul : seuls les fichiers ci-dessous
appellent effectivement une méthode mathématique de Three.

## packages/sdk-browser/autonomousGeometry.ts

| Site (lignes) | Méthode Three appelée            | Ce que ça calcule ici                                                                    | Formule équivalente                        | Fréquence                               | Chemin                                                       |
| ------------- | -------------------------------- | ---------------------------------------------------------------------------------------- | ------------------------------------------ | --------------------------------------- | ------------------------------------------------------------ |
| 144           | `Box3.getBoundingSphere(Sphere)` | Sphère englobante d'une page géométrique nouvellement décodée, à partir de sa boîte AABB | centre = (min+max)/2, rayon = ‖max−centre‖ | Par page décodée (chargement/streaming) | Diagnostic/rendu (sphère utilisée pour le culling ultérieur) |

## packages/sdk-browser/autonomousInstances.ts

| Site (lignes) | Méthode Three appelée         | Ce que ça calcule ici                                                                        | Formule équivalente | Fréquence                                                      | Chemin                               |
| ------------- | ----------------------------- | -------------------------------------------------------------------------------------------- | ------------------- | -------------------------------------------------------------- | ------------------------------------ |
| 31            | `Matrix4.copy(a).multiply(b)` | Repose la racine d'une instance : `world = transform · baseRoot.world`                       | M_root = T · M_base | Par racine, à chaque déplacement d'instance (`updateInstance`) | WebGL2 mode autonome (racines/pages) |
| 34            | `Matrix4.copy(a).multiply(b)` | Repose une page d'instance : `matrix = transform · base.matrix`                              | M_page = T · M_base | Par page, à chaque déplacement d'instance                      | idem                                 |
| 70            | `Matrix4.clone().multiply(b)` | Matrice initiale d'une page clonée à la création d'une instance : `transform · base.matrix`  | M = T · M_base      | Par page, à la création d'instance (`addInstance`)             | idem                                 |
| 86            | `Matrix4.clone().multiply(b)` | Matrice initiale d'une racine clonée à la création d'une instance : `transform · root.world` | M = T · M_base      | Par racine, à la création d'instance                           | idem                                 |

## packages/sdk-browser/autonomousPages.ts

| Site (lignes) | Méthode Three appelée              | Ce que ça calcule ici                                                                    | Formule équivalente                       | Fréquence            | Chemin               |
| ------------- | ---------------------------------- | ---------------------------------------------------------------------------------------- | ----------------------------------------- | -------------------- | -------------------- |
| 128           | `Object3D.updateMatrixWorld(true)` | Recompose les matrices monde de toute la hiérarchie source (TRS composées parent→enfant) | M_monde(n) = M_monde(parent) · M_local(n) | Par image (`render`) | WebGL2 mode autonome |

## packages/sdk-browser/backendCommon.ts

| Site (lignes) | Méthode Three appelée   | Ce que ça calcule ici                                         | Formule équivalente         | Fréquence                                                       | Chemin     |
| ------------- | ----------------------- | ------------------------------------------------------------- | --------------------------- | --------------------------------------------------------------- | ---------- |
| 48            | `Color.setHSL(h, s, l)` | Couleur diagnostique d'un cluster à partir de sa teinte dorée | conversion HSL→RGB standard | Par appel à `clusterColor` (diagnostic, coloration de clusters) | Diagnostic |

## packages/sdk-browser/clusterBatchPrimitive.ts

| Site (lignes) | Méthode Three appelée            | Ce que ça calcule ici                                          | Formule équivalente                        | Fréquence                                                 | Chemin                        |
| ------------- | -------------------------------- | -------------------------------------------------------------- | ------------------------------------------ | --------------------------------------------------------- | ----------------------------- |
| 45            | `Box3.getBoundingSphere(Sphere)` | Sphère englobante de la primitive de lot, à partir de sa boîte | centre = (min+max)/2, rayon = ‖max−centre‖ | Une fois par primitive (construction du `PrimitiveIndex`) | WebGL2 lots (`clusterBatch*`) |

## packages/sdk-browser/clusterBatchUpdate.ts

| Site (lignes) | Méthode Three appelée         | Ce que ça calcule ici                                                                                                  | Formule équivalente | Fréquence                 | Chemin      |
| ------------- | ----------------------------- | ---------------------------------------------------------------------------------------------------------------------- | ------------------- | ------------------------- | ----------- |
| 103           | `Matrix4.copy(sample.matrix)` | Recopie de la matrice de l'échantillon du lot vers le maillage de dessin (pas un calcul, simple copie de 16 flottants) | memcpy              | Par lot touché, par image | WebGL2 lots |

## packages/sdk-browser/exactPagesAttachment.ts

| Site (lignes) | Méthode Three appelée            | Ce que ça calcule ici                                                          | Formule équivalente                        | Fréquence                               | Chemin                         |
| ------------- | -------------------------------- | ------------------------------------------------------------------------------ | ------------------------------------------ | --------------------------------------- | ------------------------------ |
| 33            | `Box3.set(min, max)`             | Pose la boîte englobante d'une page depuis ses deux bornes                     | assignation min/max                        | Par page attachée pour la première fois | WebGL2 « exact-cluster-pages » |
| 35            | `Box3.getBoundingSphere(Sphere)` | Sphère englobante de la page, à partir de sa boîte                             | centre = (min+max)/2, rayon = ‖max−centre‖ | Par page attachée pour la première fois | idem                           |
| 38, 46        | `Matrix4.copy(rec.matrix)`       | Recopie de la matrice de placement de la page vers le maillage (pas de calcul) | memcpy                                     | Par page, à l'attache et à chaque image | idem                           |

## packages/sdk-browser/exactPagesRender.ts

| Site (lignes) | Méthode Three appelée                  | Ce que ça calcule ici                                                                                     | Formule équivalente                       | Fréquence                       | Chemin                         |
| ------------- | -------------------------------------- | --------------------------------------------------------------------------------------------------------- | ----------------------------------------- | ------------------------------- | ------------------------------ |
| 56            | `Object3D.updateMatrixWorld(true)`     | Recompose les matrices monde de la scène source                                                           | M_monde(n) = M_monde(parent) · M_local(n) | Par image                       | WebGL2 « exact-cluster-pages » |
| 58            | `Matrix4.copy(sourceMesh.matrixWorld)` | Resynchronise la copie de mélange (transparents) sur la matrice monde de la source (copie, pas de calcul) | memcpy                                    | Par copie de mélange, par image | idem                           |

## packages/sdk-browser/explorerCamera.ts

| Site (lignes) | Méthode Three appelée                           | Ce que ça calcule ici                                                                                         | Formule équivalente                                                                    | Fréquence                                                    | Chemin                 |
| ------------- | ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- | ------------------------------------------------------------ | ---------------------- |
| 20            | `Box3.expandByObject(mesh)`                     | Étend la boîte englobante de la scène à un maillage (transforme ses sommets par sa matrice monde et fusionne) | box ∪= transform(vertices, M_monde)                                                    | Une fois, à la construction de la caméra (mode non autonome) | Cadrage caméra initial |
| 21            | `Box3.getCenter(Vector3)`                       | Centre de la boîte englobante de la scène                                                                     | centre = (min+max)/2                                                                   | Une fois, à la construction                                  | idem                   |
| 22            | `Box3.getSize(Vector3)` puis `Vector3.length()` | Rayon d'encadrement de la scène                                                                               | rayon = ‖max−min‖ / 2                                                                  | Une fois, à la construction                                  | idem                   |
| 32            | `Vector3.copy(center).add(homeOffset)`          | Position de départ de la caméra : centre + décalage d'accueil                                                 | pos = centre + offset                                                                  | Une fois, à la construction                                  | idem                   |
| 33            | `Camera.lookAt(center)`                         | Oriente la caméra vers le centre de la scène                                                                  | construit la matrice de rotation (base orthonormée regard/haut/droite) visant `center` | Une fois, à la construction                                  | idem                   |
| 34            | `Object3D.updateMatrixWorld()`                  | Recompose la matrice monde de la caméra après positionnement                                                  | M_monde = M_local (racine)                                                             | Une fois, à la construction                                  | idem                   |

## packages/sdk-browser/explorerCameraApi.ts

| Site (lignes) | Méthode Three appelée                          | Ce que ça calcule ici                                                                                   | Formule équivalente                  | Fréquence                                           | Chemin                      |
| ------------- | ---------------------------------------------- | ------------------------------------------------------------------------------------------------------- | ------------------------------------ | --------------------------------------------------- | --------------------------- |
| 58            | `Vector3.copy(center).add(homeOffset)`         | Repositionne la caméra sur la vue d'accueil                                                             | pos = centre + offset                | À chaque `resetHome()` (action utilisateur)         | API caméra de l'explorateur |
| 59, 69        | `Vector3.copy(center)`                         | Recopie la cible de visée (pas de calcul)                                                               | memcpy                               | À `resetHome()` / `restoreAfterCampaign()`          | idem                        |
| 60, 61        | `Camera.lookAt(center)`, `updateMatrixWorld()` | Réoriente la caméra vers le centre et recompose sa matrice monde                                        | cf. explorerCamera.ts                | À `resetHome()`                                     | idem                        |
| 68            | `Camera.copy(saved)`                           | Restaure l'état complet de la caméra (position, rotation, fov, near/far…) depuis une caméra sauvegardée | copie profonde des propriétés caméra | À `restoreAfterCampaign()` (fin de comparaison A/B) | idem                        |
| 87            | `Vector3.copy(center)` (via `controls.target`) | Pose la cible des contrôles orbitaux sur le centre de la scène                                          | memcpy                               | À la création des `OrbitControls`                   | idem                        |

## packages/sdk-browser/explorerHostState.ts

| Site (lignes) | Méthode Three appelée                                | Ce que ça calcule ici                                                             | Formule équivalente                     | Fréquence                                                   | Chemin                |
| ------------- | ---------------------------------------------------- | --------------------------------------------------------------------------------- | --------------------------------------- | ----------------------------------------------------------- | --------------------- |
| 68            | `Vector3().copy(center)`                             | Cible de visée initiale de l'hôte (copie)                                         | memcpy                                  | Une fois, à la création de l'état hôte                      | Hôte de l'explorateur |
| 83            | `Camera.lookAt(lookAtTarget.fromArray(pose.target))` | Applique une pose caméra reçue de l'hôte : vise la cible donnée                   | construit la rotation visant la cible   | À chaque `setPose()` (changement de vue demandé par l'hôte) | idem                  |
| 84            | `Camera.updateProjectionMatrix()`                    | Reconstruit la matrice de projection perspective après changement de fov/near/far | P = perspective(fov, aspect, near, far) | À chaque `setPose()`                                        | idem                  |
| 85            | `Object3D.updateMatrixWorld()`                       | Recompose la matrice monde de la caméra après la pose                             | M_monde = M_local                       | À chaque `setPose()`                                        | idem                  |

## packages/sdk-browser/explorerScene.ts

| Site (lignes) | Méthode Three appelée                                                                     | Ce que ça calcule ici                                                                                                       | Formule équivalente                                             | Fréquence                                                                                      | Chemin                 |
| ------------- | ----------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- | ---------------------- |
| 33            | `Box3.applyMatrix4(mesh.matrixWorld)` puis `Box3.union` (implicite via `into.union(...)`) | Boîte monde d'une page exacte : transforme sa boîte locale par la matrice monde du maillage puis l'ajoute à l'union globale | box_monde = transform(box_locale, M_monde) ; union ∪= box_monde | Par page « exact » de chaque primitive, au calcul des bornes cadrant la caméra (mode autonome) | Cadrage caméra initial |

## packages/sdk-browser/explorerViewportApi.ts

| Site (lignes) | Méthode Three appelée                             | Ce que ça calcule ici                                                                    | Formule équivalente                     | Fréquence                                            | Chemin                      |
| ------------- | ------------------------------------------------- | ---------------------------------------------------------------------------------------- | --------------------------------------- | ---------------------------------------------------- | --------------------------- |
| 50            | `Camera.lookAt(Vector3().fromArray(pose.target))` | Oriente la vue clonée pour une capture de surface vers la cible demandée                 | rotation visant la cible                | À chaque `captureSurfaceView()` (action utilisateur) | Capture de surface (mesure) |
| 51            | `Camera.updateProjectionMatrix()`                 | Reconstruit la projection perspective de la vue de capture (fov/aspect/near/far propres) | P = perspective(fov, aspect, near, far) | À chaque capture                                     | idem                        |
| 52            | `Object3D.updateMatrixWorld()`                    | Recompose la matrice monde de la vue de capture                                          | M_monde = M_local                       | À chaque capture                                     | idem                        |
| 69            | `Camera.updateProjectionMatrix()`                 | Reconstruit la projection principale après redimensionnement du viewport (aspect changé) | P = perspective(fov, aspect, near, far) | À chaque `resize()`                                  | Redimensionnement           |

## packages/sdk-browser/gpuSelection.ts

| Site (lignes) | Méthode Three appelée                                                       | Ce que ça calcule ici                                                   | Formule équivalente                                | Fréquence                              | Chemin                                  |
| ------------- | --------------------------------------------------------------------------- | ----------------------------------------------------------------------- | -------------------------------------------------- | -------------------------------------- | --------------------------------------- |
| 122           | `Object3D.updateMatrixWorld()`                                              | Recompose la matrice monde de la caméra avant de dériver le frustum GPU | M_monde = M_local                                  | Par image (uniformes de sélection GPU) | Sélection GPU (chemin WebGPU par image) |
| 124-126       | `Matrix4.multiplyMatrices(P, V)` puis `Frustum.setFromProjectionMatrix(vp)` | Matrice vue-projection puis 6 plans du frustum caméra                   | VP = P · V ; plans = extraction des 6 plans de VP  | Par image                              | idem, chemin principal                  |
| 142           | `Camera.getWorldPosition(Vector3)`                                          | Position monde de la caméra pour les uniformes GPU                      | extraction de la colonne de translation de M_monde | Par image                              | idem                                    |

## packages/sdk-browser/hizCorners.ts

Aucun appel — les commentaires mentionnent `Matrix4`/`Vector3.applyMatrix4` comme référence de
correction (« l'arithmétique est `Matrix4`/`Vector3.applyMatrix4` terme à terme »), mais le code lui-même
réimplémente la transformation homogène à la main (produits scalaires sur `world.elements`), sans appeler
Three. Pas de calcul délégué dans ce fichier.

## packages/sdk-browser/hizDepth.ts

| Site (lignes) | Méthode Three appelée            | Ce que ça calcule ici                                                                  | Formule équivalente | Fréquence                                            | Chemin          |
| ------------- | -------------------------------- | -------------------------------------------------------------------------------------- | ------------------- | ---------------------------------------------------- | --------------- |
| 35            | `Object3D.updateMatrixWorld()`   | Recompose la matrice monde de la caméra avant de bâtir la profondeur Hi-Z de référence | M_monde = M_local   | Par appel à `visibilityDepth` (banc/diagnostic Hi-Z) | Diagnostic Hi-Z |
| 36-39         | `Matrix4.multiplyMatrices(P, V)` | Matrice vue-projection pour la rastérisation CPU de référence                          | VP = P · V          | Par appel                                            | idem            |

## packages/sdk-browser/hizProjection.ts

| Site (lignes) | Méthode Three appelée            | Ce que ça calcule ici                                                   | Formule équivalente | Fréquence                                                       | Chemin                       |
| ------------- | -------------------------------- | ----------------------------------------------------------------------- | ------------------- | --------------------------------------------------------------- | ---------------------------- |
| 22            | `Object3D.updateMatrixWorld()`   | Recompose la matrice monde de la caméra avant projection de boîtes Hi-Z | M_monde = M_local   | Par lot de projection de boîtes (`projectBoxesFlat`), par image | Hi-Z (culling par occlusion) |
| 23-26         | `Matrix4.multiplyMatrices(P, V)` | Matrice vue-projection partagée par tout le lot de boîtes               | VP = P · V          | Une fois par lot, par image                                     | idem                         |

## packages/sdk-browser/hizProjectionHold.ts

| Site (lignes) | Méthode Three appelée          | Ce que ça calcule ici                                                                    | Formule équivalente | Fréquence                           | Chemin                   |
| ------------- | ------------------------------ | ---------------------------------------------------------------------------------------- | ------------------- | ----------------------------------- | ------------------------ |
| 34            | `Object3D.updateMatrixWorld()` | Recompose la matrice monde de la caméra avant de comparer la vue tenue à la vue courante | M_monde = M_local   | Par appel à `reframe()` (par image) | Cache de rectangles Hi-Z |

## packages/sdk-browser/hizTemporal.ts

| Site (lignes) | Méthode Three appelée          | Ce que ça calcule ici                                                                         | Formule équivalente                                             | Fréquence                                 | Chemin        |
| ------------- | ------------------------------ | --------------------------------------------------------------------------------------------- | --------------------------------------------------------------- | ----------------------------------------- | ------------- |
| 24, 25        | `Object3D.updateMatrixWorld()` | Recompose les matrices monde des caméras précédente/courante avant de comparer leurs éléments | M_monde = M_local                                               | Par test `sameHizView`, par image         | Hi-Z temporel |
| 44            | `Camera.copy(camera, false)`   | Clone l'état de la caméra courante dans l'historique (sans les enfants)                       | copie des propriétés caméra (position, rotation, fov, matrices) | Par image où l'historique Hi-Z est retenu | idem          |

## packages/sdk-browser/lightingObservationMeshes.ts

| Site (lignes) | Méthode Three appelée                                     | Ce que ça calcule ici                                                                           | Formule équivalente                       | Fréquence                                                    | Chemin                           |
| ------------- | --------------------------------------------------------- | ----------------------------------------------------------------------------------------------- | ----------------------------------------- | ------------------------------------------------------------ | -------------------------------- |
| 20            | `Object3D.updateMatrixWorld(true)`                        | Recompose les matrices monde de la scène source du banc d'éclairage                             | M_monde(n) = M_monde(parent) · M_local(n) | Une fois, à la construction des maillages d'observation      | Banc R&D éclairage (observation) |
| 58            | `Matrix4.copy(original.matrixWorld)`                      | Fixe la matrice de la copie d'observation sur la pose de repos (copie)                          | memcpy                                    | Par maillage source, à la construction                       | idem                             |
| 61-64         | `Matrix4.clone().invert().multiply(original.matrixWorld)` | Transformation « au repos » relative à la base de surface : `inverse(basis) · M_monde_original` | M_repos = basis⁻¹ · M_monde               | Par maillage source, à la construction                       | idem                             |
| 97            | `Matrix4.multiplyMatrices(basis, restTransform)`          | Matrice animée de la copie : recompose la base courante avec la transformation de repos         | M = basis_courante · M_repos              | Par copie, à chaque `updateTransforms()` (par image du banc) | idem                             |

## packages/sdk-browser/lightingObservationTransforms.ts

| Site (lignes) | Méthode Three appelée                    | Ce que ça calcule ici                                                                   | Formule équivalente               | Fréquence                                     | Chemin             |
| ------------- | ---------------------------------------- | --------------------------------------------------------------------------------------- | --------------------------------- | --------------------------------------------- | ------------------ |
| 13            | `Vector3.crossVectors(u, v)`             | Normale du rectangle de surface (produit vectoriel des arêtes)                          | n = u × v                         | Par surface, par `updateTransforms()` du banc | Banc R&D éclairage |
| 14            | `Vector3.length()`                       | Aire du parallélogramme formé par u,v (norme du produit vectoriel)                      | aire = ‖u × v‖                    | idem                                          | idem               |
| 18            | `Vector3.dot(v)` + `Vector3.length()` ×2 | Test d'orthogonalité des arêtes u,v, à une tolérance relative                           | rejette si \|u·v\| > 1e-6·‖u‖·‖v‖ | idem                                          | idem               |
| 21            | `Vector3.multiplyScalar(1/area)`         | Normalise la normale par l'aire (équivalent à une normalisation unitaire ici)           | n_unitaire = n / aire             | idem                                          | idem               |
| 22            | `Matrix4.makeBasis(u, v, normal)`        | Construit la matrice de rotation dont les colonnes sont u, v, n                         | M[:,0]=u, M[:,1]=v, M[:,2]=n      | idem                                          | idem               |
| 23, 32        | `Matrix4.setPosition(x, y, z)`           | Fixe la colonne de translation de la base (origine de la surface / centre de la sphère) | M[:,3] = (x,y,z,1)                | idem                                          | idem               |
| 31            | `Matrix4.makeScale(r, r, r)`             | Matrice d'échelle uniforme pour la sphère brillante                                     | M = diag(r,r,r,1)                 | idem                                          | idem               |

## packages/sdk-browser/pageCone.ts

| Site (lignes) | Méthode Three appelée                                       | Ce que ça calcule ici                                                                        | Formule équivalente                              | Fréquence                                                          | Chemin                                |
| ------------- | ----------------------------------------------------------- | -------------------------------------------------------------------------------------------- | ------------------------------------------------ | ------------------------------------------------------------------ | ------------------------------------- |
| 100           | `Matrix3.getNormalMatrix(world)`                            | Matrice normale de la transformation d'une racine (inverse-transposée du bloc 3×3)           | N = (M₃ₓ₃⁻¹)ᵀ                                    | Une fois par racine, par image (posé dans `coneContextFor`)        | Rejet de cône (culling par direction) |
| 101, 102      | `Object3D.updateMatrixWorld()`, `Camera.getWorldPosition()` | Recompose la matrice monde de la caméra et en extrait la position                            | M_monde = M_local ; pos = colonne de translation | Une fois par racine, par image                                     | idem                                  |
| 126-127       | `Vector3.set(...).applyMatrix4(world)`                      | Centre monde de la boîte du cluster (transforme le centre local par la matrice de la racine) | c_monde = M · c_local                            | Par cluster testé, par image (chemin de coupe sans hiérarchie GPU) | Rejet de cône par cluster             |
| 136           | `Vector3.fromArray(axis).applyMatrix3(ctx.normal)`          | Transforme l'axe du cône par la matrice normale de la racine                                 | a' = N · a                                       | Par cluster testé                                                  | idem                                  |
| 137, 139      | `Vector3.length()`, `Vector3.multiplyScalar(1/al)`          | Normalise l'axe transformé                                                                   | a_unitaire = a' / ‖a'‖                           | Par cluster testé                                                  | idem                                  |

## packages/sdk-browser/pageRaster.ts

| Site (lignes)    | Méthode Three appelée                                            | Ce que ça calcule ici                                                          | Formule équivalente | Fréquence                                                                 | Chemin                        |
| ---------------- | ---------------------------------------------------------------- | ------------------------------------------------------------------------------ | ------------------- | ------------------------------------------------------------------------- | ----------------------------- |
| 44-48, 103-107   | `Object3D.updateMatrixWorld()`, `Matrix4.multiplyMatrices(P, V)` | Matrice vue-projection pour la rastérisation CPU de référence (oracle de test) | VP = P · V          | Par appel à `rasterPageRecords`/`rasterPages` (oracle, pas le rendu réel) | Oracle CPU (diagnostic/tests) |
| 136-139, 155-158 | `Vector3.set(x,y,z).applyMatrix4(matrix).applyMatrix4(viewProj)` | Projette un sommet : espace local → monde/page → clip                          | v' = VP · (M · v)   | Par sommet de chaque triangle rastérisé                                   | idem                          |

## packages/sdk-browser/pageSelectionCollect.ts

| Site (lignes) | Méthode Three appelée                         | Ce que ça calcule ici                            | Formule équivalente                        | Fréquence                                                     | Chemin                                       |
| ------------- | --------------------------------------------- | ------------------------------------------------ | ------------------------------------------ | ------------------------------------------------------------- | -------------------------------------------- |
| 99            | `Box3.clone().applyMatrix4(mesh.matrixWorld)` | Boîte englobante monde d'une racine de primitive | box_monde = transform(box_locale, M_monde) | Une fois par primitive, à la collecte des pages (préparation) | Préparation de la coupe (une fois par scène) |

## packages/sdk-browser/pageSelectionCut.ts

| Site (lignes) | Méthode Three appelée                                               | Ce que ça calcule ici                                                  | Formule équivalente                                                   | Fréquence                         | Chemin                                        |
| ------------- | ------------------------------------------------------------------- | ---------------------------------------------------------------------- | --------------------------------------------------------------------- | --------------------------------- | --------------------------------------------- |
| 35            | `Object3D.updateMatrixWorld()`                                      | Recompose la matrice monde de la caméra avant la coupe                 | M_monde = M_local                                                     | Par image (coupe principale)      | Coupe de clusters (chemin critique par image) |
| 36-37         | `Matrix4.multiplyMatrices(P, V)`, `Frustum.setFromProjectionMatrix` | Matrice vue-projection puis 6 plans du frustum caméra                  | VP = P·V ; plans du frustum                                           | Par image                         | idem                                          |
| 77            | `Frustum.intersectsBox(root.worldBox)`                              | Test d'intersection frustum/AABB pour rejeter une racine hors champ    | test des 6 plans contre les 8 coins de la boîte (SAT simplifié Three) | Par racine, par image             | idem                                          |
| 81            | `Matrix4.multiplyMatrices(matrixWorldInverse, root.world)`          | Matrice vue de la racine (objet→vue) pour l'étirement/l'erreur d'écran | V_racine = V_caméra · M_racine                                        | Par racine non rejetée, par image | idem                                          |

## packages/sdk-browser/pageSelectionDiagnostic.ts

| Site (lignes) | Méthode Three appelée                                                                      | Ce que ça calcule ici                                                                      | Formule équivalente        | Fréquence                                              | Chemin                             |
| ------------- | ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------ | -------------------------- | ------------------------------------------------------ | ---------------------------------- |
| 17-18         | `Object3D.updateMatrixWorld()`, `Matrix4.multiplyMatrices(matrixWorldInverse, rec.matrix)` | Matrice vue d'une page affichée, pour recalculer son erreur d'écran affichée en diagnostic | V_page = V_caméra · M_page | Par page, sur demande de diagnostic (pas chaque image) | Diagnostic (mode « screen-error ») |

## packages/sdk-browser/pageSelectionHelpers.ts

| Site (lignes) | Méthode Three appelée              | Ce que ça calcule ici                                                          | Formule équivalente                       | Fréquence                                 | Chemin      |
| ------------- | ---------------------------------- | ------------------------------------------------------------------------------ | ----------------------------------------- | ----------------------------------------- | ----------- |
| 191           | `Object3D.updateMatrixWorld(true)` | Recompose les matrices monde de la scène source avant d'énumérer ses maillages | M_monde(n) = M_monde(parent) · M_local(n) | À la collecte des maillages (préparation) | Préparation |

## packages/sdk-browser/pageSelectionRequests.ts

| Site (lignes) | Méthode Three appelée             | Ce que ça calcule ici                                                                       | Formule équivalente             | Fréquence                                 | Chemin                             |
| ------------- | --------------------------------- | ------------------------------------------------------------------------------------------- | ------------------------------- | ----------------------------------------- | ---------------------------------- |
| 14            | `Vector3.distanceTo(motion.last)` | Vitesse de la caméra (distance parcourue / temps écoulé), pour l'erreur de pixel adaptative | vitesse = ‖pos − pos_préc‖ / Δt | Par image (quand `lodAdaptive` est actif) | Seuil adaptatif (chemin par image) |

## packages/sdk-browser/pagesBackendScenes.ts

| Site (lignes) | Méthode Three appelée    | Ce que ça calcule ici                    | Formule équivalente     | Fréquence                                               | Chemin                                                                                                      |
| ------------- | ------------------------ | ---------------------------------------- | ----------------------- | ------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| 46            | `Camera.lookAt(0, 0, 0)` | Oriente la caméra de test vers l'origine | rotation visant (0,0,0) | Par appel à `frontCamera()` (scènes de test uniquement) | Test (fichier de scènes fixtures, non couvert par le nom d'exclusion mais utilisé uniquement par les tests) |

## packages/sdk-browser/referenceBackend.ts

| Site (lignes) | Méthode Three appelée                  | Ce que ça calcule ici                                                 | Formule équivalente                       | Fréquence                      | Chemin                                  |
| ------------- | -------------------------------------- | --------------------------------------------------------------------- | ----------------------------------------- | ------------------------------ | --------------------------------------- |
| 30            | `Matrix4.copy(mesh.matrixWorld)`       | Fixe la matrice de la copie de référence WebGL (copie, pas de calcul) | memcpy                                    | Par maillage, à la préparation | Moteur de référence Three (comparaison) |
| 63            | `Object3D.updateMatrixWorld(true)`     | Recompose les matrices monde de la scène source                       | M_monde(n) = M_monde(parent) · M_local(n) | Par image                      | idem                                    |
| 67            | `Matrix4.copy(sourceMesh.matrixWorld)` | Resynchronise la copie de référence sur la matrice monde de la source | memcpy                                    | Par maillage, par image        | idem                                    |

## packages/sdk-browser/replicateInstances.ts

| Site (lignes) | Méthode Three appelée              | Ce que ça calcule ici                                                                             | Formule équivalente                                               | Fréquence                                         | Chemin                   |
| ------------- | ---------------------------------- | ------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- | ------------------------------------------------- | ------------------------ |
| 10            | `Object3D.updateMatrixWorld(true)` | Recompose les matrices monde avant de mesurer les bornes de la source                             | M_monde(n) = M_monde(parent) · M_local(n)                         | Une fois, au chargement (réplication d'instances) | Chargement (réplication) |
| 11            | `Box3.setFromObject(source)`       | Boîte englobante monde de toute la scène source (utilisée si aucune boîte préparée n'est fournie) | union des boîtes de chaque maillage transformées par leur M_monde | Une fois, au chargement                           | idem                     |
| 12            | `Box3.getSize(Vector3)`            | Dimensions de la boîte, pour espacer les réplicas sur une grille                                  | taille = max − min                                                | Une fois, au chargement                           | idem                     |
| 25            | `Matrix4.copy(mesh.matrixWorld)`   | Fixe la matrice de chaque copie répliquée (copie)                                                 | memcpy                                                            | Par maillage × par réplica, au chargement         | idem                     |
| 32            | `Object3D.updateMatrixWorld(true)` | Recompose les matrices monde du groupe répliqué                                                   | M_monde(n) = M_monde(parent) · M_local(n)                         | Une fois, au chargement                           | idem                     |

## packages/sdk-browser/sceneLighting.ts

| Site (lignes) | Méthode Three appelée                        | Ce que ça calcule ici                                                               | Formule équivalente                       | Fréquence                         | Chemin                                                          |
| ------------- | -------------------------------------------- | ----------------------------------------------------------------------------------- | ----------------------------------------- | --------------------------------- | --------------------------------------------------------------- |
| 35            | `Object3D.updateWorldMatrix(true, false)`    | Recompose la matrice monde d'une lampe source (sans descendre aux enfants)          | M_monde(n) = M_monde(parent) · M_local(n) | Par lampe, par image (`update()`) | Synchronisation d'éclairage (tous les moteurs rendus par Three) |
| 36            | `Vector3.setFromMatrixPosition(matrixWorld)` | Extrait la position monde de la lampe copiée depuis la matrice monde de l'originale | pos = colonne de translation de M_monde   | idem                              | idem                                                            |
| 44            | `Object3D.updateWorldMatrix(true, false)`    | Recompose la matrice monde de la cible d'une lampe directionnelle                   | idem                                      | idem                              | idem                                                            |
| 45            | `Vector3.setFromMatrixPosition(matrixWorld)` | Position monde de la cible de la lampe                                              | idem                                      | idem                              | idem                                                            |

## packages/sdk-browser/sceneMeshes.ts

| Site (lignes) | Méthode Three appelée              | Ce que ça calcule ici                                                   | Formule équivalente                       | Fréquence                                                         | Chemin      |
| ------------- | ---------------------------------- | ----------------------------------------------------------------------- | ----------------------------------------- | ----------------------------------------------------------------- | ----------- |
| 5             | `Object3D.updateMatrixWorld(true)` | Recompose les matrices monde avant d'énumérer les maillages de la scène | M_monde(n) = M_monde(parent) · M_local(n) | À chaque appel `meshes(source)` (préparation, plusieurs backends) | Préparation |

## packages/sdk-browser/threeLod.ts

| Site (lignes) | Méthode Three appelée                            | Ce que ça calcule ici                                                                | Formule équivalente                                              | Fréquence                                                     | Chemin                                            |
| ------------- | ------------------------------------------------ | ------------------------------------------------------------------------------------ | ---------------------------------------------------------------- | ------------------------------------------------------------- | ------------------------------------------------- |
| 39            | `Matrix4.copy(mesh.matrixWorld)`                 | Fixe la matrice du nœud `THREE.LOD` sur la pose de la source (copie)                 | memcpy                                                           | Par maillage, à la construction                               | Moteur `three-lod` (référence de comparaison LOD) |
| 72-73         | `Box3.expandByPoint(Vector3.fromArray(min/max))` | Étend la boîte englobante du niveau grossier aux bornes de chaque cluster inclus     | box ∪= point                                                     | Par cluster grossier, à la construction                       | idem                                              |
| 77            | `Box3.getBoundingSphere(Sphere)`                 | Sphère englobante du niveau grossier, depuis sa boîte                                | centre = (min+max)/2, rayon = ‖max−centre‖                       | Une fois par maillage avec niveau grossier, à la construction | idem                                              |
| 152           | `Matrix4.copy(sourceMesh.matrixWorld)`           | Resynchronise le nœud LOD sur la matrice monde de la source                          | memcpy                                                           | Par maillage LOD, par image                                   | idem                                              |
| 153           | `Object3D.updateMatrixWorld(true)`               | Recompose la matrice monde du nœud LOD et ses niveaux                                | M_monde(n) = M_monde(parent) · M_local(n)                        | Par maillage LOD, par image                                   | idem                                              |
| 154           | `LOD.update(camera)`                             | Sélection du niveau de détail par distance caméra↔objet (algorithme interne à Three) | choisit le plus grand rayon de bascule ≤ distance(caméra, objet) | Par maillage LOD, par image                                   | idem (cœur de la référence LOD par distance)      |

## packages/sdk-browser/visibilityLighting.ts

Ombrage CPU complet (espace tangent + BRDF Cook-Torrance) du chemin de référence CPU du visbuffer ;
gros bloc concentré, détaillé ligne par ligne car c'est le fichier le plus dense en appels Three du lot.

| Site (lignes) | Méthode Three appelée                                                                                                                    | Ce que ça calcule ici                                                                                                                                                                         | Formule équivalente                                                     | Fréquence                                                                         | Chemin                                                                |
| ------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- | --------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| 63            | `Matrix3.getNormalMatrix(page.matrix)`                                                                                                   | Matrice normale de la page (inverse-transposée du bloc 3×3)                                                                                                                                   | N = (M₃ₓ₃⁻¹)ᵀ                                                           | Une fois par page ombrée, par pixel appelant (voir note fréquence)                | Ombrage CPU du visbuffer (référence/diagnostic, pas le chemin WebGPU) |
| 67-71         | `Vector3.fromBufferAttribute(...).applyMatrix3(N).normalize().multiplyScalar(side)`                                                      | Transforme les 3 normales de sommet du triangle en espace monde, les normalise, applique le sens de face                                                                                      | n' = normalize(N · n) · côté                                            | Par sommet (×3), par triangle ombré, par pixel touché                             | idem                                                                  |
| 73-78         | `Vector3.copy(a).multiplyScalar(w0).addScaledVector(b,w1).addScaledVector(c,w2).normalize()`                                             | Normale interpolée au pixel par combinaison barycentrique des 3 normales de sommet                                                                                                            | n = normalize(w0·n0 + w1·n1 + w2·n2)                                    | Par pixel ombré                                                                   | idem                                                                  |
| 79            | `Vector3.multiplyScalar(face)`                                                                                                           | Retourne la normale interpolée si la face est vue de dos et le matériau double face                                                                                                           | n *= face                                                               | Par pixel (matériaux double face)                                                 | idem                                                                  |
| 102-109       | `Vector3.fromBufferAttribute(...).transformDirection(M).multiplyScalar(side)`, `Vector3.crossVectors(n,t).multiplyScalar(w).normalize()` | Tangentes/bitangentes de sommet, transformées en espace monde (direction seule) puis orthogonalisées par produit vectoriel avec la normale                                                    | t' = normalize(direction(M,t))·côté ; b = normalize((n×t')·w)           | Par sommet (×3), quand une carte de normales et des tangentes explicites existent | idem                                                                  |
| 111-122       | combinaison barycentrique + `normalize()` (×2)                                                                                           | Tangente T et bitangente B interpolées au pixel                                                                                                                                               | T = normalize(Σ wᵢ·tᵢ) ; B = normalize(Σ wᵢ·bᵢ)                         | Par pixel ombré (chemin avec tangentes explicites)                                | idem                                                                  |
| 131-137       | `Vector3.set(...)` (produits vectoriels manuels q1,q0), `copy/multiplyScalar/addScaledVector`, `lengthSq()`                              | Construction de repère tangent à partir des dérivées UV (méthode classique sans tangentes stockées) : q1 = c×N, q0 = N×n, T = du1·q1+du2·q0, B = dv1·q1+dv2·q0, puis normalisation par l'aire | T,B construits depuis ∂p/∂u, ∂p/∂v ; échelle = face / √max(‖T‖²,‖B‖²,ε) | Par pixel ombré (chemin de repli, sans tangentes explicites)                      | idem                                                                  |
| 139-142       | `Vector3.multiplyScalar(face)` (×2)                                                                                                      | Retourne T,B si face arrière et matériau double face                                                                                                                                          | T,B *= face                                                             | Par pixel (double face)                                                           | idem                                                                  |
| 143-146       | `Vector3.multiplyScalar(mapN[i]).addScaledVector(...).normalize()`                                                                       | Perturbation de la normale par la carte de normales dans le repère TBN                                                                                                                        | n_final = normalize(mapN.x·T + mapN.y·B + mapN.z·N)                     | Par pixel avec carte de normales                                                  | idem                                                                  |

Après cette section (lignes 151-197), le reste du fichier est de l'arithmétique scalaire pure (BRDF
Cook-Torrance GGX : distribution D, terme de visibilité de Smith, Fresnel de Schlick, diffusion
lambertienne, ambiance hémisphérique) sans appel Three supplémentaire — hors du périmètre T1
(délégué à Three), à recenser par le lot couvrant les formules propres au moteur.

## packages/sdk-browser/visibilityProjection.ts

| Site (lignes) | Méthode Three appelée                     | Ce que ça calcule ici                                           | Formule équivalente   | Fréquence                                           | Chemin                               |
| ------------- | ----------------------------------------- | --------------------------------------------------------------- | --------------------- | --------------------------------------------------- | ------------------------------------ |
| 13-15         | `Vector3.set(x,y,z).applyMatrix4(matrix)` | Transforme un sommet de l'espace local vers l'espace monde/page | v_monde = M · v_local | Par sommet projeté (rastérisation CPU du visbuffer) | Visbuffer CPU (référence/diagnostic) |

## packages/sdk-browser/visibilityRaster.ts

| Site (lignes) | Méthode Three appelée            | Ce que ça calcule ici                                                        | Formule équivalente | Fréquence                      | Chemin                               |
| ------------- | -------------------------------- | ---------------------------------------------------------------------------- | ------------------- | ------------------------------ | ------------------------------------ |
| 76            | `Object3D.updateMatrixWorld()`   | Recompose la matrice monde de la caméra avant de rastériser le visbuffer CPU | M_monde = M_local   | Par appel à `rasterVisibility` | Visbuffer CPU (référence/diagnostic) |
| 77-80         | `Matrix4.multiplyMatrices(P, V)` | Matrice vue-projection pour la rastérisation CPU                             | VP = P · V          | Par appel                      | idem                                 |

## packages/sdk-browser/visibilityShade.ts

| Site (lignes) | Méthode Three appelée                                            | Ce que ça calcule ici                                                                         | Formule équivalente | Fréquence                                                    | Chemin                             |
| ------------- | ---------------------------------------------------------------- | --------------------------------------------------------------------------------------------- | ------------------- | ------------------------------------------------------------ | ---------------------------------- |
| 18-22         | `Object3D.updateMatrixWorld()`, `Matrix4.multiplyMatrices(P, V)` | Matrice vue-projection pour l'ombrage CPU du visbuffer (image complète)                       | VP = P · V          | Par appel à `shadeVisibility`                                | Ombrage CPU (référence/diagnostic) |
| 50-53         | `Object3D.updateMatrixWorld()`, `Matrix4.multiplyMatrices(P, V)` | Même matrice vue-projection, pour retrouver le triangle gagnant d'un pixel et ses dérivées UV | VP = P · V          | Par appel à `visibilityUvDerivatives` (un pixel, diagnostic) | idem                               |

## packages/sdk-browser/webgpuBlendDraw.ts

| Site (lignes) | Méthode Three appelée   | Ce que ça calcule ici                                                                                                          | Formule équivalente   | Fréquence                                   | Chemin                                                      |
| ------------- | ----------------------- | ------------------------------------------------------------------------------------------------------------------------------ | --------------------- | ------------------------------------------- | ----------------------------------------------------------- |
| 150           | `Matrix4.determinant()` | Signe du déterminant de la matrice d'un item transparent, pour savoir si la transformation retourne le sens des faces (miroir) | renversé = det(M) < 0 | Par item transparent double face, par image | WebGPU, passe de dessin des transparents (chemin par image) |

## packages/sdk-browser/webgpuBlendPrepare.ts

| Site (lignes) | Méthode Three appelée                    | Ce que ça calcule ici                                                                | Formule équivalente                  | Fréquence                                       | Chemin                               |
| ------------- | ---------------------------------------- | ------------------------------------------------------------------------------------ | ------------------------------------ | ----------------------------------------------- | ------------------------------------ |
| 74            | `BufferGeometry.computeBoundingBox()`    | Calcule la boîte englobante locale d'une géométrie transparente depuis ses positions | box = min/max des sommets            | Une fois par copie de mélange, à la préparation | WebGPU, préparation des transparents |
| 75            | `Box3.clone().applyMatrix4(copy.matrix)` | Boîte englobante monde de l'item (transformation statique figée)                     | box_monde = transform(box_locale, M) | Une fois par copie de mélange, à la préparation | idem                                 |

## packages/sdk-browser/webgpuPagesEncodeBlend.ts

| Site (lignes) | Méthode Three appelée              | Ce que ça calcule ici                                                                                                  | Formule équivalente               | Fréquence | Chemin                                                       |
| ------------- | ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------- | --------------------------------- | --------- | ------------------------------------------------------------ |
| 85            | `Matrix4.copy(viewProj).invert()`  | Inverse la matrice vue-projection pour la résolution différée (reconstruction position/direction monde depuis l'écran) | VP⁻¹                              | Par image | WebGPU, résolution de l'éclairage différé (chemin par image) |
| 96            | `Camera.getWorldPosition(Vector3)` | Position monde de la caméra, transmise à la résolution différée                                                        | colonne de translation de M_monde | Par image | idem                                                         |

## packages/sdk-browser/webgpuPagesEncodeDraws.ts

| Site (lignes) | Méthode Three appelée                                         | Ce que ça calcule ici                                           | Formule équivalente                                    | Fréquence | Chemin                                                 |
| ------------- | ------------------------------------------------------------- | --------------------------------------------------------------- | ------------------------------------------------------ | --------- | ------------------------------------------------------ |
| 74            | `Matrix4.multiplyMatrices(P, V)`                              | Matrice vue-projection principale de l'image                    | VP = P · V                                             | Par image | WebGPU, cœur de l'encodage par image (chemin critique) |
| 75            | `Frustum.setFromProjectionMatrix(viewProj, coordinateSystem)` | 6 plans du frustum pour la sélection des items transparents     | plans extraits de VP (convention WebGPU de profondeur) | Par image | idem                                                   |
| 77            | `Matrix4.premultiply(remap)`                                  | Remappe la profondeur NDC de [-1,1] (Three) vers [0,1] (WebGPU) | VP' = remap · VP                                       | Par image | idem                                                   |

## packages/sdk-browser/webgpuPagesEncodeShadows.ts

| Site (lignes) | Méthode Three appelée                         | Ce que ça calcule ici                                                                 | Formule équivalente                         | Fréquence                            | Chemin                           |
| ------------- | --------------------------------------------- | ------------------------------------------------------------------------------------- | ------------------------------------------- | ------------------------------------ | -------------------------------- |
| 45            | `Camera.getWorldPosition(Vector3).toArray()`  | Position monde de la caméra, point de vue pour la planification des cascades d'ombres | colonne de translation de M_monde           | Par image (planification des ombres) | WebGPU, planification des ombres |
| 46            | `Camera.getWorldDirection(Vector3).toArray()` | Direction avant de la caméra (axe -Z tourné par la rotation monde)                    | d = −Z monde = rotation(M_monde) · (0,0,−1) | Par image                            | idem                             |

## packages/sdk-browser/webgpuPagesEncoder.ts

| Site (lignes) | Méthode Three appelée                        | Ce que ça calcule ici                                             | Formule équivalente               | Fréquence                                      | Chemin                                              |
| ------------- | -------------------------------------------- | ----------------------------------------------------------------- | --------------------------------- | ---------------------------------------------- | --------------------------------------------------- |
| 81            | `Camera.getWorldPosition(Vector3).toArray()` | Position monde de la caméra, jointe à l'échantillon de mesure GPU | colonne de translation de M_monde | Par image échantillonnée (mesure de temps GPU) | Diagnostic/mesure (pas le chemin de rendu lui-même) |

## packages/sdk-browser/webgpuPagesHelpers.ts

| Site (lignes) | Méthode Three appelée         | Ce que ça calcule ici                                           | Formule équivalente                                               | Fréquence                              | Chemin                               |
| ------------- | ----------------------------- | --------------------------------------------------------------- | ----------------------------------------------------------------- | -------------------------------------- | ------------------------------------ |
| 6             | `Matrix4.set(...)`            | Matrice constante de remappage de profondeur NDC [-1,1] → [0,1] | matrice diagonale/translation fixe                                | Une fois, au chargement du module      | WebGPU (constante partagée)          |
| 44            | `Color.copy(color)`           | Recopie une couleur de matériau (pas de calcul)                 | memcpy                                                            | Par appel à `linearColor`              | Couleur linéaire (diagnostic/dessin) |
| 45, 50        | `Color.convertSRGBToLinear()` | Convertit une couleur sRGB en espace linéaire                   | linéaire = ((sRGB+0.055)/1.055)^2.4 (ou sRGB/12.92 sous le seuil) | Par appel à `linearColor`/`clusterRgb` | idem                                 |
| 49            | `Color.setHSL(h, s, l)`       | Couleur diagnostique d'un cluster depuis sa teinte              | conversion HSL→RGB standard                                       | Par appel à `clusterRgb` (diagnostic)  | Diagnostic                           |

## packages/sdk-browser/webgpuPagesRender.ts

| Site (lignes) | Méthode Three appelée                         | Ce que ça calcule ici                                                    | Formule équivalente                  | Fréquence                                   | Chemin                                     |
| ------------- | --------------------------------------------- | ------------------------------------------------------------------------ | ------------------------------------ | ------------------------------------------- | ------------------------------------------ |
| 37-40         | `Camera.copy(camera, false)`                  | Clone l'état de la caméra dans l'historique Hi-Z occlusif (sans enfants) | copie des propriétés caméra          | Par image où la vue Hi-Z change             | WebGPU, historique d'occlusion (par image) |
| 44            | `Matrix4.copy(sourceMesh.matrixWorld)`        | Resynchronise la matrice d'un item transparent sur sa source (copie)     | memcpy                               | Par item transparent, par image             | WebGPU, préparation des transparents       |
| 46            | `Box3.copy(boundingBox).applyMatrix4(matrix)` | Boîte englobante monde de l'item transparent                             | box_monde = transform(box_locale, M) | Par item transparent avec bornes, par image | idem                                       |

## packages/sdk-browser/webgpuPagesSetup.ts

| Site (lignes) | Méthode Three appelée            | Ce que ça calcule ici                                                           | Formule équivalente | Fréquence                                                  | Chemin                                   |
| ------------- | -------------------------------- | ------------------------------------------------------------------------------- | ------------------- | ---------------------------------------------------------- | ---------------------------------------- |
| 53            | `Matrix4.copy(mesh.matrixWorld)` | Fixe la matrice d'une copie de mélange paginée sur la pose de sa source (copie) | memcpy              | Une fois par maillage transparent paginé, à la préparation | WebGPU, préparation (une fois par scène) |

## packages/sdk-browser/webgpuPagesStateTiming.ts

| Site (lignes) | Méthode Three appelée                             | Ce que ça calcule ici                                                | Formule équivalente                          | Fréquence                                    | Chemin           |
| ------------- | ------------------------------------------------- | -------------------------------------------------------------------- | -------------------------------------------- | -------------------------------------------- | ---------------- |
| 184           | `Camera.getWorldPosition(Vector3).toArray()`      | Position monde de la caméra pour l'échantillon de pose de diagnostic | colonne de translation de M_monde            | Par échantillon de diagnostic (`cameraPose`) | Diagnostic/trace |
| 185           | `Camera.getWorldQuaternion(Quaternion).toArray()` | Orientation monde de la caméra pour le même échantillon              | quaternion extrait de la rotation de M_monde | idem                                         | idem             |

## packages/sdk-browser/webgpuPagesSurfaceCapture.ts

| Site (lignes) | Méthode Three appelée                        | Ce que ça calcule ici                                                                                        | Formule équivalente                     | Fréquence                                                     | Chemin                      |
| ------------- | -------------------------------------------- | ------------------------------------------------------------------------------------------------------------ | --------------------------------------- | ------------------------------------------------------------- | --------------------------- |
| 46            | `Matrix4.clone().invert()`                   | Inverse la matrice vue-projection courante pour reconstruire position/direction monde des surfaces capturées | VP⁻¹                                    | Par capture de surface (action utilisateur, pas chaque image) | Capture de surface (mesure) |
| 47            | `Camera.getWorldPosition(Vector3).toArray()` | Position monde de la caméra de capture                                                                       | colonne de translation de M_monde       | Par capture                                                   | idem                        |
| 104           | `Camera.updateProjectionMatrix()`            | Reconstruit la projection perspective de la vue de capture (aspect propre)                                   | P = perspective(fov, aspect, near, far) | Par capture                                                   | idem                        |
| 105           | `Object3D.updateMatrixWorld()`               | Recompose la matrice monde de la vue de capture                                                              | M_monde = M_local                       | Par capture                                                   | idem                        |

## packages/sdk-browser/webgpuPagesTransform.ts

| Site (lignes) | Méthode Three appelée                            | Ce que ça calcule ici                                                                     | Formule équivalente                      | Fréquence                                                                     | Chemin                               |
| ------------- | ------------------------------------------------ | ----------------------------------------------------------------------------------------- | ---------------------------------------- | ----------------------------------------------------------------------------- | ------------------------------------ |
| 46            | `Matrix4.copy(node.parent.matrixWorld).invert()` | Inverse la matrice monde du parent, pour ramener la matrice demandée dans le repère local | M_parent⁻¹                               | Par appel `setWebgpuTransform` (déplacement de nœud, rare, piloté par l'hôte) | Déplacement de nœud nommé (API hôte) |
| 47            | `Matrix4.premultiply(parentInverse)`             | Convertit la matrice monde demandée en matrice locale au parent                           | M_locale = M_parent⁻¹ · M_monde_demandée | idem                                                                          | idem                                 |
| 49            | `Matrix4.decompose(position, quaternion, scale)` | Décompose la matrice locale en position, rotation (quaternion), échelle                   | (T,R,S) tels que M = T·R·S               | idem                                                                          | idem                                 |
| 54            | `Box3.copy(localBox).applyMatrix4(root.world)`   | Recalcule la boîte englobante monde d'une racine affectée par le déplacement              | box_monde = transform(box_locale, M)     | Par racine sous le nœud déplacé, par appel                                    | idem                                 |

### Synthèse du lot

- **118** fichiers de `packages/sdk-browser` importent `three`, mais seuls **49** appellent effectivement
  une méthode mathématique de Three (les autres s'en servent uniquement pour du typage ou construisent
  des objets — `Mesh`, `Scene`, `BufferGeometry` — sans appeler de méthode de calcul).
- **≈150** sites d'appel recensés, pour une **trentaine** de méthodes Three distinctes.
- Méthodes les plus appelées, toutes catégories : `updateMatrixWorld`/`updateWorldMatrix` (récompose la
  hiérarchie TRS, dans presque tous les fichiers), `Matrix4.multiplyMatrices` (matrice vue-projection,
  ~10 sites), `Matrix4.copy(...)` (recopie de pose, très fréquent, sans calcul), `getWorldPosition`
  (position caméra/lampe), `applyMatrix4`/`applyMatrix3` (transformation de sommets/boîtes/normales).
- **Chemin WebGPU par image (le chemin à remplacer pour le plan sans Three.js)** : `pageSelectionCut.ts`
  (`updateMatrixWorld`, `multiplyMatrices` P·V, `setFromProjectionMatrix`, `intersectsBox`,
  `multiplyMatrices` vue-racine — la coupe de clusters elle-même) ; `gpuSelection.ts` (mêmes calculs pour
  les uniformes GPU) ; `webgpuPagesEncodeDraws.ts` (VP, frustum transparents, `premultiply(remap)`) ;
  `webgpuPagesEncodeBlend.ts` (inversion VP, position caméra, pour la résolution différée) ;
  `webgpuPagesEncodeShadows.ts` (position/direction caméra pour la planification d'ombres) ;
  `webgpuBlendDraw.ts` (`determinant()` pour le sens des faces) ; `webgpuPagesRender.ts`/`webgpuPagesTransform.ts`
  (boîtes monde des items transparents, historique Hi-Z, déplacement de nœuds) ; les fichiers Hi-Z
  (`hizDepth.ts`, `hizProjection.ts`, `hizProjectionHold.ts`, `hizTemporal.ts`) pour la matrice VP et
  la comparaison de vues. Toutes ces matrices vue-projection (`multiplyMatrices(P, V)`) sont la **même
  formule recodée à répétition** : `pageSelectionCut.ts`, `gpuSelection.ts`, `hizDepth.ts`,
  `hizProjection.ts`, `webgpuPagesEncodeDraws.ts`, `pageRaster.ts`, `visibilityRaster.ts`,
  `visibilityShade.ts` (×2) en sont autant de copies indépendantes.
- **Chemin des moteurs de référence Three (comparaison, pas le moteur cible)** :
  `referenceBackend.ts` (recopie de pose par maillage/image), `threeLod.ts` (`LOD.update(camera)` — la
  sélection de niveau par distance est entièrement déléguée à Three), `pageRaster.ts`/`visibilityRaster.ts`/
  `visibilityShade.ts`/`visibilityLighting.ts` (rastérisation et ombrage CPU utilisés comme oracle de
  test, pas le rendu réel), `pagesBackendScenes.ts` (scènes de test).
- **Chemin diagnostic/mesure uniquement** : `pageSelectionDiagnostic.ts` (vue par page en mode
  « screen-error »), `webgpuPagesStateTiming.ts` et `webgpuPagesEncoder.ts` (pose caméra pour la trace),
  `webgpuPagesSurfaceCapture.ts` (capture de surface sur demande hôte), `webgpuPagesHelpers.ts`
  (conversions de couleur sRGB↔linéaire et HSL pour la coloration diagnostique).
- **Chemin préparation/chargement (une fois, pas par image)** : `pageSelectionCollect.ts`,
  `pageSelectionHelpers.ts`, `sceneMeshes.ts`, `replicateInstances.ts`, `explorerCamera.ts`,
  `explorerScene.ts`, `webgpuPagesSetup.ts`, `webgpuBlendPrepare.ts`, `autonomousGeometry.ts`,
  `clusterBatchPrimitive.ts`, `exactPagesAttachment.ts` (sphères/boîtes englobantes et boîtes monde
  calculées une fois à la collecte des pages, pas par image).
- Cas notable : `hizCorners.ts` documente en commentaire une équivalence bit à bit avec
  `Matrix4`/`Vector3.applyMatrix4`, mais **réimplémente la transformation à la main** (pas d'appel Three)
  — aucun calcul délégué dans ce fichier malgré sa proximité évidente avec le reste du lot Hi-Z.
- Doublon net : la sphère englobante depuis une boîte (`Box3.getBoundingSphere`) est calculée à
  l'identique dans `autonomousGeometry.ts`, `clusterBatchPrimitive.ts`, `exactPagesAttachment.ts` et
  `threeLod.ts` — quatre implémentations du même besoin, une par backend.
