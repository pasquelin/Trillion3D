# Spécification — WebGeometry sans Three.js : moteur, éditeur, cuisson finale

Version 1, 14 septembre 2026. Document de référence pour les agents. Chaque exigence est numérotée et vérifiable ; une exigence sans mesure associée n'existe pas.

## 0. Objectif et non-objectifs

Objectif : un moteur de géométrie virtualisée complet et autonome pour le web, utilisable dans un éditeur (mode édition) et livrable dans un jeu (mode final), à 120 images par seconde sur les scènes du banc, sans perte de rendu, sans dépendance à Three.js dans le SDK ni dans le runtime livré. Three.js ne subsiste que dans le banc de mesure, comme moteur témoin.

Non-objectifs de cette version : animation squelettique, physique, audio, réseau, éclairage global dynamique, ombres. Ils sont hors périmètre et ne doivent pas être commencés avant la fin des phases 1 à 5.

Règles transverses : fidélité avant vitesse (aucune réduction de résolution, de distance, de qualité ; transparents jamais transformés en masqués) ; aucune dette ; mots interdits (nom du système de géométrie virtualisée d'Epic, nom de son moteur) ; un hôte ne configure rien et ne lit aucun champ de format ; tests écrits après le code, une passe ; chaque fusion prouvée par captures identiques ou différence expliquée au niveau du bruit A/A.

## 1. Architecture cible

```
Sources (glTF, FBX, OBJ, STL, PLY, images)
        │
        ▼
[1] Compilateur natif Rust (binaire unique, multi-OS, aussi en wasm pour l'éditeur)
    import → normalisation → clusters 128 tri → DAG par objet (multi-matériaux)
    → erreur certifiée (forme + couleur + quantification) → paquets autonomes
    → textures en mips streamables → manifeste binaire → cache par objet, adressé par empreinte
        │                                   ▲
        ▼                                   │ recompilation d'un objet (mode édition)
[2] Format de cache versionné (dossier statique, tout en .bin + un petit JSON)
        │
        ▼
[3] Runtime navigateur (TypeScript + WGSL + GLSL, zéro Three.js)
    chargeur → streaming prioritaire → sélection de clusters (GPU en WebGPU, CPU en WebGL2)
    → rendu (visibility buffer + éclairage différé en WebGPU ; multi-draw + forward en WebGL2)
    → API scène (ajouter, retirer, transformer, matériaux, caméra, picking)
        │
        ├── [4] Éditeur (mode édition : compilation incrémentale, échange à chaud, mode source, historique)
        └── [5] Cuisson finale (mode final : recompilation globale, blocs de quartier, ordre de streaming, runtime seul)

[6] Banc : Three.js témoin, campagnes 4 moteurs, parité WebGPU/WebGL2, captures, rapports
```

## 2. Compilateur natif (Rust)

C1. **Import** : glTF/GLB natif ; FBX et OBJ via `ufbx` ; STL et PLY. Sortie normalisée : positions, normales, UV (deux jeux), couleurs, tangentes si présentes, matériaux PBR (couleur, métal-rugosité, normale, émission, occlusion, alpha mode), hiérarchie et matrices, instances. Critère : les huit scènes du banc et trois fichiers FBX/OBJ de test importés sans Blender ni Node.
C2. **Clusters** : partition spatiale en clusters de ≤ 128 triangles, compacts, bornes sphère et boîte. Critère : distribution des tailles publiée, aucune boîte dégénérée.
C3. **DAG par objet, multi-matériaux** : construit sur toutes les primitives opaques d'un maillage ; groupes de 8 à 32 clusters ; simplification par groupe avec verrous par sommet aux frontières de groupes ; chaque triangle garde son matériau ; pages publiant des plages par matériau. Frontières de matériaux verrouillées tant qu'elles représentent plus d'un pixel à la distance de bascule du niveau, libres au-delà. Transparents : DAG propre par primitive, ordre source conservé. Critère : Emerald vue générale ≤ 200 000 triangles sélectionnés à 1 px pour une ville, image identique à 0 px, différences à 1 px localisées et sous le seuil.
C4. **Erreur certifiée** : `error(cluster) = max(erreur géométrique du groupe, erreurs des enfants) + erreur de quantification + erreur de couleur` (déviation UV et normale pondérée par la texture), monotone, en unités objet, avec sphère de projection. Critère : test de monotonie sur toutes les scènes, aucune violation.
C5. **Paquets autonomes** : chaque paquet (~64 à 128 Ko) contient index, positions quantifiées (16 bits par axe sur la boîte du cluster), normales octaédriques 16 bits, UV 16 bits, couleurs 8 bits, plages de matériaux ; encodé meshopt ; `source.bin` n'est plus lu par le runtime. Critère : octets par triangle ≤ 12 ; remplissage de la vue générale d'Emerald < 300 ms à chaud.
C6. **Textures** : décodage PNG/JPEG dans le compilateur, génération des mips, découpe en tuiles ou en niveaux streamables, table d'atlas ; format GPU brut ou compressé sans perte visible (pas de supercompression avec perte tant qu'un test au pixel ne l'autorise pas). Critère : première image d'Emerald sans aucune texture pleine résolution ; mips demandés par visibilité.
C7. **Manifeste binaire** : colonnes typées (bornes, sphères, erreurs, niveaux, groupes, plages de matériaux, paquets, offsets), un JSON de quelques centaines de Ko (objets, matériaux, structure), le tout adressé par empreinte SHA-256. Critère : chargement + décodage < 100 ms pour Emerald.
C8. **Cache par objet** : un objet compilé = un dossier adressé par l'empreinte de sa source et des options ; une scène = un manifeste qui référence des objets et des instances. Recompiler un objet ne touche pas les autres. Critère : modifier un objet d'Emerald et recompiler ≤ 500 ms pour un objet de 100 000 triangles.
C9. **Binaire unique** : un exécutable par OS (macOS arm64/x64, Linux x64/arm64, Windows x64), protocole d'événements sur stdout (progression, erreurs, résultat court), résultat écrit sur disque, jamais un manifeste complet sur stdout. Le même code compilé en WebAssembly pour l'éditeur (compilation d'un objet dans le navigateur, hors thread principal). Critère : le Lab prépare ses scènes sans Node autrement que comme relais ; l'éditeur recompile un objet sans serveur.
C10. **Provenance** : empreinte du compilateur (sources + dépendances verrouillées) dans chaque cache ; deux compilations du même fichier donnent les mêmes octets. Critère : diff nul entre deux exécutions.

## 3. Runtime navigateur (TypeScript, WGSL, GLSL)

R1. **Zéro dépendance Three.js** dans `sdk-browser`. Maths propres (matrices, quaternions, frustum, rayons) partagées avec le compilateur via wasm là où la parité compte (erreur d'écran, picking).
R2. **Chargeur** : lit manifeste binaire et paquets ; jamais un champ de format côté hôte ; validation publique (`assertCachePointer`, `assertCacheReady`).
R3. **Streaming** : 32 transferts en vol, priorité par erreur d'écran puis distance, couronne de préchargement, prédiction de caméra, cache LRU borné en octets, cache persistant par empreinte (Cache Storage/OPFS), transferts en cours jamais annulés par un mouvement. Critère : après un saut de caméra, coupe complète < 300 ms à chaud ; deuxième visite sans réseau.
R4. **Couverture** : racines épinglées, repli par groupe sur la représentation grossière résidente, jamais de trou, jamais d'exception hors racine absente. Critère : `tri = selected` à tout budget ≥ racines.
R5. **Sélection** : WebGPU en compute (un thread par cluster, hiérarchie de culling en rejet précoce, occlusion Hi-Z de l'image précédente) ; WebGL2 sur CPU (hiérarchie de culling, sans allocation) avec option wasm SIMD si > 2 ms. Critère : Emerald sélection < 1 ms GPU, < 2 ms CPU.
R6. **Rendu WebGPU** : visibility buffer, compaction et `drawIndexedIndirect` par cluster, raster logiciel borné aux petits triangles réels, résolution matériau par binning, éclairage différé (GGX, IBL si et quand livré, tone mapping ACES, sRGB), transparents en sélection GPU et indirect par matériau, table de pages statique mise à jour par page, zéro allocation par image. Critère : Emerald 1280×720 CPU < 4 ms, GPU < 6 ms, image identique à la référence.
R7. **Rendu WebGL2** : mêmes formules d'éclairage en GLSL généré depuis la même source que le WGSL, tampons d'index persistants, `WEBGL_multi_draw`, un dessin par matériau et non par objet (matrices d'instance en texture), transparents triés, textures et mips gérés par le runtime. Critère : parité au pixel avec WebGPU sur toutes les scènes du banc (erreur max ≤ 2 par canal, expliquée), CPU < 8 ms sur Emerald.
R8. **API scène** : `addObject(cache, transform)`, `removeObject`, `setTransform`, `setMaterial`, `setCamera`, `pick(x, y)` (rayon contre clusters visibles et triangles réels), événements de résidence et de chargement. Critère : opérations appliquées à l'image suivante, sans allocation par image.
R9. **Métriques honnêtes** : rAF, CPU par étape, GPU par passe (WebGPU) ou `null`, triangles soumis et sélectionnés selon le même contrat pour tous les moteurs, `pagesDetached`, `cacheEvictions`, trous mesurés par le SDK lui-même. Critère : champs identiques entre moteurs, aucune valeur déduite.

## 4. Mode édition

E1. **Objet éditable** : un objet importé existe sous deux formes : source (triangles bruts) et compilée (clusters). Le moteur affiche la forme compilée par défaut.
E2. **Gestes instantanés** (sans recompilation) : ajouter, retirer, dupliquer, déplacer, tourner, mettre à l'échelle, changer matériau ou texture, visibilité. Critère : effet à l'image suivante.
E3. **Sculpture et modification de maillage** : pendant le geste, l'objet s'affiche depuis sa forme source (chemin direct, sans LOD) ; au relâchement, recompilation de cet objet seul en arrière-plan (wasm dans un Worker, ou binaire natif si hôte Electron) ; échange à chaud quand le cache est prêt, ancienne version affichée jusque-là. Critère : aucune image manquante pendant l'échange, recompilation ≤ 500 ms pour 100 000 triangles.
E4. **Historique** : chaque version compilée adressée par empreinte ; annuler = réafficher un cache existant ; garbage collection des versions non référencées. Critère : annuler/refaire en < 16 ms.
E5. **Outils dessinés par le moteur** : poignées, sélection, grille, boîtes, tout est rendu par notre runtime (pas de canvas Three superposé). Critère : aucune dépendance Three.js dans l'éditeur hors importation si elle y reste transitoirement.
E6. **Projet** : un fichier de projet référence sources, options, caches par empreinte, scène ; rechargeable à froid sans recompiler ce qui n'a pas changé.

## 5. Mode final (cuisson)

F1. **Commande unique** : `compile --final <projet> <sortie>` produit un dossier statique complet.
F2. **Optimisations globales** : recompilation de tous les objets avec les mêmes options ; **blocs de quartier** : objets voisins fusionnés en un DAG de scène pour les vues lointaines (règle du pixel identique) ; ordre des paquets selon les parcours probables ; textures en mips streamables ; déduplication par empreinte.
F3. **Runtime livré** : le SDK de rendu seul (quelques centaines de Ko), sans compilateur, sans éditeur, sans Three.js. Chargement par un simple dossier statique ou un CDN, `Cache-Control: immutable`.
F4. **Critère** : sur Emerald × 9, vue générale < 2 M triangles sélectionnés, 120 FPS présentés en WebGPU, première image < 1,5 s à froid et < 500 ms à chaud, image identique au mode édition au même seuil.

## 6. Banc et preuve

B1. Three.js reste le **moteur témoin** dans le Lab : même scène, même caméra, capture PNG sans perte, comparaison au pixel à 0 px (identité attendue) et à 1 px (différences localisées aux bascules), témoin A/A.
B2. **Parité WebGPU/WebGL2** : test automatique sur toutes les scènes, erreur max ≤ 2 par canal, sinon échec.
B3. **Campagnes** : fenêtre visible à 120 Hz, machine libre, mode mesure sans trace, ABBA, DPR/pixelError/résolution/commit consignés, quatre moteurs, 1 et 9 instances, toutes les scènes ; verdict par scène et moteur (FPS présentés, p95, p99, images > 8,33 ms, pixels différents, première image).
B4. **Scripts headless** conservés dans `render-tech-lab/scripts/headless/` pour les preuves rapides de chaque fusion.

## 7. Phases, ordre, critères de sortie

| Phase | Contenu | Sortie mesurée |
|---|---|---|
| 1 | Lot 2 WebGPU (R5, R6), saccades WebGL (p99) | Emerald 1 instance : WebGPU CPU < 4 ms, GPU < 6 ms ; WebGL p99 < 8,33 ms visible ; 0 pixel |
| 2 | DAG multi-matériaux par objet (C3, C4) après validation du prototype | vue générale ≤ 200 k triangles par ville, image identique à 0 px |
| 3 | Paquets autonomes et textures streamables (C5, C6, C7), streaming (R3) | première image < 500 ms chaud / 1,5 s froid, `source.bin` absent du chargement |
| 4 | Cache par objet, compilation incrémentale, wasm (C8, C9, E1 à E4) | recompilation d'un objet ≤ 500 ms, échange à chaud sans image manquante |
| 5 | Rendu WebGL2 maison et parité (R7, B2), maths propres (R1), API scène (R8) | parité au pixel, Three.js hors de `sdk-browser` |
| 6 | Cuisson finale et blocs de quartier (F1 à F4) | Emerald × 9 à 120 FPS, runtime livré seul |
| 7 | Outils d'éditeur dessinés par le moteur (E5, E6) | éditeur sans Three.js |

Chaque phase se termine par une campagne du banc et une entrée de journal avec les chiffres. Une phase dont la sortie n'est pas mesurée n'est pas finie.

## 8. Risques et décisions prises

- Quantification des sommets : acceptée, l'erreur de quantification entre dans l'erreur certifiée (décision du 14 septembre).
- Compression de textures avec perte : refusée tant qu'un test au pixel ne l'autorise pas ; mips streamables sans perte d'abord.
- FBX : lecteur libre imparfait ; glTF reste le pivot, conversion en amont si nécessaire.
- WebGL2 : jamais le même pipeline que WebGPU (pas de compute) ; parité exigée sur l'image, pas sur la méthode.
- Trois mois d'agents estimés pour les phases 1 à 7 ; les phases 1 à 3 donnent déjà un moteur de rendu livrable.
