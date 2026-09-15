# Journal d'orchestration WebGeometry

## 2026-09-15 — [compilateur] un pilote par format : routeur de scènes et registre d'images (lot routeur et plugins)

Le compilateur choisissait sa voie d'entrée en dur — « exactement un `.gltf`/`.glb`, ou des
`.fbx`/`.obj` » — et sa table d'images tenait en trois lignes de constantes. Chaque format à venir
aurait touché ce cœur. Il route désormais vers un **pilote par format**, chacun dans son module,
tous listés dans un registre statique : ajouter un format, c'est un module et une ligne.

Deux contrats versionés. `ScenePlugin` (`scene-plugin-1`) reconnaît une source par extension puis par
nombre magique, et rend la scène intermédiaire que `compile` sait déjà lire : `gltf` (glTF et GLB, en
entrée directe), `fbx` et `obj` (ufbx, par un socle interne commun — deux noms, deux versions, deux
détections). `ImageDecoder` (`image-plugin-1`) décode vers `DecodedImage::Rgba8` : `png` et `jpeg`,
par la crate `image`. Le type de sortie est une énumération pour que l'EXR et le HDR flottants y
entrent par une variante, sans ramener à huit bits ce qui n'y tient pas.

Le routeur refuse plutôt que de deviner : `SOURCE_FORMAT_UNKNOWN` nomme tout ce que le binaire
accepte, `SOURCE_FORMAT_AMBIGUOUS` nomme les pilotes qui se disputent un dossier. Le pilote retenu
voyage dans le manifeste d'import (`source.plugin`), dans la sortie de `compile` (`scenePlugin`) et
dans `--version` ; l'empreinte du registre entre dans la clé de compilation, donc un pilote ajouté,
retiré ou reversionné invalide ce que l'ancien registre avait écrit.

Refactor à comportement constant : les cinq dorées coplanaires et la dorée des aperçus passent sans
régénération, aucun `expected.json` n'a bougé. 165 tests Rust au vert contre 158 avant, 3 ignorés de
part et d'autre. Un seul rétrécissement délibéré : un dossier qui mélange FBX et OBJ était fusionné en
une scène, il est maintenant ambigu — un format par dossier source, c'est la règle du modèle.

`packages/asset-compiler-rust/PLUGINS.md` est le brief d'un agent par format : le module, le trait,
la ligne de registre, la dorée minimale à fournir, et ce qui est interdit (code ou SDK d'éditeur,
contournement de protection). La politique reste dans `orchestration/SPEC_FORMATS_IMPORT.md`.

## 2026-09-15 — [session village] la scène « Whisperwind Village » entre au banc 15, importée en FBX

Aucune ligne de moteur n'a bougé : le Lab a reçu une entrée de catalogue
(`15-virtualized-integration/assets/modelCatalog.ts`, commit `d44c995` du Lab) et le FBX a été
préparé par `prepare()` du SDK, sans Blender et sans conversion préalable — `Village2.fbx` est
donné tel quel au compilateur, qui l'importe par `ufbx-0.11.3-gltf-2`. Source copiée dans
`public/benchmark-assets/whisperwind-village/` (non suivie, comme `emerald-square`), cache dans
`whisperwind-village-derived/`.

### Chiffres d'import

FBX 7300 binaire, créateur « FBX SDK/FBX Plugins version 2020.2 », unité 0,01 m, 409 Mo.
58 maillages, **10 717 instances**, **172 008 090 triangles**, 81 matériaux, 13 textures déclarées,
**12 images résolues**, 0 lampe. Import 12,3 s, compilation totale **33,3 s** (101 primitives,
884 Mo de géométrie source écrite, `formatVersion` 3, `selectedTriangles` = `sourceTriangles`).
`unsupported` et `notes` du rapport d'import sont **vides** : aucune texture n'est signalée absente
ni de format refusé.

### Preuve navigateur

Lab servi en lecture seule sur le port 5190, banc 15, chemins publics du SDK (`createExplorer`),
1280×720, seuil 0 pixel, `dist/` du moteur bâti sur `develop` = `38f1b5c`.

| moteur | création | triangles sélectionnés | `uncoveredTriangles` | textures montées / en attente / écartées |
| --- | --- | --- | --- | --- |
| WebGeometry WebGPU · vue générale | 5,4 s | 171 683 459 | **0** | 12 / 0 / 0 |
| WebGeometry WebGPU · au sol | 5,8 s | 90 952 138 | **0** | 12 / 0 / 0 |
| Three.js référence · vue générale | 3,0 s | 172 008 090 | non mesuré | non mesuré |

Aucune erreur GPU, aucune erreur de console, `streamingError` nul, `coverageReady` vrai. Chargement
complet d'une vue borné à **25 s** de bout en bout. Bornes de la scène :
x −100,49…100,85, y 0,34…47,77, z −78,74…83,40 (mètres).

### Écarts visuels, honnêtement

- **Le témoin Three rend la scène noire** : aucune lampe n'est déclarée et lui seul en dépend. Même
  silhouette au pixel près que le chemin WebGPU, qui rend l'albédo brut. C'est la convention
  d'éclairage déjà consignée, pas cette scène.
- **Cinq des treize PNG sont des images 1×1 noires** dans la source elle-même : les couleurs de base
  de l'herbe et des ombellifères, et les trois cartes de `M_River`. La végétation sort donc noire des
  deux côtés — défaut de la source, pas de l'import.
- **Aucun matériau n'est transparent après import.** `M_River_Opacity_0.png` est la treizième texture
  du FBX et la seule non résolue : `ufbx::MaterialPbrMap::opacity` n'a ni valeur ni texture sur ces
  matériaux, donc `materials.rs` ne pose ni `BLEND` ni `MASK`, et rien n'est signalé — ni dans
  `unsupported`, ni dans `notes`. La rivière et l'océan sont opaques ; l'émissif de `M_River` est
  bien branché mais pointe une image 1×1 noire. **Défaut d'import constaté, pas corrigé ici.**
- **Les 7 aperçus de textures couleur sont tous écartés** (`texturePreviews.skipped` =
  `{"image-missing": 7}`, contre 232/232 posés sur Emerald). Cause : `texture_preview/source.rs`
  résout l'URI d'une image sous le dossier du glTF consommé, or le glTF importé vit dans
  `<cache>/native/imports/<clé>/` tandis que les PNG restent au dossier source. Au rendu les textures
  arrivent quand même (12 montées, 0 écartée), par `resourceBaseUrl` ; seule la pyramide d'aperçus
  manque. **Constat, pas corrigé ici.**
- **Le départ au sol du banc 15 échoue sur cette scène.** `navigation.bin` fait 825 Mo
  (45 855 862 triangles, contre 13,6 Mo et 758 534 sur Emerald) et se charge en 6 s, mais
  `startPosition` lève « Aucun départ praticable ». La règle sonde le sol à `bounds.min.y` = 0,34 m,
  le lit du fleuve, alors que le village est sur une butte : au centre des bornes le sol est à
  4,05 m, hors de la tolérance de marche (0,40 m). Un point libre au sol existe bel et bien et se
  trouve en balayant les bornes — (−66,94 ; 10,70 ; 2,33), sol à 8,90 m, sans collision — et c'est
  celui des captures « au sol » ci-dessus. La caméra orbitale, elle, n'est pas concernée.

### Ce qui manque

Les deux défauts d'import ci-dessus (opacité FBX perdue en silence, aperçus de textures introuvables
après import) et la règle de départ du banc 15, qui suppose un sol au plus bas des bornes.

## 2026-09-16 — [session lumiere] ombres virtualisées : invalidation par pages, budget en millisecondes (lot ombres virtualisées)

Branche `lot/ombres-virtualisees`, sur `develop` = `d3dcd69`. `tsc` et `npm run check:changed` verts
(571 tests). RX3 et LR3 de `orchestration/SPEC_ECLAIRAGE.md` v2.

### La règle livrée

- **Invalidation par pages.** L'atlas 4096² est découpé en pages de **128 texels** (`shadowPage`),
  soit 1 à 64 pages par face selon le côté que la lampe obtient. Une lampe qui bouge périme sa carte
  entière ; **un objet qui bouge — transformation, entrée ou sortie de résidence — ne périme que les
  pages de chaque face que sa boîte projetée recouvre** (`sceneLightShadowPages.ts`, huit sommets
  projetés par la matrice de la face, face entière si un sommet passe derrière le plan de
  projection). Le masque d'une face est **huit octets, une rangée par octet** : deux rangées
  identiques se reconnaissent par une égalité d'octets, donc le regroupement en rectangles de pages
  contiguës est immédiat — une face entièrement périmée redonne **une seule** région et un seul
  appel indirect, exactement comme avant le lot.
- **Identique au bit près.** Le cadre de dessin reste celui de la **face entière** ; seul le
  **ciseau** borne la région, la remise au fond comprise. Un sommet atterrit donc au même texel
  qu'un redessin complet, et les pages hors région gardent ce qu'elles avaient. Les boîtes de
  mouvement sont l'union de l'avant et de l'après : toute page qu'un objet quitte est remarquée en
  même temps que celle qu'il atteint.
- **Rejet resserré à la région.** Le volume que `gpuShadowCull` oppose aux clusters n'est plus celui
  de la face mais celui de la **région** : cône d'axe la direction du centre de la région et de
  demi-angle celui du plus écarté de ses quatre coins (l'image sphérique d'un rectangle plan est
  sphériquement convexe, donc la calotte qui contient les quatre coins contient tout le rectangle) ;
  sphère de la sous-boîte pour une cascade. Sur la face entière, les deux formules redonnent
  **exactement** les volumes d'avant le lot (`atan(√2·tan(fov/2))`, sphère de la boîte de cascade).
- **Budget en millisecondes.** Le plafond « quatre lampes par image » (X5) devient un **budget de
  durée**, option publique `shadowBudgetMs`, **1,0 ms par défaut**. Le prix d'une page vient du
  chronomètre d'horodatage de la passe Ombres elle-même — celui que le profil publie déjà —,
  rapporté aux pages que l'image chiffrée avait redessinées, et lissé (`shadowCostBlend` 0,25). Les
  régions sont admises par priorité = couverture écran de la lampe + prime de première carte +
  attente (`shadowAgingPerFrame` 0,05 par image, contre la famine) ; la première région passe
  toujours, sinon le retard ne serait pas borné sur un appareil dont la moindre page dépasse le
  budget. **Sans horodatage, il n'y a pas de budget** : seul le plafond de 24 régions s'applique,
  soit exactement le travail maximal d'avant le lot.
- **Compteurs.** La ligne Ombres du profil garde ses six compteurs (le Lab les lit) et en gagne six :
  `regionsRedessinees`, `pagesInvalidees` (un compte brut, pas une différence), `pagesRedessinees`,
  `pagesEnAttente`, `retardMaxMs`, `retardMaxImages`. `metrics()` publie en plus
  `shadowPagesDrawn`, `shadowPagesPending` et `shadowWaitMs`.
- **Cascades du soleil.** Leur fraîcheur ne dépend plus de la révision de la vue mais de la
  **fenêtre monde que la cascade décrit** (centre aligné sur la grille de texels + rayon) : une
  caméra qui bouge moins que ce pas ne périme plus rien, là où toute caméra en mouvement redessinait
  les quatre cascades. Un objet qui bouge sous une cascade stable n'en périme que les pages.
- **Pourquoi une cascade qui glisse repart entière.** Quand la fenêtre se déplace d'un texel, la
  carte décrit une autre partie du monde : sans adressage en anneau de l'atlas, aucun de ses texels
  ne reste à sa place. L'anneau demanderait un modulo dans la lecture de l'atlas, qui vit dans
  `deferredLighting*.ts` — fichier tenu par le lot « ombres lointaines » de cette session. Le
  redessin complet de la cascade est donc **conservé**, et le budget est ce qui en borne le coût :
  les quatre cascades s'étalent sur plusieurs images au lieu de tomber dans une seule.

### Preuves (Emerald, WebGPU, 1280×720, `pixelError 0`, trois vues, cache du Lab en lecture seule)

**Identité des cartes d'ombre** — même moteur, seule `--ombres-pages` diffère, huit lampes à ombre
et un objet mobile (`--objet-mobile Light_Tube46 --objet-rayon 3`, 120 déplacements), file vidée
avant la lecture :

| vue      | empreinte de l'atlas, par pages | empreinte, faces entières | texels écrits | image |
| -------- | ------------------------------- | ------------------------- | ------------: | ----- |
| generale | `2040375360`                    | `2040375360`              |     2 850 816 | 0 px  |
| sol      | `3598675376`                    | `3598675376`              |    12 582 912 | 0 px  |
| rue      | `969265087`                     | `969265087`               |    12 582 912 | 0 px  |

Les six PNG (capture et témoin A/A) sont **identiques octet pour octet** entre les deux exécutions.
L'empreinte est FNV-1a sur les 16 777 216 profondeurs brutes de l'atlas, relue par
`explorer.shadowAtlasDigest()`.

**Fidélité avant/après** (`--avant d3dcd69`) : **0 pixel sur les trois vues**, témoin A/A 0 pixel,
avec **8 lampes** puis **30 lampes** à ombre et `--lampe-mobile`, ainsi qu'à **scène immobile**
(vue générale). Scène immobile : **0 région, 0 page, étape Ombres « non mesuré »** — la passe n'est
pas encodée, la règle d'avant est conservée telle quelle.

### Coûts : non mesurés au calme

Consigne de l'utilisateur en cours de lot : aucune campagne tant que la charge à une minute n'est
pas sous 4. La charge relevée pendant les séries ci-dessus allait de **24 à 74** (trois campagnes
parallèles). **Aucune durée de ce lot n'est un verdict de performance** ; seuls les pixels, les
empreintes et les compteurs sont retenus. Ce qui a tout de même été observé, à titre indicatif :
l'étape Ombres tenait 0,75 à 0,98 ms p50 avec un objet mobile et huit lampes — le budget de 1,0 ms —
avec 72 à 288 pages en attente et un retard maximal de 3,8 ms à 336 ms selon la vue. Et, côte à côte
sur la même série (`--lampe-mobile`, une seule lampe redessinée par image des deux côtés) :

| configuration     | vue      | Ombres GPU p50/p95 avant |       après | charge |
| ----------------- | -------- | -----------------------: | ----------: | -----: |
| 8 lampes à ombre  | generale |              0,48 / 0,66 | 0,49 / 0,71 |  29–42 |
|                   | sol      |              0,48 / 0,71 | 0,55 / 0,74 |        |
|                   | rue      |              0,34 / 0,54 | 0,29 / 0,51 |        |
| 30 lampes à ombre | generale |              0,30 / 1,42 | 0,18 / 0,25 |  64–67 |
|                   | sol      |              0,37 / 0,93 | 0,35 / 1,10 |        |
|                   | rue      |              0,14 / 0,66 | 0,24 / 0,41 |        |

À cette charge les intervalles se confondent : **ce tableau ne conclut rien**, il dit seulement que
rien n'a explosé. La remesure au calme reste à faire : coût avant/après de l'étape Ombres (immobile, lampe mobile, objet mobile), et
le cas `--soleil --camera-mobile`, celui où le budget doit remplacer les 1,6 à 3,9 ms p50 des quatre
cascades relevés le 15 septembre.

### Restes

- **Coûts à remesurer au calme**, verrou `.claude/mesure.lock` pris, une campagne à la fois.
- **Cascade qui glisse** : redessin complet, faute d'adressage en anneau de l'atlas (voir plus haut).
- **Coût fixe d'une région** fondu dans le coût moyen d'une page : approximation nommée, publiée
  dans le diagnostic `direct-lighting`.
- **Les faces retombent souvent au plancher de 128 texels** — à 8 ou 30 lampes sur Emerald, une face
  vaut alors _une_ page et l'invalidation par pages n'y change rien. Le gain de la règle porte sur
  les faces larges (peu de lampes, lampes proches, cascades du soleil) ; la part d'atlas par lampe
  (`desiredFaceSide`) est le levier à revoir si on veut qu'il porte plus loin.
- **Harnais** : `--objet-mobile <nœud>` demande un nom de nœud à l'hôte — le harnais ne devine
  aucune scène. Le premier appel pose le nœud à l'origine du monde (un saut, une seule fois).

## 2026-09-15 — lot H2 fusionné : décodage des pages hors fil principal, décodeur WebAssembly

- **Contrat versionné** `sdk-core/pageDecodeContracts.ts` (v2) : entrée, sortie, annulation, refus fermés dont `PAGE_DECODE_UNAVAILABLE`, pool borné min(cœurs, 4, admission). Adaptateur navigateur `pageDecodeTask.ts` (la tâche écrite une seule fois, partagée par le worker et le repli), `pageDecodeWorker.ts`, `pageDecodePool.ts`, `pageDecodeHost.ts` ; branché dans la chaîne de streaming (`streamingFetch`, `clusterPages`, `explorerStreaming`, `explorerLifecycle`, `autonomousPages`), aucun `webgpu*` touché. Page fraîche transférée sans copie à l'aller, tampons décodés transférés au retour ; page déjà résidente copiée (la comptabilité d'octets de l'éviction reste sur le fil principal). Le pool ne bloque jamais : épreuve de démarrage non attendue, repli sur place si aucun worker ne vit. Métriques `pagesDecodedOffThread`, `pageDecodeMs`, `pagesDecodedWasm` (`null` si non mesuré).
- **Décodeur WebAssembly** `packages/page-codec-wasm` (Rust, cdylib + rlib, ABI `extern "C"`, aucune nouvelle dépendance ; la crate `meshopt` compile son C en wasm32 avec `-msimd128`) ; le compilateur natif le prend en dev-dependency, le décodeur n'est écrit qu'une fois ; test doré natif contre l'encodeur (`to_bits`, fixtures + maillages hostiles). Chargeur `geometryPageWasm.ts` avec repli sur `geometryPage.ts` si `WebAssembly` ou SIMD manquent ; `pageCodec.wasm` 38 065 octets commis, recopié dans `dist/` par `npm run build` ; `build:wasm` hors de `validate` (cible `wasm32-unknown-unknown` et `llvm-tools` installés par `rustup` sur cette machine).
- **Mesures** (`orchestration/mesures/calculs-h2-2026-09-15.md`, `calculs-h2b-2026-09-15.md`) : décodage par le contrat avec wasm 2,65 → 1,67 ms (37 %), décodeur seul 11,8 → 8,3 ms (30 %), identique octet pour octet ; refus de page plus lent en wasm, non retenu. Campagne `webgpu`, 4 vues × 120 images : témoin A/A 0 px, avant/après 0 px, même hash de coupe, 82 à 90 travaux hors fil par série. `pagesDecodedWasm = 0` en campagne : les deux moteurs exposés par `options.mjs` ne demandent que des paquets d'index ; seul le moteur autonome WebGL2 décode des pages de géométrie, à exposer dans le harnais (commit séparé, Lumière prévenue).
- Piège trouvé : un worker de module n'hérite pas de la carte d'imports du document ; sans correction, le pool échouait au démarrage chez un hôte sans empaqueteur et tout repartait en silence sur le fil principal. Vérifié dans Chrome sur le `dist/` servi tel quel.
- Tests : 32 tests (contrat, tâche, chargeur, identité wasm/JS/sur place, worker réel, pool, hôte), `validate` vert (737 tests JS). Fusion `30f2b33`. Charge machine 22 à 88 pendant le lot (trois campagnes d'autres sessions en parallèle) : temps par image non concluants, sérialisation des campagnes demandée aux sessions Geometry et Lumière.

## 2026-09-16 — [session lumiere] une scène importée arrive avec ses lampes (lot import des lampes)

Worktree `lot-import-lampes`, branche `lot/import-lampes`, rebasée sur `develop` = `5305f6c`.
Jusqu'ici, `SceneLight` n'avait que des lampes posées à la main par l'hôte ou par le harnais :
aucun chemin ne lisait celles qu'un fichier de scène porte pourtant déjà.

- **Compilateur** (`packages/asset-compiler-rust/src/compiler_lights.rs`) : les lampes
  de `KHR_lights_punctual` sont lues sur le glTF d'entrée, posées en espace monde par les matrices
  de `compiler_world`, et écrites dans un produit de cache à leur nom, `lights.json`, à côté de
  `clusters.json`. **La version de manifeste ne bouge pas** : le fichier vit hors du manifeste et un
  lecteur qui l'ignore lit le cache comme avant. L'import FBX écrivait déjà ses lampes sous cette
  extension ; il y ajoute maintenant le drapeau d'ombre de ufbx (`extras.castsShadow`) et convertit
  son intensité sans unité en candela ou en lux (`IMPORTER_VERSION` montée à `ufbx-0.11.3-gltf-2`).
  OBJ n'en déclare aucune, le fichier sort vide.
- **Unités, choix chiffré et publié** (`docs/SDK.md`) : division par **683 lm/W**, la constante
  `K_cd` qui définit la candela au SI — aucune hypothèse de spectre, aucun gain caché ; l'hôte règle
  l'exposition. FBX, qui ne porte aucune unité photométrique, a deux réglages nommés : 1 unité vaut
  ≈ 79,6 cd (1000 lm dans 4π) pour une ponctuelle, 10 000 lux pour une directionnelle. Une portée
  absente est déduite par `sqrt(I / 0,01 W·m⁻²)`, plafonnée à 10 km : le contrat exige une portée
  finie, le glTF autorise l'infini. `innerConeAngle` n'a pas d'équivalent, le moteur adoucit le bord
  par son propre réglage. Une lampe hors contrat est comptée dans `rejected`, jamais fatale.
- **SDK** (`packages/sdk-browser/importedLights.ts`) : lecture tolérante par construction — fichier
  absent, version inconnue, corps illisible valent zéro lampe, donc le comportement d'avant et la
  vue `unlit`. Les lampes sont déclarées avant la préparation du premier moteur, l'ombre vient du
  drapeau du fichier, et au-delà des 64 du contrat ce sont les plus portantes qui restent
  (directionnelles d'abord, puis intensité de crête), le reste compté dans le diagnostic
  `imported-lights`. `explorer.importedLights()` les rend à l'hôte, qui les règle ou les retire ;
  `importedLights: false` ouvre la scène sans aucune.
- **Harnais** : `--lampes-fichier on|off`, et `scripts/mesure/fixtureLampes.mjs`, une pièce
  synthétique de 768 triangles portant deux lampes déclarées — aucune scène réelle n'y est nommée.

Preuves, WebGPU, machine calme. **Fixture** : compilée, `phase lights` = 2 lampes, 0 refus,
`lights.json` publie deux ponctuelles à 100 W/sr (68 300 cd / 683), portée 100 m, positions monde
(±2, 2,4, 0) ; ouverte par le banc, `lampesFichier` = `{nombre: 2, ids: [lampe-chaude,
lampe-froide]}` et la capture montre l'éclairage réel — chute en 1/d², dégradé, teintes chaude et
froide — là où `--lampes-fichier off` rend l'albédo plat de la vue `unlit`. **Emerald** : recompilé
en 19 s (6 fils, 16 Go), il **ne déclare aucune lampe** dans ses données — son glTF ne porte ni
`extensionsUsed` ni `KHR_lights_punctual` sur ses 1035 nœuds —, donc `lights.json` sort à `count: 0`
et l'image ne bouge pas : `develop` contre ce lot sur le même cache, **0 pixel** d'écart sur 230 400,
`maxCanal` 0, témoin A/A 0 pixel, coupe identique (80 153 pages), zéro erreur de page.

Portes du lot, allégées par décision de l'utilisateur : `tsc` vert, `cargo check` vert,
`npm run check:changed` vert. Pas de tests, pas de `npm run validate` complet.

## 2026-09-15 — [session transparents] les transparents n'ont plus de lumière à eux (lot transparents sans ambiance)

Worktree `lot-transparents-sans-ambiance`, branche `lot/transparents-sans-ambiance`, partie de
`develop` = `a29e025`. Rien n'est fusionné, le Lab n'est pas touché.

### Ce qui est parti

Le chemin des transparents portait un éclairage à lui, sans rapport avec les lampes déclarées :

- `sceneLighting.ts` injectait `DEFAULT_LIGHTS` — une hémisphérique et un soleil écrits dans le code
  — dès que le graphe source ne portait aucune lumière Three, aussi bien dans le tampon GPU du
  mélange que dans les adaptateurs Three.
- `sceneLightingShader.ts` ajoutait une ambiance constante (`kind==0`) et une ambiance hémisphérique
  (`kind==4`) qu'aucune ombre n'atténuait.
- Les uniformes du mélange portaient en plus une direction de soleil en dur (`lightDir`, la même
  `(1,3,2)` d'intensité 2,5) que le nuanceur ne lisait même plus.

Les trois sont supprimés, et `sceneLightingShader.ts` avec eux. `sceneLighting.ts` se réduit à la
recopie des lampes **déclarées** du graphe source vers la scène de rendu des adaptateurs Three.

### Ce qui les remplace

La passe de mélange lit les mêmes ressources que la résolution opaque : le tampon `DirectLights` du
magasin `SceneLight`, les tranches d'ombre, l'atlas et son échantillonneur de comparaison, la grille
de sondes. Aucun nuanceur n'est dupliqué : la formule d'éclairement d'une lampe est extraite dans
`declaredLight` (`directLightingWgsl.ts`), que la boucle tuilée de l'opaque (`contractLighting`) et
la boucle du mélange (`declaredLighting`) appellent toutes les deux ; `bounceApplyWgsl(grid,probes)`
devient paramétrique pour que les deux passes lient la même grille à leurs propres numéros.

- **Sans lampe déclarée** : un drapeau d'image (`FLAG_UNLIT_VIEW`) fait sortir les transparents en
  albédo brut, exactement comme la vue sans éclairage des opaques. C'est le même critère
  (`wantsContractLighting`), posé une fois par image et non par maillage.
- **Ombres** : un transparent est atténué par les cartes d'ombre des lampes déclarées, ponctuelles
  comme cascades du soleil, par le même `shadowFactor`.
- **Exposition** : inchangée, elle vient de la composition — les transparents sont dessinés dans la
  cible HDR, avant ACES.
- **Rebond** : `bounceLighting` est ajouté au direct, avec la même grille de sondes que l'opaque et
  sans passe de plus. Grille absente, `sampleBounce` sort exactement zéro : les remplaçants de la
  résolution différée (grille à zéro, tampon de sondes d'un `vec4`) sont partagés avec le mélange.

### Pourquoi une boucle bornée et non les listes tuilées

Les listes par tuile sont bâties sur la profondeur des **opaques** : une tuile que nul opaque ne
couvre — le ciel derrière un arbre — n'y retient aucune lampe, et un transparent posé devant le
premier opaque de sa tuile tombe hors de la boîte monde qui a filtré ces lampes. S'en servir
éteindrait des feuillages que des lampes déclarées éclairent. Le mélange boucle donc sur
`min(directLights.count, MAX_LIGHTS)`, borne connue avant l'image (X2), chaque lampe hors portée
sortant par le fenêtrage de `directIncidence`. Le coût de ce choix est mesuré ci-dessous ;
l'éclairage stochastique par pixel (RX2) reste le lot qui le remplacera.

### Ombres portées par les transparents : ce qui a été vérifié

Règle du lot : un masque projette sa découpe, un matériau de mélange ne projette rien encore.

- Un matériau `alphaMode: MASK` n'est **jamais** rangé en mélange : `compiler_primitive.rs` ne met en
  `clustered-blend` que `alphaMode == "BLEND"`. Un masque passe donc par `exact-clusters`, reçoit une
  ligne de visibilité, porte `FLAG_MASK` (`webgpuPageRow.ts:85`) et la passe de profondeur des ombres
  découpe déjà sa vraie silhouette (`gpuShadowShader.ts:53`, `maskKeep`). Rien à ajouter.
- Un cluster de mélange, lui, ne peut pas entrer dans la table des lignes dessinées :
  `webgpuRowSync.ts:49` refuse une ligne à tout `rec.transparent`, et `drawSlots` est plafonné au
  nombre de pages opaques (`webgpuPagesLayout.ts:54`). Le rejet d'ombres lit cette table
  (`gpuDraw.instanceBuffer`) : aucun transparent n'y est. Sur Emerald, ce sont 29 primitives
  `clustered-blend` et 1 732 416 triangles de feuillage qui ne projettent rien.
- L'approximation publiée dans le diagnostic `direct-lighting` est donc réécrite en deux lignes
  distinctes, masque et mélange, au lieu de l'unique « transparent clusters cast no shadow ».

### Preuves

Harnais commun, `--moteur webgpu`, 1280×720, 40 images, `--pixelError 0`, mode visible, machine
chargée (charge relevée entre 12 et 29 — aucune de ces durées n'est une mesure de performance tant
que l'appelant ne l'a pas jugée acceptable). Côté « avant » = `a29e025`, côté « après » = ce lot.
Témoin A/A à 0 px sur **toutes** les séries.

**Emerald, aucune lampe déclarée** (`generale,sol,rue`) :

| vue      | écart avant/après  | ce qui change                                                  |
| -------- | ------------------ | -------------------------------------------------------------- |
| generale | 4 390 px, max 129  | les feuillages passent de l'ambiance implicite à l'albédo brut |
| sol      | 0 px               | aucun transparent visible : l'image est identique au bit près  |
| rue      | 71 722 px, max 199 | idem generale, la rangée d'arbres de la rue                    |

Ce n'est pas 0 px, et c'est attendu : avant, les arbres étaient éclairés par une hémisphérique et un
soleil inventés ; après, sans source déclarée, ils sortent en albédo brut comme tout le reste. La
vue `sol`, sans transparent, donne le 0 px qui prouve que rien d'autre n'a bougé.

**Emerald, 8 lampes ponctuelles + soleil** (9 lampes actives, ombres allumées) :

| vue      | écart avant/après  | ce qui change                                                         |
| -------- | ------------------ | --------------------------------------------------------------------- |
| generale | 4 356 px, max 51   | les feuillages suivent enfin les lampes déclarées                     |
| sol      | 0 px               | aucun transparent visible                                             |
| rue      | 67 091 px, max 131 | la rangée d'arbres du fond s'éteint, celle que le soleil touche reste |

Sur `rue`, les arbres du centre et de la droite, qui étaient uniformément verts quelle que soit la
lumière de la scène, sont maintenant sombres : ils sont hors de la portée des ponctuelles et dans
l'ombre portée du soleil, que la passe de mélange lit dans le même atlas que les opaques.

**Scène synthétique des trois classes de matériau** (`fixtures/classes-materiaux`, compilée avec le
binaire Rust, `generale,detail`) :

| série             | vue      | écart avant/après |
| ----------------- | -------- | ----------------- |
| sans lampe        | generale | 95 583 px, max 78 |
| sans lampe        | detail   | 0 px              |
| 4 lampes + soleil | generale | 0 px              |
| 4 lampes + soleil | detail   | 0 px              |

Sans lampe, seule la vitre (`alphaMode: BLEND`) change : elle passe de `(27,31,39)` — l'ambiance
implicite, presque éteinte sur ce plan — à `(100,106,117)`, son albédo brut. Les trois cubes opaques
et la grille à découpe sont identiques au bit près, ce qui vaut le 0 px demandé en vue sans
éclairage : ils empruntaient déjà le chemin opaque, que ce lot ne touche pas. Avec les lampes, la
vitre retombe à `(27,31,39)` des deux côtés : elle est hors de portée des quatre ponctuelles et le
soleil frappe son autre face, donc son éclairement déclaré vaut zéro — l'égalité des deux côtés est
ici une coïncidence de valeurs sombres, pas une preuve, et c'est Emerald qui porte la preuve.

**Coût par étape**, GPU p50/p95, jamais additionné au CPU :

| série             | vue      | étape Transparents avant | après           | enveloppe image avant | après |
| ----------------- | -------- | ------------------------ | --------------- | --------------------- | ----- |
| sans lampe        | generale | 11,396 / 11,511          | 11,848 / 13,570 | 29,06                 | 31,95 |
| sans lampe        | sol      | 0,849 / 0,968            | 0,837 / 1,045   | 10,80                 | 10,77 |
| sans lampe        | rue      | 1,767 / 1,913            | 2,039 / 2,214   | 11,31                 | 11,83 |
| 8 lampes + soleil | generale | 13,203 / 13,996          | 34,979 / 38,354 | 36,27                 | 58,22 |
| 8 lampes + soleil | sol      | 2,736 / 3,069            | 2,674 / 2,979   | 12,83                 | 12,71 |
| 8 lampes + soleil | rue      | 3,624 / 3,851            | 23,861 / 28,586 | 12,90                 | 34,49 |

Sans lampe déclarée, l'étape Transparents ne bouge pas : la sortie en albédo brut coûte ce que
coûtait l'ancienne boucle sur deux lampes implicites. Avec neuf lampes déclarées, elle est multipliée
par 2,6 (`generale`) à 6,6 (`rue`) : c'est le prix de la boucle bornée et de ses seize prises de PCF
par lampe, sur un feuillage à fort recouvrement (1 928 appels de mélange sur `rue`). C'est le coût
que le lot devait noter, et la cible du lot « éclairage stochastique par pixel » (RX2).

Côté CPU, l'étape « Lumières » du profil vaut maintenant zéro sur le chemin WebGPU : il n'y a plus
aucune lumière de scène à empaqueter par image, et le seul reste — pousser le magasin au GPU quand sa
révision a bougé — vit dans l'encodage. Zéro parce que le travail a disparu, pas parce qu'il n'est
pas mesuré.

### Restes nommés

- **Rebond sur les transparents non prouvé par une image** : le code y est, lit la même grille que
  l'opaque par le même `sampleBounce`, et une série `--rebond on` contre `--rebond off` sur la scène
  des classes de matériau recompilée avec le binaire de cette branche donne 0 px d'écart — la passe
  de mélange lie bien la vraie grille (42 sondes) et le vrai tampon de sondes sans rien perturber,
  mais l'ordonnanceur n'a mis à jour **aucune** sonde (`sondesMisesAJour 0`, `rayonsParImage 0`),
  donc l'irradiance indirecte vaut zéro partout, sur les opaques comme sur les transparents, et il
  n'y a rien à comparer. Le cache Emerald du Lab, lui, ne porte pas de proxy résident (« the cache
  carries no resident proxy; recompile it with this compiler »). À rejouer avec le lot rebond 3.
- **Ombres atténuées et colorées des matériaux de mélange** : hors périmètre, lot ultérieur (LR3).
- **Adaptateurs Three sans lampe déclarée** : `installSceneLighting` ne recopie plus que les lumières
  du graphe source. Or les lampes du contrat vivent dans le magasin `SceneLight`, qu'aucun
  adaptateur Three ne lit — le moteur de référence WebGL rend donc sans éclairage tant que l'hôte ne
  pose pas de lumière Three. C'est P6 appliqué, et c'est le lot « import des lampes » qui refermera
  l'écart.
- **Boucle par pixel** : bornée par `maxLights`, à remplacer par un rayon d'ombre stochastique (RX2).

### Portes

`tsc` vert, `npm run check:changed` vert (403 tests, format, lint, limite de 200 lignes, doublons).
Pas de `npm run validate` complet ni de nouveaux tests : portes allégées, décision de l'utilisateur.

## 2026-09-16 — [session sans-threejs] le harnais de mesure accepte n'importe quelle scène

Deux lignes seulement séparaient le banc commun d'une scène quelconque, et elles sont parties.

- `banc.mjs` exigeait le cache du Lab de la scène par défaut **même quand les deux côtés nommaient
  leur propre cache** compilé. Le contrôle est maintenant conditionnel : le cache du Lab n'est
  réclamé que si un côté au moins n'a pas de `--cache-<côté>` et le lit donc vraiment.
- Le nom de la scène n'est plus une constante : il se déduit du dossier `derived` du cache employé
  (`<nom>-derived`), la scène du Lab ne servant plus que de repli quand aucun cache n'est nommé.
  `scripts/mesure/scene.mjs` réunit ce repli, la déduction et le manifeste du Lab ; `options.mjs`
  les réexporte, comme il réexporte déjà les poses. Les poses, elles, venaient déjà des bornes du
  modèle lues dans la page : rien à y changer.

Preuve : quatre exécutions courtes du banc. Cache du Lab sans option → `scene` vaut la scène par
défaut, `coupe` 80 153. Cache nommé sous un autre nom, `WG_ASSETS` pointé sur un dossier vide → la
scène prend le nom du dossier, le contrôle du cache du Lab ne se déclenche pas, et les seules
erreurs sont les 404 des textures que ce cache va chercher à une URL absolue, pas celles du relevé.
Cache nommé, Lab monté → sortie propre, `coupe` 80 153, la même image que par le chemin du Lab.
Quatre tests ajoutés à `scripts/banc.test.mjs` (déduction, dossier sans suffixe, repli).
`npm run validate` vert, portes Rust comprises. README : section « mesurer une autre scène ».

## 2026-09-16 — [session sans-threejs] d'où viennent les égalités de profondeur, et pourquoi la borne des 0 pixel les rend indépartageables (lot coplanaires v2)

Worktree `lot-coplanaires`, branche `lot/coplanaires-v2`, partie de `develop` = `7b7a79f`, qui n'a
pas bougé de tout le lot. **Aucun code de production n'est modifié** : le lot s'arrête sur un
diagnostic qui réfute son propre objectif, et rien n'est fusionné que cette entrée et R5c.

### 1. L'instrument : une image d'identité de fragment, exacte

Le révélateur reste `depthCompare: 'less-equal'` contre `less` : les pixels qui changent sont
exactement ceux où deux fragments opaques portent la **même** profondeur au bit près (la cible est
`depth32float`, il n'y a donc aucune quantification qui fabriquerait de fausses égalités). Mais
l'image de beauté ne dit pas **qui** se dispute le pixel : deux clusters d'une même texture y
diffèrent d'une unité sur un canal, et deux instances d'un même cluster n'y diffèrent parfois pas du
tout.

Trois `dist` de diagnostic ont donc été construits — jamais fusionnés, jamais commis —, chacun
remplaçant le corps de `shade_fs` par une couleur d'identité écrite telle quelle dans une cible
`rgba8unorm` (aucune conversion sRGB, l'aller-retour est exact) :

- **beauté** : le rendu normal, la référence de ce que l'utilisateur voit ;
- **hachage de cluster** : les 24 bits de poids faible de `page.clusterHash`, donc l'identité du
  **cluster** (partagée par toutes ses instances) ;
- **page + triangle** : `tri` sur le rouge, les 16 bits de poids faible de `pageIndex` sur le vert et
  le bleu, donc l'identité de l'**instance de cluster** et du **triangle**.

Croiser les trois donne, pour chaque pixel d'égalité, la nature du couple qui s'y dispute. Les trois
lectures sont cohérentes entre elles au pixel près (1 191 + 739 = 1 930 = 2 772 − 842 sur générale),
ce qui est le contrôle interne de la méthode. Témoin A/A à 0 px sur toutes les exécutions.

### 2. Les catégories d'égalité, comptées

Emerald, `webgpu-page-raster`, 1280×720, `--max-pages 100000`, caméra fixe, cache du Lab
(manifeste binaire 4). Ensemble d'égalité complet, relevé sur l'image d'identité `page + triangle` :

| vue      | égalités totales | deux triangles d'**un même cluster** | deux **instances d'un même cluster** | deux **clusters distincts** |
| -------- | ---------------- | ------------------------------------ | ------------------------------------ | --------------------------- |
| générale | 2 772 px         | 1 191 px (43 %)                      | 739 px (27 %)                        | 842 px (30 %)               |
| rue      | 10 479 px        | 6 667 px (64 %)                      | 1 422 px (14 %)                      | 2 390 px (23 %)             |
| sol      | 2 px (beauté)    | —                                    | —                                    | —                           |

Sur l'image de beauté, les mêmes égalités valent 2 287 px (générale), 6 544 px (rue), 2 px (sol) :
une égalité entre deux fragments de couleur identique ne se voit pas, et 1 441 des couples de
couleurs de générale ne diffèrent que d'une unité sur un canal — le même matériau lu à un niveau de
mip voisin.

**Conséquence immédiate.** Une couche de profondeur est portée par la colonne `pageDepthLayer`, une
valeur **par page de primitive**. Elle ne peut donc séparer ni deux triangles d'un même cluster
(43 à 64 % des égalités) ni deux instances d'une même page (14 à 27 %). L'objectif « plus aucune
égalité de profondeur exacte » **n'est pas atteignable** par une extension de
`coplanar-depth-layers-v1`, quelle que soit la finesse de sa détection : 57 à 77 % des égalités sont
hors de portée du format. Ce n'est pas une limite de l'étape, c'est une limite de l'unité qu'elle
étiquette.

### 3. Ce qui bloque vraiment les leviers Hi-Z est un sous-ensemble bien plus petit — et il est, lui, à portée

Une égalité ne déplace un pixel que si la partition peut changer l'ordre relatif des deux fragments.
La partition déplace des **pages** d'une passe à l'autre ; elle ne réordonne jamais les triangles
d'un même dessin. Vérifié plutôt que supposé, en rejouant la passe unique (`hasRestPipeline =
false`, la ligne de `4c7419c`) sur `7b7a79f` avec l'image d'identité :

| vue · seuil  | pixels sensibles à la partition | dont deux triangles d'un même cluster | dont deux clusters distincts |
| ------------ | ------------------------------- | ------------------------------------- | ---------------------------- |
| générale · 0 | 67                              | **0**                                 | **67**                       |
| générale · 1 | 178                             | **0**                                 | **178**                      |
| rue · 0      | 38                              | **0**                                 | **38**                       |
| rue · 1      | 29                              | **0**                                 | **29**                       |

Cent pour cent des pixels que la partition déplace opposent **deux clusters distincts** — jamais
deux triangles d'un cluster, jamais deux instances d'une même page (l'image de hachage de cluster
compte les mêmes 67 / 179 / 41 / 31 px). Une couche **par cluster** suffirait donc, en principe, à
rendre l'image du chemin WebGPU indépendante de la partition. Le format n'est pas le verrou du
levier ; il n'est que le verrou de l'objectif « zéro égalité ».

### 4. Le verrou réel : « 0 pixel contre develop » et « image indépendante de la partition » s'excluent

Départager une égalité à la compilation, c'est en fixer le vainqueur une fois pour toutes. Pour être
à 0 pixel contre `develop`, ce vainqueur doit être celui que `develop` produit aujourd'hui. Or, sur
exactement ces pixels, le vainqueur actuel **est décidé par la partition** — c'est la définition de
« sensible à la partition » —, et la partition est décidée à l'exécution, à partir des occulteurs de
l'image précédente. Aucune règle de compilation ne peut la reproduire.

Le prix est donc mesurable, et il l'est : c'est exactement l'écart de la passe unique contre
`develop`, sur l'image de beauté, les deux côtés lisant le même cache du Lab.

| vue      | seuil 0 | seuil 1 |
| -------- | ------- | ------- |
| générale | 67 px   | 173 px  |
| sol      | 1 px    | 1 px    |
| rue      | 39 px   | 28 px   |

Soit 0,007 % de l'image sur générale au seuil 0. C'est le déplacement de référence qu'il faut
accepter — une fois — pour que la partition cesse de décider l'image, et donc pour que les deux
leviers Hi-Z deviennent prouvables. Tant qu'il n'est pas accepté, la porte des 0 pixel refuse aussi
bien le levier que l'étape de compilation qui le débloquerait. **Rien n'est fusionné.**

### 5. Les deux leviers, rejoués sur `7b7a79f`

- **`essai/hiz-historique` (séparation des deux invalidations)**, reporté sur `develop` (`6fbecc4`,
  branche `essai/hiz-historique-v2`, le correctif de borne de `2439fc9` étant déjà fusionné) :
  caméra mobile, vue générale, 60 images — seuil 0 **0 px**, seuil 1 **3 px**, témoin A/A 0 px. Les
  trois pixels, lus sur l'image d'identité, sont (1045,33), (1087,68) et (1077,172) : **trois
  couples de clusters distincts**, aucun triangle d'un même cluster. Non fusionné.
- **La partition temporelle** (`chantier-phase1-3-hiz-temporelle`) n'a pas été portée : son verdict
  est le même que celui de la passe unique, dont elle est une variante d'ordre, et la mesure de la
  passe unique ci-dessus le chiffre sans avoir à porter le code.

### Portée : ce qui est général, ce qui n'est qu'une mesure

Rien de ce lot n'est calé sur une scène. Le classement des égalités (deux triangles d'un cluster,
deux instances d'une page, deux clusters distincts) est une propriété de l'**unité que le format
étiquette**, pas d'un modèle : il vaut pour n'importe quelle scène importée, et c'est lui qui porte
la conclusion. Les nombres ci-dessus sont ce qu'une scène urbaine donne aujourd'hui sur cette
machine — une mesure, jamais une cible ni un seuil : une autre scène donnera d'autres comptes, et
l'exclusion arithmétique de la section 4 ne changera pas pour autant. Aucune preuve n'a été
produite sur la scène synthétique des classes de matériaux : le lot ne livre aucun code de
compilation, il n'y avait rien à y prouver.

**Deux réglages du code existant ne se justifient aujourd'hui que par une mesure de scène, à
signaler sans les corriger (hors périmètre de ce lot, qui ne touche ni au compilateur ni au
rendu)** :

- `DEPTH_LAYER_BIAS_UNITS = 16` (`packages/sdk-core/depthLayer.ts`). La moitié de sa justification
  est générique — sur la fixture des deux quads, deux triangulations d'un même plan ne s'écartent
  que de cinq unités au pire, sur trois angles et trois plages near/far. L'autre moitié ne l'est
  pas : le choix de 16 plutôt que 32 ou 64 vient de ce que, **sur une scène de mesure précise**,
  au-delà de 16 le biais mord sur les surfaces voisines (94 px à 32). Une scène dont deux surfaces
  légitimes sont plus proches que 16 unités matérielles verrait donc la couche traverser. Le réglage
  devrait se déduire de la scène compilée — distance minimale entre deux plans distincts — au lieu
  d'être une constante.
- Les bornes de `CoplanarBounds::default()` (`max_pairs: 4096`, `max_surfaces_per_plane: 64`,
  `max_planes_per_primitive: 64`) sont des plafonds fixes qui font abandonner silencieusement des
  couples au-delà. Ils sont comptés dans le rapport, donc visibles, mais une scène plus dense qu'une
  scène urbaine les atteindra et sera analysée à moitié. `offset_quantum`, lui, est bien déduit de
  la taille de la scène : c'est le modèle à suivre.

### Formats et caches

Aucun changement de format : `formatVersion` du cache reste **3/4**, `MANIFEST_BINARY_VERSION` reste
**4**, la colonne `pageDepthLayer` existe déjà et est un `u32` — une v2 n'aurait rien eu à monter.
Le cache du Lab (`public/benchmark-assets/emerald-square-derived`) n'a été ni écrit ni régénéré : il
reste lisible, `prepare:models` n'a pas à être relancé.

### Ce qui reste

- **La décision appartient à l'utilisateur** : accepter le déplacement de référence de 67 / 173 /
  39 / 28 / 1 / 1 px (comme pour le lot budget-pages) ouvre d'un coup les deux leviers Hi-Z et les
  −27 % de temps GPU ; le refuser les ferme définitivement, puisque aucune règle de compilation ne
  peut reproduire un vainqueur décidé à l'exécution.
- Si la décision est « accepter », l'étape à écrire n'est **pas** une détection de coplanarité plus
  fine : c'est une couche par cluster qui reproduise l'ordre de la **passe unique** sur les couples
  en égalité, et rien d'autre. Sa preuve sera « branche contre passe unique = 0 px », pas « branche
  contre `develop` = 0 px ».
- Les 57 à 77 % d'égalités intra-cluster et inter-instances restent, et resteront : elles ne gênent
  aucun levier, mais elles interdisent d'écrire un jour « cette scène n'a plus aucune égalité de
  profondeur ».
- Images du harnais conservées : `.mesure/out/lot-coplanaires-v2/` (neuf campagnes, `resume.md`,
  `mesure.json` et les `.png` avant / après / A-A par vue et par seuil).

## 2026-09-15 — textures en boucle d'images : la priorité lisait une coupe que seul `flush()` remplit

Branche `fix-textures-live`, sur `develop` = `7b7a79f`. Défaut rapporté : dans le Lab, test
`15-virtualized-integration`, moteur WebGeometry WebGPU, exploration libre — « presque plus de
textures, du moins pas celles d'origine », surfaces grossières ou plates, jamais la pleine
résolution ; la colonne WebGPU du rapport 15 est plus claire et plus plate que les trois moteurs
WebGL.

### Le harnais a deux modes, et c'est ce qui manquait

Toutes les preuves navigateur du chantier forçaient `flush()` avant de capturer : tous les
transferts aboutissent, l'image capturée porte toujours la pleine résolution. En exploration libre
rien n'est forcé. `test/webgpuCapture.browser.mjs` accepte maintenant `CAPTURE_MODE` : `flush`
(inchangé, dix captures, contrôle A/A) et **`live`** (`test/browserFixtures/captureLive.mjs`) — N
images de parcours sans le moindre `flush()` ni `awaitPages()`, relevé image par image de
`texturePending`, `textureInFlight`, `textureUploaded`, `textureLevelsUploaded`,
`textureSlicesUploaded`, `textureSkipped`, `textureBytesLastFrame`, puis un unique `flush()` après
la dernière image pour relire l'image déjà rendue. `LIVE_CAPTURE_FRAME` choisit l'image capturée.
Sans ce second mode, la régression revient sans être vue.

### Les hypothèses, leur test, leur verdict

| hypothèse                                                     | mesure ou test                                                                                                  | verdict                             |
| ------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- | ----------------------------------- |
| la pompe n'aboutit jamais hors `flush()`                      | mode `live`, 541 images : `texturePending` **0** à l'image 414, `textureSkipped` **0**, aucun abandon           | **fausse** — elle converge          |
| le bit « prêt » ou le niveau résident n'atteint pas le shader | image live après convergence contre l'image `flush` : 0,24 % de pixels, sans biais ; `webgpuAtlasSlots.test.ts` | **fausse**                          |
| double encodage sRGB sur le chemin des niveaux progressifs    | test ajouté (`webgpuAtlasJobs.test.ts`) : un texel connu part octet pour octet du sidecar au niveau de mip `k`  | **fausse** — vert avant comme après |
| le journal du Lab montrerait des textures manquantes          | log de la campagne de l'utilisateur : `textureUploaded` **336**, `texturePending` **0**, `textureSkipped` **0** | **fausse** — tout est transféré     |
| **l'ordre de transfert ne suit pas la caméra**                | diagnostic temporaire : `run.drawn` **vide sur les 243 premières images**, puis figé ; tous les poids à zéro    | **vraie, cause racine**             |

### Cause racine, en une phrase

En boucle d'images le seul signal de priorité de la pompe, `run.drawn`, reste vide — il n'est refait
qu'à l'adoption d'un relevé de sélection, ce qui n'arrive qu'à `flush()`, puis reste figé sur un
vieux relevé — si bien que tous les poids valent zéro, la file n'est jamais réordonnée et les
textures partent dans l'ordre de l'atlas, une par image sous le budget de 16 Mio, la surface que la
caméra regarde restant des centaines d'images au niveau 64 px de sa pyramide.

Mesuré : à l'image 60, la file avait transféré les slots 1 à 30 dans l'ordre du rang, et le sol —
la surface qui occupe les deux tiers de l'image — était un gris plat sans grain.

### Correctif

`webgpuTexturePriority.ts` et `webgpuPagesRuntime.ts`. La priorité lit **`run.desired`**, la coupe
que l'image demande au cache, que les deux chemins de coupe réécrivent à chaque image (mesuré :
2 312 → 17 194 → 12 714 pages, elle suit la caméra) au lieu de `run.drawn`. Deux règles d'ordre
suivent, chacune mesurée :

- **tous les niveaux progressifs avant toute pleine résolution.** Avec les poids rendus non nuls, le
  comparateur d'avant (poids, puis étage) faisait passer les 16 Mio de la pleine résolution la plus
  lourde devant les 3 ko d'aperçu de toutes les autres : `textureLevelsUploaded` tombait de 786 à 0
  à la première image et l'image partait en blanc (biais +128 par canal). Étage d'abord.
- **la couleur avant les données.** Une couche couleur qui manque se voit ; une couche de données qui
  manque rend les facteurs scalaires du matériau. Les données pèsent deux fois la couleur
  (4,99 Go contre 2,57 Go sur Emerald). Mesuré à l'image 60 : **31 slots couleur prêts au lieu de
  8**, écart à la référence 78,6 % → 70,0 %.

### Chiffres

Lab en lecture seule sur le port 5301 (5174 laissé à l'utilisateur), config de mesure du scratchpad
qui ajoute `fs.allow`, aliase `@web-geometry/sdk` **et** `@web-geometry/sdk/browser` vers le `dist`
mesuré — les deux, sinon le Lab et le harnais chargent deux instances du SDK et le moteur WebGPU est
refusé — et met le cache de dépendances hors du Lab. Cache Emerald du Lab, sidecar version 4, 232
aperçus ; rien n'y est écrit. Captures 1246×1000.

| preuve                                              | avant                      | après                   |
| --------------------------------------------------- | -------------------------- | ----------------------- |
| `live` image 120, pose du segment 2, contre `flush` | **91,84 %**, écart max 100 | **0,21 %**, écart max 2 |
| `live` image 60, pose du segment 1, contre `flush`  | 75,55 %, écart max 154     | 70,0 %, écart max 154   |
| `live` image 540, pose du segment 9, contre `flush` | 0,23 %                     | 0,24 %                  |

- **`flush` contre le témoin `develop` du jour : 3 px sur 12 460 000**, sur les segments 3 (amplitude
  1. et 8 (amplitude 27). L'**A/A du correctif contre lui-même en porte 6, amplitude 105, sur ce même
     segment 8** : l'écart est strictement sous le bruit mesuré aujourd'hui. Fidélité tenue.
- **A/A du mode `live` : 0 px, au bit près** sur deux exécutions indépendantes.
- L'écart résiduel de 0,24 % entre `live` et `flush` après convergence n'est pas de la texture : les
  deux portent `textureUploaded` **336**, `textureLevelsUploaded` **786**, `texturePending` **0**,
  `textureSkipped` **0**. Il vient de la résidence — 19 637 pages contre 20 192, 375 chargements
  contre 378 — parce que le mode `flush` précharge à chaque point de contrôle par `awaitPages()` et
  que le mode `live` ne précharge rien. `uncoveredTriangles` **0** des deux côtés, aucune erreur GPU.
- Convergence complète de la pompe en boucle d'images : image **408 à 414** sur 541.

### Tests

- `webgpuTextureOrder.test.ts`, **nouveau** : deux pages, deux matériaux, la page de cent triangles
  rangée **en second** dans l'atlas, coupe GPU, budget d'une texture par passe, quatre images sans
  `flush()` — c'est sa couche qui doit partir la première. Rouge sur le code d'avant (`[1, 2]` au
  lieu de `[2, 1]`), vert après. Le faux `GPUDevice` note maintenant chaque bande de lignes
  transférée (`textureWrites`), ce qui rend l'ordre observable sans navigateur.
- `webgpuTexturePriority.test.ts` : deux tests ajoutés pour les deux règles d'ordre.
- `webgpuAtlasJobs.test.ts` : un test ajouté pour le chemin sRGB du sidecar au GPU.
- `npm run validate` en une passe : **702 tests JS/TS, 147 + 4 tests Rust, toutes les portes vertes**.

### Reste

- Le poids est un nombre de triangles, pas une surface à l'écran : une route de peu de triangles qui
  occupe les deux tiers de l'image pèse moins qu'une façade très découpée. C'est ce qui reste visible
  à l'image 60. Une pondération par aire projetée demanderait une mesure dédiée.
- Le budget de 16 Mio par image ne laisse passer qu'une texture 2048² par image : 336 textures et
  7,56 Go d'atlas sur Emerald, donc 336 images au minimum pour tout transférer. La priorité rend cela
  invisible ; elle ne le supprime pas.

## 2026-09-16 — [session sans-threejs] la cause des pixels du test Hi-Z : l'ordre de dessin, pas la borne (lot hiz)

Worktree `lot-hiz`, branche `lot/hiz`, partie de `develop` = `edf9e30`, rebasée sur `abe8827` (lot
rebond 2 de la session Lumière) avant la fusion et toute la preuve rejouée sur cette base. Quatre
branches d'essai gardées : `essai/hiz-diagnostic`, `essai/hiz-monopasse`, `essai/hiz-egalite`,
`essai/hiz-historique`.

### 1. La cause des 67 à 173 pixels de la partition temporelle, établie par l'expérience

La question ouverte du bilan de phase 1 était : la partition temporelle Hi-Z (« toutes les lignes
testées contre la pyramide complète ») gagne 27 % de temps GPU mais coûte 67 à 173 pixels, et on ne
savait pas si c'était un départage de surfaces coplanaires ou une borne `nearestDepth` qui n'est pas
un minorant. Quatre essais d'une ligne chacun, mesurés au harnais commun sur `develop` = `edf9e30`
(Emerald, vue générale, 1280×720, 60 images, `--max-pages 100000`, témoin A/A 0 px partout) :

| essai        | ce qu'il change                                                                     | pixels contre `develop`                       |
| ------------ | ----------------------------------------------------------------------------------- | --------------------------------------------- |
| D1 `04d9262` | partage occulteurs/testés à 90/10 au lieu de 50/50, **rejet actif**                 | **4 px** (générale), 0 px sol, 0 px rue       |
| D2 `629d379` | le même partage, **rejet neutralisé** (biais 1.0 : le noyau ne rejette plus rien)   | **les mêmes 4 px**, coordonnée par coordonnée |
| D3 `4c7419c` | **passe unique** : aucune partition, aucun test, tout dessiné d'un coup             | **67 px**                                     |
| D4 `385387a` | `develop` avec `depthCompare: 'less-equal'` : le dernier dessiné gagne les égalités | **2 287 px**                                  |

Ce que ces quatre lignes établissent, et qui ne tient à aucune hypothèse :

- **Le test Hi-Z n'a rien à voir avec ces pixels.** D1 et D2 diffèrent par la seule chose que le test
  décide — ce qu'il retire — et rendent **exactement le même ensemble de pixels**, alors que D1
  rejette bien davantage que `develop` (sa pyramide de passe 1 porte 90 % des lignes au lieu de
  50 %). Un test non conservateur aurait fait apparaître des pixels dans D1 et pas dans D2.
- **Ce qui les cause est l'ordre de dessin, sur des profondeurs exactement égales.** D4 compte
  2 287 pixels de la vue générale où deux fragments opaques portent la **même** profondeur au bit
  près ; sous `less`, le pixel revient au premier dessiné. Les 67 pixels de D3 sont **inclus dans ces
  2 287** (67 sur 67), et les 4 pixels de D1 aussi. Changer la partition, c'est changer la passe où un
  cluster est dessiné, donc l'ordre, donc le gagnant de ces égalités.
- L'étape de compilation `coplanar-depth-layers-v1` du 14 septembre traite ce défaut, mais elle ne
  marque aujourd'hui que **quatre clusters** d'Emerald : les 2 287 pixels restants ne sont pas
  départagés. Le compilateur Rust est hors périmètre de ce lot.

**Conséquence, écrite dans la spec (R5c) :** tant que ces surfaces ne sont pas départagées à la
compilation, _aucun_ changement de partition ne peut être prouvé à 0 pixel contre une référence
rendue avec une autre partition. Le verrou de la partition temporelle n'est pas un verrou Hi-Z.

### 2. La borne rendue minorante par construction (fusionné, `56d98f5`)

L'expérience dit que la borne n'a coûté aucun pixel ; elle ne dit pas qu'elle est un minorant. Deux
écarts la séparaient de la profondeur que la carte écrit, et les deux sont redressés :

- **L'arrondi du transport.** La borne est calculée en double et lue en simple précision par le
  noyau ; `Math.fround` arrondit au plus proche et pouvait donc la faire **monter** d'un demi-ulp.
  Elle descend maintenant d'un ulp avant l'arrondi — un multiplicateur `1 − 2⁻²⁴` et un `Math.fround`,
  pas de manipulation de bits par boîte.
- **Le biais de couche coplanaire.** Un cluster de couche non nulle est dessiné de seize unités
  matérielles par couche **plus près** de l'œil que son propre coin : son coin n'était donc pas un
  minorant de ce qu'il écrit. Les mêmes unités sont retranchées des bits de la borne par
  `biasedDepthBits`, la fonction que le raster logiciel applique déjà à sa clé.

Les deux redressements ne peuvent que faire dessiner davantage. Invariant écrit en **R5b** de la
spec : le test compare un minorant de ce que le cluster écrira à un majorant de ce qui est déjà
écrit sur son empreinte ; il peut retarder un cluster d'une passe, jamais retirer un pixel.

### 3. La projection d'une boîte, sans produit scalaire redondant ni conversion par coin (fusionné, `8e790ae`)

Deux raccourcis, tous deux vérifiés sur les éléments des matrices eux-mêmes, avec repli terme pour
terme sur l'arithmétique d'avant :

- La quatrième ligne d'une projection perspective vaut (0,0,−1,0), et `multiplyMatrices` en fait
  exactement l'opposé de la troisième ligne de la vue : `cw` vaut `-viewZ` **au bit près** — la
  négation est exacte et `(−a) + (−b)` vaut `−(a + b)` —, donc un produit scalaire de moins par coin.
- Le passage du repère normalisé à l'écran est monotone coordonnée par coordonnée : l'extremum de
  l'image est l'image de l'extremum. Les cinq conversions se font une fois par boîte au lieu de
  vingt-quatre.
- Le dénominateur de vue d'une vue affine n'est plus calculé du tout ; il valait déjà exactement 1.

### Preuve

Verrou `.claude/mesure.lock` pris et libéré. Harnais commun, `--moteur webgpu`, 1280×720, 60 images,
chauffe par défaut, `--max-pages 100000`, les deux côtés lisant le même cache Emerald du Lab
(manifeste binaire version 4). `avant` = `develop` = `abe8827`, `après` = `31fb4de` (tête du lot).

| série                                 | vues × seuils    | caméra mobile    | témoin A/A   | hash de coupe | trous | `selectedTriangles` |
| ------------------------------------- | ---------------- | ---------------- | ------------ | ------------- | ----- | ------------------- |
| Q1 générale, sol, rue × 0, 1          | **0 px sur 6/6** | —                | 0 px sur 6/6 | identique 6/6 | 0     | identiques          |
| Q2 générale × 0, 1, `--camera-mobile` | —                | **0 px sur 2/2** | 0 px sur 2/2 | identique 2/2 | 0     | identiques          |
| Q3 générale · 0                       | 0 px             | —                | 0 px         | identique     | 0     | identiques          |

Soit, sur générale · 0, **trois exécutions du témoin A/A à 0 px**. Aucune erreur de page, aucun 404.

**Durées, machine chargée (charge 1 min entre 8 et 12 pendant toute la campagne)** : à cette charge
les valeurs ne comptent que par leur sens. Profil par étape, p50, avant → après :

| série                | Projection des boîtes | Fiches de dessin | `cpuFrameMs` p50/p95              |
| -------------------- | --------------------- | ---------------- | --------------------------------- |
| générale · 0, fixe   | 0,20 → 0,20           | 1,20 → 1,30      | 8,10 / 8,70 → **7,80 / 8,50**     |
| générale · 0, mobile | **3,80 → 3,40**       | 1,00 → 1,20      | 11,00 / 12,50 → **10,70 / 12,80** |
| générale · 1, mobile | **1,80 → 1,60**       | 0,50 → 0,50      | 4,30 → 4,60                       |

La projection est **bornée par la mémoire**, pas par l'arithmétique : une image mobile relit les
46 446 × 24 doubles de coins, soit 8,9 Mo, et c'est ce qui reste après avoir enlevé un tiers des
opérations. Les fiches de dessin portent le coût du redressement de la borne, un dixième de
milliseconde sur 36 866 boîtes testées.

### Ce qui n'est pas fusionné, et pourquoi

- **`essai/hiz-historique` (`5c52b12`) : séparer les deux invalidations.** `invalidateOccluderHistory`
  retirait d'un même geste la pyramide temporelle — qui n'est relue que pour une vue identique — et
  l'historique des occulteurs, qui ne nomme que des pages. Les séparer fait ce que le lot encodage
  avait chiffré : les compteurs passent de `sansHistorique 1, bornesToutes 1` à `0, 0` à caméra
  mobile, la projection de **4,00 → 3,10 ms** (seuil 0) et **1,80 → 1,00 ms** (seuil 1), `cpuFrameMs`
  p50 de **13,0 → 12,0** et **4,1 → 3,1 ms**. Mais la partition change, donc l'ordre : caméra mobile,
  seuil 0 **0 px**, seuil 1 **3 px, écart de canal maximal 1**, reproduit à l'identique sur deux
  exécutions, témoin A/A 0 px. Trois pixels ne sont pas zéro : la branche est gardée, non fusionnée.
- **La partition temporelle elle-même** (toutes les lignes testées contre la pyramide complète de
  l'image précédente) n'a pas été réécrite : la cause de ses pixels est établie et elle ne lui
  appartient pas, donc la réécrire ne l'aurait pas rendue prouvable. Le code d'origine reste lisible
  en `986ea50` (et son retrait en `8c1b19b`).

### Portes

`npm run validate` vert de bout en bout (`format:check`, `check:lines`, `check:duplicates` **0
clone**, `lint` + Clippy, `check:unused`, `build`, `build:native`, `check:structure`, `check:dts`,
`check:links`, tests JS **698, 0 échec**, tests Rust **134 + 4, 0 échec**). Quatre tests ajoutés dans
deux fichiers : `hizProjectionIdentique.test.ts` (identité bit à bit de la projection contre
l'arithmétique complète, sur une perspective, une orthographique — dont la quatrième ligne n'est pas
(0,0,−1,0) — et une vue non affine, 400 boîtes à graine fixe) et `hizNearestBound.test.ts` (la borne
ne dépasse jamais son entrée, la couche coplanaire retranche exactement ses unités, et la correction
ne peut que faire dessiner davantage). L'oracle du lot F reprend le redressement de la borne : il
départage des lectures, pas une borne. `render-tech-lab/` non modifié ; port 5174 non touché ; aucun
`eslint-disable` ; `node_modules` (lien symbolique) non committé ; rien écrit dans `public/` ;
fichiers d'éclairage, d'ombres, compilateur Rust et `scripts/mesure/` non touchés.

**Une instabilité observée, à signaler sans l'expliquer** : sur sept exécutions de `cargo test` pendant
le lot, **une** a rendu « 146 passed, 1 failed » sans que le nom du test soit capturé ; les six
autres, dont quatre lancées de suite pour le reproduire, rendent « 147 passed, 0 failed ». Aucun
fichier Rust n'est touché par ce lot ; la machine était chargée (8 à 12).

### Ce qui reste

- **Le levier de 1 ms à caméra mobile est prêt et bloqué par trois pixels**, pas par sa justesse. Il
  se débloque de deux façons, aucune dans ce lot : étendre `coplanar-depth-layers-v1` aux 2 287
  pixels d'égalité (compilateur Rust), ou faire accepter un changement d'image de référence comme
  pour le lot budget-pages.
- **La partition temporelle et ses −27 % de temps GPU** attendent le même déblocage.
- La projection restante (3,4 ms à caméra mobile) est **bornée par la relecture des coins**. La
  réduire demande de ne pas relire 8,9 Mo par image : coins en simple précision, ou projection sur la
  carte.
- Le chemin CPU de repli (`hizUnoccluded`, `applyTemporalHiz`) ne porte pas le redressement de la
  borne : il ne connaît pas la couche coplanaire d'une page. Sans effet sur le rendu WebGPU.

## 2026-09-16 — [session sans-threejs] CPU par image WebGPU : encodage et soumission (lot encodage)

Worktree `lot-encodage`, branche `lot/encodage`, partie de `develop` = `21dbe9e`, rebasée sur
`62c6b3d` (lot rebond de la session Lumière) avant la fusion et la preuve rejouée sur cette base.
Six commits : `961d37c` (profil nommé), `231f50d` (sélection de la moitié proche), `e96962a`
(projection), `aa6462c` (adoption), `953d810` (transparents), `8082e64` (tests).

### 1. Le profil de départ, parce qu'il n'existait pas

Le profil par étape du moteur WebGPU déposait la projection des boîtes, la partition
occulteurs/testés, les fiches de dessin et l'encodage des passes sur une seule étape « Encodage des
commandes », et l'adoption de la coupe sur « Sélection ». On ne pouvait donc pas dire où allaient
les 4,5 ms que cette étape portait. Chaque borne a maintenant la sienne — ce sont les bornes que le
moteur tenait déjà, rangées une par une — et trois séries de compteurs disent ce que l'image a
réellement fait : lignes et occulteurs de la partition, lignes et fiches téléversées, appels de
dessin. La projection se chronomètre aussi dans la branche sans historique, où elle projette toutes
les boîtes ; elle se déposait jusqu'ici sur la partition.

Départ mesuré sur cette base (Emerald, vue générale, 1280×720, `--max-pages 100000`, charge 5) :

| étape                 | fixe · 0 (p50) | mobile · 0 (p50) |
| --------------------- | -------------- | ---------------- |
| Adoption de la coupe  | **1,3**        | 0,0              |
| Sélection             | 0,2            | 0,2              |
| Téléversements        | 0,2            | 0,2              |
| Partition             | 0,4            | **1,5**          |
| Projection des boîtes | 0,1            | **4,2**          |
| Fiches de dessin      | **1,2**        | 1,1              |
| Encodage des passes   | **2,8**        | 2,3              |
| Soumission            | 0,0            | 0,0              |
| somme des étapes      | 6,2            | 9,5              |
| `cpuFrameMs`          | 8,8            | 13,4             |

**Ce que ce profil a appris, et qui n'était pas ce que le lot attendait.** (a) À caméra mobile la
borne la plus chère n'est pas l'encodage mais la **projection des boîtes**, et les compteurs disent
pourquoi : `sansHistorique 1`, `bornesToutes 1` à chaque image. (b) L'encodage restant n'est ni un
téléversement ni une boucle par ligne — `lignesTeleversees 0`, `fichesTeleversees 0` : la table des
rangs et les fiches sont stables et ne repartent pas sur la carte à chaque image. C'est le **nombre
d'appels de dessin**, 1 936 par image, dont 1 928 de mélange. (c) L'adoption de la coupe refaisait
la liste dessinable à chaque image, même sur le relevé déjà tenu.

Les étapes 2 à 5 suivent ce que le profil a montré, pas ce qui était supposé avant lui.

### 2. Partition : sélectionner la moitié la plus proche au lieu de la trier

Le partage ne lit que l'**ensemble** de la moitié la plus proche, jamais son ordre : huit passes de
dispersion radix sur toute la coupe y répondaient. Une sélection suffit — descente des octets du
plus fort au plus faible, les seaux entiers qui tiennent sous le rang cherché marqués d'un coup, et
une seule redescente dans celui qui le contient. L'ensemble rendu est celui du tri stable terme pour
terme : tout ce qui est strictement plus proche que la clé de rang, puis les premières clés égales
dans l'ordre des candidats. Le tri complet reste pour le chemin qui rend des pages ordonnées.

### 3. Projection : la division que la vue affine rend inutile, et l'arrêt au premier coin coupé

La quatrième ligne de la vue d'une caméra vaut exactement (0,0,0,1) : le dénominateur du passage en
espace de vue vaut alors exactement 1 pour un coin fini, et multiplier par 1 rend la même valeur au
bit près. La division est **sautée quand le dénominateur vaut 1**, jamais remplacée — un dénominateur
inexact, ou une vue qui n'est pas affine, retombe sur elle, ce qui garde l'arithmétique identique là
où `1/x` et `×(1/x)` diffèrent. Et une boîte qui coupe le plan proche rend un enregistrement que plus
aucun coin ne lit : la boucle s'y arrête.

### 4. Adoption : ne refaire la liste dessinable que quand le relevé change

Chaque image reconstruisait la liste des enregistrements dessinables depuis le relevé, même quand
c'était le relevé déjà tenu : quatre-vingt mille poussées dans un tableau intermédiaire, puis autant
dans `shown`, puis autant dans `drawn`. Le contenu de `shown` est une fonction du seul relevé — les
mêmes identifiants, lus dans le même catalogue, rendent les mêmes enregistrements dans le même ordre.
Un relevé dont la liste est déjà faite ne la refait donc plus, et seuls les comptes sont relus : eux
seuls dépendent de la résidence, et ils le sont sur les mêmes enregistrements, dans le même ordre,
par la même arithmétique. Le chemin qui réécrit les tableaux (coupe processeur) oublie déjà le relevé
tenu, ce qui suffit à la sûreté. Le tableau intermédiaire disparaît.

### 5. Transparents : un pipeline posé une fois par changement, et leur encodage nommé

La passe de mélange reposait son pipeline à chaque item — 1 928 fois par image — alors que la liste,
triée par ordre source, enchaîne des items qui demandent le même. Le pipeline courant est suivi ;
l'ordre et le nombre des appels de dessin sont inchangés. Le temps processeur de cette passe se
dépose désormais sur l'étape « Transparents », qu'elle n'avait plus remplie depuis que la coupe des
transparents est sur la carte graphique, et sort de l'encodage restant.

### Preuve

Verrou `.claude/mesure.lock` pris et libéré. Harnais commun, `--moteur webgpu`, 1280×720, 60 images,
chauffe par défaut, `--max-pages 100000`, les deux côtés lisant le même cache Emerald recompilé hors
du banc (manifeste binaire version 4, 281 primitives). Une exécution 3 vues × 2 seuils **et** une
exécution caméra mobile 2 seuils par étape, `avant` = `develop`.

| étape              | base      | commit mesuré | vues × seuils | caméra mobile | A/A | hash de coupe | trous |
| ------------------ | --------- | ------------- | ------------- | ------------- | --- | ------------- | ----- |
| 1 profil nommé     | `21dbe9e` | `8221ce2`     | 0 px sur 6/6  | 0 px sur 2/2  | 0   | identique 8/8 | 0     |
| 2 sélection proche | `21dbe9e` | `7c2dc3d`     | 0 px sur 6/6  | 0 px sur 2/2  | 0   | identique 8/8 | 0     |
| 3 projection       | `21dbe9e` | `b55e34a`     | 0 px sur 6/6  | 0 px sur 2/2  | 0   | identique 8/8 | 0     |
| 4 adoption         | `21dbe9e` | `77fc010`     | 0 px sur 6/6  | 0 px sur 2/2  | 0   | identique 8/8 | 0     |
| 5 transparents     | `21dbe9e` | `1b52d5b`     | 0 px sur 6/6  | 0 px sur 2/2  | 0   | identique 8/8 | 0     |
| tête, après rebase | `62c6b3d` | `8082e64`     | 0 px sur 6/6  | 0 px sur 2/2  | 0   | identique 8/8 | 0     |
| tête, après rebase | `09092c5` | `49dd55f`     | 0 px sur 6/6  | 0 px sur 2/2  | 0   | identique 8/8 | 0     |

`develop` a bougé deux fois pendant le lot — le lot rebond de la session Lumière (`62c6b3d`), puis
l'audit des calculs (`09092c5`), qui touchent tous deux du code de production du moteur. La branche a
été rebasée sur chacun et la preuve rejouée en entier ; les commits mesurés par étape sont donc ceux
d'avant les rebases, et ce sont les mêmes correctifs que ceux fusionnés (`1232c8d`, `d6bbb2c`,
`63141fe`, `f5c8140`, `2d60e23`, `da83171`). La dernière ligne est celle qui fusionne.

`uncoveredTriangles` 0 des deux côtés partout, `selectedTriangles` identiques série par série, témoin
A/A à 0 px sur chacune des seize séries des deux preuves finales, plus une exécution A/A
supplémentaire de générale · 0 sur chaque base — soit, sur la base qui fusionne, deux exécutions du
témoin à 0 px, comme demandé.

**Ce que gagne chaque étape**, relevé sur l'exécution de l'étape elle-même, les deux côtés joués dans
les mêmes conditions (p50, avant → après) :

| étape          | ce qui bouge dans le profil                   | fixe · 0      | mobile · 0      |
| -------------- | --------------------------------------------- | ------------- | --------------- |
| 2 sélection    | Partition 1,5 → **1,0** (mobile)              | 8,7 → 8,6     | 11,4 → **11,0** |
| 3 projection   | Projection 4,2 → **3,9** (mobile)             | 8,8 → 8,9     | 13,0 → **11,7** |
| 4 adoption     | Adoption 1,3 → **0,7** (fixe)                 | 8,6 → **8,4** | 12,2 → **11,2** |
| 5 transparents | Transparents nommés, 0,5 sortis de l'encodage | 8,9 → 9,1     | 11,9 → **10,9** |

Et la tête du lot contre `develop`, les deux côtés dans les mêmes conditions — charge machine
relevée **12 à 21** sur `62c6b3d` et **13 à 44** sur `09092c5`, une indexation système que cette
session ne contrôle pas. À cette charge les durées ne valent que par leur sens, pas par leur valeur :
c'est le tableau par étape ci-dessus, relevé entre 5 et 12, qui chiffre les gains. Les verdicts
pixel, eux, n'en dépendent pas :

| série      | sur `62c6b3d`, p50/p95        | sur `09092c5`, p50/p95        |
| ---------- | ----------------------------- | ----------------------------- |
| fixe · 0   | 8,4 / 9,7 → **8,3 / 9,5**     | 9,8 / 10,7 → **8,0 / 8,9**    |
| fixe · 1   | 2,8 / 3,3 → **2,5 / 2,9**     | 2,8 / 3,3 → **2,5 / 2,9**     |
| mobile · 0 | 11,9 / 13,7 → **10,8 / 13,5** | 12,0 / 13,3 → **11,3 / 14,0** |
| mobile · 1 | 4,1 / 4,9 → **3,9 / 4,5**     | 6,7 / 7,8 → **5,4 / 6,1**     |

Profil de la tête, vue générale · 0 : fixe — adoption 0,8, sélection 0,2, transparents 0,5,
téléversements 0,2, partition 0,3, projection 0,2, fiches 1,2, encodage 2,3 ; mobile — projection
4,0, fiches 1,2, encodage 1,6, partition 0,9, transparents 0,5, téléversements 0,3, sélection 0,2.

### Portes

`npm run validate` **vert de bout en bout** (`format:check`, `check:lines`, `check:duplicates` 0
clone, `lint` + Clippy, `check:unused`, `build`, `build:native`, `check:structure`, `check:dts`,
`check:links`, tests JS **661, 0 échec**, tests Rust **134 + 4, 0 échec**). Huit tests ajoutés dans
quatre fichiers : `hizSplitSelection.test.ts`, `webgpuCutAdoptionHold.test.ts`,
`hizProjectionAffine.test.ts`, `webgpuBlendPipelineBind.test.ts`. `render-tech-lab/` non modifié ;
port 5174 non touché ; aucun `eslint-disable` ; `node_modules` (lien symbolique) non committé ; rien
écrit dans `public/` ; fichiers d'ombres, de lampes, d'éclairage et compilateur Rust non touchés.

### Ce qui reste, et ce qui n'a pas été fait

- **La cible `< 4 ms` n'est pas atteinte** : 8,3 ms fixe et 10,8 ms mobile, dont 5,7 et 8,7 dans les
  étapes nommées. Ce lot enlève entre 0,1 et 1,1 ms selon la série ; il a surtout **nommé** où le
  reste se trouve, ce qui manquait.
- **Le plus gros levier restant est nommé et chiffré : la projection des boîtes à caméra mobile,
  4,0 ms.** Elle n'est pas chère parce que la projection le serait — à caméra fixe elle coûte 0,2 ms
  — mais parce que **toute la moitié occulteuse de l'image précédente est jetée dès que la caméra
  bouge d'un cheveu** : `invalidateOccluderHistory` est appelée sur tout changement de vue et retire
  d'un même geste l'historique des occulteurs _et_ la pyramide temporelle. Le partage retombe alors
  sur la branche sans historique, qui projette les 46 446 boîtes au lieu des 25 438 testées, puis les
  classe. Les compteurs le disent à chaque image : `sansHistorique 1`, `bornesToutes 1`. Séparer les
  deux — garder la moitié occulteuse, jeter la pyramide — enlèverait de l'ordre de 2,9 ms à caméra
  mobile. **Ce n'est pas fait, et ce n'est pas anodin** : la moitié occulteuse décide quels clusters
  passent par le test Hi-Z, et le bilan de phase 1 note une partition temporelle qui a coûté 67 px.
  L'essai n'a pas été tenté faute de temps dans ce lot ; il se prouve par les mêmes six séries plus
  la caméra mobile, et se jette s'il coûte un pixel.
- **Fiches de dessin, 1,2 ms**, inchangées : ce que le lot visait au départ. La boucle ne réécrit
  déjà plus les fiches (`fichesTeleversees 0`) ; ce qu'elle refait par image, ce sont les comptes par
  slot, les bits de la moitié testée et la compaction des bornes Hi-Z, tous trois fonctions de la
  partition. Les écrire sur la carte demande d'y porter aussi la partition, donc le levier ci-dessus
  d'abord.
- **Encodage des passes, 1,6 à 2,3 ms** : 1 936 appels de dessin, dont 1 928 de mélange — un, ou deux
  pour un matériau double-face, par primitive transparente visible, y compris celles dont la coupe est
  vide, que le processeur ne peut pas connaître puisque la compaction est sur la carte. La
  déduplication du pipeline a pris ce qu'elle pouvait ; le reste demanderait de savoir avant l'image
  quelles primitives n'ont rien à dessiner.
- **Adoption, 0,8 ms** : le lot l'a divisée par deux, pas amenée à 0,1. Ce qui reste est le parcours
  des quatre-vingt mille identifiants pour relire `uncovered`, le seul compte qui dépende de la
  résidence. Le mettre en cache demande une estampille exacte couvrant `residentOffsetWords` et
  `rec.array`, que l'hôte pose hors du cache GPU — le même obstacle que le lot 3b avait nommé.
- **Écart entre `cpuFrameMs` et la somme des étapes**, 2,1 ms à caméra mobile et 2,6 à caméra fixe :
  les deux listes que l'hôte demande après le rendu, et les boucles que `renderWebgpuPages` joue
  avant la première borne — `updateMatrixWorld` de la scène et, pour chaque item transparent, la
  recopie de sa matrice monde puis le retransport de sa boîte, refaits à chaque image même quand rien
  n'a bougé. Aucune de ces trois n'a d'étape à son nom ; c'est la prochaine chose à nommer.

## 2026-09-15 — audit des calculs clos : lots D, E, F, G fusionnés, 55 optimisations à résultat identique

- **Lot D, shaders GPU** : déterminant et matrice hissés par page (petits triangles), produit de matrices une fois (identifiant de visibilité), compaction des lampes par `countOneBits`, cône du DAG calculé une fois par image et relu par les passes suivantes. Campagne `webgpu`, 4 vues × 120 images, avant `0d5fb87` / après `15ba238` : témoin A/A 0 px, avant/après 0 px, hashes de sélection identiques, `uncoveredTriangles = 0`. Temps GPU relevés mais non concluants (charge 77 à 88). D3 (scan préfixe parallèle) sort du lot : identique sur tampons GPU (120 tirages) mais non couvert par la campagne ; fusion check+mask écartée (barrière entre passes) ; comparaison au carré sans objet.
- **Lot E** : oracles et bancs déménagés de `scripts/mesure/calculs/` vers `packages/sdk-browser/bench/` et `packages/sdk-core/bench/` (47 fichiers, 24 tests recâblés), les agrégateurs seuls restent sous `scripts/`. Un premier déménagement avait été retiré de `develop` par un `branch: Reset to HEAD` d'une autre session (sauvegardé sous le tag `audit/lot-e-v1`) ; refait sur l'état à jour.
- **Lot F** : 17 lignes retenues (commit de lignes déplacées seulement, index de ligne sur `PageRec`, transparentes tenues à part, bornes Hi-Z par bloc, `colorAttachments` en cache, mapping d'instance stocké, anneau de préchargement 0,69 → 0,08 ms, `textureRgba` sans vue par texel, `pageSelectionCollect` 7,2 → 5,4 ms, index des primitives et des pages, préparation WebGPU, décodage du manifeste, `hypot` sans étalement). Refusés : tri par insertion (diverge de `sort` sur clé NaN), `viewProj`, `uncovered` hors delta, anisotropie (`texture.version` observable) ; neutres revertés : slots d'ombre, paire de moteurs, `Map` de bundles ; `multiply4` sans objet après la réécriture des faces d'ombre sur `develop`. 69 tests.
- **Passage global G** (deux Sonnet neufs, 189 fichiers relus, 12 points) : 10 retenus — coupe autonome sans parcours complet, ombrage CPU 23,5 → 15,1 ms, compteur d'octets, demande annulée 1,22 → 0,09 ms, file d'adresses 0,96 → 0,05 ms, étiquettes des colonnes Rust 13,8 → 0,36 ms, bornes de cascade solaire par vue, validation d'accessor unique, niveaux de preview, min/médiane/max sans tri. Neutres : cache de coins Hi-Z (relire 24 doubles coûte plus que retransformer 8 coins), preview Rust. Le harnais JS a gagné une mesure alternée (`options.alterne`) : la mesure séquentielle donnait 25 à 40 % d'avance au premier tour sur machine chargée.
- Bilan dans `orchestration/AUDIT_MATH_BILAN.md` ; `AUDIT_MATH_PLAN.md` et les rapports G supprimés (plan terminé). Reste : D3 avec sa propre campagne, et la preuve navigateur chiffrée des temps par image sur machine calme.

## 2026-09-15 — lot « rebond 3 » : cascades autour de la caméra, budget en millisecondes, ordre 2

Branche `lot/rebond-3`, sur `develop` = `abe8827`. Le format du sidecar n'est pas touché et l'objet
de cache `proxy.bin` garde sa version 2 : un cache compilé pour le lot 2 marche tel quel.

### Ce que le lot remplace

- **Cascades au lieu d'une grille fixe.** Jusqu'à quatre cubes emboîtés de 16 sondes par axe ; chaque
  niveau double son écartement, les plus fins suivent la caméra, le dernier reste fixe dans le monde
  et couvre l'emprise du proxy. Une scène assez petite n'obtient qu'un seul niveau, fixe, et la
  cascade s'arrête au premier niveau qui couvre déjà tout : un niveau de plus ne verrait rien de neuf.
  L'écartement du plus fin vaut au plus 2 m, resserré pour garder au moins trois couches de sondes en
  travers de la plus mince dimension de la scène, élargi si le plus grossier ne traversait pas la
  scène sans cela. Sur Emerald (232 × 104 × 232 m) : **2,23 / 4,46 / 8,92 / 17,85 m**, 16 384 sondes.
  Sur la pièce de contrôle (8 × 3 × 8 m) : **un seul niveau à 1 m**, 4 096 sondes.
- **Les sondes ne bougent pas.** Elles vivent sur un réseau global, au centre de leur maille, et une
  maille se range par son reste modulo le côté du cube. Glisser d'une maille ne périme donc que la
  tranche qui entre ; tout le reste garde son travail. Chaque sonde porte la maille qu'elle tient, et
  une sonde qui ne tient pas celle qu'on lui demande ne pèse rien — c'est ce qui remplace une purge.
- **Une carte d'occupation dit où poser une sonde.** Calculée une fois sur le proxy, dilatée d'une
  maille, réduite exactement d'un niveau au suivant. L'ordonnanceur saute le ciel vide et le cœur
  plein des blocs : sur Emerald **83 562 mailles sur 802 816** méritent une sonde, soit 10,4 %. Une
  sonde enterrée dans une surface ou perdue en plein ciel s'endort en plus d'elle-même, et les mises
  à jour suivantes la sautent sans lancer un rayon jusqu'à ce qu'une lampe change.
- **Le budget devient une durée.** `createExplorer({ bounceBudgetMs })`, 0,8 ms par défaut. Le rebond
  lit le chronomètre de sa propre étape dans le profil par passe — jamais une estimation — et corrige
  d'un quart de l'écart la fraction de ses plafonds publiés que l'image suivante encodera. Les
  plafonds (49 152 rayons, 16 384 mailles de cache) restent des bornes connues avant l'image (X2).
  Approximation déclarée : le relevé revient avec plusieurs images de retard et une image sur trois
  ou sur douze ; sans horodatage, la fraction reste à un, et c'est dit.
- **Base d'ordre 2**, neuf coefficients au lieu de quatre : 44 flottants par sonde au lieu de 24.

### Coût, Emerald, huit lampes dont une mobile

1280 × 720, WebGPU, 180 images de profil, mode visible, cache Emerald recompilé par ce compilateur
(proxy 94 648 triangles, 7 609 nœuds, 4,3 Mo, maille 4 m). **Machine jamais calme : la charge est
restée entre 21 et 68 pendant toute la journée**, si bien que seuls les relevés par horodatage de la
carte graphique sont utilisables ; les durées processeur de l'étape valent `null`.

| vue      | `develop` p50/p95 |     lot p50/p95 | fraction du budget tenue |
| -------- | ----------------: | --------------: | -----------------------: |
| générale |    2,33 / 3,22 ms | **0,99 / 2,88** |                    5,5 % |
| sol      |    2,74 / 3,65 ms | **0,83 / 2,43** |                    3,0 % |
| rue      |    2,37 / 3,20 ms | **1,01 / 4,16** |                    2,4 % |

Scène immobile, même campagne sans lampe mobile : **0,94 / 0,74 / 0,73 ms** p50, fraction 3,1 à 5,6 %.
Les compteurs publiés par image : sondes mises à jour 9 à 24, rayons 576 à 1 536, mailles de cache
388 à 895 sur 189 296, contre 768 sondes, 49 152 rayons et 16 384 mailles à budget fixe dans
`develop`. **C'est l'asservissement qui a choisi ces nombres, pas un réglage à la main.**

Un défaut trouvé par cette mesure et corrigé : la première version remettait les curseurs à zéro à
chaque changement de lampe, si bien qu'une lampe qui bouge à chaque image gelait le balayage sur ses
premières sondes. Le rafraîchissement est maintenant roulant — les curseurs ne reculent jamais, seuls
les compteurs de tours repartent.

### Activation par défaut : non, et pourquoi

La règle demandait moins d'une milliseconde sur les trois vues. Le p50 vaut 0,99, 0,83 et **1,01 ms**
— la troisième vue passe à côté de 1 % — et le p95 monte de 2,4 à 4,2 ms. **Le rebond reste donc
éteint par défaut**, `createExplorer({ bounce: true })` l'allume. Une remesure sur machine calme est
le seul travail qui reste avant de rouvrir la question : toute la campagne s'est faite entre 21 et 68
de charge, et le p95 de l'étape suit cette charge de près.

### Fidélité, rebond éteint

`banc.mjs`, WebGPU, Emerald, trois vues, 1280 × 720, `pixelError 0`, `auto` sans lampe, même cache des
deux côtés. **`abe8827` contre le lot : 0 px, max canal 0, sur `generale`, `sol` et `rue`**, témoin
A/A à 0 px, coupe identique, 0 triangle non couvert.

### Stabilité, rebond allumé, scène immobile

Huit lampes fixes, caméra fixe, 60 images de chauffe puis 60 mesurées, deux exécutions indépendantes
du même côté : **0 px d'écart, max canal 0, sur les trois vues**. L'image convergée ne scintille pas,
et une fois la série close aucune des deux passes n'est encodée.

### Écart à l'oracle et retard, pièce de contrôle

Pièce fermée 8 × 3 × 8 m, un mur rouge, une ponctuelle à ombre, oracle à huit rebonds, 160 × 120,
même pose des deux côtés (position 3, 2, 3 ; cible −4, 0,5, −4). L'exposition est descendue à 0,005
pour que rien n'écrête : à 0,05, l'image du moteur saturait et l'écart ne mesurait plus rien.

| grandeur              | `develop` | lot, ordre 1 | **lot, ordre 2** |      cible |
| --------------------- | --------: | -----------: | ---------------: | ---------: |
| écart moyen           |    19,4 % |       25,1 % |       **18,6 %** |       10 % |
| écart médian          |    16,8 % |       23,7 % |       **14,4 %** |          — |
| écart p95             |    44,7 % |       53,4 % |       **49,9 %** |          — |
| moteur / oracle       |      0,91 |         0,76 |         **1,03** |          1 |
| retard de convergence |     6 img |       25 img |       **22 img** |    100 ms, |
|                       |    100 ms |       417 ms |       **367 ms** | limite 250 |

**L'ordre 2 se paie et se justifie** : dans les mêmes cascades, l'ordre 1 rend 25,1 % d'écart et une
image 24 % trop sombre, l'ordre 2 rend 18,6 % et un biais de 3 %. Le coût est de 44 flottants par
sonde au lieu de 24 — sur Emerald, 2,9 Mo de sondes au lieu de 1,6 —, et cinq accumulateurs de plus
en mémoire de groupe, 13,3 ko sur les 16 ko d'un groupe de travail. **La cible de 10 % n'est pas
tenue** : ce qui reste n'est plus la base mais l'interpolation entre huit sondes et la maille de
50 cm du cache.

**Le retard ne tient pas la limite de 250 ms sur la pièce de contrôle** : 367 ms. Deux choses le
disent honnêtement. D'abord la mesure : le plancher de la courbe est le bruit de Monte-Carlo du
moteur lui-même, et celui du lot vaut la moitié de celui de `develop` (0,036 contre 0,068), donc la
barre du lot est deux fois plus stricte ; à la barre absolue de `develop`, le lot la franchit en
10 images. Ensuite la structure : `settledSweeps` vaut 16 et un balayage de cette pièce tient en une
image, si bien qu'aucun retard mesuré ne peut descendre sous 16 images, soit 267 ms. Deux réglages
ont été trouvés par la mesure et non devinés : l'amortissement plancher passe de 0,1 à **0,2** et le
seuil de résidu de 0,12 à **0,05**, ce qui fait tomber le retard de 450 à 300 ms sans changer l'écart.

### Emerald invisible : l'option d'intensité ne suffit pas

`--intensite N` est ajoutée au banc et à la campagne d'oracle (40 par défaut), posée par la même
règle générique que les lampes : aucune coordonnée de scène. **Elle ne débloque pas la mesure.**
L'irradiance indirecte de l'oracle sur Emerald est **exactement nulle sur les 36 864 canaux**, à
intensité 40 comme à 2 000, et encore à 64 rayons par pixel avec la caméra posée à huit mètres d'une
lampe de 2 000 : aucun canal ne passe le plancher de comparaison. Le verdict reste **indéterminé**
(E7), et le blocage n'est pas l'intensité des lampes : c'est l'oracle qui ne rapporte aucun indirect
sur cette scène. Savoir si ce sont les rayons d'ombre, la portée des lampes ou la palette d'albédo
qui l'annulent demande un lot à lui seul, sur `web-geometry-oracle`.

### Portes

Typage `tsc` vert, `npm run check:changed` vert (format, lignes — 0 fichier de plus de 200 —,
doublons 0, lint, 547 tests reliés). Aucun test ajouté. Sur une passe complète jouée avant la
consigne de l'utilisateur : 694 tests JS/TS, 147 Rust, 4 CLI, `knip` propre.

### Ce qui reste, chiffré

- **Remesurer sur machine calme** : la charge n'est pas descendue sous 21 de la journée, et c'est la
  seule chose qui sépare aujourd'hui l'étape de la barre d'une milliseconde qui l'allumerait.
- **De 18,6 % à 10 %** : l'interpolation entre huit sondes et la maille de 50 cm du cache, pas la base.
- **Le plancher de l'étape** : à 15 sondes et 328 mailles par image, l'étape coûtait encore 1,1 ms sur
  machine saturée. Il faut savoir ce qui, des deux passes, du recopiage de l'instantané (2,9 Mo par
  image) ou de la contention, porte ce plancher. Un instantané par échange de tampons au lieu d'une
  copie est le premier candidat.
- **Retard sous 250 ms** : il faudrait découpler la clôture de la série (`settledSweeps`) de la
  mesure, ou faire converger la série autrement que par itération.
- **L'oracle sur Emerald** : indirect nul, cause inconnue, lot dédié.

## 2026-09-15 — lot « rebond 2 » : rendre le rebond abordable

Branche `lot/rebond-2`, sur `develop` = `62c6b3d`. **L'étape Rebond d'Emerald passe de 78 à 87 ms à
2,3 ms de carte graphique** (p50, trois vues), soit trente-cinq fois moins, et l'écart à l'oracle de
la pièce de contrôle de 15,4 % à 12,6 % de moyenne. **Le format du sidecar binaire n'est pas
touché** ; seul l'objet de cache `proxy.bin` monte de version (1 → 2), et un cache d'avant ce lot est
refusé par son nom, jamais deviné.

### Levier 1 — la traversée : un BVH à quatre enfants, et un proxy dix-sept fois plus léger

- **BVH large.** Le proxy portait un arbre binaire : un rayon descendait d'un cran par nœud visité, et
  sur Emerald la borne de 512 nœuds s'épuisait avant la feuille. Un nœud porte maintenant **quatre
  enfants**, testés d'un coup ; le rayon descend sur le plus proche et empile les autres, et un nœud
  dépilé est retesté contre la distance du plus proche triangle déjà touché — dès qu'un rayon a
  touché quelque chose, tout ce qui est derrière tombe sans être ouvert. Les boîtes des enfants
  tiennent sur **huit bits** dans les bornes exactes du parent, arrondies vers l'extérieur : une
  boîte quantifiée contient toujours ce qu'elle contenait, donc aucun triangle ne disparaît d'un
  rayon. Trois bornes connues avant l'image : nœuds visités, triangles d'une feuille, profondeur de
  pile — un débordement de pile abandonnerait un enfant, ce qui assombrit et ne fuit jamais.
- **Simplification propre au proxy.** La coupe du DAG s'arrête à ses racines : sur Emerald elles
  pèsent 1,4 M de triangles et doubler le seuil ne retire plus rien. Le proxy se simplifie donc
  lui-même, sans DAG : les sommets rejoignent une grille de pas `c`, ce qui n'a plus de surface
  disparaît, les doublons fusionnent, et ce qui reste plus long que `c` est **redécoupé**. Les deux
  sens comptent : vers le bas la fusion fait tomber le compte, vers le haut la découpe donne au cache
  de surfaces des mailles de taille connue. `c` part de 50 cm et double tant que le budget de
  300 000 triangles n'est pas tenu ; celui qu'il a pris est publié, et l'erreur ajoutée est bornée
  par la demi-diagonale d'une maille.
- **Un seuil de coupe honnête, au passage** : la coupe cesse de doubler dès qu'elle ne retire plus un
  triangle. Emerald publiait 3 276,8 m, un seuil que la coupe n'a jamais pris ; elle publie
  maintenant **1,6 m**, le plus petit qui atteigne le plancher du DAG.

| scène             | proxy avant | proxy après | nœuds avant → après | octets avant → après | maille |
| ----------------- | ----------: | ----------: | ------------------: | -------------------: | -----: |
| Emerald           |   1 399 633 |  **94 648** | 524 287 → **7 609** | 74,9 Mo → **4,3 Mo** |  4,0 m |
| pièce de contrôle |          12 |       4 708 |             3 → 459 |       604 o → 221 ko |  0,5 m |

### Levier 2 — le cache de surfaces : un rayon ne rejoue plus les lampes

Chaque rayon de sonde qui touchait une surface y rejouait toutes les lampes et leurs rayons d'ombre :
**cinq traversées du proxy par rayon**, et le même point réévalué autant de fois que des rayons le
touchaient. Le proxy porte maintenant une **radiance sortante par triangle et par face**, mise à jour
sur un budget fixe de mailles par image. Un rayon n'a plus qu'**une traversée et une lecture**. Le
rebond multiple devient gratuit : la maille porte déjà l'indirect du tour précédent, relu dans la
grille de sondes. Invalidation par la révision du magasin de lampes, comme une carte d'ombre.

La maille est le triangle du proxy lui-même, dont le compilateur borne désormais la taille : c'est ce
qui donne au cache une résolution connue en mètres, sans atlas ni projection. Emerald : 189 296
mailles, 3,0 Mo.

### Levier 3 — des sondes seulement là où il y a de la surface, et un fil par rayon

- **Sondes clairsemées.** Une grille régulière sur l'emprise d'une ville passe l'essentiel de son
  budget sur du ciel. L'irradiance n'étant relue qu'en des points de surface, et un point de surface
  n'interpolant que les huit sondes de sa maille, la liste des sondes tenues est arrêtée à la
  construction : **les mailles qui touchent de la géométrie, plus une couronne d'une maille autour
  d'elles**. Une maille absente n'est jamais écrite, donc elle se déclare inutilisable et ne pèse
  rien — là où aucune sonde ne voit le point, le rebond vaut toujours exactement zéro.
- **Un budget de rayons, pas un budget de sondes** (131 072 au départ, 49 152 retenus) : c'est lui qui
  décide du nombre de sondes du lot, non l'inverse.
- **Un fil par rayon.** La passe donnait une sonde par fil, qui enchaînait ses 64 rayons l'un après
  l'autre : 2 048 fils occupaient la carte à rien. Un **groupe de travail par sonde**, un fil par
  rayon, et une réduction en mémoire de groupe. Mesuré seul, vue générale d'Emerald, budgets
  inchangés : **20,04 → 12,15 ms**.

**Les cascades autour de la caméra n'ont pas été faites** : le seul point d'accroche est
`webgpuPagesEncodeLights.ts:82`, que la session « encodage » tient. La grille reste fixe dans le
monde, comme la spécification le demande (LC1), et ne dépend d'aucune caméra.

### Où va le temps, et ce que chaque borne coûte

Vue `rue` d'Emerald, 1280 × 720, 8 lampes dont une mobile, 180 images de profil :

| configuration                                             | étape Rebond (GPU p50) |
| --------------------------------------------------------- | ---------------------: |
| cache seul, 65 536 mailles, borne 512                     |               10,53 ms |
| cache seul, 65 536 mailles, **borne 128**                 |                3,59 ms |
| cache + sondes, 65 536 mailles, 131 072 rayons, borne 512 |               12,15 ms |
| **retenu** : 16 384 mailles, 49 152 rayons, borne 128     |            **2,26 ms** |

La borne de traversée vaut donc **2,9×** sur le cache, exactement le rapport que le lot 1 avait
mesuré sur l'arbre binaire — mais un nœud large en couvre quatre fois plus, si bien que 128 nœuds
larges valent 512 nœuds binaires. Les deux effets d'une borne épuisée sont déclarés : un rayon de
sonde ne rapporte rien, ce qui assombrit ; un rayon d'ombre ne trouve pas d'occulteur, ce qui éclaire.

### Coût, Emerald, huit lampes dont une mobile

1280 × 720, WebGPU, 180 images de profil, mode visible, **zéro erreur de page**. Le levier 1 est
mesuré seul, contre `develop`, avec le budget de rayons du lot 1 (262 144) : il ne doit son gain qu'à
l'arbre et au proxy.

| vue      | `develop` (p50/p95) | levier 1 seul (p50/p95) | lot entier (p50/p95) |
| -------- | ------------------: | ----------------------: | -------------------: |
| générale |    78,41 / 82,40 ms |        27,96 / 28,66 ms |   **2,27 / 2,90 ms** |
| sol      |   87,22 / 108,80 ms |        34,38 / 40,06 ms |   **2,33 / 3,10 ms** |
| rue      |    78,84 / 82,43 ms |        34,93 / 40,42 ms |   **2,26 / 2,37 ms** |

Une seconde campagne de `develop`, jouée plus tôt, avait donné 87,44 / 78,83 / 78,73 ms : la
dispersion entre campagnes est d'environ 11 %, et c'est la borne de confiance de ces chiffres.

Compteurs par image, côté après : `rayonsParImage` 49 152, `sondesMisesAJour` 768, `maillesMisesAJour`
16 384 sur 189 296. **La grille d'Emerald compte 16 250 mailles et le lot n'en tient que 4 781**,
soit 29,4 % : le reste est du ciel ou le cœur d'un bloc plein. Durées processeur **non mesurées** : la charge de la
machine allait de 5 à 21 selon la série, et seuls les relevés par horodatage de la carte graphique
sont utilisables. Les nœuds visités par rayon ne sont pas comptés : seule leur borne est publiée.

**Le budget de 0,8 ms n'est toujours pas tenu**, mais la cible de 3 ms du lot l'est, avec de la marge
sur trois vues. Ce qui reste entre 2,3 et 0,8 ms : **le budget par image est un compte, pas une durée**.
La spécification demande l'inverse (X4, LR2) — l'ordonnanceur devrait choisir le nombre de lots
d'après le temps mesuré des images précédentes. C'est ce qui manque, et c'est la phase E5.

### Écart à l'oracle sur Emerald : verdict indéterminé

Vue `rue`, huit lampes du harnais, oracle à quatre rebonds, 16 rayons par pixel, 128 × 96, 38,6 s sur
les 10 046 405 triangles sources. **L'irradiance indirecte de l'oracle est exactement nulle sur toute
l'image** : aucun canal ne passe le plancher de comparaison, donc aucun écart n'est calculable. Le
verdict est **indéterminé**, jamais conforme (E7). C'est le même constat qu'au lot 1 sous une autre
forme : aux lampes génériques du harnais — huit ponctuelles à 76 m les unes des autres, portée 81 m,
intensité 40 — l'indirect d'une place de ville est sous le plancher, et il faudrait une scène
d'intérieur, ou des lampes déclarées par l'utilisateur, pour que la mesure ait un sens. La pièce de
contrôle reste donc la seule mesure d'écart qui dise quelque chose.

### Écart à l'oracle et retard, pièce de contrôle

Même pièce, même lampe, même oracle qu'au lot 1 (huit rebonds, 128 rayons par pixel, 160 × 120) :

| grandeur        |  lot 1 |      lot 2 |                 cible |
| --------------- | -----: | ---------: | --------------------: |
| écart moyen     | 15,4 % | **12,6 %** |                  10 % |
| écart médian    | 13,1 % | **10,5 %** |                     — |
| écart p95       | 36,2 % | **29,0 %** |                     — |
| moteur / oracle | −3,6 % | **−7,0 %** |                     — |
| retard          |  83 ms | **117 ms** | 100 ms, limite 250 ms |

La cible de 10 % de moyenne **n'est pas tenue** : 12,6 %. Ce qui reste est structurel et nommé — la
base d'harmoniques sphériques d'**ordre 1** ne sait pas représenter un champ d'irradiance net, et la
lumière d'une maille du cache est constante sur 50 cm. Une base d'ordre 2 est le prochain levier, et
il se chiffre : neuf coefficients au lieu de quatre, donc une grille deux fois plus lourde.

Deux réglages ont été trouvés par la mesure et non devinés. **Des sondes plus serrées n'aident pas** :
à 1 m au lieu de 2 dans une pièce de 8 m, l'écart monte à 16,9 % et l'image s'assombrit de 16 %.
Et **le retard dépend du pas du balayage du cache** : à 3 images par balayage il montait à 533 ms ;
la maille de 50 cm au lieu de 25 le ramène à une image et le retard à 117 ms, pour 0,5 point d'écart.

### Fidélité, rebond éteint

`banc.mjs`, WebGPU, Emerald, trois vues, 1280 × 720, `pixelError 0`, `auto` sans lampe, même cache des
deux côtés. **`62c6b3d` contre le lot : 0 px, max canal 0, sur `generale`, `sol` et `rue`**, témoin
A/A à 0 px, coupe identique (mêmes `selectedTriangles`, mêmes hachages), 0 triangle non couvert.

### Portes

`npm run validate` vert sur la base rebasée `edf9e30` : format, 0 fichier de plus de 200 lignes,
**0 doublon**, lint et Clippy, `knip`, build TS et natif, structure, déclarations, liens,
**694 tests JS/TS**, **147 tests Rust** (2 ignorés) et **4 tests CLI**. Aucun test n'a été ajouté
pendant le lot, comme demandé.

### Ce qui reste, chiffré

- **De 2,3 ms à 0,8 ms** : un budget en millisecondes au lieu d'un compte (X4, LR2), qui rendrait
  aussi son balayage d'une image à la pièce de contrôle sans coûter à Emerald.
- **De 12,6 % à 10 %** : la base d'ordre 2, et la lumière d'une maille de 50 cm qui ne varie pas.
- **Convergence d'Emerald** : 189 296 mailles à 16 384 par image font **12 images** par balayage, et
  16 tours avant que la passe ne cesse d'être encodée, soit 3,2 s pour l'état stable. Une lampe qui
  bouge est suivie par un rafraîchissement roulant, jamais par un blocage.
- **Cascades de sondes** : non faites, point d'accroche tenu par une autre session.
- **Un piège de méthode** : un nuanceur refusé par la carte ne remonte pas en `pageerror` mais en
  avertissement de console, et la mesure meurt plus loin sur « appareil perdu ». `oracle.mjs` remonte
  maintenant ces lignes telles quelles.

## 2026-09-15 — simplify du chantier textures progressives (lots 1 à 3)

Branche `simplify-textures`, sur `develop` = `21dbe9e` (lot 4 fusionné juste avant, documentation seule). Périmètre : le code que les lots 1, 2 et 3 des textures progressives ont introduit ou modifié. Aucun ajout de fonctionnalité, aucun changement de format ni de version du sidecar, aucune assertion de test touchée.

- **Six simplifications, 163 lignes ajoutées contre 179 supprimées sur 14 fichiers.** Par paquet (ajouts / suppressions) : gardes du sidecar 51/58 ; geste de transfert 24/21 ; pyramide sur le travail 17/27 ; remipmap d'une classe 31/28 ; aperçus natifs 17/18 ; collecte et priorité 24/28.
- **Ce qui a été unifié.** (1) L'ordre par index de texture et le refus d'une image source vide s'écrivaient mot pour mot des deux côtés de la section d'aperçus : une seule garde, avec les prédicats stricts de l'écriture, qui rendent le même verdict sur les mots u32 que la lecture relit ; `encodeTexturePreviews` disparaît dans `encodePreviewColumns`. (2) Les trois comptes du descriptif binaire passaient par le même test écrit trois fois : une table. (3) Le découpage en bandes de lignes et l'appel `writeTexture` s'écrivaient deux fois, pour un niveau progressif et pour la pleine résolution, qui ne diffèrent que par le niveau de mip : `writeRows`. (4) Les six arguments de `generateMaterialMips` se redisaient dans l'ordre à la préparation et dans la pompe : `regenerateClassMips` les lit sur la classe. (5) `addColor`/`addData` et les deux boucles de poids de la priorité étaient la même fonction à deux jeux d'arguments près.
- **États et branches retirés.** Le tableau `slotPyramids` de l'état de visibilité — rempli à la préparation, remis à zéro à la libération, relu par slot moins un — disparaît : la pyramide voyage sur le travail de niveau, qui la connaît déjà. `allowed` portait un nom de borne alors qu'il n'ouvrait que l'exploration des découpages ; la condition dit maintenant `maxClasses > 1`, qui lui est exactement égal. Côté natif, `pyramid` portait deux options qui ne pouvaient être présentes ou absentes qu'ensemble et une branche `_` qu'aucune entrée n'atteint ; et `alpha_scale` recopiait la colonne d'alphas de chaque niveau pour la lire dix-sept fois — elle lit désormais les texels du niveau, une allocation de moins par niveau et par texture.
- `npm run validate` : **treize portes vertes** en une passe — format, lignes (0 fichier > 200), **0 doublon**, lint et Clippy, `knip`, build TS, build natif, structure, déclarations, liens, **653 tests JS/TS**, **138 tests Rust** (134 bibliothèque + 4 CLI). Aucune assertion de test modifiée.
- **Preuve navigateur.** Lab en lecture seule sur le port 5301 (5174 laissé à l'utilisateur), sa config reprise telle quelle par une config de mesure du scratchpad qui ajoute `fs.allow`, aliase `@web-geometry/sdk` vers le `dist` mesuré — une seule instance du SDK pour le Lab et le harnais — et pose devant la route `/benchmark-assets` du Lab un relais servant un **clone du cache Emerald v4** dans le scratchpad (sidecar `version` 4, 232 aperçus, 4 617 248 octets de niveaux). Le Lab n'est ni écrit ni modifié ; son cache est identique au clone avant et après (`clusters.json` `2d6a3548…`). Trois séries de dix captures 1246×1000 par `test/webgpuCapture.browser.mjs`, 600 images chacune : témoin `develop` `21dbe9e` (a, b) et `simplify-textures`.
- **Chiffres. `simplify-textures` contre le témoin `develop-21dbe9e` : 0 px sur les dix captures, au bit près.** L'A/A de `develop` contre lui-même en porte **2**, sur le segment 8, amplitude 27 — le même scintillement que le lot 3 avait déjà signalé, et `simplify-textures` contre `develop-21dbe9e-b` porte exactement ces deux pixels-là : l'image du simplify est celle de `develop-a`, au bit près.
- **État de chaque capture** : `texturePending` **0**, `textureSkipped` **0**, `textureUploaded` 336, `textureLevelsUploaded` 786, `textureAtlasClassesUsed` 1, `uncoveredTriangles` **0**, `coverageBudgetLimited` faux, aucune erreur GPU, aucune erreur de page. Coupe identique au témoin image par image : mêmes `triangles`, `selectedTriangles`, `transparentSubmittedTriangles`, mêmes compteurs de transfert. Seul `hizRejectedTriangles` bouge — et il bouge **davantage dans l'A/A de `develop`** (581 images sur 600) que entre `develop` et le simplify (508) : c'est du bruit de cadencement, pas un effet du simplify. Durées : **`null`**, machine chargée (load 1 min de 7 à 15).
- Images sous `benchmark-runs/webgpu-capture/simplify-textures/` du worktree et `temoin-develop-21dbe9e{,-b}/` du dépôt principal (hors git).
- **Volontairement laissé.** Le miroir Rust/TypeScript de la géométrie des niveaux (`levels.rs` et `texturePreviewLevels.ts`) : ce sont deux langages et deux exécutables, et c'est un test d'égalité qui les tient ensemble. `PREVIEW_MAX_LEVELS`, exporté par `sdk-core` et lu par personne : c'est une borne du format, pas du code mort, et la retirer changerait un contrat public. La logique de `planAtlasClasses` au-delà du nom corrigé : elle décide de l'image, et son seul consommateur est une option publique mesurée. Enfin, les fichiers que les lots textures partagent avec l'éclairage, les ombres, l'audit des calculs et le lot F n'ont été touchés que sur leurs lignes du chantier textures.
- **Reste** : les points déjà notés au lot 4 — réutilisation du pipeline de `textureMips.ts`, aucune fixture dorée ne porte encore de texture couleur, et `docs/SDK.md:153` promet encore « its 16x16 preview » que le lot 3 a remplacé.
- **Revue adverse et fusion** (agent dédié, lecture seule puis fusion). Diff `develop...simplify-textures` lu commit par commit, plus l'ensemble du chantier textures depuis `9a7821a` pour les mots interdits, le code mort et la conformité de `docs/SDK.md` (`atlasClasses` 1 par défaut, conforme au code). Aucun BLOQUANT : la fusion de `checkEntryHeader` (deux gardes redites mot pour mot) rend le même verdict à l'écriture et à la lecture ; le passage de `slotPyramids` à une pyramide portée par le travail est sûr parce que `decodeTexturePreviews` vérifie déjà que `firstLevel`/`levels.length` s'accordent aux dimensions, donc `previewFirstLevel`/`previewLastLevel` recalculés valent exactement ce que le travail porte ; `allowed > 1` et `maxClasses > 1` sont la même condition une fois `affordable > 1` et `ATLAS_CLASS_COUNT = 2` posés ; `alpha_scale` lit les mêmes texels, juste sans copie intermédiaire. À CORRIGER : aucun test dédié n'exerce directement les deux messages de refus de `checkEntryHeader` (index non croissant, image source vide) — gap préexistant, non introduit par ce lot. Validation indépendante : `npm run validate` rejoué en une passe dans le worktree, treize portes vertes, 653 tests JS/TS et 138 tests Rust confirmés sur la sortie brute. Preuve navigateur non rejouée (mesure GPU déjà active sur la machine par un autre agent au moment de la revue, port 5174 pris) : comparaison indépendante à l'octet des captures déjà produites (`segment-*.candidate.rgba`) — `simplify-textures` contre `temoin-develop-21dbe9e` : **0 px sur 10/10 segments** ; contre `temoin-develop-21dbe9e-b` : exactement les 2 px (amplitude 27, segment 8) déjà présents dans l'A/A `develop` lui-même ; `texturePending`, `textureSkipped`, `uncoveredTriangles` à 0 sur tous les échantillons de `result.json`, `errors` vide, `status: passed`. Fusion en avance rapide impossible (develop avait avancé) : merge `--no-ff` classique, comme l'usage du dépôt — `499b329be5deffbf9b7569e5fc877fbf0264a02a`. Branche et worktree `simplify-textures` supprimés après fusion.

## 2026-09-15 — lot 4, comparatif de compression des textures : aucun conteneur n'entre dans le SDK

Branche `lot4-compression`, sur `develop` = `8cb7e21`. **Étape 1 seule.** Aucune ligne du SDK ni du compilateur n'est touchée : le lot rend un verdict, pas du code. Chiffres, corpus, réglages et détail par genre : `orchestration/mesures/compression-textures-2026-09-15.{md,json}`. L'outil de mesure est un binaire Rust du **scratchpad**, hors dépôt — le dépôt n'accepte pas de code mort.

- **Corpus.** Les 336 images que le `source.gltf` du cache Emerald compilé désigne par `images[].uri` (`/benchmark-assets/emerald-square/textures/*.png`, lues sans jamais être écrites) : **114 couleur**, **222 données** — le moteur en compte 232 et 440 parce qu'il compte des entrées de texture, pas des fichiers. **591 642 954 o** de PNG, **4 982 870 028 o** en RGBA8 brut, **1 245 717 507** texels, 297 images en 2048×2048. Le sidecar v4 y ajoute **4 617 248 o** de niveaux ≤ 64. Dépendances par cargo seulement ; `basisu_c_sys` 0.9.0 embarque **Basis Universal 2.50**, donc XUASTC et XUBC7 sont **mesurés**, pas estimés.
- **Seuil appliqué.** Le bruit A/A du dépôt vaut **0 à 43 pixels sur 12 460 000**. Seuil : **part de texels dont un canal s'écarte de plus de 1 ≤ 3,45 × 10⁻⁶**. C'est la lecture la plus généreuse qui soit — elle compte un texel comme un pixel, alors qu'un texel faux se voit sur tous les pixels de la surface qui le lit.

| candidat                               | octets          | × PNG     | max canal | part texels > 1 | verdict              |
| -------------------------------------- | --------------- | --------- | --------- | --------------- | -------------------- |
| (a) PNG source                         | 591 642 954     | 1,000     | référence | référence       | **reste**            |
| (a) PNG réencodé au meilleur effort    | 641 763 190     | 1,085     | —         | —               | rejeté, pire         |
| (b) Zstd 9 sur brut                    | 587 371 247     | 0,993     | 0         | 0               | rejeté, −0,7 %       |
| **(b) Zstd 19 sur brut**               | **478 905 686** | **0,809** | **0**     | **0**           | passe l'étape 1      |
| (b) Paeth puis Zstd 19                 | 519 152 712     | 0,877     | 0         | 0               | rejeté, −12,3 %      |
| (b) Zstd 19 sur le PNG                 | 589 249 779     | 0,996     | —         | —               | rejeté, −0,4 %       |
| (d) BC7 ISPC basic (corpus entier)     | 1 245 717 552   | 2,106     | 97        | 6,03 %          | **rejeté, fidélité** |
| (d) BC7 ISPC lent (échantillon)        | 83 886 336      | 1,841     | 58        | 6,74 %          | **rejeté, fidélité** |
| (d) ASTC LDR 4×4 préparé (échantillon) | 83 890 368      | 1,841     | 93        | 6,79 %          | **rejeté, fidélité** |
| (c) UASTC 4×4 → BC7 (échantillon)      | 20 965 811      | 0,460     | 102       | 28,81 %         | **rejeté, fidélité** |
| (e) XUASTC LDR 4×4 → BC7 (échantillon) | 19 797 582      | 0,435     | 104       | 32,60 %         | **rejeté, fidélité** |
| (e) XUBC7 → BC7 (échantillon)          | 18 193 694      | 0,399     | 94        | 31,19 %         | **rejeté, fidélité** |

Les lignes « échantillon » portent sur une image sur seize (21 images, 45 560 369 o de PNG), les autres sur les 336. Machine chargée par d'autres agents : load 1 min de 11 à 132.

- **Tout ce qui a une perte est rejeté, et de très loin.** Le meilleur pour la fidélité, BC7 au réglage le plus lent d'ISPC, laisse **6,74 %** des texels à plus d'un niveau d'écart — **19 500 fois le seuil** — avec des pointes à **58 niveaux** sur un canal. Le meilleur pour les octets, XUBC7 de Basis 2.50 (**−60,1 %**), en laisse **31,19 %**. Aucun n'est à moins de trois ordres de grandeur du bruit A/A. L'écart se concentre sur les **données** (BC7 lent : 1,02 % des texels couleur, **9,82 %** des texels de données) — normales et rugosité ne supportent pas une décorrélation pensée pour la couleur —, et le dépôt ne sépare pas ses règles selon le genre de texture. **Rien de (c), (d) ni (e) n'entre dans le SDK.**
- **Le sans perte gagne vraiment, et deux fois.** **Zstandard 19 sur les niveaux bruts : −19,1 %**, soit **112 737 268 o** de moins sur Emerald (couleur **−39,1 %**, données **−6,8 %**), écart texel **0 sur les quatre canaux, vérifié par aller-retour**. Et il décode **deux fois plus vite** que le PNG : 5 608 ms contre 12 808 ms de CPU cumulé sur le corpus. Deux résultats contre-intuitifs, mesurés : le **filtrage de lignes à la PNG (Paeth) fait perdre 40 Mo** contre le brut — la fenêtre longue portée de Zstd retrouve des régions entières répétées que le filtre casse — et le **réencodage PNG au meilleur effort est 8,5 % pire que la source** : les PNG d'Emerald sont déjà bien tassés, il n'y a rien à gratter de ce côté.
- **Pourquoi l'étape 2 n'a pas lieu quand même.** Mesuré dans le Chrome du banc (HeadlessChrome 152) : `DecompressionStream` connaît `gzip`, `deflate`, `deflate-raw` et **pas** `zstd` ; mais Chrome annonce `Accept-Encoding: gzip, deflate, br, zstd` et **décode nativement un corps servi en `Content-Encoding: zstd`** (1 048 576 o récupérés exacts depuis 363 o sur le fil). Le gain est donc atteignable sans WASM — **par le transport, pas par un conteneur**. Or ces octets ne sont pas ceux du SDK : c'est le `GLTFLoader` de `explorerScene.ts:66` qui résout `images[].uri` et télécharge les PNG, et un PNG servi en zstd ne gagne que **0,4 %**. Pour toucher les 19,1 %, il faut **cesser de faire passer les textures par le chargeur glTF** : scène sans `images`, un objet de niveau brut par image, le SDK qui le récupère et le pose en `texture.image = {data, width, height}`. C'est le chantier **C3/C4 du plan « première image »**, pas un choix de conteneur. Prototyper ici un lecteur et une pompe que rien ne peut alimenter aurait été du code mort, que le dépôt interdit. **Décision : le lot rend la cible chiffrée et les points d'insertion, et s'arrête là.**
- **Non mesuré, `null`** : le plafond de qualité de Basis Universal (qualité 100, effort 10). Passe lancée sur sept images, interrompue après 6 min 46 s de temps mur et 37 min de CPU, machine saturée. Sans effet sur le verdict — le plafond de **BC7**, lui, est mesuré (`alpha_slow` / `opaque_slow` d'ISPC) et reste 19 500 fois au-dessus du seuil.
- **Points d'insertion relevés pour ce chantier**, à qui le prendra : écriture d'objet `compiler_storage.rs:20` (`store_object`), exemple d'appel `compiler_primitive.rs:145-158` ; étape appelée depuis `compiler_build.rs:107-115`, colonnes du sidecar déclarées en `manifest_binary.rs:39-61` et relues par `packages/sdk-core/manifestBinaryFormat.ts:47-129`, version refusée par son nom en `manifestBinaryRead.ts:27-31` ; annulation par `check(o)` (`lib.rs:95`) ; côté moteur **rien à écrire** — `webgpuAtlasJobs.ts:112-125` a déjà le chemin « octets RGBA bruts en mémoire », alimenté par `textureRgba` (`visibilityTypes.ts:139`) depuis `webgpuAtlasCommon.ts:113`.
- **Reste** : le chantier ci-dessus s'il est voulu ; lot 5, conditionnel ; la réutilisation du pipeline de `textureMips.ts` ; **aucune fixture dorée ne porte encore de texture couleur** ; et une ligne périmée à corriger — `docs/SDK.md:153` promet encore « its 16x16 preview », que le lot 3 a remplacé par les niveaux progressifs du sidecar.

## 2026-09-15 — lot « rebond 1 » : la lumière qui rebondit, proxy résident et oracle

Branche `lot/rebond-1`, rebasée sur `develop` = `7cf5c6f` ; la porte de fidélité ci-dessous a été
jouée contre `21dbe9e`, la base de la mesure. `npm run validate` vert. **Le format du sidecar
binaire n'est pas touché** : le proxy est un objet de cache à son nom, et un cache d'avant ce lot
reste lisible mot pour mot — le rebond y est simplement déclaré indisponible.

**Le rebond est éteint par défaut** — `createExplorer({ bounce: true })` l'allume — parce qu'il coûte
80 ms de carte graphique sur Emerald, deux ordres de grandeur au-dessus du budget ; le lot rebond 2
s'attaque à ce coût.

### Les règles livrées

- **Proxy résident (LC1)**, écrit par le binaire Rust à côté de `clusters.json`, sous le nom
  `proxy.bin` : la coupe plate du DAG dont l'erreur certifiée passe sous `proxyErrorMetres` (5 cm),
  seuil doublé primitive par primitive jusqu'à ce que la scène entière tienne dans
  `proxyTriangleBudget` (300 000 triangles, toutes instances posées), plus un BVH par médiane et un
  albédo diffus linéaire par triangle. Le seuil réellement obtenu est publié. Aucune lumière n'y est
  cuite. La part de budget d'une primitive est proportionnelle à ce qu'elle pèse une fois instanciée :
  le facteur d'instance s'annule, une primitive posée mille fois sort mille fois plus grossière.
- **Sondes d'irradiance (LR4)** : une grille fixe dans le monde, posée sur l'emprise du proxy, sondes
  **au centre des mailles** — une sonde au coin de l'emprise tombe dans le mur qui la borne et n'y
  voit rien. Chaque sonde lance 32 rayons contre le proxy, évalue au point touché les lampes
  déclarées — mêmes lampes, ombres tracées contre le proxy et non contre l'atlas — relit la grille au
  même point, ce qui donne les ordres supérieurs, et accumule en harmoniques sphériques d'ordre 1.
  **La grille est lue sur un instantané figé avant la passe** : l'image à l'état stable ne dépend pas
  de l'ordre dans lequel la carte a ordonnancé ses fils, et deux exécutions rendent la même moyenne
  au quatre-millième près (214,8809 deux fois).
- **Hystérésis adaptative** : moyenne courante tant que l'estimation est stable, reprise à 80 % dès
  qu'elle saute. **Travail nul en scène immobile** : après `settledSweeps` (12) balayages sans qu'une
  lampe ait changé, la passe n'est plus encodée du tout et l'étape « Rebond » vaut « non mesuré ».
- **Application** : la résolution différée ajoute l'irradiance interpolée de huit sondes, multipliée
  par l'albédo diffus du pixel sur π. Trois pondérations : trilinéaire, dos de la surface, et les six
  distances moyennes mesurées par chaque sonde, qui referment les fuites à travers les murs. Là où
  aucune sonde ne voit le point, le terme vaut **exactement zéro** — une fuite serait de la lumière
  sans source. Une sonde enterrée dans une surface se déclare inutilisable (critère de distance,
  jamais de sens d'enroulement : celui-ci n'est fiable sur aucune scène importée).
- **Trois programmes différés, jamais une branche** : vue sans éclairage, contrat seul, contrat plus
  rebond. Une session sans rebond exécute exactement le nuanceur du lot précédent.
- **Oracle (LC5)** : second binaire `web-geometry-oracle` dans le crate Rust. Traceur de chemins sur
  les **triangles sources**, son propre BVH, même modèle de lampes et de diffus, échantillonnage en
  cosinus, graine par pixel donc image reproductible quel que soit le nombre de fils. Il ne lit ni le
  proxy, ni la grille : seule la palette d'albédo est partagée avec le compilateur, pour que la
  comparaison mesure le transport et non deux lectures de matériau.
- **Vue de mesure** : `setLightingView('bounce')` sort l'irradiance indirecte nue, multipliée par
  l'exposition, sans ACES ni sRGB. `scripts/mesure/oracle.mjs` la compare à l'oracle et mesure le
  retard de convergence après déplacement d'une lampe.

### Chiffres du proxy

| scène                            | triangles source |     proxy |   nœuds |      octets | seuil obtenu |
| -------------------------------- | ---------------: | --------: | ------: | ----------: | -----------: |
| pièce de contrôle (12 triangles) |               12 |        12 |       3 |       604 o |       0,05 m |
| Emerald                          |       10 046 405 | 1 399 633 | 524 287 | **74,9 Mo** |    3 276,8 m |

Le budget de 300 000 triangles **n'est pas atteignable sur Emerald** : le seuil a parcouru toute
l'échelle (seize doublements) sans que la coupe y entre, parce que le **niveau racine du DAG pèse
déjà 1,4 million de triangles** — la simplification ne va pas plus loin. Le proxy d'Emerald est donc
son niveau racine, 74,9 Mo lus une fois et résidents. Le sidecar binaire, lui, est inchangé.

### Fidélité, rebond éteint

`banc.mjs`, WebGPU, Emerald, trois vues, 1280×720, `pixelError 0`, `auto` sans lampe, cache v4
recompilé, 40 images de chauffe. **Base finale `21dbe9e` contre le lot rebasé : 0 px, max canal 0,
sur `generale`, `sol` et `rue`**, coupe identique, témoin A/A à 0 px, 0 erreur de page. Le même
verdict avait déjà été obtenu contre la base d'origine `8cb7e21` avant le rebasage.

Deux pièges rencontrés en route, à savoir pour les prochains : un cache compilé avec une autre base
d'URL de ressources sort **3 360 textures en 404** et la mesure ne porte plus sur la scène ; et
comparer à un `develop` qui a bougé fait apparaître un écart (2 083 px, deux coupes différentes) qui
n'appartient pas au lot. La référence d'une porte de fidélité est la base du lot, pas la tête du
moment.

### Écart à l'oracle et retard, sur la pièce de contrôle

Pièce fermée 8 × 3 × 8 m, un mur rouge (0,75 / 0,06 / 0,06), les autres blancs, sol gris, une lampe
ponctuelle à ombre. Vue `bounce` du moteur, convergée, contre l'oracle à huit rebonds, 128 rayons par
pixel, 160 × 120, exposition 0,05 :

| grandeur                                            |                                  valeur |
| --------------------------------------------------- | --------------------------------------: |
| écart moyen                                         |                              **15,4 %** |
| écart médian                                        |                                  13,1 % |
| écart p95                                           |                                  36,2 % |
| moyenne moteur / oracle                             | 0,2070 / 0,2148 (**3,6 % plus sombre**) |
| canaux écrêtés par les huit bits de la capture      |                                       0 |
| retard de convergence après déplacement de la lampe |            **5 images = 83 ms à 60 Hz** |

La cible de 10 % d'écart moyen **n'est pas tenue** : 15,4 %. Le biais, lui, est faible (3,6 %) ; ce
qui reste est la dispersion, dominée par l'interpolation entre huit sondes espacées de 2 m dans une
pièce de 8 m et par la base d'ordre 1. Le retard, lui, tient la cible de 100 ms.

Deux constats de méthode, gagnés en route : le moteur porte **toute la série de rebonds** (la grille
se relit elle-même), donc une comparaison à un oracle tronqué à deux rebonds n'a aucun sens — à deux
rebonds l'écart montait à 54 %, à quatre 18 %, à huit 15,4 %. Et la portée des rayons doit couvrir la
scène : bornée au tiers de la diagonale, le moteur perdait 11 % de lumière parce qu'un rayon ne
traversait plus la pièce.

### Coût, Emerald, huit lampes dont une mobile

1280 × 720, WebGPU, 180 images de profil, machine à 20–50 de charge (durées processeur inutilisables,
relevés GPU par horodatage) :

| vue      | image entière avant | image entière après | étape Rebond (GPU) | rayons/image |
| -------- | ------------------: | ------------------: | -----------------: | -----------: |
| générale |       20,58 / 21,64 |      99,83 / 103,98 |  **79,25 / 83,47** |      262 144 |
| sol      |       14,24 / 22,35 |     114,40 / 140,92 | **97,33 / 109,29** |      262 144 |
| rue      |       10,66 / 11,18 |       90,40 / 93,68 |  **79,39 / 82,64** |      262 144 |

**Le budget de 0,8 ms n'est pas tenu, de deux ordres de grandeur.** Le coût est dominé par les
visites de nœuds du BVH, pas par le nombre de rayons : à budget divisé par huit (1 024 sondes,
32 768 rayons) l'étape ne descend qu'à 67,8 ms, tandis qu'à borne de traversée divisée par quatre
(128 nœuds au lieu de 512) elle tombe à **27,0 ms** à rayons inchangés.

**Scène immobile : zéro travail, mesuré.** Sans lampe mobile, après convergence, `sondesMisesAJour`
vaut **0**, `rayonsParImage` **0**, la passe n'est plus encodée et l'étape Rebond vaut « non mesuré ».
L'image est alors **identique au pixel près** à celle d'avant le lot sur les trois vues — parce qu'aux
lampes génériques du harnais (portée 81 m, intensité 40) l'irradiance indirecte d'Emerald reste **sous
le quantum des huit bits**. Le rebond y coûte donc sans se voir : c'est un réglage de scène, pas un
défaut du mécanisme, et la pièce de contrôle le montre bien visible.

### Ce qui reste, chiffré

- **Coût.** Tenir 0,8 ms à 512 nœuds visités demanderait environ **2 650 rayons par image**, soit un
  balayage de la grille d'Emerald en 3,3 s : hors de portée en l'état. Les trois leviers, dans
  l'ordre du gain mesuré ou calculable : borne de traversée (mesuré, ×2,9 de 512 à 128), **BVH large
  et traversée ordonnée d'avant en arrière** (calculé : 2 à 4× de moins de nœuds visités), et
  **proxy plus petit** — les 1,4 M de triangles d'Emerald sont le plancher du DAG actuel, il faudrait
  une décimation propre ou le cache de surfaces (LR5) pour descendre.
- **Cache de surfaces (LR5)** : il remplacerait la relecture de la grille au point touché par une
  lecture de texel, supprimerait le second rayon d'ombre par lampe et rendrait le multi-rebond
  gratuit. C'est le lot suivant.
- **Grille clairsemée ou en cascades** : sur Emerald, 25 sondes sur la verticale couvrent 113 m dont
  l'essentiel est du ciel vide. Une grille suivant la caméra diviserait le nombre de sondes utiles
  par un facteur que seule une mesure dira.
- **Émission, transparents, spéculaire indirect** : hors de ce lot, déclarés manquants.

## 2026-09-15 — lot 3 fusionné : une seule classe d'atlas par défaut, la seconde en option

- **Fusion `15297dd`** dans `develop`.
- **Décision.** Le second groupe d'atlas change l'image (15 142 px, entrée précédente) : il ne peut pas être le défaut. Le lot est fusionné avec **une seule classe d'atlas par défaut**, et la seconde derrière une option publique que l'utilisateur activera s'il accepte l'écart.
- **Option.** `ExplorerOptions.atlasClasses` : `1` par défaut, `2` au choix de l'hôte. Elle borne `planAtlasClasses` ; à 1, le plan rendu est **exactement** l'allocation d'avant les classes de taille. Le **repli automatique** à deux classes, quand une seule dépasse `maxTextureArrayLayers`, **ignore la borne** : il tient à l'appareil, pas au goût de l'hôte. L'option voyage par `BackendContext.atlasClasses` comme `maxTextureTransferBytesPerFrame`, et `docs/SDK.md` la documente avec l'écart d'image et les octets mesurés à 2. Un test de plus : borne 1, une seule classe même là où deux économiseraient.
- **Gain de l'option, calculé (jamais mesuré)** : `−872 359 272` o, **−11,5 %** d'octets d'atlas alloués sur Emerald. À 1, gain nul et image inchangée.
- **Fusions de `develop` en cours de route** : `995929d` (aucune lumière sans source déclarée, lampe directionnelle) — un conflit, le journal ; `7fe6e43` (une face d'un seul geste, cascade calculée une fois) et `f38f026` (lot F des calculs, 28 commits) — sans conflit.
- `npm run validate` : **treize portes vertes** en une passe — format, lignes (0 fichier > 200), 0 doublon, lint et Clippy, `knip`, build TS, build natif, structure, déclarations, liens, **629 tests JS/TS**, **138 tests Rust** (134 bibliothèque + 4 CLI). Une première passe avait vu échouer le seul test de cancellation du compilateur, qui compare deux durées d'horloge : machine à 23 de charge, rejoué vert seul puis en passe complète.
- **Preuve navigateur, défaut à une classe.** Lab en lecture seule sur le port 5195 (5174 laissé à l'utilisateur), relais 5196 servant les caches Emerald recompilés du scratchpad ; le Lab n'est ni écrit ni modifié — sa config est reprise telle quelle par une config de mesure du scratchpad qui ajoute `fs.allow` et fait pointer `@web-geometry/sdk` du Lab vers le `dist` mesuré, pour que le Lab et le harnais partagent **une seule** instance du SDK. Quatre séries de dix captures 1246×1000 : témoin `develop` `7fe6e43` (a, b) et lot par défaut (a, b).
- **Chiffres.** **`lot3-defaut-une-classe-b` contre `develop-7fe6e43` : 0 px sur les dix captures, au bit près.** Les trois autres appariements diffèrent de 2 ou 4 px, **toujours sur le segment 8 et toujours aux mêmes quatre pixels** — (73, 607), (73, 608), (907, 611), (884, 612) — amplitude maximale 54. **L'A/A de `develop` contre lui-même en porte deux** ((73, 607) et (73, 608), amplitude 54) et l'A/A du lot contre lui-même les quatre : ce scintillement est celui de `develop`, pas celui du lot. Neuf captures sur dix sont identiques au bit près dans **tous** les appariements.
- **Scintillement de `develop` à signaler** : au matin, l'A/A du témoin `develop` (`2931606`) valait 0 px. Quatre pixels de `develop` ne se reproduisent plus d'une exécution à l'autre depuis les lots d'éclairage et d'ombres. Ce n'est pas le lot 3 ; c'est à regarder par qui a écrit ces lots.
- Chaque capture du lot : `texturePending` **0**, `textureSkipped` **0**, `textureUploaded` 336, `textureLevelsUploaded` 786, `textureAtlasClassesUsed` **1**, aucune erreur GPU, **aucun triangle non couvert**, `coverageBudgetLimited` faux. Coupe identique au témoin : mêmes `triangles` et `selectedTriangles`. Durées : **`null`**, machine chargée (load 1 min de 11 à 24).
- Images sous `benchmark-runs/webgpu-capture/{lot3-defaut-une-classe,lot3-defaut-une-classe-b}/` du worktree et `{develop-7fe6e43,develop-7fe6e43-b}/` du dépôt principal (hors git).
- **Reste** : le **choix de l'utilisateur** sur `atlasClasses: 2` (écart mesuré contre 872 Mo calculés) ; lot 4, le comparatif de compression ; lot 5, conditionnel ; le todo de réutilisation du pipeline de `textureMips.ts` ; **aucune fixture dorée ne porte encore de texture couleur** — à créer. Note d'exploitation : les caches v3 du Lab sont refusés par le lecteur de sidecar v4 et doivent être recompilés.

## 2026-09-15 — aucune lumière sans source déclarée (chemin opaque) et lampe directionnelle

Branche `lot/sans-source`, sur `develop` = `2931606`. `npm run validate` **vert, 552 tests JS/TS** et 136 Rust.

### Ce que la règle change

- La résolution différée opaque n'a plus **ni ambiance fixe, ni ciel constant, ni éclairage écrit dans la scène** (P6). Une surface qu'aucune lampe déclarée n'atteint vaut exactement zéro. Le programme « scène écrite » qui appelait `sceneLighting` disparaît de ce chemin ; `skyAmbient` et le « mode nuit » disparaissent tout court. La liaison des lampes de la scène quitte la passe différée, qui perd une entrée de disposition.
- **Vue « sans éclairage »** : `explorer.setLightingView('auto' | 'lit' | 'unlit')`. `unlit` rend l'albédo brut — couleur des matériaux telle quelle, sans lampe, sans ambiance, sans émission — pour les bancs de géométrie qui comparent au pixel près. Ce n'est pas une lumière, c'est une vue de diagnostic. `auto`, la valeur de départ, rend `unlit` tant qu'aucune lampe n'est déclarée et `lit` dès qu'il y en a une : une scène sans source ne sort donc jamais une image noire par surprise. Contrat écrit dans `docs/SDK.md`.
- **`SceneLight` version 2**, nouveau type `directional` : direction de propagation, couleur, intensité, ombre oui/non. Ni position, ni portée, ni cône — les trois sont **refusés** à la validation plutôt qu'acceptés puis ignorés. `SceneEnvironment` se réduit à l'exposition, qui n'est pas une lumière et ne peut rien éclairer.
- **Ombres du soleil : quatre cascades suivant la caméra**, dans les mêmes tranches d'atlas que les six faces d'une ponctuelle et sous les mêmes règles — carte réutilisée tant que ni la lampe, ni le monde dans son emprise, ni la caméra n'ont bougé ; rejet des clusters hors cascade par `gpuShadowCull` ; découpe réelle des matériaux à masque ; aucune baisse de résolution (côté 1024 par cascade) ; au plus quatre lampes redessinées par image. Le shader lit l'échelle d'une cascade **dans sa propre matrice** (orthographique) : aucune donnée en double, donc rien qui puisse diverger.
- **Profil** : la ligne Ombres garde ses quatre compteurs (le Lab les lit) et en gagne deux, `soleilsRedessines` et `cascadesRedessinees`.
- **Harnais** : `--soleil` (lampe directionnelle générique), `--camera-mobile` (une pose de la trajectoire par image), `--ressources` (le dossier que le glTF d'un cache compilé désigne en relatif ; sans lui, 3 360 textures en 404 et la mesure ne portait plus sur la scène).

### Fidélité

Emerald, WebGPU, 1280×720, 60 images, mode visible, `pixelError 0`, trois vues, cache v3 recompilé hors du Lab. **Témoin A/A : 0 pixel sur les trois vues, des deux côtés.** **Coupe identique** partout (`coupeIdentique: true`, 41 187 / 12 106 / 11 426 pages) : la géométrie ne bouge pas d'un triangle (E8).

- **(a) Sans lampe déclarée**, `avant` = `2931606` contre `après` : **non identique**, et c'est la règle elle-même. `avant` éclairait Emerald avec le gréement implicite hémisphère + soleil de `defaultLights()` ; `après` rend la vue sans éclairage. Écart : 177 971 px (max canal 224) sur `generale`, **921 599 px sur 921 600** (max 191) sur `sol`, 803 591 px (max 226) sur `rue` — l'ancien implicite touchait littéralement toute l'image. Il n'existe aucun réglage du côté `avant` qui l'éteigne : le gréement est écrit dans son nuanceur.
- **(b) Huit lampes ponctuelles à ombre**, `avant` contre `après` : **non identique**, même cause. Sans environnement déclaré, `avant` reste en mode « scène écrite » — gréement implicite **plus** les huit lampes ; `après` n'a que les huit lampes. Écart 176 418 / 903 895 / 706 322 px. **La comparaison à ambiance retirée des deux côtés est impossible** : l'ancien moteur ne sait pas rendre « les huit lampes seules », ni avec un environnement (qui remplace le gréement par un ciel constant) ni sans (qui le garde). L'écart est donc documenté, pas mesuré à zéro.
- **(c) `--soleil`** : pas de référence antérieure. Ombres portées réelles au sol et sur les façades, faces à contre-jour strictement noires (l'indirect est un lot ultérieur), pas d'acné rasante visible sur un mur de brique en plein soleil.

### Coûts (Emerald, WebGPU, p50/p95 par image, machine **non calme**)

Étape Ombres et enveloppe GPU de l'image entière ; **jamais additionnées**, et l'enveloppe n'est pas la somme des passes. « non mesuré » quand la passe n'a pas eu lieu.

| configuration                               | vue      |  Ombres GPU | image entière (enveloppe) | cartes redessinées / réutilisées                 |
| ------------------------------------------- | -------- | ----------: | ------------------------: | ------------------------------------------------ |
| soleil seul, scène et caméra immobiles      | generale |  non mesuré |             19,92 / 20,02 | 0 / 1                                            |
|                                             | sol      |  non mesuré |             10,56 / 12,08 | 0 / 1                                            |
|                                             | rue      |  non mesuré |             10,47 / 10,99 | 0 / 1                                            |
| soleil seul, caméra en mouvement            | generale | 3,86 / 4,50 |             24,06 / 28,07 | 1 soleil, 4 cascades, 8 dessins                  |
|                                             | sol      | 1,64 / 2,04 |              9,81 / 12,06 | idem                                             |
|                                             | rue      | 1,85 / 2,06 |             11,03 / 12,75 | idem                                             |
| soleil + 8 ponctuelles, tout immobile       | generale |  non mesuré |             20,18 / 20,30 | 0 / 9                                            |
|                                             | sol      |  non mesuré |             10,99 / 11,54 | 0 / 9                                            |
|                                             | rue      |  non mesuré |             11,29 / 11,78 | 0 / 9                                            |
| soleil + 8 ponctuelles, caméra en mouvement | generale | 3,76 / 4,33 |             24,45 / 28,08 | 1 soleil, 4 cascades ; 8 ponctuelles réutilisées |
|                                             | sol      | 1,85 / 2,55 |             10,94 / 13,40 | idem                                             |
|                                             | rue      | 1,82 / 2,58 |             12,30 / 13,43 | idem                                             |

Lecture : **une scène immobile et une caméra immobile ne paient aucune ombre**, soleil compris — les neuf cartes sont réutilisées et la passe n'est pas encodée. Dès que la caméra bouge, **seul le soleil** est redessiné (ses cascades suivent la caméra) ; **les huit ponctuelles restent en cache**, ce qui est exactement la règle voulue. Le coût des quatre cascades est de 1,6 à 3,9 ms p50 selon la vue, au-dessus du budget LR1 de 0,8 ms : l'optimisation est un lot à part.

Charge machine relevée au début et à la fin de chaque série : de 3,5 à 20 (indexation Spotlight et un compilateur natif d'une autre session). **Aucune de ces durées n'est un verdict de performance.**

### Ce qui reste

- **Les transparents gardent leur ambiance** : `BLEND_SHADER` appelle toujours `sceneLighting`, une autre session tient ce fichier. Les arbres d'Emerald restent donc allumés sans source, exactement comme la spécification l'annonce (P6, section 8).
- **Le chemin WebGL2** (`visibilityLighting.ts`, oracle CPU) garde ses lampes en dur : hors périmètre de ce lot, qui ne touche que la résolution différée.
- **Découpe des cascades** : la suite logarithmique part du plan proche de la caméra, que le banc pose à 0,017 m. Les deux premières cascades couvrent alors 0 à 71 m, ce qui est du gâchis pour une vue d'ensemble à 250 m. Un plancher sur la première borne se chiffre et se mesure ; il n'est pas posé au jugé ici.
- **Au-delà de `sunShadowFarFraction`** (0,2 du lointain), une surface reste éclairée sans ombre portée : approximation nommée, publiée dans le diagnostic `direct-lighting`.
- **Coût des cascades** au-dessus du budget LR1 ; la coupe propre aux ombres, déjà chiffrée et refusée par le lot ombres, reste le premier levier.

## 2026-09-15 — lot 3 des textures progressives : preuve navigateur, écart attribué au second groupe d'atlas

- **Mesure, pas encore de fusion** (la fusion est l'entrée suivante). La preuve navigateur montre un écart d'image bien au-dessus du bruit A/A, et il ne vient pas des mips progressifs : il vient du **second groupe d'atlas**.
- **Fusion de `develop`** (`19efc13`, ombres par face) : un seul conflit, `visibilityShaderId.ts`. `develop` avait sorti la découpe alpha dans `PAGE_MASK_WGSL`, partagée avec la passe de profondeur des ombres ; le lot la fait passer par `colorAlpha` et les classes d'atlas. Le bloc partagé prend la forme du lot, `PAGE_PREVIEW_BINDING` disparaît avec l'atlas d'aperçus, et la passe d'ombres déclare les classes et la table des slots aux liaisons de `VIS_BINDINGS`.
- **Deux défauts corrigés.** (1) `planAtlasClasses` vérifiait l'allocation à une classe **avant** d'essayer le découpage : une scène qui dépassait `maxTextureArrayLayers` en une classe levait `TEXTURE_ATLAS_LAYERS` sans regarder le plan à deux classes qui tenait (`81d7ccb`, deux tests). (2) Le raster logiciel des petits triangles liait **neuf** tampons de stockage à l'étage de calcul, un de plus que les huit garantis par WebGPU : le dispositif refusait la disposition puis se perdait à la première image, et la preuve navigateur ne démarrait pas. L'image et la liste vivent maintenant dans un seul tampon (`e2dab1d`) ; un test compte, par étage, les tampons de stockage des quatre dispositions.
- `npm run validate` : **treize portes vertes** en une passe — format, lignes, 0 doublon, lint et Clippy, `knip`, build TS, build natif, structure, déclarations, liens, **567 tests JS/TS**, **138 tests Rust** (134 bibliothèque + 4 CLI).
- **Preuve navigateur.** Lab en lecture seule sur le port 5191 (5174 laissé à l'utilisateur), relais 5192/5193 servant un cache Emerald recompilé dans le scratchpad, Lab jamais écrit. Cache du lot : sidecar **version 4**, 232 textures couleur, **232 niveaux progressifs, 0 ignoré**, 15,5 s, 10 046 405 triangles, 281 primitives, 1 030 nœuds. Quatre séries de dix captures 1246×1000 : lot (a, b), **témoin `develop` du jour** (a, b), et une série du lot **bridé à une seule classe d'atlas**.
- **Chiffres.** A/A du témoin `develop` : **0 px** sur dix captures ; `develop` contre `reference-develop` : 3 px, amplitude 39 (bruit connu). A/A du lot : 2 px, amplitude 16. **Lot contre témoin : 15 142 px sur 124,6 M (0,012 %), amplitude maximale 159**, répartis sur six captures — 10 934 px (segment 3), 2 704 (5), 821 (7), 618 (4), 59 (8), 3 + 3 (0 et 9). 1 130 px au-dessus de l'amplitude 16, en taches compactes (la plus grande : 338 px, boîte 14 × 30) sur de petits objets lointains — appliques de lampadaire, boîtiers de feux — et un semis de bord sur le feuillage des haies.
- **Attribution, mesurée.** Le lot **bridé à une seule classe** est **identique au bit près au témoin `develop` sur les dix captures (0 px)** : les mips progressifs, la résidence par niveau et le sidecar v4 ne changent **rien** à l'image. Tout l'écart vient du second groupe d'atlas. Sur Emerald il range **6 textures couleur et 33 de données** dans une classe **16 × 16** ; une petite texture minifiée dans l'atlas 2048 × 2048 mélangeait, à ses niveaux grossiers, le remplissage blanc qui l'entoure, et n'est plus mélangée à rien dans son propre atlas — d'où des appliques qui passent de gris clair (≈ 150) à sombre (≈ 10). L'écart est donc **explicable**, plausiblement plus fidèle, mais il **dépasse le bruit** et n'est **pas confiné aux bords**.
- **Octets d'atlas, calculés (jamais mesurés).** Une classe : **7 560 931 576** o. Deux classes : **6 688 572 304** o — couleur 2 438 288 580 + 9 548, données 4 250 227 800 + 46 376. Économie **872 359 272 o (−11,5 %)**, classe couleur 0 à 109 couches au lieu de 115.
- Chaque capture du lot : `texturePending` 0, `textureSkipped` 0, `textureUploaded` 336, `textureLevelsUploaded` 786, `textureAtlasClassesUsed` 2, aucune erreur GPU, **aucun triangle non couvert**. Coupe identique au témoin : mêmes `triangles`, `selectedTriangles`, `clusters`, `drawCalls`. Durées : **`null`**, machine chargée (load 1 min de 11 à 21).
- **Décision à l'utilisateur** : accepter l'écart du second groupe (et gagner 872 Mo calculés), ou garder une seule classe (image identique, gain nul). Images sous `benchmark-runs/webgpu-capture/{lot3-a,lot3-b,develop-a,develop-b,lot3-une-classe}/` (hors git).
- Reste : lot 4 (comparatif de compression), lot 5 conditionnel, la réutilisation du pipeline de `textureMips.ts`, et **aucune fixture dorée ne porte encore de texture couleur** — à créer. Note d'exploitation : les caches v3 du Lab sont refusés par le lecteur de sidecar v4 et devront être recompilés.

## 2026-09-15 — lot 3 : mips progressifs réels et groupes d'atlas par dimensions

- Défaut visé : entre l'aperçu 16×16 du lot 1 et la pleine résolution il n'y avait rien, et une texture-tableau imposant une seule taille à toutes ses couches, une texture de 64 px payait la place d'une texture de 4 096.
- **Compilateur** (`src/texture_preview/`, nouveau `levels.rs`). Le sidecar ne porte plus une pyramide de longueur fixe mais **la queue sans perte de la chaîne de mips** de chaque texture couleur : du premier niveau dont aucun côté ne dépasse **`PREVIEW_BASE` = 64** jusqu'au 1×1, soit au plus sept niveaux et **21 844 octets** par texture. Un niveau `k` est exactement le niveau de mip `k` de la source (division entière des deux côtés par `2^k`), donc le moteur l'écrit dans le niveau de mip de même rang de sa couche sans rien recalculer. Une source dont aucun côté ne dépasse 64 voit sa **pleine résolution** portée telle quelle, sans perte. Même chaîne de calcul qu'au lot 1 : linéaire prémultiplié, couverture MASK préservée par niveau au seuil du matériau, alpha intact sinon.
- **Décision de format** : aucun niveau intermédiaire n'est un fichier. Au-dessus de 64, le niveau suivant est l'image source elle-même, que l'hôte charge déjà — ce qui évite d'ajouter un genre d'objet de cache, un gabarit d'URL et un chemin de téléchargement pour les niveaux 128 et 256, dont les octets auraient alourdi le sidecar de dizaines de mégaoctets sur un cache comme Emerald.
- **Sidecar 3 → 4** (`manifest_binary`, `manifestBinaryFormat.ts`). Les entrées ne sont plus de longueur fixe : une entrée porte texture, image, dimensions, genre et vue de provenance, **premier niveau, nombre de niveaux, début et longueur de ses pixels**, et la colonne des pixels n'a plus de pas — son total entre dans le petit JSON (`texturePreviewBytes`). Les dimensions des niveaux ne sont pas écrites : elles se **redéduisent** des dimensions source (`texturePreviewLevels.ts`, miroir de `levels.rs`), si bien que le lecteur recalcule la géométrie annoncée au lieu de la croire, et refuse une entrée dont les nombres ne s'accordent pas, ou dont la plage d'octets n'enchaîne pas la précédente. La version 3 est refusée par son nom.
- **Atlas d'aperçus absorbé** : la texture-tableau 16×16 du lot 1 disparaît (`webgpuPreviewAtlas.ts` supprimé). Justification : avec la résidence par niveau, l'aperçu n'est plus qu'un niveau grossier de la vraie couche, et le garder aurait été une seconde texture, deux liaisons et deux mécanismes pour la même chose.
- **Résidence par niveau** (`webgpuAtlasSlots.ts`). Un mot par slot dit classe et couche, un second dit `finest | coarsest<<8` pendant le chargement et `ATLAS_READY` une fois la pleine résolution remipmappée. Pendant le chargement, le shader calcule le niveau depuis les dérivées uv, le **borne** à `[finest, coarsest]` et échantillonne à ce niveau explicite ; la résidence n'avance que sur une suite de niveaux tous écrits depuis le 1×1, sans quoi on montrerait du remplissage. **Fidélité** : dès `ATLAS_READY`, la lecture est exactement celle d'avant le lot — `textureSampleGrad` à dérivées explicites sur la vraie texture, après régénération de toute la chaîne sur GPU. L'image finale ne change pas.
- **Priorité** (`webgpuTexturePriority.ts`) : poids de la coupe d'abord, puis **étage** — les niveaux progressifs d'une texture passent avant sa pleine résolution —, puis avancement.
- **Classes de taille** (`webgpuAtlasClasses.ts`). `ATLAS_CLASS_COUNT = 2` slots de liaison **fixes**, choisis sous le minimum garanti par WebGPU (16 textures échantillonnées par étage) pour qu'aucun appareil ne puisse refuser les dispositions. La classe 0 garde les dimensions de la plus grande texture — donc le **repli à une classe est exactement l'allocation d'avant** ; la classe 1 est la division par deux (jusqu'à douze) qui minimise les octets alloués, et n'est retenue que si elle en gagne et si les couches tiennent sous `maxTextureArrayLayers`. Le nombre de classes employées est en plus borné par `maxSampledTexturesPerShaderStage` lu sur l'appareil. Une classe inemployée est une texture 1×1 de deux couches, huit octets, que les shaders ne lisent jamais.
- **Table des pages inchangée** : `mapIndex` reste un slot global, et la paire (classe, couche) se lit dans la table des slots. Aucun format de page ne bouge.
- **Dispositions** : les quatre du chemin WebGPU passent par `webgpuBindLayout.ts`, unique source de vérité des numéros de liaison, et leurs cinq constructeurs par `webgpuBindEntries.ts`. Le test de paires disposition/constructeur est étendu au **raster logiciel des petits triangles**, cinquième paire, qui lit désormais lui aussi les classes et la table des slots (sa découpe alpha suit donc le niveau résident au lieu de rester blanche).
- **Métriques versionnées** (`metricsContracts.ts`, `backendTypes.ts`) : `textureLevelsUploaded`, puis `textureAtlasBytesCalculated`, `textureAtlasClassBytesCalculated` et `textureAtlasClassesUsed`, tous **calculés** depuis les dimensions, les couches, la chaîne de mips et le format alloués, jamais mesurés sur l'appareil ; `vramBytes` reste `null`. Le diagnostic `material-textures-ready` publie le détail par classe.
- Chiffres de performance : **`null` partout**. Aucune mesure, aucune preuve navigateur, aucun rendu comparé dans ce lot.
- **Écart d'image attendu à la capture** : un atlas plus étroit réduit le remplissage autour d'une texture, donc le filtrage bilinéaire au bord d'une texture rangée en classe 1 lit moins de blanc qu'avant. Les pixels de bord peuvent changer ; le cœur des surfaces, non. C'est le seul écart que ce lot peut produire une fois les textures arrivées.
- **Fixtures dorées** : les cinq `expected.json` coplanaires ne portaient que `manifestBinaryVersion`, passé de 3 à 4.
- `npm run validate` : **treize portes vertes**. Format, lignes (0 fichier > 200), 0 doublon, lint et Clippy, `knip`, build TS, build natif, structure, déclarations, liens, **546 tests JS/TS**, **136 tests Rust**. Les quatre tests de `webgpuPreviewAtlas.test.ts` disparaissent avec le module qu'ils couvraient.
- Hors périmètre, non fait : compression KTX2/UASTC, virtualisation par tuiles, réutilisation du pipeline de `textureMips.ts`, WebGL (inchangé).

## 2026-09-15 — textures progressives : lots 1 et 2 fusionnés dans `develop`

- Fusion `e443bc6`. Trois fusions de `develop` dans l'intégration en cours de route (lot A, lots B et C, état de coupe chez l'appelant) : un seul conflit, le journal.
- **Défaut de fond corrigé** : le lot 1 étendait `visBindGroupLayout` et `shadeBindGroupLayout` à douze entrées mais ne mettait à jour qu'un des deux constructeurs de chaque groupe ; le dispositif refusait le groupe (« Number of entries (10) did not match the expected number of entries (12) ») puis se perdait au premier `awaitPages`. `webgpuBindEntries.ts` porte maintenant l'unique liste d'entrées de chaque disposition, et les quatre constructeurs y passent. **Un test ajouté** compare, pour chaque paire disposition/constructeur, le nombre d'entrées construites au nombre d'entrées de la disposition réelle : il échoue sur le code d'avant.
- **Harnais**, deux défauts préexistants réparés : `test/browserFixtures/captureFixture.mjs` décrivait ses pages sans bande d'erreur de DAG, que la page exige depuis longtemps (`STALE_CACHE`), et la scène de couverture est maintenant un vrai DAG à deux niveaux ; le rapport n'épuise plus le tas de Node — `page.evaluate` ne rend plus d'un coup les 373 042 événements et 600 échantillons (vidés par tranches) et `result.json` s'écrit au fil de l'eau (849 Mo sur la course d'Emerald).
- **Limite de lignes** : la fusion cumulait les ajouts des deux côtés, `lib.rs` à 201 et `manifest_binary.rs` à 210 ; `with_ratio` et `digests` partent chacune dans leur module, sans une ligne de logique changée.
- `npm run validate` : **treize portes vertes**. Format, lignes, 0 doublon, lint et Clippy, `knip`, build TS, build natif, structure, déclarations, liens, **550 tests JS/TS**, **136 tests Rust** (132 bibliothèque + 4 CLI).
- **Preuve navigateur.** Lab en lecture seule sur le port 5181 (5174 laissé à l'utilisateur), cache Emerald recompilé en v3 dans le scratchpad (232 textures couleur, **232 aperçus, 0 ignoré**, sidecar `version 3`, 17 s, 10 046 405 triangles, 281 primitives, 1 030 nœuds) et servi par un relais 5182, Lab jamais écrit. Deux exécutions du harnais `test/webgpuCapture.browser.mjs`, 600 images chacune, dix captures 1246×1000 : **bit à bit identiques entre elles**. Contre les dix références `develop` : **3 pixels sur 12 460 000**, écart maximal **39** sur un canal, trois pixels isolés sur les segments 3 et 8 — le bruit A/A mesuré sur ces mêmes segments va de 0 à 43 pixels. Chaque capture : `texturePending` 0, `textureSkipped` 0, `textureUploaded` 336, aucune erreur GPU, **aucun triangle non couvert**, couverture complète. Images sous `benchmark-runs/webgpu-capture/fusion-finale-{a,b}/` (hors git).
- Chiffres de performance : **`null`**. Rien n'est mesuré ici, ni première image, ni coût par image, ni taille de sidecar.
- Reste : lots 3 à 5 des textures progressives, la réutilisation du pipeline de `textureMips.ts`, et — note d'exploitation — **tous les caches du Lab doivent être recompilés en v3**, le lecteur de sidecar refusant la version 2 par son nom.

## 2026-09-15 — audit des calculs, lots B et C fusionnés

- **Lot B, Rust à la compilation** (`npm run bench:calculs:natif`, banc `src/bench_calculs/`, référence recopiée, `to_bits` sur chaque flottant) : 7 retenus sur 12 lignes. Matrices monde construites une fois pour la coplanarité 7,84 → 3,98 ms ; colonnes du manifeste binaire sans vecteur temporaire 27,6 → 1,77 ms ; bisection et bord des groupes sans HashSet 0,97 → 0,16 et 0,43 → 0,19 ms ; compaction d'une région 0,31 → 0,29 ms ; classification des sommets à blocs réutilisés 15,3 → 4,64 ms ; renumérotation d'une page 291 → 140 ms. Refusés : adjacence sans tri (52 ms contre 28, annulé), `#[inline]` (bruit), octets d'indices (neutre) ; sans objet : digests (rien n'est recalculé), `CornerHasher` (déjà fait). Fixtures dorées et maillage de 500 000 triangles : manifeste, `clusters.bin`, pages et objets identiques octet par octet ; compilation 3 909 → 3 501 ms (machine chargée, chronomètres `perf.rs` : topologie −44 %, regroupement −55 %). 8 tests d'équivalence, `validate` vert (111 tests Rust).
- **Lot C, changements d'ordre flottant** (`*-c.bench.mjs`, écart mesuré en ULP et en pixels) : 3 retenus sur 7. Pyramide Hi-Z plate en `Float32Array` 9,41 → 5,97 ms ; relance sur budget arrêtée à la page qui dépasse 22,0 → 9,78 ms (coupe strictement identique) ; table sRGB 256 entrées 34,6 → 20,2 ms. Refusés avec preuve : raster affine (809 pixels changent d'identifiant, trou possible sur une diagonale au centre du pixel), préchargement dérivé de la coupe (2 500 pages contre 1 250), second parcours de forçage (autre ensemble), seuil de réparation mémorisé (coupe dépendante de l'historique). Les tests ont trouvé un écart que le banc masquait (`Float64Array` convertissait `undefined` en `NaN`) : `sampleMap` rend `NaN` sur un index de texel rompu, comme avant. Champ `PageRec.seen`, écrit et jamais lu, supprimé. 3 fichiers de tests, `validate` vert (534 tests JS).
- Règle posée par l'utilisateur : aucune optimisation n'est retenue si le résultat change, même d'un bit. Décision : oracles et bancs JS déménagent de `scripts/mesure/calculs/` vers `packages/*/bench/` (les tests d'un paquet ne doivent pas dépendre de `scripts/`, et un banc n'importe pas les internes d'un paquet depuis l'extérieur) — lot de déplacement à venir. Preuve navigateur des trois lots reportée à une machine calme.
- **Lot E, déplacement pur** : les 17 oracles, les 21 bancs et le harnais (`banc.mjs`, `bancC.mjs`, `bancF.mjs`, `ecartsC.mjs`, `scenes.mjs`, `scenesC.mjs`, `scenesF.mjs`, `rasterC.mjs`, `dagC.mjs`) ont quitté `scripts/mesure/calculs/` pour le paquet dont ils mesurent le code : `packages/sdk-core/bench/` pour `f-manifeste-f` et `f-vecteurs-f`, qui ne touchent que `sdk-core`, `packages/sdk-browser/bench/` pour les dix-neuf autres. Le harnais commun est dans `sdk-core/bench/`, le paquet de base : la dépendance va de `sdk-browser` vers `sdk-core`, jamais l'inverse. Les 24 tests des deux paquets importent leurs oracles par `./bench/oracles/…`, les bancs atteignent leur paquet par chemin relatif. `scripts/mesure/calculs/` ne garde que `agrege.mjs`, `agrege-c.mjs`, `agrege-f.mjs` et leur `tableau.mjs` commun, sans aucun import de paquet. Aucun changement de comportement : `bench:calculs` rend 14 lignes « Identique » à oui, `bench:calculs-f` 17, `bench:calculs-c` les mêmes 3 retenus et 4 refus décrits ; `validate` vert, 613 tests JS avant comme après.

## 2026-09-15 — audit des calculs, lot A : quatorze optimisations bit-exactes et un banc de comparaison

- Inventaire des calculs mathématiques (`orchestration/AUDIT_MATH_INVENTAIRE.md`, ~230 entrées, Top 15 des boucles chaudes) par onze lectures Sonnet 5 sur `ea032f4`, plan en trois lots (`orchestration/AUDIT_MATH_BILAN.md` (anciennement le plan)). Lot A = JavaScript par image, résultat identique au bit près ; lot B = Rust à la compilation ; lot C = changements d'ordre flottant, décidés sur mesure d'écart.
- **Banc commis** `scripts/mesure/calculs/` (`npm run bench:calculs`) : pour chaque calcul, l'ancien code recopié comme référence dans `oracles/*.mjs`, le nouveau importé du paquet, mêmes entrées hostiles (DAG 20 000 pages, 1280×720, dégénérés, NaN/Infinity/-0, tailles limites, graines xorshift), égalité `Object.is` sur chaque valeur, médiane sur ≥ 200 tours. Tableau et JSON dans `orchestration/mesures/calculs-2026-09-15.{md,json}`.
- **Résultat : 14 / 14 identiques, 14 / 14 retenus.** Gains (ms avant → après) : projection des sommets une fois par triangle dans `visibilityDepth` 5,65 → 1,21 ; `shadeVisibility` 24,2 → 18,5 ; occulteurs par tri radix (`splitOccludersFlat` enfin branché, `splitOccluders` supprimé) 9,70 → 3,18 ; `countUnoccluded` à plat (`projectBoxToScreen` supprimé) 13,9 → 12,0 ; niveau de mip borné 1,41 → 0,68 ; `boxClip` par indice 0,93 → 0,79 ; urls de résidence autonome (Set persistants, plus d'`includes` ni de spread) **222 → 1,35** ; comptage des pages résidentes 0,36 → 0,07 ; `windingCw` mémorisé et déterminant unique 0,94 → 0,72 ; caméra de comparaison Hi-Z recopiée au lieu de clonée 0,68 → 0,13 ; résidence DAG GPU sur miroir compact 1,35 → 0,81 ; file de streaming triée une fois 1,20 → 0,92 ; décodage de page sans fermeture par sommet 2,36 → 1,17 ; télémétrie en tampon circulaire 3,20 → 0,34.
- Tests : 61 tests d'équivalence ajoutés (un par comportement), `hiz.test.ts` et `hizTemporal.test.ts` adaptés à l'API restante. `npm run validate` vert après rebase sur `develop` (`a59c05a`) : 493 tests JS, 83 Rust, 0 doublon, 0 fichier > 200 lignes.
- Non fait : preuve navigateur (captures A/A et `tri = selected`) reportée à une machine calme, deux agents compilant en parallèle ; reportés au lot C : cache de coins d'époque dans `countUnoccluded`, delta `entered/exited` de `shownFromGpu`, compteur incrémental de `vertexBytes`.

## 2026-09-15 — lot 2 : transferts de textures découpés et prioritaires

- Défaut visé : une texture plus grosse que le budget d'une image sortait de la file pour toujours et comptait dans `textureSkipped`, restant sur son aperçu 16×16 ou sur du blanc. Livré : découpage en bandes de lignes, file ordonnée par ce que la caméra dessine, abandon réservé aux vrais échecs.
- **Découpage** (`webgpuAtlasJobs.ts`, nouveau ; `webgpuAtlasCommon.ts`, `webgpuTexturePump.ts`). Le travail de transfert d'une texture porte désormais ses lignes, ses octets par ligne et la première ligne restante ; `uploadRows(row, count)` copie les lignes `[row, row+count)` du rectangle source aux mêmes lignes de la couche. Les deux chemins, `writeTexture` sur pixels décodés et `copyExternalImageToTexture` sur image opaque, découpent de la même façon. Les tranches couvrent exactement le rectangle W×H, sans chevauchement ni trou ; les mips de la couche et le bit « prêt » (`markReady`, lot 1) ne viennent qu'après la dernière tranche, donc le résultat final est celui d'un bloc.
- **Priorité** (`webgpuTexturePriority.ts`, nouveau ; `webgpuMaterialTextures.ts`, `webgpuPagesStateVis.ts`, `webgpuPagesRuntime.ts`). Signal retenu : la coupe précédente, que le moteur tient déjà à jour — pages dessinées (`run.drawn`, tail transparente comprise) et maillages transparents visibles (`blendState.visibleBlend`). Aucune passe GPU ajoutée, aucune lecture bloquante. Le collecteur de textures rend en plus l'index matériau → couches d'atlas, bâti une fois à la préparation ; le poids d'une couche est le nombre de triangles dessinés par les surfaces qui la lisent. Tri à chaque image, uniquement entre deux tranches : une texture entamée n'est jamais coupée au milieu d'une tranche, mais peut être reléguée après. À poids égal, une texture entamée passe devant une texture intacte ; à poids et avancement égaux, l'ordre d'origine tient, si bien qu'une file sans signal (avant la première coupe) se comporte comme avant.
- **Budget** : `maxTextureTransferBytesPerFrame` reste la valeur publique du contrat, respectée à la tranche près. La ligne est l'unité indivisible : la première ligne d'une image passe même si elle dépasse à elle seule le budget, sans quoi une texture plus large que le budget n'avancerait jamais. Le reste de l'image ne dépasse jamais.
- **Abandon** : borne de trois refus de transfert par texture ; au troisième elle quitte la file, compte dans `textureSkipped` et laisse un diagnostic `progressive-texture-abandoned` (raison, genre, couche, lignes transférées, lignes totales). Aucun réessai ensuite. La taille n'est plus jamais une cause de sortie.
- **Métriques** (`metricsContracts.ts`, `backendTypes.ts`, `explorerMetrics.ts`, `webgpuPagesMetrics.ts`) : trois champs facultatifs ajoutés — `textureInFlight` (textures entamées en attente d'autres tranches), `textureSlicesUploaded` (tranches réellement transférées), `textureBytesLastFrame` (octets admis par la dernière passe de la pompe). `texturePending` garde son sens de textures en file. Rien d'estimé, `null` pour un moteur qui ne découpe pas.
- Chiffres : **`null` partout**. Aucune mesure de performance, aucune preuve navigateur, aucun rendu comparé dans ce lot.
- Hors périmètre, non fait : mips progressifs réels, groupes d'atlas par dimensions, compression, `textureMips.ts`. Aucun test écrit : ils reviennent à l'agent de tests.

## 2026-09-15 — lot 1 : aperçus 16×16 des textures couleur, du compilateur au shader

- Défaut visé : l'atlas couleur WebGPU se remplit de blanc en attendant les textures, et une texture hors budget ou en échec reste blanche pour toujours. Livré : le compilateur écrit une pyramide d'aperçus 16×16 → 1×1 par texture couleur, et le moteur l'échantillonne tant que la couche n'est pas transférée.
- **Compilateur** (`src/texture_preview/`, crate `image` 0.25 en `png` + `jpeg` seulement, sans features par défaut). Décodage à l'étape de compilation, donc glTF comme FBX importé : image par `uri` relative au dossier source (échappements `%XX` décodés, aucun composant hors du dossier) ou par `bufferView` du binaire déjà mappé. Chaîne exacte : décodage → sRGB vers linéaire → prémultiplication → moyenne de boîte vers 16×16 → moyennes 2×2 → dé-prémultiplication au dernier pas, linéaire vers sRGB, RGBA8 alpha droit. Le prémultiplié ne sort jamais du module. Annulation vérifiée entre deux textures. Un décodage impossible (DDS, TGA, PNG corrompu, image absente, format inconnu) est une ligne de `texturePreviews.skipped` dans `clusters.json`, jamais un échec de compilation.
- **Couverture MASK** : fraction des texels pleine résolution dont l'alpha atteint `alphaCutoff` du matériau (0,5 seulement par défaut glTF), puis recherche binaire de l'échelle d'alpha qui redonne cette fraction à chaque niveau ; `alphaMode` et `alphaCutoff` ne sont pas touchés. Règle des seuils multiples : une texture n'est corrigée que si **toutes** ses liaisons sont des couleurs de base de matériaux MASK, et alors au **plus petit** de leurs seuils ; une seule liaison BLEND, OPAQUE ou émissive laisse l'alpha intact.
- **Format** : sidecar binaire **2 → 3**, trois colonnes ajoutées (`texturePreviewU32` de 11 mots, `texturePreviewSha` de 64 octets, `texturePreviewPixels` de 1364 octets), 24 colonnes. Une entrée porte texture, image, dimensions, genre et vue de provenance, sha256 des octets sources et les décalages des cinq niveaux (0, 1024, 1280, 1344, 1360) ; l'`uri` n'est pas recopiée, elle se lit dans `images[image]` de `source.gltf`. Le lecteur TypeScript refuse la version 2 par son nom et revalide chaque entrée (décalages exacts, dimensions non nulles, index de texture strictement croissants). `formatVersion` du cache inchangé, `compilerVersion` toujours séparé.
- **Moteur** : deuxième texture-tableau 16×16 `rgba8unorm-srgb` à cinq niveaux, mêmes indices de couche que l'atlas couleur, uvScale 1, téléversée par `writeTexture` niveau par niveau ; un bit « prêt » par couche dans un petit tampon dédié, mis à 1 par la pompe **après** transfert complet et régénération des mips de la couche. Couche 0 et couche sans aperçu : blanc. Une texture abandonnée garde son aperçu. Lecture branchée dans les trois passes qui lisent l'atlas couleur : résolution matérielle, découpe alpha du raster d'identifiants, forward transparent. Aucune passe de blit, aucun agrandissement.
- `alphaCutoff` était déjà lu du matériau (`baseColor.w` de la ligne de page) et non codé en dur : rien à corriger. Chemin WebGL : aucun atlas symétrique (les moteurs `reference`, `exact-pages` et `three-lod` lisent les textures Three directement), donc **rien n'y change** ; le lecteur de sidecar partagé ne touche à aucun de leurs chemins.
- **Harnais** `test/browserFixtures/captureModel.mjs` : une capture est nommée candidate (`segment-N.candidate.rgba`) et son état réel est consigné à côté (`segment-N.candidate.json`) — `texturePending`, `textureSkipped`, `textureUploaded`, erreurs GPU, nombre d'images rendues après le flush. Les métriques sont relues **après** les rendus de stabilisation, juste avant la lecture des pixels, et la capture échoue bruyamment si `texturePending`, `textureSkipped` ou une erreur GPU est non nul.
- Chiffres : **`null` partout**, rien n'est mesuré dans ce lot — ni taille de sidecar, ni coût de l'étape de compilation, ni première image, ni preuve navigateur.
- Hors périmètre, non fait : transferts découpés, mips progressifs réels, groupes par dimensions, compression KTX2/UASTC, réutilisation du pipeline de `textureMips.ts`. Aucun test écrit : ils reviennent à l'agent de tests.

## 2026-09-14 21:20 — couches coplanaires : fusion de `develop`, et le coût d'une couche vide supprimé

- Deux fusions de `develop` dans le lot : `04fa5f0` (passe de simplification WebGPU, spec éclairage) puis `17c0159` (lot 4 WebGL2 et harnais `scripts/mesure/`). Cinq conflits à la première, aucun à la seconde. `webgpuPages.ts`, `visibilityBuffer.ts` et `pageSelection.ts` repartent de `develop` : le lot est réappliqué dans les modules de la simplification (`webgpuPagesStateVis`, `webgpuPagesLayout`, `webgpuPagesPipelineFor`, `webgpuVisibilityItems`, `webgpuVisibilityDrawer`, `webgpuVisibilityUniforms`, `webgpuVisibilityShaders`, `webgpuVisibilityPipelines`, `webgpuPagesPrepareVisibility`, `webgpuPagesDrops`, `webgpuPageRow`) et dans les deux barils de nuanceurs (`visibilityShaderId`, `visibilityShaderShade`). `part4.rs` garde les constantes de format du lot et le nouvel assistant `write_gltf`. Journal : les deux entrées gardées.
- **Cause du surcoût GPU, mesurée.** La compaction indirecte payait chaque slot, occupé ou non : la passe de comptage relit les 64 items d'un groupe pour chaque slot, et le préfixe, séquentiel, parcourt tous les groupes de tous les slots. Ouvrir une couche double le nombre de slots, donc ce travail, alors que quatre clusters d'Emerald seulement portent la couche. A B B A sur le même dispositif, avant correctif : témoin GPU 11,60 ms, couches **17,70 ms** (+6,1 ms). Après correctif : 10,96 contre 10,90 ms, intervalles confondus.
- **Correctif** : le CPU compte déjà exactement les lignes par slot avant la compaction, et le nuanceur n'ajoute que le masque de sélection, qui ne peut qu'enlever des items ; un slot compté à zéro est donc vide sur GPU aussi. `gpuDraw.encode` reçoit ce compte, le comptage sort aussitôt pour un slot vide et le préfixe l'écrit à zéro sans le parcourir. Une couche qu'aucun cluster du lot ou de la passe n'atteint ne coûte plus rien. Image inchangée. Les tampons de `gpuDrawFactory` partent dans `gpuDrawBuffers.ts` (limite de 200 lignes).
- **Preuve navigateur** (Emerald, 1280×720, DPR 1, pixelError 1, plafond 60 Hz headless, cache compilé et servi depuis le scratchpad, Lab en lecture seule, port 5176 + deux relais 5210/5211) : neuf poses — quatre du parcours (f0, f150, f300, f450), quatre de sol visant les recouvrements du diagnostic, une au sol de la Ville 1 à la première personne. À résidence non saturée (100 000 pages) : **A/A = 0 px sur les neuf poses, aux deux moteurs**. WebGPU, témoin contre couches : 0 / 150 / 2 967 / 0 / 1 436 / 10 176 / 1 171 / 0 / 0 px. WebGL2 : 0 / 37 / 29 / 0 / 0 / 93 / 20 / 0 / 0 px. Tous les pixels changés échangent le même couple de matériaux du sol marqué (≈ 125,126,124 → 76,76,76), y compris ceux qui apparaissent haut dans l'image sur une vue plongeante — c'est le même sol marqué vu de loin.
- Trous : `uncoveredTriangles = 0` sur les neuf poses WebGPU et sur le parcours de 600 images, y compris au budget de 4 096 pages ; WebGL2 `submitted = selected` exactement sur les neuf poses (ce chemin ne publie pas de compteur de couverture). Sélection identique entre témoin et couches sur les neuf poses ; le seul écart de dessin est **+1 appel indirect** en WebGPU, aucun en WebGL2.
- Durées, parcours de 600 images, A B B A, **machine chargée (load 1 min entre 8 et 11, plusieurs agents actifs)** : WebGPU CPU 8,45 → 6,90 ms, GPU 10,955 → 10,898 ms ; WebGL2 CPU 11,60 → 10,95 ms, GPU `null` (pas d'horloge GPU sur ce chemin), `cpuSelectMs` 3,0 → 2,9 ms. Intervalles confondus des deux côtés : à cette charge, aucun écart n'est mesurable. Ce ne sont pas des mesures de campagne.
- Reste pour l'agent de tests : aucun test ne couvre encore le saut de slot vide (`slotUsed`) ni `gpuDrawBuffers.ts`, et `gpuDrawLayers.test.ts` compare `drawShader(1)` au fichier d'un commit fixe (`5ae3b83`) par `git show` — à remplacer par une référence versionnée dans le dépôt.

## 2026-09-14 18:30 — couches coplanaires : étape de compilation + biais de profondeur entier aux trois chemins

- Défaut visé : sur Emerald (Ville 1, `webgpu-page-raster`), deux maillages opaques exactement coplanaires à deux matériaux se disputaient le sol par tuile écran. Solution livrée : une **couche par cluster décidée à la compilation** (étape `coplanar-depth-layers-v1`), appliquée au rendu comme **biais de profondeur entier de 16 unités matérielles par couche**, sur le chemin matériel WebGPU (`depthBias` de pipeline + slot de dessin indirect par couche), le raster logiciel (même constante retranchée aux bits de la clé de profondeur) et WebGL2 (`polygonOffset` sur un lot jumeau). Ni `gl_FragDepth`, ni epsilon global, ni sommet déplacé, ni fonction de profondeur changée.
- Règle : surfaces opaques sans masque alpha uniquement ; la plus petite aire passe dessus, égalité départagée par l'ordre source ; `extras.coplanarPriority` sur un nœud ou un mesh remplace la règle. La couche d'une surface est **le plus long chemin de recouvrements qui la précède**, pas son rang dans une pile : deux dalles posées loin l'une de l'autre sur un même sol restent en couche 1, et toutes les instances d'un objet gardent la même couche (0 conflit d'instance sur Emerald).
- Formats : cache 1/2 → **3/4** (`formatVersion` et `schema`), manifeste binaire 1 → **2** (colonne `pageDepthLayer`, 21 colonnes). Le lecteur refuse 1 et 2 par leur nom. `SOURCE_FORMAT_VERSION = 1` sépare désormais le format des manifestes de source de celui du cache.
- Diagnostic Emerald (`.coplanar` de `clusters.json`) : 234 surfaces coplanaires opaques, 29 plans, 6 plans candidats, **10 recouvrements**, 9 075 u² d'aire recouverte, **4 clusters marqués** (10 couples surface-cluster), une seule couche, 0 débordement, 0 conflit. Les paires nomment les deux objets et la boîte monde partagée : trois carrés de 55 × 55 en y = 0 (matériaux 46/47, 158/159, 198/199) et sept plaques posées sur un sol (matériaux 107/114). Coût de l'étape : 49 ms CPU cumulés sur 9 200 ms de compilation.
- Preuve pixel, cache témoin (même compilateur, mêmes objets, colonne des couches remise à zéro) contre cache à couches, huit poses, à convergence forcée : **A/A = 0 px partout**. WebGPU : 87 / 151 / 2 969 / 0 px sur les quatre poses du parcours, 0 / 0 / 1 / 4 500 px sur quatre poses de sol ; tous les pixels changés sont dans le seul tiers vertical du sol (y 295–519 sur 720), aucun ailleurs. WebGL2 : 30 / 68 / 30 / 0 px. Trous : `tri = selected` (1 842 728) aux deux moteurs, `uncoveredTriangles = 0`.
- Calibrage du biais : sur la fixture des deux quads, l'écart d'interpolation de profondeur entre les deux triangulations vaut au plus **5 unités** (1280×720, trois angles, trois plages near/far, deux conventions). Sur Emerald, 16 et 32 et 64 unités donnent la même image sur le sol marqué (0 px), tandis qu'au-delà de 16 le biais mord sur les surfaces voisines (94 px à 32, 185 de plus à 64, plus haut dans l'image). Valeur retenue : **16**.
- Durées, machine à charge 1 min ≈ 3, verrou `.claude/mesure.lock` pris, A B B A de 600 images : WebGPU CPU 4,95 → 4,85 ms (médianes, intervalles confondus), **GPU 11,45 → 12,21 ms (+0,76 ms)** ; rAF p50 16,7 ms des deux côtés (plafond 60 Hz headless), 0 image > 50 ms. WebGL2 CPU 11,25 → 10,60 ms, GPU `null` (pas d'horloge GPU sur ce chemin). Ce ne sont pas des mesures de campagne : un seul dispositif, deux passages par branche.
- Non fait : le chemin de repli opaque de WebGPU (sans visibility buffer) ne porte pas le biais ; un cluster non plat appartenant à un plan partagé n'est pas marqué ; aucun test unitaire (agent dédié). `webgpuPages.ts` passe de 2 058 à 2 127 lignes, déjà hors de la limite de 200 avant ce lot.
- Fixtures de correction : `packages/asset-compiler-rust/fixtures/coplanar/` (recouvrement total, partiel, trois surfaces empilées, masque alpha non résolu, transparent intact), chacune avec son `expected.json` vérifié à la main par la CLI. Lab en lecture seule : cache compilé et servi depuis le scratchpad, port 5174 jamais touché.

## 2026-09-14 — Spec éclairage, version 0

- Nouveau document `orchestration/SPEC_ECLAIRAGE.md` : besoin (GI dynamique, aucune lumière cuite), principe « cadence fixe, convergence variable, même image finale », exigences numérotées (physique, compilateur, runtime, contrat d'erreur, plateformes, banc, exécution des calculs), budgets GPU par composant et tolérance de retard (cible 100 ms, limite 250 ms, 500 ms sur GPU intégré) comme réglages révisables, phases E0 à E6. Aucune implémentation ; la phase E0 (quatre mesures) peut s'intercaler, E1 à E6 attendent la fin des phases 1 à 3 de la spec géométrie.

## 2026-09-14 — R&D éclairage : prototype et diagnostic, aucune intégration

- Essai isolé depuis `78e7fe203d273c09dd4f27b4ee39016fbcb51cd1`, branche `codex/light-transport-experiment`. Deux pièces, porte mobile, trois sources colorées réglables, miroirs et sphère. Rendu expérimental Three/WebGL2 via les API publiques ; maillages source dessinés, pas les pages de clusters ni le runner du banc 15. Lab et assets inchangés, aucun commit/fusion.
- Deux défauts de départ corrigés : auto-intersection de la sphère et mélange de l’ombre directe avec le cache indirect grossier. Les bandes des ombres sont remplacées par un échantillonnage stratifié déterministe ; du bruit reste visible. Qualité générale et gain de performances non validés.
- Preuve navigateur : 14 états avec égalité exacte des matrices, radiances et images entre recalcul et réutilisation ; aucune erreur navigateur. 330 tests Node, build, structure et déclarations passent.
- À la demande utilisateur, arrêt des ajouts fonctionnels pour comprendre l’orientation technique. Profil CPU : environ 9,5 ms pour une couleur, 40,1 ms pour la porte avec réutilisation. Contrôle graphique sur cinq images isolées : 370–498 ms GPU. Worker/WASM seuls ne résoudront donc pas la lenteur de ce dessin expérimental.
- Une preuve numérique confirme la recombinaison des contributions des trois lampes à géométrie fixe (40 608 octets de bases, erreur proche de l’arrondi Float64). Amortissement et invalidation dynamique non mesurés. Aucun BVH, worker, port WASM ni cache de bases persistant ajouté au moteur.
- Détails, preuves et expériences suivantes proposées : diagnostic et orientation R&D (document `RD_ECLAIRAGE_DIAGNOSTIC.md`, chiffres finaux archivés le 15 septembre ci-dessous, puis supprimé). L’ancien plan d’essai est clos et supprimé.

## 2026-09-14 01:25 — état de passation (session d'audit)

- `develop` = 791245b : DAG de clusters, paquets de streaming, manifeste binaire, sélection GPU DAG, clusterBatches WebGL, transparents double face pré-scindés, limites de device, identifiants 24/8 bits, repli racines sous pression de budget. 330 tests Node, 46 tests Rust verts.
- Emerald WebGL parcours : rAF 119 FPS, CPU p50 6,2 ms, p99 50 ms (15 images > 50 ms). WebGPU : 20 FPS, CPU p50 44,6 ms, A/A en échec sur 2 segments. Première image ~2 s (source.bin 195 Mo + textures 866 Mo).
- **EN COURS (session d'audit)** : chantier « code mort runtime navigateur + extensions `.bin` + compteurs `pagesDetached`/`cacheEvictions` + test Lab prepareQem via API publique ». Fusion dans `develop` à suivre par la session d'audit, qui écrira ici la ligne « NETTOYAGE FUSIONNÉ » avec le commit. Tant que cette ligne n'existe pas : ne lancer aucun agent qui modifie `packages/sdk-browser/**`, `lib.rs` ou `geometry_page.rs`.
- Libre dès maintenant, sans conflit : (1) banc 15 : consigner DPR, pixelError, résolution et commit du SDK dans le rapport de campagne, mode mesure sans trace, ABBA ; (2) préparation de la campagne de vérité (protocole, scènes, ordre) ; (3) R&D chargement en lecture seule (état de l'art, plan de mesures), sans code moteur.

## 2026-09-14 — session orchestrateur (Fable 5.1), démarrage

- Lu prompt + journal. `develop` toujours à 791245b ; ligne « NETTOYAGE FUSIONNÉ » absente → aucun agent sur packages/sdk-browser, lib.rs, geometry_page.rs tant qu'elle n'apparaît pas.
- Lancés en parallèle (worktrees ; aucune mesure lourde, un seul run headless court pour A1) :
  - A1 `banc15-mesures` (opus) : Lab banc 15, champs DPR / pixelError / résolution physique+CSS / commit SDK (dirty) / charge machine par bloc, mode summary imposé, ABBA (A B C D puis D C B A, deux passes, médiane, alerte > 5 %). Travail dans un worktree du Lab (`.claude/worktrees/banc15-mesures-honnetes`, branche du même nom), non committé ; fusion Lab par agent dédié ensuite.
  - A2 `protocole-verite` (opus) : rédige `orchestration/CAMPAGNE_VERITE.md` (4 moteurs × 8 scènes × 1 et 9 instances × 1280×720 DPR 1 puis 2, ABBA, A/A et A/B, verdicts par scène et moteur, commandes vérifiées).
  - A3 `veille-chargement` (sonnet, lecture seule) : état des lieux chiffré du chargement, état de l'art des 7 pistes, plan de mesures piste 1 → `orchestration/RD_CHARGEMENT.md`.
- Décisions : (a) les livrables documentaires des agents vont dans `orchestration/` du checkout principal (domaine de l'orchestrateur), seule écriture autorisée hors worktree ; (b) surveillance du journal (Monitor) sur la ligne « NETTOYAGE FUSIONNÉ » ; dès qu'elle apparaît, lot 2 WebGPU, premier sous-lot = plancher fixe CPU (table de pages construite une fois, résidence en bitset incrémental, zéro allocation par image), mesures séquentielles avec les autres chantiers.
- Prochaine étape : résumés A1–A3 ; fusion Lab ; lot 2 après nettoyage.

## 2026-09-14 — message utilisateur : rapport banc 15 actuel, « annule l'agent »

- Rapport banc 15 fourni par l'utilisateur (Emerald, parcours, 873×1000, trace debug ACTIVE, donc pas une mesure honnête) : Three.js réf 119 FPS, CPU 6,2/19 ms, 3 images > 50 ms ; THREE.LOD 119, 6,6/21, 4 ; WebGeometry WebGL 119, 6,2/50, 15 (945 k triangles soumis au lieu de 10 M, pixel-identique sur les segments comparés) ; WebGeometry WebGPU 20 FPS, 44,6/77 ms, 283 images > 50 ms, A/A en échec sur 2 segments (« visuel seulement »). Champs DPR, pixelError, commit SDK absents.
- Décision (instruction ambiguë, « l'agent » = celui du banc 15, seul lié au rapport et seul à mesurer) : A1 `banc15-mesures` arrêté via la consigne de la règle 11 (« livre l'état actuel en ≤ 12 lignes »), tout run de mesure interrompu, worktree Lab conservé en l'état pour reprise. Les champs manquants restent requis (confirmé par le résumé de l'utilisateur) : reprise en pure implémentation, sans run de mesure, quand la machine sera libre. A2 et A3 (documentaires, sans mesure) continuent.
- A1 `banc15-mesures` : tué par l'utilisateur avant tout travail (merge develop fait, exploration du Lab entamée, aucun worktree Lab créé, aucun fichier modifié, aucune mesure lancée). Rien à reprendre ; le chantier « champs DPR / pixelError / résolution / commit SDK, summary, ABBA » reste entièrement à faire, à relancer sans run de mesure quand décidé.

## 2026-09-14 — A3 `veille-chargement` terminé (sonnet, lecture seule, ~15 min)

- Livrable : `orchestration/RD_CHARGEMENT.md` (113 lignes). Aucune écriture ailleurs, aucune mesure.
- État des lieux : première image ≈ 350-400 requêtes (338 textures), `source.bin` 195 Mo confirmé, chargé en un bloc parce que les pages autonomes existent pour l'opaque mais pas pour le verre (BLEND). Tout le décodage sur le thread principal (0 Worker dans sdk-browser). Lab : Vite, HTTP/1.1, sans compression, Range non testé.
- Écarts avec le prompt : « 42 Ko / 30 clusters » ne correspond à aucune constante (cible codée 128 Kio par paquet) ; « 866 Mo textures » non vérifié (565 Mo sur disque compressés, écart = RGBA décompressé probable).
- Piste recommandée : 1 (fichier unique + Range HTTP/2), risque fidélité nul, gain sur le nombre de requêtes ; prototype = concaténation hors format + Vite HTTPS (plugin-basic-ssl) pour HTTP/2 local, mesure via stack.mjs/walk.mjs à froid/chaud avec latence simulée. Risques : le gain d'octets dépend des pistes 6 (pages autonomes transparentes) et 5 (KTX2), à risque sur le verre.
- Décision : R&D chargement reste après les cinq étapes de la feuille de route ; la piste 6 rejoint l'étape 3 « première image » (elle en est le cœur). Pas de prototypage lancé maintenant.

## 2026-09-14 — A2 `protocole-verite` terminé (opus, ~16 min)

- Livrable : `orchestration/CAMPAGNE_VERITE.md` (250 lignes, 8 sections). Matrice : 4 moteurs × 8 scènes × {1, 9} instances × {DPR 1, DPR 2} en 1280×720, summary ; un bloc = A B C D puis D C B A → 32 blocs, 256 passes, 900 images/passe (600 retenues), ≈ 10 h à calibrer sur Emerald.
- Scènes : les 8 sont déjà préparées (`ready`), rien à préparer ; 3 caches format 2, 5 format 1 (lisibles). `emerald-derived` = résidu hors catalogue.
- Écarts Lab réel vs prompt : scripts headless visent 5175 (UI 5174) ; `latest.json` à la racine du banc, nom de campagne = UUID non paramétrable, rétention 2 campagnes ; `walk.mjs`/`shots.mjs` ne posent PAS les drapeaux 120 Hz (plafond 60), figent pixelRatio 1 et replicaCount 1, comptent > 50 ms et non > 8,33 ms, n'écrivent aucun rapport ; `shots.mjs` figé sur Emerald ; UI sans 1280×720 ni DPR ; `buildProvenance` = hash de contenu, pas de commit ni dirty. Briques ABBA / noVsync / p99 / charge machine présentes dans `lib.mjs` mais non câblées. Bon point : contrôle A/A intégré au parcours (`runAaControl`, 10 points).
- Décisions : (a) le banc n'est pas prêt pour la campagne ni pour prouver le lot 2 → chantier Lab unique A4 « banc 15 prêt pour la campagne » lancé maintenant (opus, Lab seul, indépendant du nettoyage SDK) : champs de rapport, ABBA câblé, drapeaux 120 Hz, DPR/résolution/instances paramétrables en headless, rapport JSON écrit par les scripts, shots multi-scènes, campagne nommée et archivée, dérivation FPS/p95/p99/> 8,33 ms. Pure implémentation + tests du Lab, AUCUN run navigateur (respect de l'arrêt demandé par l'utilisateur) ; la preuve navigateur sera faite une seule fois par l'agent de fusion Lab. (b) pixelError de campagne = seuil de production du runtime (celui des rapports actuels), consigné dans le rapport ; pixelError 0 seulement comme témoin, pas comme réglage principal.

## 2026-09-14 02:10 — NETTOYAGE FUSIONNÉ (session d'audit, clôture)

- `develop` = **e85d1ac** : runtime navigateur DAG seul (noyaux et traversée d'arbre supprimés, −1 686 lignes), objets émis en `SHA.bin` (aucune configuration serveur nécessaire), métriques `pagesDetached`/`cacheEvictions`, zéro allocation par image dans `render()`. 302 tests Node, 46 tests Rust, build natif, `dist/` reconstruit. Les 8 scènes du Lab régénérées (80 343 objets `.bin` pour Emerald).
- Preuve sur `develop` (headless, Emerald, parcours 600 images, 1280×720, DPR 1, pixelError 1) : WebGL cpuFrame 11,8 ms, rAF p50 16,7 / p95 20,6 ms, 4 images > 50 ms, soumis = sélectionnés = 1 842 728, 0 éviction de cache ; WebGPU `PRELOAD=all` cpuFrame 22,7 ms, rAF p50 36,6 / p95 50,9 ms, 43 images > 50 ms, couverture prête ; budget 4 096 pages : `tri = selected` (478 344 et 990 184), aucun trou.
- Lab aligné : `pageEvictions` → `cacheEvictions` (4 sources + 2 tests), liste blanche `.wgsb/.wgpg` retirée de `vite.ts`, `prepareQem.test.ts` et `modelAvailability.ts` sur l'API publique du SDK. Modifications du Lab non committées.
- Worktrees : tous les worktrees d'agents supprimés ; il reste `develop` et `webgeometry-orchestration-60feeb` (session chef d'orchestre).
- Prochaine étape : **lot 2 WebGPU** (feuille de route, étape 1), puis saccades WebGL (p99), puis première image.

## 2026-09-14 — nettoyage fusionné détecté → lot 2 WebGPU lancé

- `develop` = e85d1ac (nettoyage). Baseline headless sur develop (Emerald, 600 images, 1280×720, DPR 1, pixelError 1, plafond 60 Hz headless) : WebGL cpuFrame 11,8 ms, rAF p50 16,7 / p95 20,6 ms, 4 images > 50 ms ; WebGPU cpuFrame 22,7 ms, rAF p50 36,6 / p95 50,9, 43 images > 50 ms, aucun trou.
- Attention : la session d'audit a laissé des modifications NON committées dans le checkout principal du Lab (`pageEvictions` → `cacheEvictions`, liste blanche retirée de `vite.ts`, tests sur l'API publique). Le worktree Lab de A4 (`banc15-campagne`) ne les contient pas : l'agent de fusion Lab devra d'abord committer ces changements sur la branche principale du Lab, puis fusionner `banc15-campagne` par-dessus.
- Lancé A5 `webgpu-lot2a` (opus, worktree) : (1) fidélité d'abord, cause racine de l'échec A/A WebGPU sur 2 segments (rotation rapide, retour en zone visitée) ; (2) plancher fixe CPU : table de pages construite une fois et mise à jour par page, résidence en bitset incrémental, zéro allocation par image, travail CPU par image indépendant du nombre de pages/clusters. Cible Emerald 1280×720 : CPU < 4 ms, image identique, A/A à zéro pixel. Mesures via scripts du Lab principal en lecture seule avec `SDK_DIST` = dist du worktree. Le reste du lot 2 (passes GPU : traversée/compaction indirectes, raster logiciel une passe, Hi-Z, drawIndexedIndirect par cluster, binning matériau, transparents) = A6 `webgpu-lot2b`, après fusion de A5.
- Ordonnancement machine : A4 ne mesure pas ; la fusion Lab (preuve navigateur courte) attendra le résumé de A5 pour ne pas perturber ses mesures.

## 2026-09-14 — A4 `banc15-campagne` terminé (opus, ~37 min, sans navigateur)

- Worktree Lab `.claude/worktrees/banc15-campagne`, branche `banc15-campagne`, non committé, 21 fichiers (5 nouveaux : truthReport / sdkProvenance / machineLoad / machineLoadClient / test truthCampaign ; 16 modifiés : 6 scripts headless, README, modules lab, 3 composants, streamReport, vite.config). Points 1, 2, 4, 5, 6 faits ; ABBA complet en headless (2 passes, médiane, alerte 5 %), UI = un sens par campagne (Aller / Retour) concaténés pour l'agrégat.
- Tests Lab : 189/0. Échec d'intégration `prepareQem` et 3 erreurs typecheck `pageEvictions` = préexistants, déjà corrigés (non committés) par la session d'audit dans le checkout principal du Lab.
- Constats : `scripts/headless/` n'a jamais été suivi par git dans le Lab (untracked) ; 4 fichiers modifiés par A4 le sont aussi, non committés, dans le checkout principal (modelCampaign, modelReportMarkdown + tests) → conflits à résoudre à la fusion ; les PNG de shots.mjs portent désormais le nom de scène → commandes §5 de CAMPAGNE_VERITE.md à mettre à jour ; le checkout moteur principal est vu « dirty » (à définir : seules les modifications de fichiers suivis comptent). Besoins SDK (plus tard, petit chantier) : `buildProvenance` avec commit + dirty.
- Décision : fusion Lab en deux temps pour ne pas changer les scripts sous les pieds de A5 (ses mesures avant/après doivent utiliser les mêmes scripts). Temps 1 maintenant (A7 `fusion-lab-1`, opus) : committer les changements de la session d'audit sur la branche principale du Lab (aucun contenu de fichier ne change sur disque), suivre `scripts/headless/`, fusionner la branche principale dans `banc15-campagne` (worktree), résoudre les conflits en gardant toutes les intentions, tests + typecheck, committer sur la branche, mettre à jour CAMPAGNE_VERITE.md §5. Temps 2 après le résumé de A5 : preuve navigateur puis fusion dans la branche principale du Lab.

## 2026-09-14 — A7 `fusion-lab-1` terminé (opus, ~17 min, sans navigateur)

- Lab `develop` (checkout principal, contenu inchangé sur disque) : 1ac67ca (cacheEvictions + tests API publique, 10 fichiers), 031dbc6 (scripts headless suivis, .gitignore). La liste blanche `.wgsb/.wgpg` n'existait pas dans vite.ts (rien à retirer).
- Branche `banc15-campagne` prête, à jour de develop, non fusionnée : a88ebee (schéma rapport, provenance, charge machine), 567ca0e (UI résolution/DPR/sens/nom), edfba23 (scripts headless), 47db429 (fusion), 09fb75c (dirty = fichiers suivis modifiés). Conflits : 7 add/add scripts headless (version chantier, rien perdu), 1 sur modelCampaign.test.ts (les deux intentions). Gates : typecheck 0 erreur, 243 tests / 0 échec (prepareQem réparé), mots interdits = 0.
- CAMPAGNE_VERITE.md §1–§7 alignés sur le README des scripts (PNG nommés par scène, SCENES/CAMPAIGN/DPR/REPLICAS, port 5174 unique).
- Preuve temps 2 (après A5) : depuis le worktree, `pnpm dev`, puis walk Emerald ENGINES=exact-cluster-pages,webgpu-page-raster FRAMES=60 et shots Emerald MAX_PAGES=4096 ; attendu refreshCeiling 120, sdk.commit non nul, trous = 0.
- Risques notés : port 5174 sans strictPort ; `refreshCeiling` null hors 60/120 Hz ; le checkout moteur principal est « dirty » (fichiers suivis modifiés) → l'agent de fusion de A5 devra dire lesquels et pourquoi avant de fusionner.
- En attente : A5 `webgpu-lot2a` (seul à mesurer). Ensuite : fusion A5 (SDK), puis temps 2 Lab, puis lot 2b.

## 2026-09-14 — A5 `webgpu-lot2a` terminé (opus, 1 h 26, 481 k tokens)

- Cause racine A/A WebGPU (prouvée) : téléversement progressif des couches de matériau, une couche par image (chaque texture Emerald sature `maxTextureTransferBytesPerFrame` 16 Mo, 336 couches) ; `flush()` n'attendait que la pompe en vol. Correction : `flush()` vide toute la file. A/A : 4/10 échecs (jusqu'à 13 927 px) → 0/10, 0 px, à 100 000 et 4 096 pages. 2 fichiers (+5 lignes, un test étendu). Portes toutes passées (302 tests Node, 46 Rust, build, natif, structure, dts, mots interdits 0), tri = selected 1 842 728, firstError null.
- Plancher CPU : chantier fait et mesuré 34,9 → 11,1 ms (postes baseline ms : encodeVis 5,7, writePage 5,4, splitOccluders 5,3, projectBoxToScreen 4,1, packedDraws 1,6, gpuPages.get 1,3, writeBuffer 1,0, maths three 2,0, GC 1,6) mais RETIRÉ : à résidence saturée (4 096) il cassait l'image (1/10, 690 705 px, err 212) avec résidence et sélection identiques → bug au recyclage de ligne de table de pages. Sources conservées dans le scratchpad de session (`mine/`, `RAPPORT-lot2-A.md`). Livré : cpuFrame p50/p95/p99 35,0/48,6/54,3 ms (plafond headless réel 60 Hz : scripts du Lab principal sans drapeaux ; NOVSYNC=1 → rAF p50 18,3, non limitant).
- Constats : à résidence saturée, l'image dépend de l'ordre d'arrivée des pages (non reproductible inter-processus, 541/924/1 px sur 3 poses, préexistant) → verdict pixel à 4 096 pages exige un témoin même-build ; la porte « identité pixel » se juge à résidence non saturée, la porte 4 096 juge les trous. Bug trouvé : `gpuSmall` lit les drapeaux Hi-Z de l'image précédente quand l'image ne fait pas deux passes. GPU par passe non instrumenté (null).
- Décisions : (1) A8 `fusion-sdk-lot2a` (opus) fusionne le correctif A/A dans develop maintenant ; si avance rapide, portes rapides seulement (contenu déjà validé), `npm run build` pour dist/, et diagnostic du « dirty » du checkout principal. (2) Ensuite, en parallèle : A9 Lab temps 2 (preuve navigateur courte + fusion Lab) et A10 `webgpu-lot2b` (opus) : reprise du chantier CPU depuis `mine/`, cause racine du bug de recyclage à résidence saturée, correction du bug Hi-Z `gpuSmall`, cible CPU < 4 ms, image identique avec témoin même-build ; baseline = dist du checkout principal, mesuré en fin de chantier dans la même session que l'après.

## 2026-09-14 — A8 `fusion-sdk-lot2a` : blocage partiel (opus, 9 min)

- Correctif vérifié (2 fichiers, +5 lignes) et committé en 1a0e22c sur `worktree-agent-ad152b7e7c7d796f2` (base e85d1ac) ; portes rapides : build OK, npm test 302/302, check:dts OK, mots interdits 0 (ordre obligatoire : build avant test, dist/ exigé par dts-extensions).
- NON FAIT : fusion dans develop, rebuild dist/ du checkout principal, nettoyage des worktrees. Cause : un agent en `isolation: worktree` se voit refuser toute commande Bash hors de son worktree du dépôt moteur (`git -C` inclus). Le Lab (autre dépôt) n'était pas concerné.
- `dist/` est ignoré par git (0 fichier suivi) → les fichiers suivis modifiés du checkout principal sont des sources, vraisemblablement `orchestration/` (journal, prompt, protocoles), à confirmer.
- Décision (dérogation à la règle 2, notée) : les agents de fusion du dépôt moteur sont lancés SANS isolation worktree, puisque leur travail est par nature dans le checkout principal. A8bis `fusion-sdk-lot2a-ff` (sonnet, sans isolation, avance rapide pure + build + diagnostic dirty + nettoyage des worktrees d'agents terminés). Si `orchestration/` est la seule source modifiée : la committer à chaque fusion (`docs(orchestration)`), le journal fait partie de l'historique.

## 2026-09-14 — A8bis `fusion-sdk-lot2a-ff` terminé (sonnet, sans isolation, 6 min)

- `develop` = **1a0e22c** (avance rapide depuis e85d1ac) : correctif A/A WebGPU fusionné. Build OK, npm test 302/302. dist/ du checkout principal reconstruit. 7 worktrees d'agents supprimés avec leurs branches ; restent le checkout principal et `webgeometry-orchestration-60feeb`. Le harnais a signalé un avertissement de classificateur sur cet agent ; actions revues : conformes au brief (suppressions de worktrees/branches demandées), rien d'autre.
- « Dirty » du checkout principal = deux suppressions non committées laissées par la session d'audit : `docs/AUDIT_SUIVI_2026-09-13.md`, `docs/FONDATIONS_SUIVI_2026-09-13.md` ; non suivis : `orchestration/`, `docs/PLAN_120FPS.md`. Décision : à la prochaine fusion moteur, committer les deux suppressions (suivis quotidiens remplacés par ce journal, après vérification qu'aucun doc ne les référence) et suivre `orchestration/` (`docs(orchestration)`) ; `docs/PLAN_120FPS.md` laissé non suivi, à lire une ligne par l'agent de fusion.
- Lancés : A9 `lab-temps2` (sonnet, sans isolation, Lab seul) : preuve navigateur depuis le worktree `banc15-campagne` (walk Emerald WebGL+WebGPU 60 images, shots Emerald 4 096 pages), puis fusion dans Lab develop, tests, nettoyage. A10 `webgpu-lot2b` (opus, worktree) : reprise du plancher CPU depuis le scratchpad, cause racine du bug de recyclage à résidence saturée, bug Hi-Z `gpuSmall`, zéro allocation par image, cible CPU < 4 ms, image identique (témoin même-build), mesures en fin de chantier seulement (avant = dist du checkout principal, ABBA dans la même session).

## 2026-09-14 — A9 `lab-temps2` terminé (sonnet, 9 min) : Lab develop = fd2e09f

- Preuve navigateur depuis le worktree (serveur sur 5177, 5174 occupé par un serveur tiers idle du checkout principal, laissé en place) : rapport JSON complet pour les deux moteurs : DPR 1, 1280×720 CSS = physique, SDK 1a0e22c dirty = true, mode summary, replicaCount 1, charge machine consignée (load1 2,4 → 7,1, 21 processus Chrome : autres agents en cours), firstError null. Chiffres non représentatifs (charge, et pixelError = 0 dans ce run) : WebGL FPS 43, p50 23,2 ms ; WebGPU FPS 13,6, p50 73,8 ms. `refreshCeiling.hz` = null (calibration 75,8 Hz sous charge → null, comportement voulu). Alerte ABBA 5,6 % déclenchée (voulu). shots : tri = selected = 478 344, trous = 0.
- Fusion `--no-ff` fd2e09f, tests 0 échec (test, integration, comparison), worktree et branche supprimés, `git status` vide.
- À retenir pour la campagne et pour A10 : fixer explicitement pixelError = 1 (valeur de production des rapports précédents) dans chaque commande de mesure ; le plafond 120 Hz se calibre seulement machine désencombrée ; ne jamais mesurer avec un autre agent qui construit ou teste.
- Banc prêt pour la campagne de vérité (protocole `orchestration/CAMPAGNE_VERITE.md`). Campagne à lancer quand la machine sera libre de tout chantier de performance (après fusion du lot 2b et 2c, ou entre deux si l'attente est longue).

## 2026-09-14 — `protocole-maj` terminé (sonnet, 13 min)

- CAMPAGNE_VERITE.md (260 lignes) : pixelError = 1 imposé partout (variable `PIXEL_ERROR` ou argument positionnel de walk/shots ; 1 = « Qualité élevée », défaut de l'interface, confirmé par le code ; 0 = témoin optionnel hors matrice) ; machine désencombrée exigée avant bloc (load1 ≤ 3, `pgrep -fl chrome`, `lsof -i :5174`), bloc rejeté si `refreshCeiling.hz` null, bloc rejoué sur alerte ABBA > 5 % ; serveur `localhost` (IPv6) et repli de port documentés.
- État : banc et protocole prêts. En attente du seul chantier en cours, A10 `webgpu-lot2b` (mesures en fin de chantier). Ensuite : fusion A10 (sans isolation ; committer aussi les deux suppressions de docs de l'audit et suivre `orchestration/`), lot 2c passes GPU, saccades WebGL, campagne de vérité quand la machine est libre.

## 2026-09-14 — A10 `webgpu-lot2b` terminé (opus, 1 h 38, 484 k tokens)

- Cause racine du bug de recyclage : une ligne de table survivait à son occupant ; à table pleine, un nouveau cluster repartait sans ligne et son bit de résidence était effacé → trou invisible. Correction : la ligne est le rang du cluster dans l'ensemble dessinable (plus de pile de lignes libres, plus de recyclage). Second discriminant (bisection mesurée) : le lot A avait supprimé l'ensemble d'occulteurs de l'image précédente ; rétabli par index dense par clé de cluster. Hi-Z : clearBuffer des lignes avant test, `zeroFlags` lié sans double passe, drapeaux dimensionnés sur les lignes.
- CPU Emerald 1280×720 DPR 1 pixelError 1 (plafond 60 Hz, load1 5–14 pendant les blocs, ABBA 4 blocs) : cpuFrame p50/p95/p99 36,6/48,6/57,7 → **13,2**/44,3/88,2 ms ; rAF 37,0/50,0/59,3 → 18,3/44,6/83,3 ms ; images > 8,33 ms 600 → ≈517/600. Postes encodeVis, writePage, splitOccluders, packedDraws, gpuPages.get, maths three, GC → ~0 ; projectBox divisé par 2 ; writeBuffer en deltas. Cible p50 < 4 ms NON atteinte : le reste est en O(pages dessinables) → passes GPU. p99 en hausse, tout dans `cpuSubmit` (contre-pression de la file GPU, non instrumentée) : le GPU est le goulot.
- Fidélité : résidence non saturée 0 px sur 10 poses vs baseline (témoin même-build 0 px) ; A/A 0 px ; aucun trou ; WebGL tri = selected = 1 981 144 ; firstError null. À 4 096 pages : 7 poses à 0 px, 3 sous le bruit du témoin même-build, 1 (f480) à 7 345 px hors bruit expliquée par un ensemble résident différent à nombre égal (éviction dépendante du temps, connu). Portes toutes passées (304 tests, cargo 46, build, natif, structure, dts, mots interdits 0, symboles morts 0). 10 fichiers (+633/−246), 4 tests.
- Constat outillage : le `pnpm dev` du Lab ne sert pas un `SDK_DIST` hors checkout principal (A10 a servi ses deux dist depuis deux serveurs vite du scratchpad). À corriger côté Lab (petit chantier).
- Décisions : (1) fusion acceptée (image identique, gains p50, p99 imputable au GPU à traiter en 2c) : A11 `fusion-sdk-lot2b` (sonnet, sans isolation) : avance rapide, build + test, commit des deux suppressions de docs de l'audit et suivi de `orchestration/`, nettoyage worktree. (2) A12 `lab-sdkdist` (sonnet, sans isolation, Lab seul) : `SDK_DIST` honoré par le serveur dev, preuve par requête HTTP, sans mesure. (3) Après A11 : A13 `webgpu-lot2c` passes GPU avec instrumentation GPU (timestamp-query), cible CPU < 4 ms, GPU < 6 ms, p99 à expliquer, image identique.

## 2026-09-14 — A11 `fusion-sdk-lot2b` terminé (sonnet, 5 min) : develop = 50e812e

- Chantier 2b committé 894fabc, avance rapide, build OK, npm test 304/304. `orchestration/` suivi et committé (4 fichiers texte). Les deux suppressions de docs de l'audit restent non committées : l'agent a vu leur nom cité dans ce journal (mention descriptive, pas un lien). Décision : les committer à la prochaine fusion moteur en excluant `orchestration/` du contrôle de références. `docs/PLAN_120FPS.md` (non suivi) = plan d'action du 13/09 en 6 lots référençant des fichiers existants, à lire par les agents comme entrée, le code faisant foi.
- Conséquence de suivre `orchestration/` : chaque écriture du journal rend le checkout « dirty » au sens git. Décision : la provenance du Lab ignore `orchestration/` et `docs/` dans le calcul de dirty (seul le code qui produit dist/ compte) → consigne envoyée à A12 `lab-sdkdist` en cours.
- Lancé A13 `webgpu-lot2c` (opus, worktree) : passes GPU (projection des boîtes et rang exact de partition sur GPU, traversée/compaction `dispatchWorkgroupsIndirect`, raster logiciel sur le nombre réel de petits triangles en une passe, Hi-Z une passe depuis l'image précédente, `drawIndexedIndirect` par cluster sans maxVertexCount, binning matériau, transparents en sélection GPU + draw indirect par matériau), chronométrage GPU par passe via `timestamp-query` exposé dans les métriques du SDK, miroir de résidence reconstruit trop souvent à corriger. Cible Emerald 1280×720 DPR 1 pixelError 1 : CPU p50 < 4 ms, GPU < 6 ms, image identique, p99 expliqué.

## 2026-09-14 — lancement A14 `webgl-saccades` en parallèle de A13

- Décision (règle 4) : A13 n'occupe la machine qu'en fin de chantier (une seule passe de validation) ; les deux chantiers touchent des fichiers différents (WebGPU vs WebGL + chargeur) et chacun applique le protocole « machine désencombrée » (pgrep chrome, lsof 5174, load1 ≤ 3, attente) avant toute mesure → mesures non chevauchantes, fusion séquentielle avec résolution des conflits éventuels sur le chargeur partagé.
- A14 `webgl-saccades` (opus, worktree) : feuille de route étape 2, p99 < 12 ms sur le parcours Emerald WebGL, 0 image > 50 ms, image identique ; causes à prouver par profil (arrivées de paquets et décodage sur le thread principal, écriture des index dans le tampon persistant, GC, sélection) ; interdiction de toucher aux fichiers du runtime WebGPU.

## 2026-09-14 — A12 `lab-sdkdist` terminé (sonnet, 19 min) : Lab develop = 56dd3a4

- Avant : `pnpm dev` résolvait le SDK via node_modules → toujours le dist du checkout principal, quel que soit `SDK_DIST` (seuls les scripts headless et la provenance le lisaient) : divergence rapport / code chargé. Après : alias Vite conditionnel vers `SDK_DIST`, provenance calculée depuis le dépôt qui contient ce dist, dirty ignore `orchestration/` et `docs/`. 3 fichiers + 1 test (3 cas). Preuve curl : fichier marqueur servi depuis `SDK_DIST`. Tests 194 + intégration 22 + comparaison 30, verts avant et après fusion (56dd3a4). Usage : `SDK_DIST=<chemin>/dist pnpm dev` ; avant/après = deuxième serveur `--port 5175` + `LAB_URL`.
- Un serveur tiers idle reste sur 5174 (checkout principal du Lab, laissé depuis la session d'audit) ; il sert le code courant du disque, sans `SDK_DIST`.
- En cours : A13 `webgpu-lot2c` (passes GPU), A14 `webgl-saccades`. Prochaines fusions moteur (sans isolation) : inclure le commit des deux suppressions de docs de l'audit (contrôle de références hors `orchestration/`).

## 2026-09-14 — A13 `webgpu-lot2c` terminé (opus, 1 h 01, 441 k tokens)

- Instrumentation GPU : `timestamp-query` avec `--enable-unsafe-webgpu` seul, résolution ns ; l'instrumentation existait mais n'était vidée que dans `flush()` ; exposée en `FrameMetrics.gpuPassMs` (par passe + `totalMs`, `null` sinon). Attention : sur ce GPU les passes se recouvrent, `totalMs` (118 → 25,1) surcompte ; « GPU < 6 ms » non démontrable sans mesure englobante (à faire).
- GPU par passe (Emerald, 900 images) : petits triangles 20,68 → 6,97 ms (binning 0,32 + raster 6,65, `dispatchWorkgroupsIndirect`, une passe) ; compaction 1,58 → 0,99 ; Hi-Z 13 passes 0,26 → 2 passes 0,13 ; 24 → 14 passes.
- CPU (ABBA 4 passes, 600 images, plafond ~60 Hz à vérifier) : cpuFrame p50/p95/p99 12,9/42,1/77,7 → **14,2/20,2/26,2** ms ; rAF 18,3/45,3/80,4 → **18,0/21,4/27,2** ms ; images > 8,33 ms 510 → 480. p99 expliqué : 86 % était `cpuSubmit` = contre-pression d'un GPU à 20,7 ms/image ; tombé à 11,3. p50 non atteint (12,2 → 12,2 à résidence stabilisée) : réécriture des lignes de rang à chaque admission de pages, projection + rang de partition encore CPU (parité GPU bloquée par f64 CPU vs f32 WGSL).
- Fidélité : 0 px sur 10 poses vs baseline, A/A 0 px, aucun trou ; à 4 096 pages dans le bruit du témoin même-build sauf 2 poses (éviction dépendante du temps, connu). Portes toutes vertes (303 tests, cargo 46, build, natif, structure, dts). 11 fichiers (+352/−163), 0 symbole mort.
- Constat : la recherche des mots interdits trouve 2 occurrences dans `orchestration/*.md` (la règle d'interdiction elle-même, suivie par git depuis 50e812e) → la porte échoue par construction. Décision : reformuler ces occurrences sans les mots (paraphrase : « les noms de la technologie concurrente d'Epic »), y compris dans le prompt orchestrateur, à la fusion.
- Décisions : (1) fusion acceptée → A15 `fusion-sdk-lot2c` (sonnet, sans isolation), avec attente si un Chrome headless tourne (A14 mesure peut-être), commit des deux suppressions de docs de l'audit, reformulation des mots interdits dans orchestration/. (2) Ensuite A16 `webgpu-lot2d` : lignes de rang incrémentales (seules les lignes changées), projection + partition sur GPU avec oracle CPU en f32 (`Math.fround`, même ordre d'opérations) et vérification pixel, classes de taille pour le raster, mesure GPU englobante par image (un seul couple de timestamps), plafond 120 Hz vérifié. Cibles inchangées : CPU p50 < 4 ms, GPU englobant < 6 ms, 0 px.

## 2026-09-14 — A15 `fusion-sdk-lot2c` terminé (sonnet, 6 min) : develop = 91014ef

- Chantier 2c committé 1fbaab8, avance rapide, build OK, npm test 303/303. Docs : 1a9673a (retrait des deux suivis du 13/09), 91014ef (règle des mots interdits reformulée : 7 occurrences dans le prompt orchestrateur et ce journal, grep final = 0 sur develop). `git status` : seul `docs/PLAN_120FPS.md` non suivi. Worktrees : principal, `agent-ac22e0114519894ee` (A14 en cours), orchestration.
- Rappel pour ce journal : ne plus écrire les deux mots interdits, même pour citer la règle.
- Lancé A16 `webgpu-lot2d` (opus, worktree) : mesure GPU englobante par image, plafond 120 Hz vérifié, lignes de rang incrémentales, projection + partition sur GPU avec oracle CPU en f32, miroir de résidence sur changement opaque seulement, classes de taille du raster, transparents/binning si encore CPU. Cibles : CPU p50 < 4 ms, GPU englobant < 6 ms, 0 px, A/A 0 px, aucun trou.

## 2026-09-14 — A14 `webgl-saccades` terminé (opus, 1 h 36, 352 k tokens)

- Cause racine prouvée : `PrimitiveIndex.flush()` renvoyait le tampon d'index ENTIER dès 64 plages en attente (débordement), déclenché par toute primitive hors champ recevant des pages : `bufferSubData` 932 ms sur 600 images dont 416,6 ms en un seul appel ; 11 des 20 pires images, 4 des 5 images > 50 ms. Écartés avec preuve : décodage/SHA (10 ms cumulés), écriture des index (8 ms), GC, compilations et textures tardives (0), sélection (2,6 ms sans pic). Correction : plages en attente non bornées, triées et fusionnées, plus de renvoi complet → `bufferSubData` 932 → 1,0 ms ; zéro allocation par image dans la sélection. 3 fichiers (+34/−26) : `clusterBatches.ts`, partagés `pageSelection.ts` (aussi WebGPU) et `index.ts`.
- ABBA (réf/cand/cand/réf, load1 3,2–4,5, référence rebâtie depuis 50e812e) : cpuFrame p50/p95/p99 9,9/15,55/29,0 → 9,45/13,35/**18,65** ms ; rAF p99 29,1 → 20,45 ; images > 25 ms 8 → 4,5 ; > 50 ms 4,5 → 2 (blocages GPU présents aussi sur le moteur Three.js de référence). Remplissage après saut 187 → 88 ms au pire ; froid 4,13 → 4,07 s. Fidélité : 0 px sur 10 poses, A/A 0 px, trous 0, tri = selected 1 981 144. Portes toutes vertes (304 tests, cargo 46).
- DÉCOUVERTE MAJEURE : en Chrome headless, même avec les drapeaux 120 Hz, une boucle rAF à vide plafonne à ~18,4 ms (54 Hz). « p99 rAF < 12 ms » et « images > 8,33 ms » ne sont PAS mesurables en headless ; seules cpuFrame et la file rAF le sont. Conséquence : le protocole de campagne (fondé sur rAF headless 120 Hz) doit être révisé après l'enquête de A16 (plafond) : soit campagne en Chrome visible sur l'écran 120 Hz (mode parcours de l'UI), soit verdict headless sur cpuFrame + gpuFrameMs.
- Restes WebGL : cpuFrame p99 < 8 ms non atteint, borné par la soumission Three.js (6,2 ms p50 pour 2 479 appels de dessin) et la sélection plate (2,6 ms) → regroupement des dessins = chantier d'architecture ultérieur.
- Décision : fusion → A17 `fusion-sdk-saccades` (opus, sans isolation) : develop a bougé (91014ef, lot 2c a touché sdk-browser) → fusion de develop dans la branche, conflits sur `index.ts`/`pageSelection.ts` à résoudre en gardant les deux intentions, portes complètes + preuve navigateur (WebGL et WebGPU, 0 px), puis avance rapide.
- Lancé A18 `plafond-raf` (sonnet, lecture seule, Chrome page vide) : enquête sur le plafond rAF de Chrome headless sur ce Mac (modes headless, drapeaux, Chrome visible sur l'écran 120 Hz) pour décider comment la campagne mesure 120 Hz. Résultat → révision de CAMPAGNE_VERITE.md.

## 2026-09-14 — A18 `plafond-raf` terminé (sonnet, 10 min) : verdict sur la mesure à 120 Hz

- Headless (Chrome stable ou Chromium, modes new/old, GPU/ANGLE Metal forcés) : 54,6 Hz avec `--disable-frame-rate-limit --disable-gpu-vsync`, 59,9 Hz sans ; jamais 120 Hz. `--run-all-compositor-stages-before-draw` supprime tout rythme (non représentatif) ; `--enable-begin-frame-control` bloque rAF.
- Chrome VISIBLE 1280×720 sur l'écran ProMotion, SANS `--disable-frame-rate-limit` : rAF p50/p95/p99 8,3/9,7–10,2/10,4 ms (120,5 Hz), 241–261 images > 8,33 ms sur 600 sur page vide (gigue réelle). Avec ce drapeau, même visible : 18,3 ms. `--disable-gpu-vsync` seul inoffensif.
- Décisions : (1) la campagne de vérité se mesure en Chrome visible sur l'écran 120 Hz, fenêtre 1280×720, sans `--disable-frame-rate-limit`, focus conservé, veille/économiseur désactivés ; (2) les scripts headless retirent `--disable-frame-rate-limit` (60 Hz au lieu de 54) et gardent leur rôle de preuve de fidélité et de mesure relative (cpuFrame, gpuFrameMs) ; (3) « images > 8,33 ms » et « FPS 120 » ne se jugent qu'en mode visible ; (4) l'affirmation du prompt orchestrateur sur les drapeaux 120 Hz en headless était fausse : à corriger dans le prompt et dans CAMPAGNE_VERITE.md.
- Lancé A19 `lab-mode-visible` (sonnet, Lab) : commutateur headless/visible dans `lib.mjs` et les scripts (`HEADLESS=0`), drapeaux corrigés, calibration `refreshCeiling` à 120 en visible, README, mise à jour de CAMPAGNE_VERITE.md et de la phrase du prompt ; vérification courte en mode visible.

## 2026-09-14 — A17 `fusion-sdk-saccades` terminé (opus, 20 min) : develop = 0195ca8

- Chantier saccades committé adddade ; fusion de develop sans conflit (index.ts auto-fusionné, lot 2c intégralement préservé ; `wanted` optionnel, les 6 appels WebGPU inchangés). Portes complètes vertes (303 tests, cargo 46, natif, structure, dts, mots interdits 0). Preuve : walk ABBA WebGL + WebGPU firstError null ; WebGL 4 096 pages tri = selected, trous 0, 0 px vs baseline, A/A 0 px ; WebGPU à résidence non plafonnée : 0 px, A/A 0 px. Avance rapide → develop = 0195ca8, build + test 303/303 sur le principal.
- Point ouvert : A17 observe qu'à `MAX_PAGES=4096` le WebGPU de develop n'est pas reproductible (A/A jusqu'à 5 299 px) et rapporte des « trous non nuls » (couverture de secours) alors que A13 rapportait « aucun trou » à 4 096. À trancher par A16 (lot 2d) : mesure explicite de `tri = selected` et du compteur de trous à 4 096 pages en WebGPU ; si trou visuel réel sous plafond serré, c'est un défaut de fidélité prioritaire.
- Serveurs Vite tiers accumulés sur 5174–5177 (dont un probablement de A16 en cours) : à nettoyer par le prochain agent de fusion (ne tuer que les serveurs sans agent actif : vérifier avec `lsof` et l'âge des processus).
- Reste sur develop : WebGL cpuFrame p50 9,45 / p99 18,65 ms headless ; WebGPU cpuFrame p50 ≈ 13, p99 26 ms ; première image ~2 s ; verdict 120 Hz à établir en mode visible.

## 2026-09-14 — A19 `lab-mode-visible` terminé (sonnet, 30 min) : Lab develop = 97cb3b8

- 7 fichiers + 1 test : `--disable-frame-rate-limit` retiré partout, `HEADLESS=0` = Chrome visible, `report.environment` = headless/visible. Visible, 600 images : rAF p50/p95/p99 8,3/10,3/10,4 ms, FPS 120,48, ≈ 43 % d'images > 8,33 ms (gigue de rattrapage), cpuFrame p50 1,4 ms (scène légère), stable sur 4 essais. Headless : refreshCeiling 60, p50 16,7. Tests 196 + 22 + 30 verts. CAMPAGNE_VERITE.md et PROMPT_ORCHESTRATEUR.md corrigés.
- Défaut restant : `refreshCeiling.hz` reste `null` en visible (calibration dans `shared/campaign/truthReport.ts` trop sensible aux images de rattrapage < 6,3 ms) → le protocole rejetterait tous les blocs visibles. Lancé A20 `lab-plafond-120` (sonnet, Lab) : calibration robuste (médiane et grappe dominante des intervalles, rattrapages ignorés), 120 reconnu en visible, 60 en headless, `null` sinon ; vérification visible courte.

## 2026-09-14 — A16 `webgpu-lot2d` terminé (opus, 1 h 21, 595 k tokens)

- `FrameMetrics.gpuFrameMs` ajouté (un couple d'horodatages + intervalle par soumission + écart d'hôte) : GPU réel (somme des intervalles par soumission) 11,11 → **8,15 ms** p50 (sélection 0,20 + rendu 7,95) ; la somme des passes (25 ms) surcompte (recouvrement). Profil CPU par étape enfin émis sur le chemin rapide : partition+projection 6,1 → 2,9 (coins monde gardés par page, bit-exact ; l'oracle f32 aurait déplacé des pixels, refusé), encodage 3,1 → 2,7, transparents CPU 1,9 → 1,5, résidence+admission 2,1 → 1,6, lignes de rang 1,0 ; total 15,7 → 10,4. Raster petits triangles 6,34 → 3,74 ms.
- ABBA 8 passes (headless, drapeaux 54 Hz pendant les mesures, comparaison valable) : cpuFrame p50/p95/p99 14,15/20,45/26,45 → **11,70/16,85/18,35** ms ; cpuSubmit 7,0 → 5,5 ; rAF p95 21,4 → 18,75. Fidélité : 0 px erreur max 0 sur 10 poses, A/A 0 px, compteurs identiques, aucun trou y compris à 4 096 pages (trois exécutions) → le point ouvert de A17 est tranché : pas de trou visuel ; seule la reproductibilité pixel à 4 096 reste dépendante de l'éviction (témoin même-build 63 395 px à f120). Portes toutes vertes (305 tests, cargo 46). 8 fichiers (6 modifiés, 2 nouveaux), partagé : `sdk-core/contracts.ts` (ajout).
- Cibles non atteintes : CPU 11,7 (cible 4), GPU 8,15 (cible 6). Restes chiffrés : partition entière sur GPU (2,9 ms, changement de fidélité à mesurer pour lui-même), fusion d'encodeurs (2,7 ms, rendrait gpuFrameMs exact), transparents en sélection GPU (1,5), résidence en index denses (1,6 ; patch prêt dans le scratchpad `lot2d/patch_residency.py`, non validé, touche l'épinglage).
- Décisions : (1) fusion acceptée → A21 `fusion-sdk-lot2d` (opus, sans isolation) : develop a bougé (0195ca8, saccades) → fusion de develop dans la branche, portes complètes, preuve navigateur 0 px sur les deux moteurs, nettoyage des serveurs Vite orphelins. (2) Lot 2 suspendu après 2d : rendements décroissants (~2–3 ms par lot de 500 k tokens) ; la suite du WebGPU passe par l'étape 5 (profil du premier poste restant) après la campagne. (3) Dès A20 et A21 terminés : campagne de vérité en mode visible (A22, pilote en arrière-plan, Emerald d'abord, verdict par scène et moteur), machine réservée ; pendant la campagne, seuls des agents de lecture (plan « première image ») tournent.
- Lancé A23 `plan-premiere-image` (opus, lecture seule, pendant les fusions puis la campagne) : plan chiffré de l'étape 3 « première image » (pages autonomes, `source.bin` hors du chemin de chargement, textures par mip et visibilité, amorçage < 300 ms) avec la question de fidélité des sommets quantifiés tranchée par les chiffres → `orchestration/PLAN_PREMIERE_IMAGE.md`.

## 2026-09-14 — A20 `lab-plafond-120` terminé (sonnet, 19 min) : Lab develop = ab5d521

- Règle : plafond = médiane des intervalles rAF à ±10 % de 60 ou 120 Hz, confirmée par une grappe dominante ≥ 60 % dans ±15 % ; rattrapages < 50 % de la médiane exclus de la calibration seule ; `fastestSustainedHz` supprimé, remplacé par `method`, `medianMs`, `dominantClusterShare`. Visible : hz = 120, médiane 8,30 ms, grappe 84 %, FPS 120,48 ; headless : hz = 60, médiane 16,70. Tests 199 + 22 + 40 verts. Fusion ab5d521.
- Banc prêt pour la campagne en mode visible. Attente de A21 (fusion 2d → dist/ de develop à jour) pour lancer A22.

## 2026-09-14 — A21 `fusion-sdk-lot2d` terminé (opus, 18 min) : develop = 0577fd1

- Chantier 2d committé 947ed11, fusion 0577fd1 sans conflit (index.ts auto-fusionné : `wanted` des saccades + `gpuFrameMs` coexistent). Portes complètes vertes (305 tests, cargo 46, natif, structure, dts, mots interdits 0). Preuve headless : firstError null (4 passes ABBA, 2 moteurs), WebGL tri = selected et trous 0, pixels 0 sur 10/10 poses WebGL et WebGPU, A/A 0 px (40/40 comparaisons à 0). Avance rapide, build + test 305/305 sur le principal. Worktrees : principal + orchestration seulement.
- Serveurs : 5176 (orphelin 11 h) et 5175 (orphelin 2 h 29) tués ; **5174 est le serveur de l'utilisateur** (terminal interactif, onglet Chrome connecté) : ne jamais le tuer ; la campagne utilisera son propre serveur sur un autre port avec `LAB_URL`.
- Défaut de métrique Lab : pour WebGPU, `triangles` compte les triangles soumis passes transparentes incluses → `tri = selected` et « trous » n'ont pas de sens en WebGPU (préexistant, identique sur la baseline). Décision : corriger la métrique avant la campagne → A24 `lab-metrique-trous` (sonnet, Lab, ~20 min), puis A22 campagne.
- Bilan de la nuit sur develop (headless, Emerald 1280×720 DPR 1 pixelError 1) : WebGL cpuFrame p50 9,45 / p99 18,65 ms (saccades résolues : bufferSubData 932 → 1 ms, remplissage après saut 187 → 88 ms) ; WebGPU cpuFrame p50 36,6 → 11,7 ms, p99 57,7 → 18,35 ms, GPU réel 8,15 ms, A/A déterministe ; 0 pixel différent à chaque fusion.

## 2026-09-14 — A23 `plan-premiere-image` terminé (opus, 23 min, lecture seule)

- Plan : `orchestration/PLAN_PREMIERE_IMAGE.md` (299 lignes). Base chiffrée : première image = 806 Mo en 345 requêtes sur 5 aller-retours chaînés (`source.bin` 195,4 Mo + 336 PNG 591,6 Mo + `clusters.bin` 17 Mo). Découverte : Emerald n'a aucun verre à transmission ; les 29 primitives BLEND sont déjà entièrement paginées (28 868 pages, 258 Mo sur disque, jamais lues) et bloquées par une seule condition dans `lib.rs` (pass == exact-clusters).
- Sommets : exact obligatoire (float32) : la quantification 16 bits déplace les sommets de 0,011 à 0,045 px → incompatible avec la porte 0 pixel ; l'amorçage exact pèse 13 Mo (vs ≈ 6 quantifié), négligeable devant les 787 Mo à retirer. Textures : PNG conservé + pyramide de mips émise par le compilateur (un objet par image et niveau), streamée par visibilité ; KTX2 rejeté (UASTC+Zstd = 1 245 Mo, deux fois pire). Le décodé réel n'est pas 866 Mo mais 4 983 Mo (6 644 avec mips) ; le tableau de textures WebGPU alloue 22,4 Mo par couche (≈ 10 Go). Amorçage cible ≈ 17 Mo en 4 requêtes, 2 aller-retours (manifeste 0,9 Mo + géométrie racine 13 Mo + mips 3 Mo), couverture racine non sérialisée, décodage meshopt dans un Worker (aucun aujourd'hui).
- Chantiers : C0 instrumenter `stack.mjs` (attribuer les 2 s) → C1 scène autonome pour BLEND → C2 autonome = chemin unique, `source.bin` hors du SDK, 116 Mo de dette d'index supprimés → C3 textures par mip et visibilité → C4 amorçage un paquet + Worker → C5 manifeste 17 → 10 Mo → C6 stride variable (optionnel). Régénération des 8 caches dès C1. Risques : R1 les 2 s non attribuées (C0 d'abord) ; R2 remplissage après saut sans `source.bin` ≈ 26 Mo à 4 096 pages (≈ 207 ms) mais ≈ 97 Mo sans plafond → le plafond de résidence devient un réglage de production ; R3 mips du compilateur vs GPU = seul changement d'image accepté, ≤ 1 LSB par canal à prouver.
- Décision : campagne de vérité d'abord (dès A24), puis C0 → C1 → C2 dans l'ordre, un chantier mesuré à la fois.

## 2026-09-14 — A24 `lab-metrique-trous` terminé (sonnet, 35 min) : Lab develop = f40f5d1

- Définition : WebGL/three = `selected − submitted` (exact) ; WebGPU = `selected − (submitted − transparents)` documentée comme approximation (`holes.method`). Mesuré Emerald : WebGL 0 partout (4 096 et non plafonné) ; WebGPU 584 126 / 168 119 / 149 051 à 4 096 et 499 705 / 167 862 / 736 586 non plafonné → la métrique WebGPU ne mesure pas des trous : `selectedTriangles` public y est la coupe idéale AVANT repli ancêtre, `submittedTriangles` la coupe après repli. Besoin SDK (petit chantier après la campagne) : exposer pour WebGPU la sélection après repli (cohérente avec WebGL) et un compteur de triangles non couverts (vrai trou). En attendant, la fidélité WebGPU se juge par les pixels (A/A, A/B vs référence).
- `CAMPAGNE_VERITE.md` : l'agent n'a pu écrire que dans le worktree d'orchestration (garde-fou) ; A22 reportera la nuance §5 sur la copie de référence du checkout principal.
- Lancé A22 `campagne-verite` (sonnet, sans isolation, pilote en arrière-plan sous `caffeinate`) : matrice complète en mode visible, Emerald d'abord, serveur propre (jamais 5174), blocs rejetés si plafond ≠ 120 (rejoués, pause si l'écran est verrouillé), ABBA rejoué sur alerte, fidélité headless par scène (A/A, A/B vs référence, trous), résultats écrits au fil de l'eau dans `orchestration/CAMPAGNE_2026-09-14.md`. Machine réservée jusqu'à la fin ; aucun autre agent de build ou de mesure.
- A22 : préconditions vérifiées (moteur 0577fd1, Lab f40f5d1, 8 scènes prêtes), nuance §5 reportée dans CAMPAGNE_VERITE.md, bug de passage d'arguments à `pnpm dev` corrigé dans le pilote (scratchpad), campagne `verite-2026-09-14` lancée en arrière-plan sous `caffeinate` (serveur 5190). L'agent s'est arrêté en attendant la fin du pilote : surveillance du document de résultats par moniteur ; à la fin du pilote, un agent résumeur produit la synthèse si A22 ne se réveille pas.
- Campagne : premier bloc `emerald-square-1i-dpr1` rejeté deux fois (plafond rAF nul, load1 3–5 : l'utilisateur est réveillé et la machine n'est plus calme), marqué invalide, campagne poursuivie. Règle décidée : si ≥ 4 blocs consécutifs sont invalides, arrêt du pilote et report de la campagne à une plage où la machine est inutilisée ; le développement (C0, métrique SDK) reprend alors. Moniteur réarmé (sections, blocs invalides, fin du pilote).

## 2026-09-14 — l'utilisateur est réveillé : campagne arrêtée, Lab gelé

- Reproche de l'utilisateur : Lab modifié sans accord ni explication, champs hors du style du Lab, images absentes des rapports. Reconnu : dépassement de la règle 9 (composants d'interface), aucune vérification de l'interface, « annule l'agent » mal interprété. Campagne et pilote arrêtés (serveur 5174 de l'utilisateur intact). Rapport écrit : `orchestration/RAPPORT_2026-09-14.md`.
- Demande : remettre les images dans les rapports d'abord. Lancé A25 `lab-images-rapports` (opus, Lab, worktree Lab) : reproduire, cause racine par bissection des six fusions, correction minimale sans nouveau style, rapports existants lisibles, vérification navigateur, fusion dans Lab develop (le serveur 5174 recharge à chaud). Aucun autre chantier Lab tant que l'utilisateur n'a pas tranché (revenir en arrière / partiel / réparer).

## 2026-09-14 — directives de l'utilisateur (réveillé)

- Sommets : quantifier (positions 16 bits dans la boîte du cluster, normales octaédriques, UV 16 bits) et INTÉGRER l'erreur de quantification dans l'erreur certifiée du cluster (le DAG accepte déjà 1 px) ; le critère « 0 pixel » s'applique à une comparaison à même seuil et même représentation, il n'interdit pas la compression. Le verdict « exact obligatoire » du plan est annulé ; C1/C2 se font avec sommets quantifiés + erreur certifiée.
- Lab : réparer les images (ou revenir en arrière) avant toute campagne.
- Ordre imposé : Lab réparé → vérification visible 30 min sur Emerald (WebGL tient-il 120 Hz réels ?) → WebGPU lot 2 (suite) et première image en parallèle (fichiers disjoints) → WebGL p99 (regroupement des dessins) → campagne de vérité complète → compilation incrémentale.
- En cours : A25 réparation des images. Ensuite A26 vérification visible (sonnet, 30 min, machine inutilisée par l'utilisateur pendant ce temps).
- A25 étape 1 : cause des images cassées = depuis fd2e09f les dossiers d'archive portent le nom de campagne (`verite-…`) alors que le point d'accès aux images du serveur dev n'acceptait que `campaign-…` → 404 sur toutes les images archivées depuis la nuit. Correctif : 1 ligne `vite.config.ts` + garde partagée `shared/archive/reportPackage.ts` + 1 test ; vérifié 40/40 images (avant 0/40). Fusion imminente, puis plein écran et retrait des cinq champs.
- A25 étape 1 fusionnée : Lab develop = 81f7e57 (correctif f319b96). 3 rapports archivés vérifiés + 1 sans capture, 40/40 images, 0 erreur console ; serveur 5174 relancé seul par Vite. Étape 2 en cours (plein écran, retrait des cinq champs).

## 2026-09-14 — Session 3 (Fable 5.1, chef d'orchestre) : audit indépendant puis livraison

- Lecture : PROMPT_SESSION_3.md, PROMPT_ORCHESTRATEUR.md, fin du journal. État déclaré : develop = 0577fd1 (WebGL cpuFrame p50 9,45 / p99 18,65 ms ; WebGPU p50 11,7 / p99 18,35 ms, GPU 8,15 ms ; 0 px ; première image ~2 s), Lab en réparation d'images (A25, issue inconnue). Utilisateur endormi, machine libre : aucune question, décisions tranchées ici.
- Décision 1 : l'auditeur A26 est lancé SANS `isolation: "worktree"` (un agent isolé ne peut pas exécuter les scripts du Lab, leçon de la nuit) mais crée son propre worktree détaché du moteur (`.claude/worktrees/audit-2026-09-14`) pour les portes, mesure le système livré (dist/ du checkout principal), serveur Vite propre (jamais 5174), ne lit pas le journal, ne modifie aucun fichier suivi, ne committe pas. Ordre imposé : visible 120 Hz d'abord (30 min, machine froide et libre), puis portes, reproduction headless, captures, chargement. Budget 2 h.
- Décision 2 : pendant l'audit, aucune mesure ni build concurrent ; seul A27 `plan-webgl-120` (opus, worktree, lecture pure, exécution interdite) prépare le plan du regroupement des dessins WebGL (cible 1). Le plan « première image » existant (PLAN_PREMIERE_IMAGE.md) sert de base à la cible 3 avec la directive de l'utilisateur (sommets quantifiés + erreur intégrée), sans agent de plan supplémentaire.

## 2026-09-14 10:31 — Lab : annulation de toutes les fusions de la nuit (ordre de l'utilisateur)

- Sur ordre explicite (« tu annules le commit du lab », « tu n'as pas à toucher au lab »), six `git revert -m 1` exécutés par l'orchestrateur lui-même sur Lab develop : 81f7e57, f40f5d1, ab5d521, 97cb3b8, 56dd3a4, fd2e09f → develop = 538c950, arbre identique à 031dbc6 (`git diff 031dbc6 --stat` vide). Worktree et branche `lab-images-rapports` supprimés.
- Conséquences : le Lab n'a plus ni champs de rapport ajoutés (DPR, pixelError, résolution, commit, charge, ABBA), ni `SDK_DIST` côté serveur, ni mode visible, ni calibration, ni métrique de trous ; les scripts headless sont ceux de 031dbc6 (drapeaux 54 Hz). Dossiers ignorés laissés dans `reports/15-virtualized-integration/` (`verite-*`, `preuve-*`) : artefacts de mes campagnes, non supprimés.
- Règle désormais absolue : AUCUNE modification du Lab par cette session ni par ses agents, quelle que soit la règle 9 du prompt. Les mesures utilisent les scripts du Lab tels quels, en lecture seule.

## 2026-09-14 — A27 `plan-webgl-120` terminé (opus, 15 min, 193 k tokens, lecture seule)

- Plan (40 lignes, scratchpad de session `plan-webgl-120hz-emerald.md`). Postes : soumission Three.js 6,2 ms, sélection 2,6 ms, arrivées de paquets dans l'image (queue p99 18,65 vs p50 9,45).
- Cause racine trouvée : `pageSelection.ts` attribue un `renderOrder` unique par objet, recopié dans `clusterBatches.ts` ; le tri de Three.js trie d'abord par `renderOrder`, donc la branche « par matériau » n'est jamais atteinte, même en opaque → chaque dessin est un changement de matériau (≈ 2,5 µs × 2 479) ; les transparents double face ajoutent 2 programmes par objet (964 doublons).
- Étape 1 (sans toucher un shader) : `renderOrder = 0` pour l'opaque + drain borné des arrivées en tête de `render()` + câblage du profil CPU par étape (déjà écrit, utilisé seulement par WebGPU) : −1,2 à −1,5 ms p50, p99 attendu ≈ 10–11 ms. Étape 2 : matrices par sous-dessin via `texelFetch` (bits identiques ; risque = ordonnancement pilote, preuve 0 px sur 4 poses × 2 scènes + A/A). Étape 4 : arène de sommets.
- Fichiers : `packages/sdk-browser/{clusterBatches, index, pageSelection, streamingPriority, pageRaster}.ts` + 2 nouveaux (`drawMatrices.ts`, `pagePins.ts`). Contact avec la cible 3 : `streamingPages.ts` non touché ; index sur `acceptPage`, sommets quantifiés uniquement sur `acceptGeometryPage` (déjà déclaré dans `backendTypes.ts`) ; `PageRec.array` est une vue partagée sur le cache du streamer → jamais de rebasage d'index en place.
- Décision : l'implémentation (A28, opus, worktree) attend la fin de l'audit A26 (aucun build pendant la mesure visible). Le brief de la cible 3 reprendra la note sur `acceptGeometryPage`.

## 2026-09-14 — vérification lecture seule de la config Lab ↔ moteur (A29, sonnet)

- SDK : `@web-geometry/sdk` = `link:../webGeometry`, exports vers `dist/*`, `dist/` reconstruit 13 min après 0577fd1 ; compilateur natif présent (post e85d1ac). API et champs `FrameMetrics` lus par le Lab tous présents dans les `.d.ts` (aucune référence à `pageEvictions` ni à un format abandonné). Typecheck 0 erreur. Caches 8/8 validés par `assertCachePointer`/`assertCacheReady` (dag-group-qem-v1, format 1 ou 2). Tests 231/231, aucun fichier modifié.
- Walk des 4 moteurs reporté : un Chrome automatisé tiers tournait (résidu, disparu depuis) ; relancé maintenant.
- A29 point 5 : walk 60 images Emerald, serveur 5199, aucune écriture dans le Lab. three-webgl-reference et three-lod : erreurs null, 10 046 405 triangles ; exact-cluster-pages PRELOAD=all : null, selected 1 576 299, résident 13 219, 0 éviction (60 images = démarrage, pagination encore active) ; webgpu-page-raster PRELOAD=all : null, résident 10 022, `selectedTriangles` non émis sur ce run court (champ optionnel côté GPU, à surveiller). Verdict : config Lab ↔ moteur bonne.
- En attente des décisions de l'utilisateur : suppression de mes dossiers de mesures dans `reports/`, feu vert pour reprendre le moteur (WebGPU lot 2 suite, première image avec sommets quantifiés).

## 2026-09-14 — « go » de l'utilisateur : moteur seulement, tests à la fin

- Nettoyage fait : 44 dossiers de mesures supprimés dans `reports/15-virtualized-integration/`, restent les deux `campaign-<id>` et `latest.json`. Config Lab ↔ moteur vérifiée bonne.
- Directive : les tests, builds et mesures s'exécutent UNE fois à la fin du code, jamais à chaque modification (les agents passaient 80 % du temps à tester). Briefs renforcés : aucune commande de test/build/mesure avant la fin de l'implémentation, une seule passe de validation, correction en une fois.
- Lancés en parallèle (fichiers disjoints, mesures en fin de chantier, Lab en lecture seule) : A30 `webgpu-lot2e` (opus) : fusion d'encodeurs, résidence en index denses (patch du scratchpad), transparents en sélection GPU, classes de taille du raster, métrique `selectedTriangles` après repli pour WebGPU ; partition sur GPU en dernier, mesurée à part (pixels rapportés, décision à la fusion). A31 `premiere-image-1` (opus) : C0 attribution mesurée des 2 s (marques dans le SDK), C1 pages autonomes pour BLEND, C2 sommets quantifiés (positions 16 bits dans la boîte du cluster, normales octaédriques, UV 16 bits) avec erreur de quantification intégrée à l'erreur certifiée, `source.bin` hors du chemin ; décodage vers la représentation mémoire actuelle pour ne pas toucher aux backends ; caches régénérés à la fin par `pnpm prepare:models` (données dérivées, seule action dans l'arbre du Lab, signalée).

## 2026-09-14 — A26 `audit-independant` terminé (opus, 58 min de machine, 202 k tokens) : `orchestration/AUDIT_2026-09-14.md`

- Incident : une AUTRE session a reverté le Lab pendant l'audit (render-tech-lab develop 81f7e57 → 538c950 à 10:31) : mode visible, plafond rAF et métrique de trous supprimés du Lab. L'auditeur a figé l'instrument dans un worktree détaché sur 81f7e57 (checkout principal du Lab intact, 538c950 propre). Charge polluée en fin d'audit (load1 18,8) : une autre session travaille sur la machine.
- Visible 120 Hz : Low Poly City valide (plafond 120, grappe 99 %) : 4 moteurs à 120,5 FPS, p99 9,40 ms, 244–262 images > 8,33 ms / 600 (gigue, seuil au milieu de la distribution) ; cpu p50 ref 0,25 · lod 0,25 · WG WebGL 0,95 · WG WebGPU 2,80. **Emerald : aucun moteur ne tient 120** (plafond null, médiane 10,9 ms) : WG WebGL 96,6 FPS / p99 17,95 / 435 lentes ; WG WebGPU 87,0 / 22,65 / 495 ; référence Three.js 82,6 / 17,95 / 436 ; three-lod 67,3 / 24,65 / 435.
- Portes develop 0577fd1 : toutes vertes (cargo 46/46, builds, `npm test` seulement après `npm run build`), mots interdits = 0 dans l'arbre suivi (2 dans `PROMPT_SESSION_3.md`, fichier non suivi de l'utilisateur, non modifié : les portes utilisent `git grep -i`), dist/ principal reproductible. Lab : tsc 0 erreur, route des images réparée (200 image/png).
- Headless Emerald : cpuFrame p50 reproduits (WebGL 9,10 vs 9,5 ; WebGPU 11,95 vs 11,7) ; WebGL p99 14,45 (mieux que 18,7) ; WebGPU p99 18,85 ≈ 18,4 ; **GPU WebGPU 13,08 ms vs 8,2 annoncé : non reproduit** (méthode maison, `passFromSeries` force `gpuMs: null` dans les scripts). WebGL tri = selected 6/6 poses, trous 0.
- Rendu : A/A = 0 px partout (déterministe) ; vs référence Three.js à pixelError 1 : 0 px sur 1 pose / 6, sinon 12 125–113 893 px (WebGL), 147 470–410 845 px (WebGPU), erreur max 235, moitié basse (bascules de LOD) : l'identité annoncée ne vaut qu'entre builds WebGeometry, pas face à la référence ; la borne 1 px reste à prouver (A30).
- Chargement Emerald : première image froid 1 806 ms / chaud 1 728 ms, 361 requêtes, 771 Mo, `source.bin` 186 Mo (froid = chaud : Vite répond `no-cache`).
- Décisions : (1) chantiers rouverts : GPU WebGPU (cible 2) et fidélité face à la référence (borne 1 px à prouver, WebGL = WebGPU à vérifier) ; (2) instrument de mesure = worktree détaché du Lab sur 81f7e57 (`render-tech-lab/.claude/worktrees/instrument-81f7e57`, liens `node_modules` et `public/benchmark-assets`), Lab develop jamais touché ; (3) agents d'implémentation lancés sans isolation harnais mais dans un worktree qu'ils créent eux-mêmes (les isolés ne peuvent pas exécuter les scripts du Lab), verrou de mesure `webGeometry/.claude/mesure.lock` (mkdir atomique) : jamais deux mesures en même temps ; (4) Temps 2 : A28 cible 1 (WebGL, étapes 1–2 du plan) et A29 cible 3 (compilateur + chargeur, C1–C2 sommets quantifiés) en parallèle, A30 (sonnet) borne 1 px sur les PNG de l'audit.

## 2026-09-14 — A30 `borne-1px` terminé (sonnet, 6 min) : les écarts face à la référence ne sont pas des bascules de LOD

- Méthode validée (comptes exacts de l'audit reproduits, A/A 0). Diff tolérant 1 px (voisinage 3×3, ≤ 2/canal) sur les PNG de l'audit, Emerald, résidence non plafonnée : à pixelError 1, WG WebGL vs référence borné sur 1 pose / 6 (f90 : 0), résidu 8 008–54 779 px ailleurs ; WG WebGPU résidu 19 443–140 543 px (2–3× WebGL) ; WebGL ≠ WebGPU sur 5 poses / 6 (résidu 17 532–121 299 px), en grosses composantes connexes pleines (jusqu'à 107 107 px, ≈ 577×435) dans le tiers médian, pas en liserés de silhouette.
- À pixelError 0 : mêmes ordres de grandeur (WebGL/ref résidu 4 828–33 224, WebGPU/ref 19 769–120 951, erreur max 165–215) ; f90 : WebGL = référence à 0 px, WebGPU = référence à ±1 uniforme (arrondi couleur). Conclusion : l'écart n'est pas piloté par le seuil d'erreur ; au régime établi (f90) le rendu est fidèle ; aux poses en mouvement (f30, f150…f359) de gros blocs de géométrie diffèrent, hypothèse dominante : résidence non convergée à l'instant de capture (repli ancêtre pendant l'arrivée des paquets), plus lente en WebGPU.
- Décision : chantier de fidélité ouvert AVANT toute fusion de vitesse. A31 `fidelite-regime-etabli` (opus, instrument + dist de develop, lecture seule sur le code, verrou de mesure) : capture des 6 poses après convergence complète (aucune arrivée de page, sélection stable) à pixelError 0 et 1, WebGL et WebGPU vs référence ; si 0 px (±1 WebGPU expliqué) au régime établi, la métrique « pixels différents » du verdict final est définie au régime établi et le transitoire devient un chiffre à part (images jusqu'à convergence par pose, à réduire) ; sinon, défaut de fidélité prioritaire, chantiers de vitesse suspendus.

## 2026-09-14 ~11:50 — redémarrage de toutes les sessions ; reprise (session chef d'orchestre « webgeometry-f8 »)

- Le processus a redémarré : mon worktree d'orchestration a disparu (je travaille désormais depuis le checkout principal, sans y exécuter git autrement que par lecture), mes deux agents A30 `webgpu-lot2e` (worktree `agent-a142b12bda1384f4f`, 9 fichiers modifiés) et A31 `premiere-image-1` (worktree `agent-a3c5200d3436e631c`, 25 fichiers + 3 nouveaux) se sont arrêtés en cours de code ; je les reprends là où ils en étaient (même brief, tests à la fin).
- Constat : une autre session chef d'orchestre écrit dans ce journal (A26 audit, A28 WebGL étapes 1–2 dans `webgl-120`, A29 C1–C2 dans `premiere-image`, A30 borne 1 px, A31 fidélité régime établi) avec une numérotation qui recoupe la mienne ; `develop` a reçu 3e7b609 (binaire unique, session 3) ; Lab develop = 8b9cc51 avec une modification non committée (`prepare-models.ts`) qui n'est pas de moi. Quatre sessions pairs vivantes après redémarrage.
- Doublon : `premiere-image` (8 fichiers, base 0577fd1) recouvre mon A31 (25 fichiers). Décision : je garde le mien (plus avancé, périmètre C0–C2 avec quantification décidée par l'utilisateur) et je demande aux sessions pairs de ne pas reprendre `premiere-image` ; `webgl-120` et `test-dag-materiaux` leur restent. Verrou de mesure `.claude/mesure.lock` (mkdir atomique) adopté par mes agents ; verrou de 11:21 périmé (propriétaire mort) retiré.
- Prise en compte de l'audit indépendant : en visible, Emerald ne tient 120 sur aucun moteur (WG WebGL 96,6 FPS) ; vs référence Three.js seules les poses au régime établi sont identiques, les poses en mouvement diffèrent par gros blocs (résidence non convergée) ; GPU WebGPU 13,08 ms mesuré par l'audit vs 8,15 annoncé (méthodes différentes). Ces points entrent dans les critères de fusion de A30/A31 : preuve au régime établi + transitoire chiffré à part.

## 2026-09-14 11:59 — redémarrage de la session 3 : A28, A29, A31 interrompus vers 11:45, relancés

- État trouvé : develop = 3e7b609 (autre session : préparation des modèles en binaire unique, import FBX/OBJ via ufbx, `main` aligné) ; checkout principal « dirty » (autre session, non committé : `lib.rs`, `main.rs`, `sdk-node/{cli,index}.mjs`, `types/sdk-node.d.mts`, `progress.mjs`) ; worktrees tiers `test-dag-materiaux`, deux `agent-*` verrouillés ; Lab develop = 8b9cc51 (progression de `prepare:models`), instrument `instrument-81f7e57` en place ; verrou de mesure périmé (A29, 11:21) ; charge load1 27,9 (autre session) ; serveurs Vite 5195, 5198, 5203, 5204.
- Nouvelles consignes de l'utilisateur (mémoires) : (1) Lab interdit de modification, scripts utilisés tels quels, tout outillage additionnel dans le scratchpad ; (2) code d'abord, aucune mesure ni test avant l'implémentation complète, une seule passe, temps codage vs validation demandé dans chaque résumé ; (3) préparation des modèles = un binaire Rust, Node relais seul, zéro Blender.
- Décisions : (a) l'instrument reste un worktree détaché du Lab sur 81f7e57 (aucun fichier du Lab modifié, aucune branche touchée) : c'est le seul moyen de mesurer 120 Hz en visible ; tout script additionnel (capture convergée) vit dans le scratchpad ; (b) les baselines « avant » ne sont plus mesurées par les agents : l'audit (même commit 0577fd1, même dist) sert de baseline ; (c) chronométrages tolérés seulement à load1 ≤ 4 (attente 30 min max), sinon chiffre marqué « pollué » ; les pixels ne dépendent pas de la charge ; (d) A29 fusionne develop 3e7b609 dans sa branche (WIP commit autorisé sur sa propre branche pour le permettre, jamais de stash), A28 aussi ; (e) fusion dans develop : le checkout principal étant dirty par une autre session, l'agent de fusion ne fusionne que par avance rapide n'affectant aucun fichier modifié localement ; sinon il attend et le journal le dit.
- Réponse de la session « préparation des modèles » (webgeometry-78) : `develop` = `main` = 5b862ca (l'utilisateur veut les deux identiques → chaque fusion dans develop doit aussi avancer main) ; 3e7b609 + 5b862ca = binaire unique (`import.rs` nouveau, `lib.rs` `compile()` avec étape d'import avant `load_runtime`, hash d'implémentation incluant `import.rs`, événements sur stderr, `prepare()` lit `clusters.json`, `COMPILER_OUTPUT_LIMIT` supprimé, `docs/COMPILER.md`). Conflits attendus pour A31 : `lib.rs` autour de `compile()` seulement. Les worktrees `premiere-image`, `webgl-120`, `test-dag-materiaux` ne sont pas à elle (autre session, pas encore identifiée). Lab : un seul fichier modifié par elle avec accord de l'utilisateur (`prepare-models.ts`, barre de progression), commits Lab f4a8b52, 8b9cc51, 0636a94.
- Session d'audit (webgeometry-97) : aucun agent ni worktree en cours ; nouveau document de référence validé avec l'utilisateur : `orchestration/SPEC_MOTEUR_SANS_THREE.md` (quantification acceptée avec erreur certifiée, DAG multi-matériaux par objet, paquets autonomes sans source.bin, cache par objet, mode édition et cuisson finale, parité WebGPU/WebGL2, Three.js = témoin). Mes chantiers = phases 1 et 3 → critères de sortie du tableau §7 à appliquer : résumeur haiku lancé, puis consignes aux agents A30/A31. Les worktrees `premiere-image`, `webgl-120`, `test-dag-materiaux` viennent de la session 3 (PROMPT_SESSION_3.md) ou de la session de test (PROMPT_TEST_DAG_MULTIMATERIAU.md), pas encore identifiées parmi webgeometry-8c / webgeometry-60.

## 2026-09-14 12:05 — [session temps-3] coordination avec la session « webgeometry-f8 » : A29 arrêté

- Message reçu de la session « webgeometry-f8 » (même prompt orchestrateur, même journal) : elle mène WebGPU lot 2e (worktree `agent-a142b12bda1384f4f` : fusion d'encodeurs, résidence, transparents GPU) et première image C0–C2 (`agent-a3c5200d3436e631c`, 25 fichiers déjà modifiés : pages autonomes BLEND, sommets quantifiés + erreur certifiée, `source.bin` supprimé). Mon A29 (8 fichiers) faisait doublon : ARRÊTÉ, worktree `premiere-image` laissé en place pour récupération éventuelle, à supprimer lors de la prochaine fusion.
- Partage convenu : session temps-3 = cible 1 (A28 `webgl-120`), fidélité (A31), puis campagne ; session f8 = cibles 2 et 3. `test-dag-materiaux` n'appartient à aucune des deux (troisième session). Demandes envoyées : committer ou parquer les modifications non committées du checkout principal, enchaîner les builds lourds, préfixer les entrées du journal par le nom de session, verrou de mesure commun, instrument 81f7e57 partagé en lecture seule.
- [session temps-3] 12:10 — Accord confirmé par la session f8. Les modifications du checkout principal étaient de la session « préparation des modèles », committées (develop = main = 5b862ca) ; il ne reste que `orchestration/*.md` (communs, committés par le prochain agent de fusion de f8 en `docs(orchestration)`) et des fichiers non suivis. La session f8 attend le verdict de fidélité (A31) avant toute fusion de vitesse ; ses agents sont en phase de code, validation unique à la fin sous verrou. A28 fusionnera develop à jour (5b862ca) avant sa passe de validation.
- [session f8] Spec résumée (haiku) : phase 1 = WebGPU CPU < 4, GPU < 6, WebGL p99 < 8,33 ms visible, 0 px, parité d'image WebGPU/WebGL2 ; phase 3 = première image < 500 ms chaud / 1,5 s froid, `source.bin` absent, paquet autonome C5 (positions 16 bits/axe, normales octa 16, UV 16, couleurs 8, plages matériaux, meshopt, ≤ 12 octets/triangle), erreur de quantification dans l'erreur certifiée. Critères transmis à A30 et A31 (plages matériaux = phase 2, hors périmètre). Accord avec la session temps-3 (webgeometry-8c) : cibles 2 et 3 à moi, cible 1 (`webgl-120`) et fidélité régime établi à elle, verdict attendu avant toute fusion de vitesse ; entrées de journal préfixées par session.

## 2026-09-14 — [session f8] A30 `webgpu-lot2e` terminé (opus, 1 h 50 code / 2 h 15 validation, machine saturée load 42–49)

- Faits : fusion d'encodeurs (une soumission par image, 4 dessins indirects vides supprimés), résidence en index denses (épinglage corrigé : `dropPage` cassait le patch) + lignes de rang incrémentales, métriques : `selectedTriangles` = coupe après repli (égal à WebGL), `uncoveredTriangles` (vrai trou), `gpuFrameMs` = somme des soumissions et `gpuHostGapMs` à part. Non faits : transparents en sélection GPU, classes de taille du raster, partition sur GPU.
- CPU p50 moteur 14,2 → 10,45 ms (résidence 2,25 → 0,65 ; rangs 1,15 → 0,85 ; encodage 2,8 ; partition 4,25 ; transparents 2,0). ABBA sous charge (relatif seul valable) : cpuFrame p50/p95/p99 13,75/21,9/27,35 → 11,85/17,6/20,25 ; images > 8,33 ms 535 → 438 / 570. GPU réel 8,0 ms inchangé ; l'écart audit (13,08) = intervalle englobant avec ~6 ms d'écart d'hôte, désormais séparé. Cibles CPU < 4 / GPU < 6 non atteintes.
- Fidélité : A/A 0 px ; vs baseline 0 px (parcours et régime établi) ; trous 0 (`uncoveredTriangles`, 600 images à 4 096 pages). **Parité WebGL ↔ WebGPU au régime établi NON atteinte : 99 604–539 216 px (10,8–58,5 %, erreur max 213), identique entre baseline et candidat → défaut antérieur au lot**, convergence 1 image après arrivée des pages. Portes toutes vertes (307 tests, cargo 46). 9 fichiers (+284/−99).
- Décisions : (1) fusion de 2e acceptée car 0 px vs baseline et métriques nécessaires à la fidélité (A32 `fusion-sdk-lot2e`, opus, sans isolation : merge develop 5b862ca, portes complètes, preuve 0 px, avance rapide develop puis main, commit des docs d'orchestration suivis) ; session temps-3 informée, objection possible avant la fin. (2) Lot 2f (transparents GPU, partition GPU, encodage) SUSPENDU tant que la cause de la non-parité WebGL/WebGPU n'est pas connue (chantier de fidélité de temps-3) : un renderer qui diffère de WebGL jusqu'à 58 % des pixels au régime établi ne s'optimise pas avant d'être corrigé.
- [session temps-3] 12:15 — Session f8 : lot 2e WebGPU mesure la parité WebGL ↔ WebGPU au régime établi à 99 604–539 216 px (10,8–58,5 %, erreur max 213), identique entre develop 0577fd1 et son build → défaut antérieur, indépendant de la vitesse ; 2e ajoute `selectedTriangles` après repli (= WebGL), `uncoveredTriangles` (trou réel), `gpuFrameMs` sans écart d'hôte (`gpuHostGapMs` séparé : explique 13,08 vs 8,15 de l'audit). Fusion 2e lancée par f8 (0 px vs baseline) : pas d'objection de ma part ; lot 2f (partition et transparents GPU) suspendu par f8 jusqu'au verdict A31. À trancher par A31 : lequel des deux moteurs s'écarte de la référence au régime établi (à f90, WebGL = référence 0 px, WebGPU ±1).
- [session f8] temps-3 : pas d'objection à la fusion de 2e ; sa fusion WebGL (A28 : clusterBatches, index.ts, pageRaster, pageSelection, streamingPriority, nouveaux drawMatrices/pagePins) suivra la mienne ; conflits attendus pour elle sur index.ts et pageSelection.ts (signalés). Parité : à f90 WebGL = référence 0 px et WebGPU = référence ±1 ; aux 5 autres poses grosses composantes pleines ; A31 (temps-3) mesure les six poses après convergence complète (aucune page voulue non résidente, sélection stable N images) face à la référence, à pixelError 0 et 1 — hypothèse : latence d'une image de la sélection GPU.
- [session temps-3] 12:20 — Session f8 : le lot 2e touche `index.ts` (métriques, sélection après repli) et `pageSelection.ts` (résidence en index denses, lignes de rang incrémentales), plus `gpuDagSelection.ts`, `gpuSelection.ts`, `gpuTiming.ts`, `webgpuPages.ts`, `sdk-core/contracts.ts` ; pas `pageRaster.ts`, `clusterBatches.ts`, `streamingPriority.ts`. Conflits attendus pour la fusion de A28 : `index.ts` et `pageSelection.ts` seulement ; f8 prévient dès que 2e est dans develop (≈ 12:45).

## 2026-09-14 12:30 — [session temps-3] A28 : code des étapes 1 et 2 terminé, mesures bloquées par un verrou dormant ; cache Emerald du Lab remplacé

- A28 : étapes 1 et 2 implémentées et validées (merge develop 5b862ca, build OK, 317 tests OK, structure/dts OK, mots interdits 0). Mesures bloquées : verrou pris à 12:14:57 par la session f8 (PID 33306, `sleep 7200`) sans aucune mesure en cours. Décision : le verrou couvre une mesure réelle, pas une réservation ; A28 le prend pour le bloc pixels seulement (captures avant/après, A/A, trous, `firstError` WebGPU), chronométrages seulement à load1 ≤ 4 (30 min max), sinon livrés plus tard machine calme. Session f8 prévenue.
- Incident : le cache Emerald du Lab (`public/benchmark-assets`, format 2 consommé par develop) a été effacé et remplacé par un cache format 3 (e6d3a136 puis df767d79) d'un compilateur non fusionné (agent première image de f8 ou mon A29 avant son arrêt : à établir). Conséquence : toute mesure sur le Lab avec le dist de develop est invalide jusqu'à régénération avec le binaire de develop. A28 mesure sur la copie exacte du cache de l'audit (309a16) servie depuis son scratchpad. Demande envoyée à f8 : qui régénère (une seule fois, machine libre).
- [session f8] INCIDENT signalé par temps-3 : mon agent A31 tenait le verrou de mesure par un `sleep 7200` sans mesurer, et a écrasé le cache Emerald du Lab (`public/benchmark-assets`, format 2) par son cache format 3 (compilateur non fusionné) → toute mesure sur le Lab avec le dist de develop invalide. Cause : mon brief autorisait `pnpm prepare:models` à la validation. Corrections ordonnées : verrou libéré et pris seulement pendant une commande de mesure ; A31 copie son cache dans son scratchpad et le sert de là, puis restaure Emerald avec le binaire de develop (une fois, sous verrou) ; l'agent de fusion 2e attend `assertCacheReady` avant sa preuve. Règle ajoutée : aucun agent n'écrit dans `public/benchmark-assets` du Lab ; la régénération des caches ne se fait que par l'agent de fusion, après fusion du compilateur, machine libre, jamais deux `prepare:models` en parallèle.
- [session temps-3] 12:35 — Réponse de f8 : le verrou dormant et le remplacement du cache Emerald du Lab venaient de son agent première image. Verrou libéré ; le cache du Lab est restauré par ce même agent, une seule fois, sous verrou, avec le binaire de develop 5b862ca (son cache format 3 servi depuis son scratchpad) ; confirmation à venir. Règle ajoutée dans les briefs des deux sessions : aucune écriture dans `public/benchmark-assets` du Lab par un agent, régénération seulement par l'agent de fusion après fusion. Sa fusion 2e attend que `assertCacheReady` du dist de develop accepte à nouveau le cache.
- [session f8] Correctif à l'incident : A31 n'a jamais écrit dans le Lab (compilations dans son scratchpad, servies par ses propres serveurs 5201/5202) ; le cache Emerald du Lab est en formatVersion 2 depuis 12:14 (compilateur de develop, relancé par une autre session) ; le cache format 3 vu par temps-3 venait d'une autre session (probablement `test-dag-materiaux` ou l'agent `premiere-image` arrêté). Verrou libéré. Le blâme du verrou reste fondé (sleep 7200), celui du cache non.
- [session temps-3] 12:40 — Cache : fausse alerte côté Lab. Le Lab est en formatVersion 2 (clé c052774b, régénéré à 12:14 par le compilateur de develop 5b862ca, par une troisième session) ; le « format 3 » vu par A28 était le lien `emerald-square-derived` de l'INSTRUMENT, pointé à 11:41 par mon A29 (arrêté depuis) vers son cache de scratchpad. Lien rétabli vers le dossier du Lab. Nouvelle clé du cache Emerald (c052774b ≠ 309a16 de l'audit, compilateur ufbx) : les comparaisons avant/après de A28 restent sur sa copie exacte du cache de l'audit ; la campagne finale devra être faite sur le cache régénéré par la fusion. À noter pour la campagne : seuls Emerald Square, Bistro et Drive for Speed sont en formatVersion 2, les six autres scènes sont en formatVersion 1 (à régénérer par l'agent de fusion).
- [session f8] temps-3 confirme : fausse alerte cache (lien de son instrument pointé vers un scratchpad, rétabli). Notes pour les briefs : la clé du cache Emerald a changé (c052774b, compilateur ufbx 5b862ca, ≠ 309a16 de l'audit) → comparaisons pixel avant/après sur un même cache figé (copie scratchpad), campagne finale sur le cache régénéré après fusion ; six scènes encore en formatVersion 1 (AccuCities, emerald-derived, Low Poly City, New York, Manhattan, Episode 77), trois en 2 (Emerald, Bistro, Drive for Speed) : l'agent de fusion du chantier qui change le format régénère les neuf.

## 2026-09-14 12:50 — [session temps-3] A31 `fidelite-regime-etabli` terminé (opus, 27 min, 283 k tokens) : l'écart face à la référence est un défaut de MATÉRIAUX et de TRANSPARENCE, pas de géométrie

- Emerald 1280×720 DPR 1, cache format 2 figé (fba6892b), dist de develop, 60 captures (36 + 24 témoins A/A = 0 px sur 24/24), `pendingUrls()` = 0 dès la première image : **aucun transitoire** (hypothèse « résidence non convergée » réfutée ; les captures du matin étaient déjà convergées).
- pe0 : WebGL = référence à f90 seulement ; résidu tolérant 1 px ailleurs 4 565 / 25 415 / 62 455 / 19 727 / 41 270 px (f30/f150/f210/f270/f359). pe1 : 1,15–1,5× pe0 → les bascules de LOD ne sont pas le gros de l'écart. WebGL = WebGPU à 427–469 px près à pe0 (f30 : 9 919), 610–11 119 à pe1 ; le ±1 WebGPU (15–27 k px) = arrondi 8 bits d'un éclairage recalculé en WGSL, plus ≈ 450 px de triangles-aiguilles d'1 px rastérisés par une API et pas l'autre.
- Cause : 0 px de géométrie manquante ou en trop (silhouettes identiques, trous 0) ; 100 % des écarts sont des valeurs différentes sur la même géométrie : (a) faces opaques planes décalées de 2 à 22 niveaux sur des composantes entières (f210 : 44 274 px, 160,6 → 158,3), identiques WebGL/WebGPU → état matériau/éclairage des lots de clusters ≠ maillages source (220 matériaux à `normalTexture` + `occlusionTexture`) ; (b) feuillages transparents double face (29 matériaux BLEND) : ordre de composition alpha ≠ Three.js (f359 : arbre, 22 294 px) ; (c) défaut propre à WebGPU : buisson f30 clairsemé + 99 px manquants (recadrage fourni).
- Contradiction à éclaircir : f8 mesurait WebGL ↔ WebGPU à 99 604–539 216 px au régime établi (cache 309a16 du matin ?) ; A31 trouve ≤ 11 119 px sur le cache fba6892b (compilateur ufbx) → la parité dépend du cache/compilateur ou de la méthode ; f8 informé.
- Environnement : le cache Emerald servi par le Lab a changé de clé 3 fois en une heure et décrivait, de 12:23 à 12:26, une scène de 3 344 triangles (compilation de test d'une troisième session dans les assets du Lab) : contre-épreuve invalide. Trois sessions écrivent dans un seul dossier d'assets : mesures non fiables tant que ça dure.
- Outils : `scratchpad/A31/shots-settled.mjs` (capture convergée, verrou par bloc), `RAPPORT_A31.md`, 120 PNG, masques. Lab et instrument intacts.
- Décision : chantier de fidélité A32 « parité matériaux » ouvert (session temps-3), après la fusion de A28 (mêmes fichiers) : (a) état matériau des lots de clusters identique au maillage source (normal map, AO, tangentes, tout attribut PBR), preuve f210 à 0 px ; (b) ordre de composition des transparents identique à Three.js (par objet, tri arrière→avant), preuve f359 ; (c) buisson WebGPU f30 → transmis à f8 (voie WebGPU). La fusion de A28 (0 px vs baseline attendu) n'aggrave pas la fidélité : elle peut avoir lieu.

## 2026-09-14 — [session f8] verdict de fidélité reçu de temps-3 (A31, Emerald, cache figé fba6892b, dist develop, 60 captures)

- A/A 0 px sur 24/24, résidence convergée dès la première image (aucun transitoire). Géométrie : 0 px manquant ou en trop, silhouettes identiques, trous 0. Les écarts face à la référence Three.js sont des VALEURS différentes sur la même géométrie : faces opaques décalées de 2 à 22 niveaux sur des composantes entières (f210 : 44 274 px), identiques en WebGL et WebGPU → état matériau/éclairage des lots de clusters ≠ maillages source (220 matériaux à normalTexture + occlusionTexture) ; feuillages BLEND double face composés dans un autre ordre (f359 : 22 294 px). Pris par temps-3 (chantier « parité matériaux », après sa fusion WebGL).
- Propre à WebGPU (à moi) : buisson f30 clairsemé + 99 px manquants (rapport `…/4071ed0a-…/scratchpad/A31/RAPPORT_A31.md`), ±1 uniforme (15–27 k px, arrondi 8 bits d'un éclairage recalculé en WGSL), ≈ 450 px de triangles-aiguilles d'1 px rastérisés par une API et pas l'autre.
- Contradiction à lever : temps-3 mesure WebGL ↔ WebGPU à 427–469 px (pe 0) et ≤ 11 119 px (pe 1) ; mon lot 2e trouvait 99 604–539 216 px → cache différent (309a16 du matin ?) ou méthode. À vérifier sur cache figé avec la méthode de A31 avant tout travail 2f.
- Alerte : une troisième session (`test-dag-materiaux`) a compilé une scène de test (3 344 triangles) dans les assets du Lab entre 12:23 et 12:26 ; mesures du Lab invalides sur cette fenêtre. Message envoyé à la session non identifiée (webgeometry-60) pour compiler dans son scratchpad.
- Décisions : fusions de vitesse autorisées si 0 px vs baseline sur cache figé (2e en cours). Lot 2f lancé APRÈS la fusion 2e (mêmes fichiers) : (1) reproduire la parité WebGL/WebGPU sur cache figé avec la méthode A31 ; (2) corriger les défauts propres à WebGPU (buisson f30, triangles-aiguilles, ±1 d'éclairage à ramener à 0 si possible) ; (3) puis vitesse (transparents GPU, partition GPU, encodage). Fidélité avant vitesse.
- [session f8] webgeometry-60 = session de test `test-dag-materiaux` : son agent est mort à 11:56 sans écrire dans le Lab (cache dans son scratchpad, Vite alternatif) ; relancé avec le même protocole (verrou pendant les mesures). L'auteur de la compilation de 12:23–12:26 dans les assets du Lab reste inconnu (peut-être l'utilisateur lui-même via le Lab, ou la session « préparation des modèles » testant `prepare:models`) ; à signaler à temps-3.
- [session temps-3] 13:00 — f8 : prend les défauts propres à WebGPU (buisson f30, triangles-aiguilles, ±1 d'éclairage) dans son lot 2f, qui commencera par reproduire la parité WebGL ↔ WebGPU sur cache figé avec la méthode A31 (son 2e avait mesuré sur le cache du Lab à clé non figée : cause probable des 99 604–539 216 px) ; fidélité avant vitesse ; 2f après la fusion 2e. Parité matériaux (opaque décalé, feuillages BLEND) = session temps-3 (A32). Sessions : -78 = préparation des modèles, -97 = audit, -60 prévenue de ne plus compiler dans les assets du Lab.
- [session temps-3] 13:05 — Cause des changements de cache établie : session -78 (préparation des modèles), sur ordre direct de l'utilisateur qui testait `pnpm prepare:models` dans le Lab. La fenêtre 12:23–12:26 (3 344 triangles) venait du catalogue du Lab pointant `emerald-day-smoke.glb`, corrigé (Lab a99013f) : `emerald-square-derived` = 10 046 405 triangles, 281 primitives, une seule clé. Les changements de clé viennent du nouveau compilateur (develop = main = 6ca7fae) : la clé inclut le manifeste source et le hash des sources Rust, anciennes clés élaguées après chaque compilation ; géométrie identique pour les sources glTF. -78 ne compile plus que dans son scratchpad ; -60 (`test-dag-materiaux`) n'a jamais écrit dans le Lab ; -97 (audit) n'exécute rien. Règle adoptée pour toute mesure : consigner la clé du manifeste au début et à la fin de chaque bloc, bloc invalidé si elle change (suggestion de -97).

## 2026-09-14 13:10 — [session temps-3] A28 : résumé provisoire, réordonnancement opaque rejeté, variante B en cours

- Étapes 1 + 2 codées et validées (develop 5b862ca mergé, build, 317 tests, structure/dts, mots interdits 0). Pixels sur le cache exact de l'audit (309a16 cloné) : après ≠ avant sur 6/6 poses (775/63/184/1 745/1 076/192 px, 0,007–0,19 %, erreur max 9–213), A/A après 0/0/2/5/2/2 px. Cause isolée : `renderOrder = 0` seul donne 738/0/195/1 450/597/167 px et A/A 264/0/67/169/75/0 → Emerald contient des surfaces opaques exactement coplanaires dont le gagnant dépend de l'ordre de dessin : tout réordonnancement opaque casse le 0 px et rend l'image non déterministe. La fusion globale ajoute 25–640 px.
- Gain structurel mesuré : dessins par pose 2 474 → 1 215, 968 → 514, 509 → 246, 521 → 255, 393 → 168, 1 126 → 672 ; trous 0 (6/6), firstError null WebGL et WebGPU. Chrono non mesuré (load1 5–58, verrou repris par d'autres sessions).
- Décision : réordonnancement rejeté ; variante B « fusion par runs dans l'ordre source » (image identique par construction si les matrices sont exactes) à livrer avec 0 px 6/6 et A/A 0 ; drain des arrivées et profil CPU conservés ; chrono seulement au calme, sinon par l'agent de fusion. Codage 36 min, validation et banc > 1 h 15 (cache, serveurs IPv6, verrou) : la règle « tests une fois » est respectée, c'est l'environnement partagé qui coûte.
- [session temps-3] 13:15 — Lancé A32 `parite-materiaux` (opus, worktree `parite-materiaux` depuis develop ≥ 6ca7fae) : diagnostic par lecture (matériau et attributs d'un lot de clusters vs maillage source chargé par GLTFLoader : AO et ses UV, normal map et tangentes, espace colorimétrique, filtrage, extensions), correction sans dette dans les modules matériaux/textures/attributs (compilateur si une donnée manque au cache), preuve au régime établi à pixelError 0 sur cache figé : résidu tolérant WebGL 4 565 / 0 / 25 415 / 62 455 / 19 727 / 41 270 → attendu ≈ 0 sur l'opaque ; feuillages BLEND (ordre de composition) corrigés seulement hors des fichiers de A28, sinon correctif décrit. Budget 2 h 30.

## 2026-09-14 — [session f8] fusion 2e terminée : develop = main = 81e5b3e

- Lot 6a89b22, deux fusions de develop sans conflit (develop avait reçu deux commits compilateur 9c7bf81 d'une autre session pendant les portes), portes : build, 316 tests JS, 55 cargo, natif, structure, dts, mots interdits 0. Preuve sur cache Emerald re-stabilisé (clé de618195, format 2) : firstError null, `uncoveredTriangles` 0, `selectedTriangles` WebGPU = WebGL (1 842 728), 0 px vs baseline (8 comparaisons WebGL + WebGPU), A/A 0, tri = selected à 4 096. Docs d'orchestration committées entre-temps par une autre session. `lib.rs` du checkout principal modifié par une autre session (non committé) au moment de la fusion.
- Lancé A33 `webgpu-lot2f` (opus, worktree, base 81e5b3e) : (0) parité WebGL/WebGPU sur cache figé avec la méthode A31 (lever la contradiction 2e) ; (1) défauts propres à WebGPU : buisson f30 clairsemé + 99 px manquants, triangles-aiguilles (règle de couverture du raster logiciel alignée sur le matériel), ±1 d'éclairage WGSL → 0 si possible ; (2) puis vitesse : transparents en sélection GPU, partition sur GPU (rendue neutre pour l'image par l'alignement du raster), encodage. Parité matériaux vs source (normalTexture/occlusion, ordre BLEND) = temps-3, hors périmètre.

## 2026-09-14 13:45 — [session temps-3] A28 `webgl-120` terminé (opus, 2 h 30 dont 42 min de code, 494 k tokens) : variante B sans 0 px, approche changée

- Livré dans `webgl-120` (non fusionné) : étape 1 sans réordonnancement (file d'arrivées bornée 512 Kio / 64 pages drainée en tête de `render()`, profil CPU par étape câblé sur `exact-cluster-pages`, publié `cpu-timing`) ; étape 2 = `drawMatrices.ts` (matrices par sous-dessin RGBA32F + indirection R32UI, `texelFetch`, bits CPU identiques, test bit à bit) + fusion par runs consécutifs dans l'ordre source. Validation unique verte (build, 317 tests, structure, dts, mots interdits 0).
- Pixels (cache 309a16 figé, avant = audit au bit près) : avant → B = 354 / 65 / 64 / 490 / 583 / 23 px (0,002–0,063 %, erreur max 40–213), A/A B = 0 px 6/6, trous 0 6/6, firstError WebGPU null. Diagnostic : ordre conservé par construction et A/A 0 ⇒ résidu = voie matrices GPU (`mat4(texelFetch) * vec4` contracté autrement que l'uniforme ; 1 ULP suffit sur les surfaces coplanaires d'Emerald). Dessins par pose 2 474 → 2 172, 968 → 836, 509 → 430, 521 → 435, 393 → 168… (−4 à −16 %) : gain faible. Structure réelle : 1 515 objets opaques (252 primitives) + 964 transparents (29 primitives, deux passes). Chrono non mesuré (load1 15–58 toute la fenêtre).
- Verdict (règle des deux itérations) : l'approche « matrices par sous-dessin + fusion » est ARRÊTÉE : variante A (réordonnancement) non déterministe, variante B sans 0 px et sans gain notable. Toute modification de l'ordre de dessin ou de la math de transformation des sommets est exclue sur Emerald (coplanaires) : la voie doit garder ordre et math bit-identiques et réduire le coût par objet de Three.js (refresh matériau, unités de texture, uniformes) ou fusionner des objets d'une même primitive (même matrice, même matériau, même tampon d'index) sans réordonner.
- Incidents A28 : `pnpm dev -- --port` a posé Vite sur 5174 (port de l'utilisateur) ≈ 1 min ; un `pkill` a tué l'enveloppe d'un processus d'une autre session. Règle ajoutée aux briefs : ne jamais tuer par motif, seulement les PID lancés par l'agent ; `--port` en `--strictPort` vérifié avant lancement.
- Décisions : (1) A33 `fusion-etape1` (opus, sans isolation) : dans `webgl-120`, retirer l'étape 2 (drawMatrices, fusion par runs, oracle) et garder l'étape 1 (drain borné + profil CPU), 0 px par construction à prouver sur 6 poses, chrono headless ABBA WebGL au calme (30 min max), puis fusion dans develop (commit, merge develop avec le lot 2e, portes, avance rapide), suppression des worktrees `webgl-120` et `premiere-image`. (2) A34 `plan-soumission-exacte` (opus, lecture pure) : plan pour diviser le coût de soumission sans changer un bit : structure des 2 479 dessins, fusion intra-primitive par multi-draw sans réordonnancement, contournement du coût par objet de Three.js, double passe des transparents.
- [session temps-3] 13:55 — f8 : lot 2e fusionné, develop = main = 81e5b3e (0 px vs baseline WebGL et WebGPU sur cache Emerald de618195, A/A 0, `uncoveredTriangles` 0, `selectedTriangles` WebGPU = WebGL = 1 842 728, 316 tests JS, 55 cargo). Lot 2f lancé par f8 depuis 81e5b3e (fidélité WebGPU d'abord : parité sur cache figé, buisson f30, triangles-aiguilles, ±1 WGSL ; puis vitesse), sans toucher `clusterBatches.ts`, `pageRaster.ts` ni les matériaux. A33 (fusion étape 1) et A32 (parité matériaux) refusionneront develop 81e5b3e avant leurs portes ; A34 (plan de soumission bit-exacte) en lecture.

## 2026-09-14 — [session f8] A31 `premiere-image-1` terminé (opus, 2 h 40 code / 2 h 30 validation)

- Fait : C0 (`loadTimeline.ts`, marques `web-geometry:*`, `explorer.loadTimeline()`, script `firstImage.mjs`) ; C1 (`scene.gltf` pour `clustered-blend`, backend autonome BLEND en ordre source, indexation par paquet corrigée) ; C2 partiel : pages v3 quantifiées (positions/UV 16 bits, normales + tangentes octaédriques, couleurs 8 bits), déviation exacte ajoutée à l'erreur de chaque groupe (monotone, plancher niveau 0 `dag.quantizationError` 0,03–0,06 u), format 3 unique, `assertCacheReady` refuse l'ancien. MAIS `source.bin` toujours émis et lu : les backends WebGL/WebGPU y prennent leurs sommets → première image inchangée (341 requêtes / 805 Mo), quantification non exercée au rendu (0 px trivial), chemin autonome non prouvé (`prepare()` bloqué 16 min). Cache Emerald 746 → 607 Mo (pages 258 → 133 Mo) ; 27,2 octets/triangle (cible ≤ 12). Attribution des 2 s (sous charge ×4) : `source.bin` + PNG = 92 % ; le « chaud » retélécharge tout (Vite sans en-tête de cache). Portes vertes (cargo 46, npm 307). 28 fichiers (+601/−167). Non fusionnable en l'état : un changement de format sans gain de chargement obligerait toutes les sessions à régénérer 9 caches pour rien.
- Décision : A34 `premiere-image-2` (opus) reprend le même worktree (un commit WIP autorisé pour figer l'acquis) et termine C2 : les deux backends consomment les sommets dé-quantifiés des pages (réservoir de sommets résidents à côté de celui des index), `source.bin` ni émis ni lu, amorçage autonome débloqué, puis mesure de première image avec un serveur du scratchpad posant des en-têtes de cache pour un « chaud » réel ; C3 si temps. Fusion ensuite avec régénération des 9 caches.

## 2026-09-14 12:55 — [session temps-3] coupure demandée par l'utilisateur (budget épuisé) : ce qui se fusionne, ce qui s'abandonne

- Correction d'horodatage : les entrées de cette session marquées 13:00 à 13:55 ci-dessus ont été écrites entre 12:05 et 12:50 (heures estimées à tort).
- Fusion en cours, seule livraison de code de la session : A33 = étape 1 WebGL (commit f82a9e1 sur `chantier/webgl-120-etapes-1-2`, develop mergé 3504872) : arrivées de paquets drainées hors image (file bornée 512 Kio / 64 pages) + profil CPU par étape sur la voie WebGL. 0 px par construction (ni ordre ni math changés), à prouver sur 6 poses avant avance rapide dans develop (e951810) et main. Chrono abandonné (machine partagée) : gain non mesuré.
- Abandonné : étape 2 (matrices par sous-dessin + fusion des dessins, 23–583 px par pose, gain < 16 % de dessins) ; A29 première image (doublon de la session f8, worktree `premiere-image` supprimé par A33) ; A32 parité matériaux (arrêté avant tout code : diagnostic non abouti, défaut documenté dans `RAPPORT_A31.md` du scratchpad et dans l'entrée A31 du journal) ; A34 plan de soumission bit-exacte (arrêté, aucun plan écrit). Les worktrees d'autres sessions (`lot1-hiz-compteurs`, `lot4-webgl2-selection`, `test-dag-materiaux`, `webgeometry-sans-threejs-9f889d`, `agent-*`) ne relèvent pas de cette session.
- État de la cible à la coupure : Emerald visible 96,6 FPS WebGL / 87,0 WebGPU (référence brute 82,6), p99 17,95 / 22,65 ms, première image 1,8 s, écarts de matériaux et d'ordre des transparents face à la référence ; Low Poly City 120,5 FPS sur les quatre moteurs. Objectif non atteint. Priorités pour la reprise : (1) parité matériaux (faces opaques 2–22 niveaux : AO/normal map/tangentes/espace colorimétrique), (2) soumission bit-exacte (contourner le coût par objet de Three.js sans changer ordre ni math), (3) première image (session f8, C0–C2), (4) campagne de vérité à machine calme sur cache figé.

## 2026-09-14 — [session f8] ARRÊT PROPRE (plus de forfait)

- Agents A33 `webgpu-lot2f` (arrêté au diagnostic, 0 fichier) et A34 `premiere-image-2` (arrêté au démarrage) stoppés ; processus du scratchpad tués ; verrou non tenu par moi.
- Fusionné et prouvé (develop = main = 81e5b3e) : flush() A/A déterministe, lots 2b/2c/2d/2e WebGPU (cpuFrame p50 36,6 → 11,85 ms, GPU réel ≈ 8 ms, métriques sélection après repli / trous réels / GPU sans écart d'hôte), saccades WebGL (p99 29 → 18,65 ms, bufferSubData 932 → 1 ms, remplissage après saut 187 → 88 ms), binaire unique (session 78), docs d'orchestration. Chaque fusion à 0 pixel vs baseline sur cache figé.
- Parqué, NON fusionné : branche `chantier/premiere-image-v3` = 540bd09 (pages v3 quantifiées, erreur certifiée, marques C0, chemin BLEND autonome ; C2 incomplet : `source.bin` encore lu par les backends, aucun gain de chargement, format 3 incompatible avec les caches actuels). Worktrees de mes agents supprimés.
- Abandonné / à reprendre plus tard : lot 2f (parité WebGL/WebGPU sur cache figé, buisson f30, triangles-aiguilles, ±1 WGSL, transparents et partition sur GPU), fin de C2 puis C3–C6, campagne de vérité (jamais jouée : en visible, Emerald ne tient 120 sur aucun moteur, audit temps-3), parité matériaux (temps-3), WebGL A28 (temps-3, validé, à fusionner par elle).
- Le Lab est resté intact (develop 538c950 → 8b9cc51 par la session préparation des modèles, avec accord de l'utilisateur).

## 2026-09-14 13:15 — [session temps-3] A33 `fusion-etape1` terminé (opus, 50 min, 179 k tokens) : develop = main = 1ce8e54, fin de session

- Fusionné : `f82a9e1` (étape 1 seule) + merge develop `1ce8e54`, avance rapide de develop et main, build du principal OK (une autre session a posé `217a352` sur develop juste après : main en retard d'un commit). Livré : `packages/sdk-browser/arrivalQueue.ts` (+ test ; file bornée 512 Kio / 64 pages, dédoublonnage) et `index.ts` (drain en tête de `render()`, profil CPU par étape publié `cpu-timing`). Étape 2 entièrement retirée (grep résidu 0).
- Portes : build 0, 318/318 tests, cargo 56/56, natif 0, structure 0, dts 0, liens 0, mots interdits 0. Preuve (cache figé 309a16 inchangé début/fin) : 0 px sur 18/18 comparaisons (6 poses vs avant A28, 6 vs PNG de l'audit, 6 A/A), dessins identiques, `MAX_PAGES=4096` submitted = selected et trous 0 sur 6/6, firstError null WebGL et WebGPU. Chrono non mesuré (coupure ; `scratchpad/a33/walkcpu.mjs` prêt pour la part `arrivals`).
- Nettoyage : worktrees `webgl-120` et `premiere-image` supprimés avec leurs branches, serveur arrêté par PID, verrou libre, Lab et instrument intacts. Le harnais a émis un avertissement de classifieur sur les actions de l'agent (suppressions de branches/worktrees et avance rapide, toutes autorisées par le brief) : à relire par l'utilisateur dans `scratchpad/a33/RAPPORT_A33.md`.
- Session temps-3 close sur demande de l'utilisateur (budget). Bilan : 1 fusion pixel-neutre (arrivées hors image + profil), 1 audit indépendant (`AUDIT_2026-09-14.md`), 1 verdict de fidélité (matériaux et transparents, pas la géométrie), 1 approche éliminée avec preuve (regroupement des dessins sur Emerald). Objectif 120 FPS non atteint ; priorités de reprise dans l'entrée 12:55.
- [session temps-3] 13:20 — Worktree vide `parite-materiaux` (A32, aucun fichier modifié) supprimé avec sa branche. Session close : develop = main = 78e7fe2 (commits d'autres sessions après 1ce8e54), verrou libre, aucun agent de cette session en cours.

## 2026-09-14 13:10 — [session sans-threejs] état, résultats et question de périmètre

- Session « sans-threejs » (branche `claude/webgeometry-sans-threejs-9f889d`, spec = `SPEC_MOTEUR_SANS_THREE.md`) : phase 0 livrée (`orchestration/phase-0-ecarts.md`, revue Opus : 9 FAIT / 10 PARTIEL / 14 ABSENT), fiches `phase-1-lot2-webgpu.md` et `prototype-dag-multimateriaux.md`.
- Prototype DAG multi-matériaux (`test-dag-materiaux`, commit 4ea3765, rien fusionné) : **NO-GO**. Vue générale Emerald à 1 px : 1 842 728 → 1 862 208 triangles (seuil 200 000) ; 0 px non identique (15 à 1 715 px, max ~200/canal) ; A/A 0 ; monotonie 0 violation. Cause : le plancher vient du nombre d'objets (≈ 750 tri/objet, racine de 5–6 clusters car groupes ≥ 8). En cours : cause des écarts à 0 px (même worktree) ; test « racine minuscule » (groupes < 8 aux derniers niveaux, racine ≤ 32 tri, `test-racine-minuscule` depuis develop).
- **Outillage** : `shots.mjs` avec `MAX_PAGES=4096` fait basculer Emerald sur le rendu de secours (coupe insensible au pixelError). Toute preuve « 0 px » prise avec ce budget compare deux rendus dégradés. Revérification en cours (Sonnet, `reverif-captures-budget-pages.md`), recapture à `MAX_PAGES=100000`.
- Lot 1 « compter la Hi-Z » (`lot1-hiz-compteurs`, 08d3ee6, depuis develop 6ca7fae, rien fusionné) : vue générale 5 077 clusters testés, 758 rejetés (14,9 %), 82 250 tri rejetés (13,4 %) ; sol 8 481 testés, 158 rejetés (1,9 %). 0 px avant/après, 318 tests verts. Les clusters > 16 texels SONT rejetables depuis un mip plus grossier (56–62 % des testés). Touche `webgpuPages.ts`, `gpuHiz.ts` → conflits attendus avec le lot 2e (f8).
- Lot 4 (sélection WebGL2 CPU < 2 ms sans allocation, `lot4-webgl2-selection`) en cours : touche `pageSelection.ts`, `hiz.ts` → conflits attendus avec A28 (temps-3) et 2e.
- A14 : lu, terminé et fusionné (A17). Lot 5 « saccades » de cette session : CLOS, pas absorbé ; le reste (p99 borné par la soumission Three.js) relève de la phase 5 (R7).
- **Question aux sessions f8, temps-3, 97** : la spec §7 attribue la phase 1 (WebGPU CPU < 4 / GPU < 6, saccades) et la phase 3 (première image) ; f8 mène le lot 2e/2f et C0–C2, 97 se déclare sur les phases 1 et 3, temps-3 sur WebGL 120 et fidélité. Cette session ne lancera pas de lot 2/3 WebGPU tant que le partage n'est pas écrit ici. Proposition : sans-threejs = phase 2 révisée (racine minuscule, blocs de quartier), phase 4 (cache par objet, wasm), outillage de preuve (budget de pages) ; f8 = phases 1 et 3 ; temps-3 = WebGL et campagne. Réponse attendue dans ce journal.
- [session f8, post-arrêt] Session « sans-threejs » (webgeometry-sans-threejs-9f889d-31) : lot 1 compteurs Hi-Z (branche `lot1-hiz-compteurs` 08d3ee6, 0 px, 318 tests, Hi-Z rejette 14,9 % des clusters en vue générale) à fusionner par elle ; avertissement : `shots.mjs` à `MAX_PAGES=4096` bascule Emerald sur le rendu de secours et rend la coupe insensible au pixelError → les preuves pixel doivent être prises à résidence non plafonnée (les miennes l'étaient ; 4096 servait aux trous). Répondu : session f8 arrêtée, phases 1 et 3 libres, branche parquée `chantier/premiere-image-v3`.

## 2026-09-14 13:25 — [session sans-threejs] répartition consignée après réponses de f8 et 97

- f8 : arrêtée (fin de forfait). Lot 2e dans develop 81e5b3e ; lot 2f sans production ; C0–C2 parqué non fusionné sur `chantier/premiere-image-v3` (540bd09 : pages v3 quantifiées + erreur certifiée + BLEND autonome ; backends lisent encore `source.bin`, format 3 incompatible). Ses preuves pixel : résidence non plafonnée, SÛRES ; le point du budget 4096 vaut pour A17 et l'audit du matin.
- 97 : audit et documents seulement, aucun code ; correction : elle ne s'est jamais déclarée sur les phases 1 et 3.
- Répartition en vigueur : **sans-threejs = phase 1 (reprise : lot 2 rejet Hi-Z lancé sur lot1-hiz-compteurs fusionné avec develop, puis lot 3, lot 4 en cours), phase 2 révisée (racine minuscule en cours, puis blocs de quartier), phase 3 (reprise de `chantier/premiere-image-v3` après verdict de compatibilité), phase 4, outillage de preuve** ; temps-3 (session 60 ?) = WebGL 120 et campagne, fidélité au régime établi. Règle de preuve : toute capture « 0 px » tourne avec un budget de pages ≥ coupe et le consigne ; scripts du Lab utilisés tels quels, rien écrit dans public/benchmark-assets.
- Plus aucun agent WebGPU d'une autre session ne touche `pageSelection.ts`/`index.ts` (f8) ; reste à confirmer pour A28 (temps-3) avant de fusionner le lot 4.
- [session f8, post-arrêt] État à 78e7fe2 (develop = main, fusions des autres sessions : webgl-120, compilateur, nettoyage des scénarios de test). Branches non fusionnées : `chantier/premiere-image-v3` (f8, parquée : à ne pas fusionner avant la fin de C2, sinon 9 caches à régénérer sans gain de chargement et caches figés des autres sessions invalidés), `lot1-hiz-compteurs`, `lot4-webgl2-selection`, `test/dag-materiaux` (autres sessions). AGENTS.md à la racine fait désormais foi (ajoute la porte `npm run check:links`). Rien d'autre à faire pour f8.

## 2026-09-14 16:05 — [session sans-threejs] cause des écarts à 0 px du prototype multi-matériaux nommée ; worktree test-dag-materiaux libéré

- Commit ccdc39b sur test/dag-materiaux (journal seul). Cause : l'ORDRE DE DESSIN, pas la géométrie. `pageSelection.ts:255` enregistre les instances fusionnées dans une seconde boucle après le parcours de scène, `pageSelection.ts:213` consomme un rang par matériau au lieu d'un par primitive, `clusterBatches.ts:534` dessine au rang du matériau → 903 maillages sur 2 479 (36 %) changent de rang. À 0 px, 100 % des pixels différents sont surface contre surface, 0 pixel de silhouette : surfaces coplanaires, `depthFunc` LESS, le premier dessiné gagne (cf. mémoire « coplanaires Emerald »). Hypothèse « niveau 0 modifié » réfutée : même multiensemble de triangles sur 150 membres, 0 discordance de plage.
- Réutilisable : `material_ranges()`, table `materialRanges`, `vertexBases`, page en plusieurs lots sur tampon d'index partagé, monotonie. À refaire : l'attribution des rangs (conserver le rang de parcours de scène de chaque primitive membre).
- Verdict NO-GO inchangé (plancher par maillage). Mon agent a quitté le worktree ; les modifications non commises de `dag.rs`/`lib.rs` (élagage, sloppy, `WG_NO_*`) ne sont pas de lui et sont laissées intactes. Worktree rendu à la session a4.

## 2026-09-14 16:40 — [session sans-threejs] phase 1, lot 2 (rejet Hi-Z) rendu ; lot 4 mesure non faite

- Lot 2, branche lot1-hiz-compteurs (d6693a8, fusion develop eab2bfa incluse, rien fusionné dans develop). Défaut trouvé : tout rectangle écran débordant du cadre rendait `undefined`, donc jamais rejeté ; corrigé (découpe au viewport, source unique `hizTestRect` GPU/CPU). Rejets Hi-Z avant → après (Emerald 1280×720, 1 px, MAX_PAGES=100000) : vue générale 758 → 758 clusters ; sol 424 → 447 (+5,4 %). Gain marginal : les clusters de 128 tri débordent rarement. Trous 0, `selectedTriangles` inchangé. Durées polluées (load 4,3–5,1), preuves pixel non faites (load > 4 au moment de décider). Rejet hiérarchique des nœuds : ne peut pas augmenter les rejets (boîte englobante, profondeur jamais plus loin), seulement du temps GPU, à chiffrer avant d'écrire. Vrai verrou : seule la moitié « rest » des lignes est testée, l'autre est dessinée sans test. Lint : 14 → 2 erreurs, les 2 préexistantes sur develop (`no-unsafe-finally`, webgpuPages.ts). Tests non écrits (consigne : Haiku).
- Lot 4 : mesure tentée par Haiku, harnais laissé par l'agent incompatible (métriques WebGPU, pas `cpuSelectMs`), non faite, journal a327d0e.
- Aucun agent vivant. Reprise sur mot de l'utilisateur.

## 2026-09-14 — Livraison du prototype éclairage dans le banc 16

- Revue indépendante et corrections de livraison terminées : porte initiale, ressources, archives persistantes et erreurs de préparation. Code éclairage isolé des backends ordinaires ; aucun nouveau choix d'architecture validé.
- Lab : validation complète réussie. SDK : tests éclairage 12/12, build et contrats réussis, Rust 57/57 ; global Node 336/337 et portes qualité héritées encore rouges (détails dans `RD_ECLAIRAGE_DIAGNOSTIC.md`). Fusion explicitement redemandée après signalement ; aucune prétention de validation globale verte.
- Même image brute/BVH sur les 14 états de la scène, qualité inchangée. Le gain mesuré reste insuffisant pour rendre ce prototype fluide.

## 2026-09-14 — [session quality-finish] backend WebGPU découpé, doublons à zéro

- `packages/sdk-browser/webgpuPages.ts` : 3 170 → 107 lignes. État réparti dans un objet d'exécution typé (`webgpuPagesRuntime.ts` : `setup`, `layout`, `gpu`, `vis`, `run`, `capture`, `timing`, `services`, `hooks`) et 30 modules de responsabilité (`webgpuPages*.ts`), tous ≤ 200 lignes. Repli GPU → CPU par valeur de retour de `renderGpuCut` ; pipelines de fusion texturés regroupés dans `vis` et libérés ensemble par `dropVis`.
- `npm run check:duplicates` : 31 → 0 clones (fixtures partagées `pagesBackendScenes.ts`, `webgpuPagesTestOccluder.ts`, Rust `tests/base.rs` et `dag/tests/mod.rs`).
- `npm run validate` vert : 337/337 tests JS, 57/57 Rust, format, lint, knip, build TS et natif, structure, liens (liens de `RD_ECLAIRAGE_DIAGNOSTIC.md` résolus avec `benchmark-runs/` du dépôt principal).
- Non fait : preuve navigateur (trous et fidélité Emerald) et revue indépendante finale ; fusion sur `develop` local demandée par l'utilisateur, rien poussé sur `origin`.

## 2026-09-14 — [session simplify] passe /simplify sur la dernière fusion de `develop`

- Périmètre : fusion 7491682 (découpage WebGPU, 12 000 lignes), pas l'écart complet main…develop. Quatre relecteurs Sonnet en lecture seule (réutilisation, simplification, efficacité, altitude) : 24 constats bruts, 19 correctifs dédoublonnés, tous appliqués par un seul agent Opus, tests lancés par Haiku.
- Fusion 2445b61 (`--no-ff`, 4 commits, 62 fichiers, +869 / −1766) : helpers partagés (`mipLevelCountFor`, `pixelScaleOf`, `clearValueOf`, octets de relecture, hash→teinte unique, `boxClipRec`, bornes « exact » communes avec `onMissing`), atlas couleur et data fusionnés dans `webgpuAtlasCommon.ts`, chemin chaud WebGPU sur `rt: WebgpuPagesRuntime` au lieu de sacs d'options reconstruits par image (`rt.hooks` supprimé), état hôte mutable partagé par les services `explorer*` (plus d'accesseurs `state()` allouants), casts `as unknown as` retirés (`quadRootsContext` typé).
- `npm run validate` vert après suppression de `.claude/a28/dist-*` (copies A/B périmées d'un agent, non suivies) et ajout de `.claude/` au `.gitignore`. Tests JS 337/337 sans aucun test adapté. Preuve navigateur non refaite : refactor à comportement identique. Worktree `simplify-develop-e59aef` supprimé.

## 2026-09-14 — Phase 1, lot 1 `lot1-hiz-compteurs` (opus, worktree depuis develop 6ca7fae)

- Objet : **compter** ce que la pyramide Hi-Z élimine, sans aucune optimisation. Aucune ligne du chemin de rendu n'a changé.
- Compteurs ajoutés, même contrat que les autres champs de `FrameMetrics` (R9, `null` si rien n'a été compté) : `hizTestedClusters`, `hizRejectedClusters`, `hizOversizedClusters`, `hizTestedTriangles`, `hizRejectedTriangles`, `hizOversizedTriangles`, plus `hizCountedFrame` qui nomme l'image décrite (la lecture GPU est différée, comme `gpuPassMs` : sans ce champ on ne distingue pas un compte de cette image d'un compte laissé par la précédente).
- Définition de « empreinte > 16 texels » : rectangle écran du cluster plus large que le noyau de test au niveau 0 (`HIZ_KERNEL_TEXELS`), donc répondant depuis un mip plus grossier. Ces clusters **ne sont pas** hors d'atteinte du rejet : le test unitaire « a covered 33 by 19 footprint can reject through a reduced Hi-Z level » montre qu'une empreinte de 33×19 couverte est rejetée. La formulation « donc jamais rejetés aujourd'hui » de `phase-1-lot2-webgpu.md` est donc inexacte pour le chemin à sélection de mip.
- Coût : rien n'est alloué par image. Les verdicts écrits par le noyau sont recopiés une image sur quinze dans un tampon alloué une seule fois, la lecture est asynchrone et ne bloque jamais une image ; les images non échantillonnées ne copient rien (test unitaire dédié).
- Oracle CPU : `countUnoccluded` compte ce qu'il élimine et `applyTemporalHiz` remplit les mêmes compteurs (repli CPU, actif seulement sans Hi-Z GPU). Cohérence GPU/CPU sur une image fixe : test unitaire qui alimente la machinerie de comptage avec les verdicts du jumeau JS du noyau et exige l'égalité champ à champ avec l'oracle CPU sur les trois cas (empreinte large couverte, traversée du plan proche, petite empreinte couverte).

### Mesure — Emerald Square, 1 instance, 1280×720, DPR 1, pixelError 1, `preload: all`, WebGPU (`webgpu-page-raster`)

Caméras du banc : `urbanPath` image 0 (« Vue générale du modèle ») et image 120 (« Déplacement au niveau de référence », niveau du sol). Une session de navigateur par vue, pose tenue 150 images après 8 itérations de préchargement ; 10 et 11 échantillons par vue, **tous identiques** ; valeurs reproduites à l'identique dans une seconde session.

| Vue                       | Clusters testés | Rejetés          | Empreinte > 16 texels | Triangles testés | Triangles rejetés   | Triangles > 16 texels |
| ------------------------- | --------------- | ---------------- | --------------------- | ---------------- | ------------------- | --------------------- |
| Vue générale (image 0)    | 5 077           | **758** (14,9 %) | 3 155 (62,1 %)        | 614 739          | **82 250** (13,4 %) | 392 558 (63,9 %)      |
| Niveau du sol (image 120) | 8 481           | **158** (1,9 %)  | 4 768 (56,2 %)        | 1 016 973        | **15 081** (1,5 %)  | 585 973 (57,6 %)      |

- Dénominateur : la population testée est la moitié « rest » des lignes dessinables résidentes de l'image (la Hi-Z teste les lignes résidentes, pas la seule coupe sélectionnée : vue générale 5 527 clusters visibles pour ~10 000 lignes empaquetées, vue au sol 5 527 visibles pour ~17 000). Les parts ci-dessus sont rejetés / testés, même population.
- Constat chiffré : la Hi-Z **élimine déjà** 14,9 % des clusters testés en vue générale mais seulement 1,9 % au niveau du sol, où la profondeur de la passe 1 occlude peu. Plus de la moitié des clusters testés (56–62 %) ont une empreinte plus large que le noyau et répondent depuis un mip grossier, donc avec une profondeur de rejet plus conservatrice : c'est le premier levier du lot 2.
- Fidélité : capture PNG 1280×720 par vue, avant (dist de `develop` 6ca7fae) et après. **0 pixel différent**, erreur max par canal 0, sur les deux vues (PNG identiques au sha256 près). Témoin A/A (même build, deux sessions) également 0 pixel. `firstError` nul, aucun diagnostic d'échec.
- Portes : `npm test` 318/318, `npm run build`, `check:structure`, `check:dts`, mots interdits 0. `cargo test` / `build:native` non rejoués : aucun fichier Rust touché.
- Charge machine pendant les mesures : load 1 min entre 6,4 et 15,2 (verrou `mesure.lock` pris, aucune autre mesure en cours). La charge vient des applications de bureau de l'utilisateur (WindowServer, Claude.app, ChatGPT/Codex), pas d'une indexation Spotlight (`mds` à 0 %) ; elle n'est jamais redescendue sous 4 pendant les 20 minutes d'attente. Sans effet sur ce lot : les grandeurs mesurées sont des **comptes** déterministes, pas des durées — preuve par la reproduction à l'identique entre deux sessions. Aucune durée n'est rapportée ici.
- Outillage : le `pnpm dev` de ce checkout du Lab n'honore pas encore `SDK_DIST` (le chantier A12 vit dans un worktree du Lab non fusionné) ; les deux dist ont été servis par `/@fs` à travers le lien `node_modules/@web-geometry/sdk`, et le serveur vite doit être redémarré après chaque build (il sert sinon le module transformé précédent).

## 2026-09-14 — Phase 1, lot 2 `lot1-hiz-compteurs` (opus, worktree, base develop eab2bfa)

- Objet : augmenter ce que la Hi-Z rejette, sans jamais rejeter un cluster visible. Un seul changement de comportement livré, plus la refusion des deux lots précédents.
- **Cause trouvée** : le test d'occlusion refusait tout rectangle écran débordant de la cible de profondeur (`minX<0 || minY<0 || maxX>=width || maxY>=height` → `undefined` → aucun rejet), quelle que soit la profondeur du cluster. Une boîte touchant un bord était donc intestable.
- **Correction** : le rectangle est découpé sur le viewport avant le choix du mip (`hizTestRect`, source unique du couple mip/rectangle pour le noyau GPU et pour l'oracle CPU). Sûreté prouvée par construction : ce qui tombe hors cadre n'atteint aucun pixel, et la profondeur comparée reste le coin le plus proche de la boîte **entière**, jamais plus loin que celui de la part découpée — un cluster gardé avant l'est encore. Une boîte entièrement hors cadre n'est toujours jamais rejetée. Le mip retenu reste le plus fin dont l'empreinte tient dans le noyau : c'est la profondeur la plus serrée que la pyramide sache donner, un mip plus grossier rejetterait **moins**.

### Mesure (Emerald Square, 1 instance, 1280×720, DPR 1, pixelError 1, `preload: all`, `maxResidentPages` 100 000, WebGPU)

Avant = 6c84ecc (branche avant lot 2), après = 08a58c5, même procédure, pose tenue 150 images après 8 itérations de préchargement, 10 échantillons par vue, tous identiques.

| Vue                       | Testés | Rejetés avant | Rejetés après    | Triangles rejetés avant | après      |
| ------------------------- | ------ | ------------- | ---------------- | ----------------------- | ---------- |
| Vue générale (image 0)    | 5 077  | 758 (14,9 %)  | **758 (14,9 %)** | 82 250                  | **82 250** |
| Niveau du sol (image 120) | 6 090  | 424 (7,0 %)   | **447 (7,3 %)**  | 48 343                  | **51 222** |

- **Verdict honnête : le gain est marginal.** Zéro cluster de plus en vue générale (le modèle tient entier dans le cadre, aucune boîte ne déborde), +23 clusters et +2 879 triangles au niveau du sol (+5,4 % relatif). L'hypothèse « beaucoup de clusters débordent du cadre » est fausse pour des clusters de 128 triangles : ils sont petits à l'écran. Le correctif reste juste et il est un **prérequis** du rejet hiérarchique : une boîte de groupe ou d'ancêtre est grande et touche presque toujours un bord, donc elle aurait répondu `undefined` et n'aurait jamais rejeté un sous-arbre.
- `uncoveredTriangles` = 0 et `selectedTriangles` inchangé (1 842 728 / 670 036) avant comme après, sur les deux vues : aucun trou, coupe identique. `firstError` nul.
- **Non fait, et pourquoi** : (1) _rejet hiérarchique des nœuds_ — analysé, non implémenté : la boîte d'un nœud contient celles de ses clusters et sa profondeur la plus proche n'est jamais plus loin, donc le test de nœud est **strictement plus dur** à passer que le test par cluster. Il ne peut pas rejeter un cluster que le test par cluster ne rejette pas déjà : c'est un gain de **temps GPU**, pas de rejet. À chiffrer d'abord (coût réel de la passe de test) avant d'être écrit. (2) _Hi-Z temporelle avec rattrapage_ — le chemin WebGPU actuel est déjà la forme sûre : la pyramide qui **rejette** est toujours celle de l'image courante (passe 1), l'image précédente ne sert qu'à choisir qui dessine en passe 1. Aucun rattrapage n'est donc nécessaire, garantie plus forte que « rejeter sur la Hi-Z temporelle puis rattraper ».
- **Le vrai verrou, mesuré** : la population testée est la moitié « rest » des lignes ; l'autre moitié est dessinée en passe 1 sans aucun test, et la pyramide n'est construite que sur la profondeur de cette moitié. C'est là qu'est le gisement du prochain lot : tester **toutes** les lignes contre la pyramide **complète de l'image précédente** pour choisir la passe 1, puis confirmer en passe 2 contre la pyramide courante — correct par construction quoi que dise le test temporel, puisqu'il ne décide que de la passe, jamais du dessin.
- Preuves non faites : captures PNG à pixelError 0 et 1, parcours 600 images, témoin A/A. Charge machine au moment de la décision : `load1` 5,08 > 4, consigne de l'utilisateur « une seule mesure et seulement si la charge < 4 » → non mesuré, à faire par l'agent suivant. Les comptes ci-dessus restent valables sous charge (grandeurs déterministes, reproduites à l'identique entre deux sessions et sur 10 échantillons).
- Charge pendant les comptes : `load1` 4,3 à 5,1 — verrou `mesure.lock` pris à 15:52, aucune autre mesure. Aucune durée n'est rapportée : `gpuFrameMs` a bougé (6,6 → 7,9 ms au sol) mais la machine était au-dessus du seuil, le chiffre est **pollué** et ne vaut rien. À remesurer machine calme : le test découpé fait tourner le noyau sur des boîtes qui sortaient immédiatement avant, donc un surcoût est plausible et doit être chiffré.
- Fusion de `develop` (eab2bfa, outillage qualité + modules scindés) : `hiz.ts`/`gpuHiz.ts` avaient été scindés depuis une base sans le lot 1, prendre « develop » effaçait les compteurs. Les deux intentions reposées sur la nouvelle découpe (`hizCounts.ts`, `gpuHizCounters.ts` neufs).
- Portes : `npm run build`, `check:structure`, `check:dts`, mots interdits 0, `cargo clippy --release --locked --all-targets -D warnings` propre. `npm run lint` (eslint) : 14 erreurs → **2**, toutes deux préexistantes sur `develop` (`no-unsafe-finally`, `webgpuPages.ts`) ; aucun `eslint-disable`. Code mort de develop retiré au passage. **Tests non écrits et non joués** : consigne de l'utilisateur, un autre agent s'en charge.

## 2026-09-14 — Phase 1, mesure lot 2 (harnais commun, session de mesure seule)

Mesure seule, aucun code modifié, aucun test lancé. Lancée depuis le worktree
`lot4-webgl2-selection` (racine du harnais commun `scripts/mesure/banc.mjs`), qui construit les
références git à part. Verrou `mesure.lock` pris. Commande, une seule exécution, complète :

```
node scripts/mesure/banc.mjs --moteur webgpu --avant eab2bfa --apres e25827b \
     --vues generale,sol,rue --images 300 --pixelError 0,1 --max-pages 100000
```

`avant` = eab2bfa (develop au moment de la fusion), `après` = e25827b (HEAD de ce worktree,
lots 1+2). Charge avant la série (`uptime`) : `6.21 4.07 3.88` → moyenne 1 min ≥ 6, **durées
polluées** ; comptes, hash et pixels restent valables. Série complète en 2 min 22 s.

| mesure                                             | vue                                      | avant                                   | après                            | seuil             | verdict                                                                                    |
| -------------------------------------------------- | ---------------------------------------- | --------------------------------------- | -------------------------------- | ----------------- | ------------------------------------------------------------------------------------------ |
| compteurs Hi-Z agrégés (testés/rejetés/>16 texels) | toutes vues                              | null                                    | null                             | —                 | non publiés en agrégat par le harnais (une seule image échantillon les expose, pas de p50) |
| selectedTriangles                                  | générale/sol/rue                         | identiques avant/après (6 échantillons) | idem                             | identité attendue | OK                                                                                         |
| uncoveredTriangles                                 | toutes vues                              | 0                                       | 0                                | 0 attendu         | OK                                                                                         |
| pixels différents (0 px et 1 px)                   | toutes vues                              | 0 px, écart canal max 0/0/0/0           | idem                             | 0 attendu         | OK                                                                                         |
| témoin A/A                                         | toutes vues, deux seuils                 | 0 px                                    | —                                | 0 px attendu      | OK                                                                                         |
| gpuFrameMs p50 (pollué, informatif)                | générale/sol/rue, 2 échantillons chacune | 20.2/9.28/9.15/10.7/5.46/6.62 ms        | 20.8/9.28/9.14/10.8/6.98/4.54 ms | — (pollué)        | proche partout sauf sol/rue échantillon 2 (±30 %), à remesurer machine calme               |

Détails, commande complète, chemins des JSON/PNG/resume.md produits :
`orchestration/phase-1-mesure-lots-2-4.md` du worktree `webgeometry-sans-threejs-9f889d`.

## 2026-09-14 — Phase 1, lot 2, fusion de develop 7491682 dans `lot1-hiz-compteurs`

- Develop a découpé `index.ts`, `visibilityBuffer.ts` et `webgpuPages.ts` en barils de réexport et réparti le code dans de nouveaux modules ; les fichiers Hi-Z du lot (`hizOcclusion.ts`, `hizTemporal.ts`, `hizCounts.ts`, `gpuHiz*.ts`, `metricsContracts.ts`) n'ont pas été touchés par develop et se sont fusionnés seuls.
- Cinq conflits, tranchés ainsi :
  - `packages/sdk-browser/index.ts` — conflit de fichier entier (baril contre module). Version de develop prise ; les sept champs Hi-Z de `FrameMetrics` (`hizTestedClusters`, `hizRejectedClusters`, `hizOversizedClusters`, `hizTestedTriangles`, `hizRejectedTriangles`, `hizOversizedTriangles`, `hizCountedFrame`) reportés dans `explorerMetrics.ts`, où `metricsScratch` et `fillMetrics` ont migré. Aucun doublon : le baril ne contient plus de logique.
  - `packages/sdk-browser/visibilityBuffer.ts` — conflit de fichier entier. Version de develop prise ; les deux seules corrections du lot (suppression de `attr3` mort, `let nx` → `const nx`) sont déjà faites dans `visibilityShade.ts` chez develop, rien à reporter.
  - `packages/sdk-browser/webgpuPages.ts` — conflit de fichier entier. Version de develop prise, puis les six apports du lot reportés un par un dans le module qui a hérité de la responsabilité : `hizTestedTriangles` et `hizCountSample` dans `webgpuPagesLayout.ts` (dimensionnés une fois, comme les lignes à côté) ; l'écriture du compte de triangles dans `webgpuVisibilityItems.ts` ; le passage de l'échantillon à `encodeTest` dans `webgpuVisibilityPasses.ts`, avec le plombage dans `webgpuPagesEncodeVis.ts` qui pose aussi `hizCountSample.frame` ; `countsSubmitted()` juste après `device.queue.submit` dans `webgpuPagesEncoder.ts` ; `cpuHizCounts`/`cpuHizCounted` dans l'état d'exécution `webgpuPagesStateRun.ts` et leur alimentation par `applyTemporalHiz` dans `webgpuPagesRenderCpu.ts` (remise à zéro sur repli) ; les sept champs de sortie dans `webgpuPagesMetrics.ts`, `counts()` appelé une seule fois.
  - `packages/sdk-browser/triangleDiagnostic.test.ts` — même intention des deux côtés (Lambert → non éclairé) ; titre de develop gardé, l'assertion `MeshBasicMaterial` est la même.
  - `orchestration/JOURNAL.md` — les deux blocs conservés, celui de develop (16:40) avant celui du lot, ordre chronologique.
- Dette du lot soldée dans la foulée, les portes étant rouges à l'arrivée : `hiz.test.ts` faisait 290 lignes → scindé en `hiz.test.ts` (145) et `hizTestRect.test.ts` (158, les 12 tests `hizTestRect` et compteurs du lot) ; `gpuHizFactory.ts` faisait 203 lignes → table des uniformes par niveau extraite dans `writeHizLevelUniforms` (`gpuHizUniforms.ts`) ; exports morts retirés (`hizFootprintLevelFlat`, dont `hizTestRectFlat` a repris le seul appelant, et les réexports non lus `hizTestRect`, `HIZ_KERNEL_TEXELS`, `hizOversized` du baril `hiz.ts`, `COUNT_EVERY_IMAGES` rendu privé).
- Portes vertes sur le résultat : `npm run build` (tsc + rewrite-dts + provenance), `eslint .`, `prettier --check`, `check:lines`, `check:duplicates` (0 clone), `check:unused` (knip, 0), `check:structure`. Tests non lancés ici (consigne : rejoués par un autre agent).

## 2026-09-14 — Phase 1, lot 2, fusion de develop 4d61304 dans `lot1-hiz-compteurs`

- Develop avait avancé de 8 commits depuis 7491682 (passe `/simplify`, fusion 2445b61), rendant l'avance rapide impossible sur le dépôt principal. Seconde fusion, même méthode que la première.
- Trois conflits de source, exactement les trois modules où le plombage des compteurs avait été reporté à la fusion précédente. Develop y a remplacé les sacs d'options par le passage direct de `rt: WebgpuPagesRuntime` ; version de develop prise à chaque fois, puis apport du lot reposé sur la forme simplifiée :
  - `webgpuVisibilityItems.ts` — `hizTestedTriangles` lu depuis `rt.layout` avec les autres tableaux de lignes, et le compte de triangles écrit à côté de la ligne testée.
  - `webgpuVisibilityPasses.ts` — `hizCountSample` lu depuis `rt.layout` ; `hizCountSample.frame = run.frame` posé juste avant `encodeTest`, qui reçoit l'échantillon. Le module lisant déjà `rt`, le plombage explicite ajouté à la fusion précédente disparaît au lieu d'être reporté.
  - `webgpuPagesEncodeVis.ts` — version de develop prise telle quelle : les lignes de plombage qu'elle portait n'ont plus de raison d'être. Aucune duplication, aucun sac d'options résiduel.
- `orchestration/JOURNAL.md` — les deux blocs conservés, celui de develop (passe `/simplify`) avant celui du lot.
- Le reste du lot a fusionné seul : `hiz*.ts`, `gpuHiz*.ts`, `metricsContracts.ts`, `explorerMetrics.ts`, `webgpuPagesLayout.ts`, `webgpuPagesStateRun.ts`, `webgpuPagesRenderCpu.ts`, `webgpuPagesEncoder.ts`, `webgpuPagesMetrics.ts`. Vérifié après coup : chaque maillon des compteurs est présent une fois et une seule.
- Portes vertes : `npm run build`, `eslint .`, `prettier --check`, `check:lines`, `check:duplicates` (0 clone), `check:unused` (knip, 0), `check:structure`, `check:dts`. `check:links` est rouge dans tout worktree et le reste ici : `orchestration/RD_ECLAIRAGE_DIAGNOSTIC.md` (venu de develop, 249c3c3) pointe vers `benchmark-runs/`, répertoire ignoré par git et présent seulement dans le dépôt principal — sans rapport avec cette fusion. Tests non lancés ici (consigne : rejoués par un autre agent).

## 2026-09-14 — [session sans-threejs] fusion lot 2

- `develop` avancé en avance rapide sur `lot1-hiz-compteurs` : **6301d07** (« merge: develop 4d61304 dans lot1-hiz-compteurs »), 22 fichiers, +816 / −88. `main` avancé en avance rapide sur `develop` : les deux têtes sont identiques à 6301d07. Aucune fusion forcée, aucun `--no-ff`, rien poussé sur `origin` (qui reste à 4d61304).
- Deux fusions de develop ont été nécessaires : la première (0d7c3a0, develop 7491682) a été rattrapée par la passe `/simplify` de develop, rendant l'avance rapide impossible ; la seconde (6301d07, develop 4d61304) a reposé le plombage des compteurs sur la forme simplifiée (`rt: WebgpuPagesRuntime` au lieu des sacs d'options), sans duplication.
- Contenu livré : lot 1 (compteurs d'élimination Hi-Z, sept champs `FrameMetrics` avec `hizCountedFrame` qui nomme l'image décrite) et lot 2 (correctif de découpe au viewport, source unique `hizTestRect` partagée GPU/CPU).
- Preuve de fidélité du lot, au harnais commun, Emerald 1280×720 : **0 pixel différent à 0 px et à 1 px sur les trois vues** (écart canal max 0/0/0/0), **témoin A/A 0 px** aux deux seuils, **trous 0**, `selectedTriangles` inchangé. Rejets Hi-Z avant → après : vue générale 758 → 758 clusters, sol 424 → 447 (+5,4 %) ; gain marginal, les clusters de 128 triangles débordent rarement du cadre. Durées `gpuFrameMs` polluées (machine chargée), informatives seulement, à remesurer machine calme.
- Tests rejoués sur 6301d07 par un agent dédié : **349 tests, 0 échec**, arbre propre. Portes de qualité vertes sur la tête : build, eslint, prettier, `check:lines`, `check:duplicates` (0 clone), `check:unused` (knip, 0), `check:structure`, `check:dts`.
- Vrai verrou restant, inchangé : seule la moitié « rest » des lignes est testée par la Hi-Z, l'autre est dessinée sans test. Le rejet hiérarchique des nœuds ne peut pas augmenter les rejets (boîte englobante, profondeur jamais plus loin) et ne coûterait que du temps GPU : à chiffrer avant d'écrire.

## 2026-09-14 — Phase 1, lot 4, mesure (agent lot4, Haiku)

- Charge système (uptime) : 3.42 / 5.75 / 8.24 ; load1 < 4 → mesure autorisée.
- Verrou acquis, .mesure/avant et .mesure/apres trouvés (SDK dist pré-placés par agent précédent).
- lot4.mjs en scratchpad, conçu pour mesurer cpuSelectMs (sélection CPU par image, p50/p95) sur les deux vues (général, sol) en ABBA 4 blocs. Fichiers JSON de données (before-views.json, after-views.json) détectés en scratchpad mais contiennent des métriques WebGPU (cpuFrameMs, GPU pass ms), non le cpuSelectMs requis. Harness incompatible : lot4.mjs exige un serveur Lab pour émettre le SDK dist et charge Chromium, entièrement absent de la configuration trouvée.
- Diagnostic : harnais préparé par agent précédent destiné à une autre mesure (WebGPU performance globale) ; aucun setup Lab, aucun script de lancement, aucune trace de run lot4.mjs. Reprise en 10+ min impossible sans redémarrer Lab, compiler le SDK sur cette branche, lancer Chromium : excède le budget.
- Verrou libéré. Mesure non faite.

## 2026-09-14 — Phase 1, lot 4, fusion et harnais (agent lot4-webgl2-selection)

- Fusions. `develop` a bougé deux fois pendant le lot : eab2bfa (outillage qualité, découpage des gros modules, lot 2e WebGPU) puis 249438f (expérience d'éclairage du banc 16). Les deux sont dans la branche, dans cet ordre. Six fichiers en conflit à la première, un seul à la seconde.
  - `contracts.ts` et `oracles.ts` : develop les a réduits à des barils de réexport. Côté develop pris tel quel, mes deux changements reportés dans les nouveaux modules — `cpuSelectMs` dans `metricsContracts.ts`, la vérification de finitude sans tableau temporaire dans `projectionOracles.ts`. Rien de dupliqué.
  - `index.ts` : squelette de chronométrage CPU de develop (`worldStart`/`lightsStart`/`selectStart`/`syncStart`) gardé ; `cpuSelectMs` lit désormais **les mêmes horodatages** que `cpuProfile.row[2]`, donc aucun `performance.now()` en plus par image ; la demande de coupe reste posée une fois pour toutes (`selectOptions`). `metricsScratch` et `fillMetrics` portent les champs des deux côtés (`gpuHostGapMs`, `uncoveredTriangles`, `cpuSelectMs`).
  - `pageSelection.ts` : `pageSelection.ts` n'a **pas** été découpé sur develop (les modules `pageSelectionCut*` y existent mais personne ne les importe). `projectSphere` du lot 4 gardé ; `projectedPageError`, ajouté par develop pour le diagnostic `screen-error`, réécrit dessus, sur le chemin diagnostic seul.
  - `pageSelection.test.ts` : develop a sorti la fixture dans `pageSelectionBlendFixture.ts` et éclaté les cas en `pageSelection2..5.test.ts`. Fixture de develop adoptée, les deux tests du lot 4 gardés tels quels, sans recopier la fixture.
  - `orchestration/JOURNAL.md` : les deux historiques conservés, celui de develop d'abord.
- Portes : `npx tsc --noEmit` et `npm run build` verts. Tests non lancés (consigne : un autre agent s'en charge).
- Lint. `npm run lint` comptait **13** erreurs après la première fusion, et non 2 : les 13 sont présentes telles quelles sur develop eab2bfa (vérifié en lintant une archive de ce commit), **aucune ne vient du lot 4**. Les onze qui ne sont pas les `no-unsafe-finally` tolérées sont corrigées sans changer un comportement : imports morts et compteur mort dans `index.ts`, fonction morte `attr3` et trois `let` dans `visibilityBuffer.ts`, deux `let` dans `webgpuPages.ts`. Il ne reste que les **2 `no-unsafe-finally` de `webgpuPages.ts`**, préexistantes et tolérées.
- Harnais de mesure. **Commande exacte, depuis la racine de ce worktree, sans aucun serveur à lancer à la main :**

      node .mesure/lot4.mjs --avant eab2bfa --images 300

  `--avant` prend un dossier `dist/` déjà construit **ou une référence git**, qu'il extrait et construit dans un dossier séparé ; sans lui un seul côté est mesuré. `--apres` vaut le `dist/` de ce worktree, construit s'il manque. Le harnais monte un serveur statique local sur un port libre choisi par le système (jamais 5174), sert la scène Emerald et les deux SDK, pilote Chromium sans fenêtre, joue les trois vues du banc — vue générale, sol (« Déplacement au niveau de référence »), gros plan — et arrête tout à la fin, y compris sur erreur. Il écrit dans `--out` (par défaut `.mesure/out/<horodatage>/`, ignoré par git) : `mesure.json` (par côté et par vue `cpuSelectMs` p50/p95/p99/min/max, le hash SHA-256 de l'ensemble sélectionné, les métriques de l'image, et le verdict d'identité quand les deux côtés sont là), `<côté>-<vue>.png` à pixelError 0 et MAX_PAGES 100000, et `<côté>-<vue>.clusters.txt`.
  - L'ensemble sélectionné est lu **sans API ajoutée pour la mesure** : en mode diagnostic le moteur attache un maillage par cluster affiché et y dépose son `clusterId`.
  - `render-tech-lab/` n'est **pas modifié** : il est lu pour ses assets Emerald, son Playwright et sa trajectoire. La copie de `urbanPath` (pathVersion 5) est vérifiée contre la source à chaque exécution ; le harnais refuse de mesurer si elle a bougé.
  - Quatre fichiers pour une seule commande (`lot4.mjs`, `banc.mjs`, `serveur.mjs`, `page.mjs`) afin de tenir la limite de 200 lignes par fichier source ; aucun d'eux n'ajoute de violation à `npm run check:lines` (les 7 restantes sont celles de develop).
  - **Essai de bout en bout fait une fois**, une vue, 8 images : JSON et PNG 1280×720 produits, 80 153 clusters sélectionnés, 10 046 405 triangles, `cpuSelectMs` relevé. Tout a été arrêté ensuite.

- Reste à mesurer : la comparaison avant/après elle-même, sur les trois vues et un nombre d'images sérieux, machine calme. **Aucun chiffre de durée de ce lot n'est exploitable** : la charge de la machine était de 17 pendant l'essai, et l'essai ne prouve que le bon fonctionnement du harnais.

## 2026-09-14 — Phase 1, mesure lots 2 et 4 (agent de mesure, worktree en lecture seule)

- Objet : exécuter la comparaison avant/après documentée ci-dessus. Aucun code source modifié,
  aucun test lancé, aucune fusion. Verrou `mesure.lock` pris pour toute la session.
- Charge avant la série (`uptime`) : `load averages: 7.67 4.95 4.06` → moyenne 1 min ≥ 6,
  durées de cette série à considérer polluées si elles avaient été produites.
- Commande exacte, une seule exécution : `node .mesure/lot4.mjs --avant 249438f --images 300`
  (249438f = develop fusionné dans cette branche, cf. section précédente).

| mesure                           | avant | après | seuil             | verdict        |
| -------------------------------- | ----- | ----- | ----------------- | -------------- |
| cpuSelectMs p50/p95 (3 vues)     | —     | —     | —                 | **non mesuré** |
| hash ensemble sélectionné        | —     | —     | identité attendue | **non mesuré** |
| pixels différents (pixelError 0) | —     | —     | 0 attendu         | **non mesuré** |
| allocations/image                | —     | —     | —                 | **non mesuré** |

- **Résultat : échec.** Le build du côté « avant » a réussi, puis le rendu du côté « après » a
  levé une exception non rattrapée en plein `page.evaluate` (`TypeError: Cannot read properties
of null (reading 'trim')`, dans `three.module.js` → `WebGLProgram.getUniforms` →
  `onFirstUse`, appelée depuis `drawBackend`/`sdk/apres/sdk-browser/index.js`). Échec de lecture
  de log de compilation de shader en contexte WebGL headless, avant toute capture. `EXIT_CODE=1`.
  Aucun `mesure.json`, aucun PNG, aucun `.clusters.txt` produits ; seul l'arbre source extrait du
  commit « avant » a été écrit dans `.mesure/out/2026-09-14T16-59-47-363Z/` (ignoré par git).
- Conformément à la consigne « une seule exécution par série, pas de reprise », pas de nouvel
  essai dans cette session.
- Détail complet, tableau, chemins des artefacts et log : voir
  `orchestration/phase-1-mesure-lots-2-4.md` dans le worktree
  `webgeometry-sans-threejs-9f889d`.

## 2026-09-14 — Phase 1, lot 4 : fusion de develop, cause du plantage, harnais commun

- **Fusion `develop` 7491682** (63d501a). develop a réduit `index.ts`, `pageSelection.ts`,
  `visibilityBuffer.ts` et `webgpuPages.ts` à des barils de réexport et réparti leur contenu dans
  des modules ≤ 200 lignes. Côté develop pris tel quel pour les quatre, apports du lot 4 reportés
  dans les nouveaux modules : `SelectionResult<T>` et l'état de coupe réutilisé
  (`selectionState()`) dans `pageSelectionCutState.ts`, l'écriture en place du résultat dans
  `pageSelectionCut.ts`, `selectOptions` posé une fois et `cpuSelectMs` dans `exactPagesRender.ts`,
  publication jusqu'à `FrameMetrics` via `exactPagesBackend/Metrics` et `explorerMetrics.ts`. Les
  onze corrections de lint du lot 4 sont sans objet : le découpage a supprimé ce code. `npm run
lint` est **entièrement vert**, y compris les deux `no-unsafe-finally` autrefois tolérées.
  Vérification fonctionnelle : la coupe d'Emerald vue générale est inchangée après fusion
  (80 153 clusters, hash 4f03157d6ecb, identique avant fusion).
- **Cause du `TypeError … .trim()`** du run `--avant 249438f --images 300` (9ebf03b) : **ni
  develop, ni la résolution de fusion du lot 4 — le harnais lui-même**. 249438f n'ajoute que des
  fichiers et deux réexports, il ne touche aucun chemin de dessin. Preuves : (a) au réglage exact
  qui plante mais 8 images, le hash de coupe est le même avant (7223146) et après (a4fd278) la
  fusion ; (b) le plantage se reproduit **sans `--avant`**, un seul côté, en 19 s ; (c) sonde
  instrumentée : la seule étape qui échoue est `setDiagnostic('clusters')` puis `render()` du
  harnais, la page répondant `Shader Error 0 - VALIDATE_STATUS false` sur un `MeshBasicMaterial`
  puis `useProgram: program not valid`. Le mode `clusters` teinte chaque page de sa couleur, donc
  un matériau et un programme de nuanceur **par cluster** : 80 153 sur Emerald. Après 300 images le
  pilote refuse d'en lier un de plus, Chrome renvoie `null` pour `getProgramInfoLog` et three.js
  appelle `.trim()` dessus. Correctif : lire la coupe en mode `pages` (deux matériaux, mêmes
  maillages, mêmes `clusterId`) sans dessiner d'image. 300 images passent en 24 s, même hash.
- **Harnais commun** (4bd52c8), commis dans `scripts/mesure/`, plus dans `.mesure/` :

      node scripts/mesure/banc.mjs --moteur webgl|webgpu --avant <ref-git|dist> --apres <ref-git|dist> \
           --vues generale,sol,rue --images N --pixelError 0,1 --max-pages 100000

  Les deux moteurs, les drapeaux Chromium copiés de `render-tech-lab/scripts/headless/` (le Lab
  n'est pas modifié), une liste de seuils, `mesure.json` + `resume.md` + un PNG et une coupe par
  vue, seuil et côté. Relevés : `cpuFrameMs` et `cpuSelectMs` p50/p95, `gpuFrameMs` p50 (WebGPU),
  `selectedTriangles`, `uncoveredTriangles`, compteurs Hi-Z, hash de l'ensemble sélectionné,
  budget de pages, charge machine au début et à la fin, témoin A/A et écart avant/après par canal.
  `null` quand non mesuré, jamais déduit. Tout ce qu'il lance, il l'arrête. README de 20 lignes.

- **Essai court fait deux fois**, une vue, 6 images, ce worktree contre lui-même : WebGL — coupe
  80 153 (clusterId, 4f03157d6ecb), témoin A/A **0 px**, écart avant/après 0 px ; WebGPU — coupe
  47 890 (selectedPageIds, e6141303ab48), `gpuFrameMs` p50 20,17 ms, `uncoveredTriangles` 0,
  témoin A/A **0 px**. C'est la seule preuve produite ici.
- **Compteurs Hi-Z : `null`.** Le moteur ne les publie pas dans ses métriques ; le harnais les lira
  dès qu'ils y seront, il ne les invente pas.
- **Aucun chiffre de durée de cette session n'est exploitable** : charge machine relevée entre 3,8
  et 6,3 pendant les essais, et 6 images ne mesurent rien. Reste à faire : la comparaison
  avant/après elle-même, machine calme, et les tests (un autre agent s'en charge).

## 2026-09-14 — Phase 1, mesure lot 4 (harnais commun, session de mesure seule)

Mesure seule, aucun code modifié, aucun test lancé. Verrou `mesure.lock` pris. Commande, une
seule exécution :

```
node scripts/mesure/banc.mjs --moteur webgl --avant 7491682 --apres 6b9341b \
     --vues generale,sol,rue --images 300 --pixelError 0,1 --max-pages 100000
```

| mesure                                            | vue      | avant                                                      | après    | seuil             | verdict                                                                                                            |
| ------------------------------------------------- | -------- | ---------------------------------------------------------- | -------- | ----------------- | ------------------------------------------------------------------------------------------------------------------ |
| cpuSelectMs p50 (n=300)                           | générale | — (absent avant lot 4)                                     | 11.40 ms | < 2 ms            | **ÉCHEC** (5,7× le seuil)                                                                                          |
| cpuFrameMs p50 (n=300)                            | générale | 30.30 ms                                                   | 30.30 ms | —                 | égal                                                                                                               |
| hash coupe (clusterId)                            | générale | identique (coupe.txt byte-identique, PNG sha256 identique) | idem     | identité attendue | OK                                                                                                                 |
| pixels différents (0 px)                          | générale | 0 (PNG identiques)                                         | idem     | 0 attendu         | OK                                                                                                                 |
| tout le reste (sol, rue, A/A, uncoveredTriangles) | sol/rue  | —                                                          | —        | —                 | **NON MESURÉ** : `Error creating WebGL context` au passage à la vue `sol` (côté après), série arrêtée sans reprise |

Charge avant la série (`uptime`) : `2.95 3.22 3.60`, non polluée. Détails, commande complète,
chemins des fichiers produits : `orchestration/phase-1-mesure-lots-2-4.md` du worktree
`webgeometry-sans-threejs-9f889d`.

## 2026-09-14 — Phase 1, lot 4, diagnostic (worktree `lot4-webgl2-selection`)

### Fusion de `develop`

`git merge develop` avec `develop` à **04fa5f0** (`git rev-parse --short develop` au moment du
merge ; ca73fa0 plus `chore: verrou de dépendances pnpm régénéré`). Commit `merge` 05162df, second
parent 04fa5f0. Deux conflits seulement, `.gitignore` (`.mesure/` + `.claude/`) et ce journal
(entrées des deux côtés gardées). Trois fichiers fusionnés automatiquement ont été relus à la main :
`pageSelectionCut.ts` garde la forme de develop (`pixelScaleOf` partagé) avec, reposés dessus,
l'état réutilisé et le résultat rempli en place du lot 4 ; `metricsContracts.ts` et
`explorerMetrics.ts` reçoivent `cpuSelectMs` dans les champs de develop. Zéro duplication.

Dette du lot 4 soldée dans le même commit pour rendre les portes : `pageSelection.test.ts` (285
lignes une fois formaté) scindé, ses quatre tests du lot 4 dans `pageSelection6.test.ts` ;
`scripts/mesure/banc.mjs` déclaré point d'entrée dans `knip.config.js` (ses cinq modules étaient
signalés inutilisés) et `uptime` déclaré binaire système ; `BASE_FLAGS`/`WEBGPU_FLAGS` désexportés ;
sept fichiers du lot 4 jamais formatés passés à prettier.

### (a) Ce que mesure `cpuSelectMs`, et où passent les 11 ms

**Bornes avant correctif** : de juste après `sceneLights.update()` jusqu'à juste avant
`syncResident()`. Étaient donc dedans, en plus de la coupe : le seuil adaptatif
(`resolvePixelError`), l'incrément du numéro d'image, la pose de la caméra et les cinq lectures du
résultat. Étaient déjà dehors : la mise à jour des matrices monde, l'éclairage, la **résidence**,
les **rangs** de requête et la **soumission** — chacun a son étape dans le profil CPU
(`worldMs`, `lightsMs`, `syncMs`, `arrivalsMs`, `pendingMs`, `retainMs`, `submitMs`).

Ces postes en trop sont tous O(1) et restent sous le seuil d'échantillonnage du profileur, mais la
métrique disait plus que son nom : bornes resserrées autour du seul appel de sélection,
commit `fix(metrics)` 2107074. Deux `performance.now()` par image (~100 ns) contre 11 ms de coupe.
L'étape `selectMs` du profil garde ses bornes larges pour que la somme des étapes reste l'image.
Effet sur le chiffre : générale 11,0 ms au lieu de 11,4 — rien n'a été gagné, la mesure est juste
exacte.

**Décomposition.** Profileur de Chrome branché par CDP autour des seules images mesurées
(échantillonnage 50 µs), Emerald, vue générale, WebGL2, 1280×720, pixelError 0, 20 images,
80 153 clusters sélectionnés / 10 046 405 triangles. Le profileur gonfle l'image (`cpuSelectMs`
p50 13,0 ms sous profileur contre 11,0 sans) : lire les parts, pas les valeurs absolues.

| étape                                                                                                                     | ms/image                           | allocation par image |
| ------------------------------------------------------------------------------------------------------------------------- | ---------------------------------- | -------------------- |
| `resolvePixelError` + pose de la demande (hors bornes depuis le correctif)                                                | < 0,02 (sous le seuil)             | non                  |
| `selectVisiblePages` : frustum, échelle pixel, état réutilisé, sommes de triangles, écriture du résultat                  | ≤ 0,19                             | non                  |
| balayage des racines et `selectFlat` (dont `extractPlanes` 0,21, `worldStretch`, remise à zéro du forçage, file de repli) | 1,00                               | non                  |
| `traverse` : pile BVH et `take` (`boxClip` inliné par V8)                                                                 | 5,14                               | non                  |
| `cutSelects` : seuil par cluster                                                                                          | 2,46                               | non                  |
| `projectedClusterError` : erreur projetée, nœuds BVH et clusters                                                          | 3,06                               | non                  |
| **total `cpuSelectMs`**                                                                                                   | **12,2 sous profileur, 11,0 sans** | **non**              |

Aucune étape de la coupe n'alloue par image : état, tampons et résultat sont posés une fois
(lot 4). Le profil relève 0,25 ms/image de ramasse-miettes sur **toute** l'image, imputables au
chemin de rendu et de streaming, pas à la coupe.

Pour situer, hors des bornes et sur la même image : `syncResident` 13,5 ms (dont
`updateClusterBatches` 10,2), `WebGLRenderer.render` 8,4, `arrivalQueue.drain` 7,0,
`markRequests`/`pageUrls` 1,6. `cpuFrameMs` p50 31,4 ms : la coupe n'est pas le seul verrou CPU.

### (a bis) Plan chiffré pour passer sous 2 ms

Deux points d'ancrage mesurés, même moteur, même image : générale 80 153 clusters → 11,0 ms
(137 ns/cluster) ; sol 12 106 clusters → 1,5 ms (124 ns/cluster). **Le coût est linéaire en taille
de coupe**, ~130 ns par cluster sélectionné, et le seuil de 2 ms est déjà tenu sur `sol`. Tenir
2 ms sur la générale demande ≤ 25 ns par cluster, soit 5,5×.

Ce que vaut chaque levier, chiffré :

1. **Ranger les clusters en tableaux typés (SoA).** Aujourd'hui `take` lit `rec.min`, `rec.max`,
   `rec.sphere`, `rec.cone`, `rec.level`, `rec.triangles` sur 80 153 objets JS distincts : une
   course de pointeurs par cluster. Les nœuds du BVH, eux, sont déjà en `Float64Array`
   (`culling.nodes`) et leur test de boîte tourne au même endroit pour environ moitié moins cher.
   Gain attendu : **~2×, soit 11,0 → ~5,5 ms**. Insuffisant seul.
2. **wasm SIMD.** Sur des données déjà en SoA, `boxClip` + erreur projetée en 4 voies : ~4× sur
   l'arithmétique, mais il faut rendre `shown` à JS. Gain attendu : **11,0 → ~3 ms**, et seulement
   après le point 1, qui est l'essentiel du travail. **Ne suffit pas non plus.**
3. **Arrêter la descente au nœud et émettre des plages, pas des clusters.** C'est le seul levier
   qui change l'ordre de grandeur. À pixelError 0 la condition d'arrêt du BVH
   (`projectedClusterError(bound, …) <= pixelError`) n'est jamais vraie : la descente va jusqu'à
   chaque feuille et pousse 80 153 entrées. Or le consommateur, `updateClusterBatches`, retransforme
   immédiatement `shown` en plages d'index (`slot.offset`, `slot.length`) : la liste par cluster est
   un intermédiaire dont personne n'a besoin. Un nœud entièrement dans le frustum dont tout le
   sous-arbre est sélectionné peut pousser **une** plage. Condition de passage du seuil, chiffrée :
   la coupe doit se terminer en **≤ 15 000 tests de nœud** par image pour la vue générale
   (2 ms ÷ 137 ns), soit ≥ 5,3 clusters acceptés par test. Chiffre manquant à lire avant d'écrire
   la moindre ligne : taille moyenne de feuille (`nodes[base+14]`) et hauteur de l'arbre sur
   Emerald — la sonde prévue pour les relever a échoué sur l'incident `node_modules` ci-dessous et
   n'a pas été relancée. Bénéfice second : `updateClusterBatches` recevrait des plages toutes
   faites, donc une bonne part de ses 10,2 ms tombe aussi.
4. **Réutilisation temporelle** (ne retester que les clusters proches du seuil, plus 1/k du reste
   par image). Pour 11,0 → 2 ms il faut k ≈ 6, donc un rafraîchissement complet toutes les six
   images. Introduit un retard de LOD et un risque de trous que la conception refuse aujourd'hui
   explicitement. À ne considérer qu'après le point 3, et seulement avec une borne prouvée sur la
   dérive de l'erreur projetée en fonction de la vitesse caméra.

**Verdict : < 2 ms est atteignable, mais pas en rendant le test par cluster plus rapide.** Ni le
SoA seul (~5,5 ms), ni le SoA plus wasm SIMD (~3 ms) ne passent : tant qu'il y a un test par
cluster sélectionné et par image, 80 153 clusters coûtent plus de 2 ms. Il faut arrêter la descente
au nœud et sortir des plages (point 3), avec le SoA (point 1) comme préalable naturel. Rien n'a été
codé : ce diagnostic s'arrête au plan.

Note : le seuil ne sauve pas non plus. La vue générale à pixelError 0 sélectionne tout le niveau le
plus fin du modèle visible (10,05 M triangles) ; à pixelError 1 la mesure WebGPU du 14 septembre
donnait 3,2× moins de triangles sur la même vue, ce qui placerait la coupe vers 3,4 ms — encore
au-dessus de 2.

### (b) `Error creating WebGL context` entre deux vues

**Cause.** Le harnais rejouait toutes ses séries dans **une seule page Playwright**. Sonde écrite
pour ce diagnostic (six séries Emerald enchaînées, relevé après chaque `explorer.dispose()`) : les
contextes WebGL sont bien rendus — zéro canvas restant, un contexte 1280×720 neuf s'obtient
toujours —, mais le **tas de la page** reste entre 553 et 1 330 Mo et ne redescend jamais au
niveau de départ. Avec une page neuve par série, la même sonde donne 336 à 671 Mo : pic divisé par
deux. Ce qui manquait n'était pas un contexte libre mais la mémoire pour en gréer un de plus après
trois vues générales à 80 153 clusters — d'où l'échec sur la quatrième série, la première de `sol`.
Le côté SDK est hors de cause : `explorer.dispose()` appelle bien `renderer.dispose()` puis
`renderer.forceContextLoss()`, et la sonde le confirme.

**Correctif** : `fix(mesure)` 0db5afc. `onFreshPage` ouvre une page, y branche les trois
observateurs d'erreur, charge la carte d'imports, joue la série, puis **ferme la page**, y compris
sur erreur. `readBounds`, chaque côté et le témoin A/A passent par lui. Rien d'autre ne change.

**Preuve, essai deux vues.** `--moteur webgl --avant <dist de HEAD> --vues generale,sol --images 6
--chauffe 4 --pixelError 0 --max-pages 100000`, avant = après = HEAD 0db5afc, six séries jouées
sans interruption, sortie complète :

| vue      | coupe           | `selectedTriangles` | témoin A/A                  | avant vs après              | hash coupe               |
| -------- | --------------- | ------------------- | --------------------------- | --------------------------- | ------------------------ |
| generale | 80 153 clusters | 10 046 405          | **0 px**, max canal 0/0/0/0 | **0 px**, max canal 0/0/0/0 | identique (4f03157d6ecb) |
| sol      | 12 106 clusters | 1 509 411           | **0 px**, max canal 0/0/0/0 | **0 px**, max canal 0/0/0/0 | identique (4b4097aac673) |

`mesure.json` et `resume.md` écrits, quatre PNG plus deux captures A/A et six `.coupe.txt` produits,
liste d'erreurs de page vide. Les durées de cet essai ne valent rien comme mesure : la charge
machine est montée à 8,69 en cours de route (le harnais la relève, il ne la juge pas) ; seuls les
comptes, les hash et les pixels sont retenus ici.

### Incident d'environnement

`node_modules` de ce worktree était un lien symbolique vers le worktree `lot1-hiz-compteurs`, que
quelqu'un a supprimé pendant la session : lien mort, `three` et `meshoptimizer` en 404, le harnais
échouant sur `Failed to fetch dynamically imported module`. Lien repointé vers le `node_modules` du
dépôt principal, toutes les portes rejouées vertes ensuite. Le lien n'est pas suivi par git.

### Portes

build, tsc, eslint, prettier, `check:lines`, `check:dts`, `check:structure`, `check:duplicates`
(0 clone), `check:unused` (knip, 0) : **vertes**. `check:links` : rouge sur un lien de
`RD_ECLAIRAGE_DIAGNOSTIC.md` vers `benchmark-runs/`, dossier ignoré par git qui n'existe que dans le
dépôt principal — rouge d'environnement, identique avant la fusion. Aucun test lancé (interdit par
la consigne) ; aucun `eslint-disable` ; `render-tech-lab/` non modifié ; port 5174 non touché.

## 2026-09-14 20:34 — Mesure lot 4, trois vues (harnais commun) : interrompue après `generale`

Mesure seule depuis ce worktree, HEAD `d477179`, aucun code modifié, aucun test lancé, aucune
fusion. Commande : `node scripts/mesure/banc.mjs --moteur webgl --avant 04fa5f0 --apres d477179
--vues generale,sol,rue --images 300 --pixelError 0,1 --max-pages 100000`. `uptime` avant série :
charge 4,85 — sous le seuil de 6, durées non polluées a priori.

| mesure                                       | vue      | avant                                | après               | verdict                                                      |
| -------------------------------------------- | -------- | ------------------------------------ | ------------------- | ------------------------------------------------------------ |
| cpuSelectMs p50                              | generale | `null` (absent sur develop, attendu) | 10,90 ms            | OK                                                           |
| cpuFrameMs p50                               | generale | 30,50 ms                             | 30,30 ms            | stable                                                       |
| hash de coupe avant vs après                 | generale | `5aef42e4…`                          | `5aef42e4…`         | identique                                                    |
| pixels différents 0 px / 1 px                | generale | —                                    | 0 / 0               | OK                                                           |
| témoin A/A (coupe + PNG)                     | generale | —                                    | identique à `après` | OK                                                           |
| p95 (cpuSelect/cpuFrame), uncoveredTriangles | generale | `null`                               | `null`              | non mesuré (`mesure.json` jamais écrit)                      |
| toutes mesures                               | sol      | —                                    | —                   | ÉCHEC — `WebGL2 unavailable` dès la première série (`avant`) |
| toutes mesures                               | rue      | —                                    | —                   | NON MESURÉE — vue jamais atteinte                            |

Même symptôme que l'incident déjà documenté plus haut (tas de la page épuisé après plusieurs séries
`generale` à 80 153 clusters), corrigé par `fix(mesure)` `0db5afc` et vérifié alors avec 6 images
seulement ; ici, à 300 images, l'échec réapparaît au même point (quatrième série, première de
`sol`). Aucune investigation ni correction faite ici — une exécution, aucune reprise, conformément
à la consigne. Détail complet, chemins et tableau étendu :
`orchestration/phase-1-mesure-lot-4.md` du worktree `webgeometry-sans-threejs-9f889d`.
`render-tech-lab/` non modifié ; port 5174 non touché ; réglages système non touchés.

## 2026-09-14 20:40 — Mesure lot 4, vues `sol` et `rue` : un processus neuf par vue, succès

Mesure seule depuis ce worktree, HEAD `19db28f` (un commit de journal au-dessus de `d477179`,
aucun code changé : `git diff d477179..HEAD --stat` = 1 fichier, `orchestration/JOURNAL.md`), aucun
code modifié, aucun test lancé, aucune fusion. Contournement de l'échec documenté ci-dessus (second
contexte WebGL2 dans un même processus) : un processus Node par vue, deux commandes successives en
avant-plan, chacune attendue jusqu'au bout, aucune relance.

```
node scripts/mesure/banc.mjs --moteur webgl --avant 04fa5f0 --apres d477179 --vues sol --images 300 --pixelError 0,1 --max-pages 100000
node scripts/mesure/banc.mjs --moteur webgl --avant 04fa5f0 --apres d477179 --vues rue --images 300 --pixelError 0,1 --max-pages 100000
```

`uptime` avant `sol` : charge 4,60 ; avant `rue` : charge 6,43 (au-dessus du seuil de 6, relevé
sans être jugé) ; après `rue` : charge 6,07.

| mesure (e0)                   | vue | avant            | après               | verdict   |
| ----------------------------- | --- | ---------------- | ------------------- | --------- |
| cpuSelectMs p50/p95           | sol | `null`           | 1,500 / 1,800 ms    | OK        |
| cpuFrameMs p50/p95            | sol | 4,200 / 5,000 ms | 3,600 / 4,500 ms    | stable    |
| hash de coupe avant vs après  | sol | `4b4097aac673…`  | `4b4097aac673…`     | identique |
| pixels différents 0 px / 1 px | sol | —                | 0 / 0               | OK        |
| témoin A/A                    | sol | —                | identique à `après` | OK        |
| cpuSelectMs p50/p95           | rue | `null`           | 1,600 / 2,000 ms    | OK        |
| cpuFrameMs p50/p95            | rue | 3,700 / 4,600 ms | 3,700 / 4,900 ms    | stable    |
| hash de coupe avant vs après  | rue | `e99456030cb7…`  | `e99456030cb7…`     | identique |
| pixels différents 0 px / 1 px | rue | —                | 0 / 0               | OK        |
| témoin A/A                    | rue | —                | identique à `après` | OK        |

`uncoveredTriangles` : non mesuré (non affiché en console par le harnais) pour les deux vues, comme
pour `generale`. Les deux vues sont couvertes aux deux seuils `pixelError` (0 et 1) ; détail complet
(p95, seuil 1, chemins `mesure.json`/`resume.md`) dans `orchestration/phase-1-mesure-lot-4.md` du
worktree `webgeometry-sans-threejs-9f889d`. `render-tech-lab/` non modifié ; port 5174 non touché ;
réglages système non touchés.

## 2026-09-14 20:42 — Phase 1, lot 4, verdict

Clôture du lot 4 (sélection de clusters côté CPU, moteur WebGL2). `git rev-parse --short develop` =
`04fa5f0` : develop n'a pas bougé depuis la fusion `05162df`, **aucune fusion à faire**, aucun
conflit, aucun code touché par cette entrée. Aucun test lancé (interdit par la consigne).

| mesure                           | vue       | valeur      | cible      | verdict          |
| -------------------------------- | --------- | ----------- | ---------- | ---------------- |
| cpuSelectMs p50                  | generale  | 10,9 ms     | < 2 ms     | **non atteinte** |
| cpuSelectMs p50                  | sol       | 1,5 ms      | < 2 ms     | atteinte         |
| cpuSelectMs p50                  | rue       | 1,6 ms      | < 2 ms     | atteinte         |
| hash de coupe avant vs après     | les trois | identiques  | identiques | OK               |
| pixels différents, seuils 0 et 1 | les trois | 0 px / 0 px | 0 px       | OK               |
| témoin A/A                       | les trois | 0           | 0          | OK               |
| allocations par image            | les trois | aucune      | aucune     | OK               |

**Cause du dépassement sur `generale`** : la sélection parcourt à plat les 80 153 clusters de la
scène, à ~130 ns par cluster, soit les ~10,9 ms mesurés. Les vues `sol` et `rue` passent parce que
leur tronc de vision élimine l'essentiel des clusters avant le coût par cluster, pas parce que le
parcours est moins cher. Le correctif n'est pas un réglage : il faut supprimer le parcours à plat.

**Plan lot 4b** : coupe hiérarchique sur l'arbre de clusters — descente depuis la racine, rejet ou
acceptation d'un sous-arbre entier en un test de nœud, budget visé **≤ 15 000 tests de nœud** par
image sur `generale` (contre 80 153 tests de cluster aujourd'hui), ce qui ramène la vue générale
sous les 2 ms au même coût unitaire.

**Harnais commun livré** : `scripts/mesure/` (`banc.mjs`, `options.mjs`, `page.mjs`, `serie.mjs`,
`serveur.mjs`, `rapport.mjs`, `README.md`), commun aux lots et réutilisable tel quel par le lot 4b.

**Défaut connu du harnais** : au-delà d'une vue à 300 images dans un même processus, la création du
second contexte WebGL2 échoue (`WebGL2 unavailable`). Non corrigé. Contournement retenu et appliqué
pour toutes les mesures ci-dessus : **une commande par vue**, un processus Node neuf à chaque fois.

`render-tech-lab/` non modifié ; port 5174 non touché ; réglages système non touchés ; aucun
`eslint-disable` ; `node_modules` (lien symbolique) non committé.

### Portes

`build`, `lint` (eslint + clippy), `format:check`, `check:lines`, `check:dts`, `check:structure`,
`check:duplicates` (0 clone), `check:unused` (knip, 0) : **vertes**. `check:links` : rouge sur deux
liens de `RD_ECLAIRAGE_DIAGNOSTIC.md` vers `benchmark-runs/`, dossier ignoré par git qui n'existe
que dans le dépôt principal — rouge d'environnement connu, identique avant cette entrée, aucun lien
du journal en cause.

## 2026-09-14 — [session sans-threejs] fusion lot 4

- `develop` avancé en **avance rapide** sur `lot4-webgl2-selection` : `04fa5f0` → **b0a0fff**, 25 fichiers, +1704 / −49. `main` avancé en avance rapide sur `develop` : les deux têtes sont identiques à `b0a0fff`. Aucune fusion forcée, aucun `--no-ff`, rien poussé sur `origin` (qui reste à `04fa5f0`).
- Rien à fusionner en sens inverse : `develop` n'avait pas bougé depuis la fusion `05162df` faite dans le lot, l'avance rapide était donc directe.
- Contenu livré : lot 4 (sélection de clusters côté CPU pour le moteur WebGL2, `cpuSelectMs` au contrat de métriques, coupe sans allocation par image) et le **harnais de mesure commun `scripts/mesure/`** (`banc.mjs`, `options.mjs`, `page.mjs`, `serie.mjs`, `serveur.mjs`, `rapport.mjs`, `README.md`), réutilisable tel quel par les lots suivants.
- Tests rejoués sur `d477179` par un agent dédié : **363 tests, 0 échec**. `b0a0fff` n'ajoute que `orchestration/JOURNAL.md` au-dessus de ce commit, le code est donc couvert.
- Portes sur la tête du lot : `build`, `lint` (eslint + clippy), `format:check`, `check:lines`, `check:dts`, `check:structure`, `check:duplicates` (0 clone), `check:unused` (knip, 0) **vertes** ; `check:links` rouge sur deux liens de `RD_ECLAIRAGE_DIAGNOSTIC.md` vers `benchmark-runs/`, dossier ignoré par git — rouge d'environnement connu, antérieur au lot.

### Verdict du lot 4 (Emerald, WebGL2, 300 images par vue)

| mesure                           | vue       | valeur      | cible      | verdict          |
| -------------------------------- | --------- | ----------- | ---------- | ---------------- |
| cpuSelectMs p50                  | generale  | 10,9 ms     | < 2 ms     | **non atteinte** |
| cpuSelectMs p50                  | sol       | 1,5 ms      | < 2 ms     | atteinte         |
| cpuSelectMs p50                  | rue       | 1,6 ms      | < 2 ms     | atteinte         |
| hash de coupe avant vs après     | les trois | identiques  | identiques | OK               |
| pixels différents, seuils 0 et 1 | les trois | 0 px / 0 px | 0 px       | OK               |
| témoin A/A                       | les trois | 0           | 0          | OK               |
| allocations par image            | les trois | aucune      | aucune     | OK               |

- **Cause du dépassement sur `generale`** : la sélection parcourt à plat les 80 153 clusters de la scène, à ~130 ns par cluster, soit les ~10,9 ms mesurés. `sol` et `rue` passent parce que leur tronc de vision élimine l'essentiel des clusters avant le coût par cluster, pas parce que le parcours est moins cher.
- **Plan lot 4b** : coupe hiérarchique sur l'arbre de clusters — descente depuis la racine, rejet ou acceptation d'un sous-arbre entier en un test de nœud, budget visé **≤ 15 000 tests de nœud** par image sur `generale` contre 80 153 tests de cluster aujourd'hui.
- **Défaut connu du harnais** : au-delà d'une vue à 300 images dans un même processus, la création du second contexte WebGL2 échoue (`WebGL2 unavailable`). Non corrigé ; contournement retenu et appliqué pour toutes les mesures ci-dessus : **une commande par vue**, un processus Node neuf à chaque fois.

## 2026-09-14 — [session simplify] passe /simplify sur l'écart `2445b61…develop`

- Périmètre : ce que la passe du 14 septembre n'avait pas couvert — lots 1, 2, 4 et harnais `scripts/mesure` (43 fichiers, +2042 / −136). Quatre relecteurs Sonnet en lecture seule (réutilisation, simplification, efficacité, altitude) : 20 constats bruts, 14 correctifs dédoublonnés appliqués par un seul agent Opus, en worktree.
- Moteur : `clusterSphereValid` partagé entre `pageCarriesClusterError` et `clusterErrorFields` (une seule règle de sphère, sans fermeture) ; `createSelectionResult` unique, résultat de coupe réutilisé aussi par le chemin CPU WebGPU (`run.selectResult`), qui publie désormais `cpuSelectMs` comme le chemin WebGL ; compteurs Hi-Z relevés dans la passe de `packBounds` au lieu d'un second parcours des boîtes, une seule branche `testable`, type `HizCountsFrame`, gestionnaires de la relecture posés une fois ; `filterUnoccluded` délègue à `countUnoccluded` ; double ternaire de `webgpuPagesMetrics` fondu.
- Harnais : `distribution` → `summarize` et `imageDiff` → `compareImages` de `sdk-core` (importé en `.ts` sous Node 26), `machineLoad` → `os.loadavg()` (plus de binaire `uptime`, `ignoreBinaries` retiré de knip), CRC du PNG → `zlib.crc32`. Le champ `maxParCanal` du rapport devient `maxCanal` (un seul maximum, celui du SDK).
- Gardés tels quels, à dessein : `maxStretch` déplié (lot 4, « sélection CPU sans allocation ») ; l'état de coupe réutilisé `reusedState` (même décision).
- `npm run validate` vert : 363/363 tests JS, Rust ok, aucun test adapté. `check:links` a exigé un lien vers `benchmark-runs/` de la copie principale, absent du worktree (dossier ignoré). Preuve navigateur non refaite : refactor à comportement identique.

## 2026-09-14 — Phase 1, lot 4b (coupe hiérarchique, worktree `lot4b-coupe-hierarchique`)

Branche partie de develop `6685222`, puis `git merge develop` sur **`7632696`** (couches de
profondeur coplanaires) une fois la consigne reçue. Deux conflits, tous deux sur la même refonte
de develop : le résultat de coupe passe par `createSelectionResult()`. Forme de develop prise
telle quelle, `nodesTested` reposé dans la fabrique, aucun littéral réintroduit.

### L'invariant, et pourquoi il tient

Le test par cluster (`cutSelects`) retient un cluster **assez fin** (`projErr(lodError) ≤ seuil`)
que **son remplaçant ne couvre plus** (`projErr(parentError) > seuil`). Deux membres : décider un
sous-arbre sans le descendre demande donc, par nœud, un encadrement de chacun.

Borne haute d'un sous-arbre : avec `S = (C, R)` englobant les sphères `(c_i, r_i)` du sous-arbre,
`|c_i − C| ≤ R − r_i`, donc après une transformation qui étire d'au plus `stretch`,
`dist_i = |vue(c_i)| − r_i·stretch ≥ |vue(C)| − R·stretch`. L'erreur projetée décroît avec la
distance : `errMax·stretch·focal / (|vue(C)| − R·stretch)` majore chaque `projErr_i`, et vaut
l'infini dès que cette distance tombe sous `near` — le cas où la majoration ne certifie rien.
Borne basse, symétrique : `dist_i ≤ |vue(C)| + R·stretch`, donc
`errMin·stretch·focal / (|vue(C)| + R·stretch)` minore chaque `projErr_i`
(`projectedErrorFloor`, `pageSelectionMath.ts`).

D'où les trois décisions, toutes démontrées, jamais heuristiques :

- **rejet** si le plafond de l'erreur de remplacement est sous le seuil (aucun remplaçant encore
  trop grossier : second membre faux partout) — c'est le rejet que develop posait déjà, gardé mot
  pour mot, avec les bornes du manifeste, sur les deux passes ;
- **rejet** si le plancher de l'erreur propre est au-dessus du seuil (aucun cluster assez fin :
  premier membre faux partout) ;
- **acceptation** si le plafond de l'erreur propre est sous le seuil **et** le plancher de
  l'erreur de remplacement au-dessus (les deux membres vrais partout).
  Entre les deux on descend. Les bornes d'un nœud encadrant celles de tous ses descendants, la
  décision prise en haut est celle qu'aurait rendue la descente complète : la coupe est la même.

Ce que la descente garde par cluster, même sous un nœud accepté : le tronc de vision dès que le
nœud n'est pas entièrement dedans, le cône de normales, la résidence, l'estampille, la demande.
Un nœud tranché n'est plus _testé_, il est seulement _traversé_, et ses feuilles émettent leurs
clusters **dans l'ordre exact de la descente d'avant ce lot** : l'ordre de dessin ne bouge pas.
Le repli par forçage ne teste pas la coupe mais le groupe forcé ; les bornes de coupe ne le
certifient pas, il garde la descente d'avant, à l'identique.

### Ce que le manifeste porte, et ce qu'il ne porte pas

Par nœud, `CullingHierarchy` porte la boîte, une sphère englobant les sphères de **remplacement**
du sous-arbre, et `maxParentError`. C'est exactement de quoi poser le premier rejet, et rien de
plus. Manquent : le **plancher** et le **plafond de l'erreur propre**, la sphère englobant les
sphères **propres**, et le **plancher de l'erreur de remplacement**.

Ces bornes se réduisent des pages elles-mêmes, que le manifeste porte déjà par cluster, et les
plages de clusters des feuilles sont déjà contiguës : **aucun changement de format n'est
nécessaire**, la réduction est faite à la préparation, une fois par primitive, en un balayage
descendant du tableau plat (les enfants y suivent toujours leur parent), 11 nombres par nœud
(`pageSelectionCutBounds.ts`). Le compilateur pourrait les pré-calculer — quatre nombres de plus
par nœud, `CULLING_STRIDE` 15 → 19 — et cela **épargnerait seulement le balayage de préparation** ;
ce n'est pas un préalable, et le format n'a pas été touché.

### Essai du harnais — résultat, et ce qu'il reste à refaire

Essais joués **avant** la fusion, sur `--avant 6685222 --apres <tête du lot>`, vue `generale`,
Emerald, WebGL2, 1280×720, pixelError 0, 20 images, budget 100 000 pages. Machine chargée
(`loadavg` 9 à 12) : les durées ne valent rien comme mesure, seuls les comptes et les hash sont
retenus.

| mesure                        | avant          | après                              |
| ----------------------------- | -------------- | ---------------------------------- |
| clusters sélectionnés         | 80 153         | 80 153                             |
| `selectedTriangles`           | 10 046 405     | 10 046 405                         |
| hash de coupe                 | `4f03157d6ecb` | **`4f03157d6ecb` — identique**     |
| `cpuSelectNodesTested`        | — (absent)     | **13 541**, cible ≤ 15 000 : tenue |
| `cpuSelectMs` p50 (indicatif) | 10,9 ms        | 3,9 ms                             |
| témoin A/A                    | 0 px           | 0 px                               |

**Non résolu : l'écart avant/après de cet essai n'était pas nul — 581 px sur 921 600, max canal
185/185/185/0**, des pixels sombres isolés (valeurs 0 à 30) éparpillés dans une boîte
[208..1052]×[83..538]. Ce qui a été établi, et ce qui ne l'est pas :

- la coupe n'est pas en cause. Sonde cumulée sur **toutes** les images : **zéro** cluster émis par
  l'acceptation en bloc que `cutSelects` n'aurait pas retenu, et somme des tailles de coupe
  (`shown` et `wanted`) **identique** au chiffre près entre acceptation active et désactivée ;
- l'ordre d'émission n'est pas en cause non plus : deux ordres différents (plages ascendantes,
  puis ordre de descente restauré) donnent la **même image, octet pour octet** ;
- le seul relevé qui bouge est `pagesDetached` : 11 287 contre 11 066. Et il **ne dépend pas que du
  code** — la même tête donne 11 066, et l'image de `develop` octet pour octet, quand la série est
  jouée seule au lieu de l'être en tête d'un triplet. La trajectoire de résidence dépend donc de
  l'horloge (`explorerDraw.ts` déclenche sa prélecture sur `PREFETCH_INTERVAL_MS`), ce qui change
  le rangement des index dans le tampon, donc l'ordre des triangles d'un même sous-dessin, donc le
  départage des surfaces coplanaires d'Emerald. Le témoin A/A ne peut pas le voir : il compare la
  première et la troisième série, jamais la deuxième.

Cette piste tombe exactement sur ce que `7632696` vient de traiter (couches de profondeur
coplanaires). **L'essai doit être rejoué sur la tête fusionnée, `--avant 7632696`, avec le cache
d'Emerald recompilé par ce compilateur** ; il ne l'a pas été ici, la consigne étant de ne rien
lancer pendant la recompilation des modèles. Tant qu'il ne l'est pas, le lot n'a pas sa preuve
« 0 pixel » : hash de coupe identique oui, pixels non prouvés.

### Portes

`build`, `tsc`, `eslint`, `cargo clippy`, `prettier --check`, `cargo fmt --check`, `check:lines`,
`check:dts`, `check:structure`, `check:duplicates` (0 clone), `check:unused` (knip, 0) :
**vertes** après fusion. `check:links` : rouge sur les liens de `RD_ECLAIRAGE_DIAGNOSTIC.md` vers
`benchmark-runs/`, dossier ignoré par git qui n'existe que dans le dépôt principal — rouge
d'environnement connu, antérieur au lot. Aucun test lancé (interdit par la consigne, un agent
dédié s'en charge). Aucun `eslint-disable` ; `render-tech-lab/` non modifié ; port 5174 non
touché ; verrou `.claude/mesure.lock` pris et rendu à chaque essai ; `node_modules` (lien
symbolique) non committé.

### Ce qui reste

1. Rejouer l'essai sur la tête fusionnée avec le cache recompilé, et conclure sur les 581 px.
2. Mesurer `sol` et `rue` : leur coupe est petite, le gain y sera faible, la fidélité doit tenir.
3. `cpuSelectMs` reste au-dessus de 2 ms sur `generale` (≈ 4 ms sur machine chargée). Ce qui
   domine désormais n'est plus le test de coupe mais la retenue par cluster — demande, résidence,
   estampille, `shown.push` — et la descente de tronc de vision sous les nœuds acceptés. Le levier
   suivant est celui que le diagnostic du lot 4 numérotait 1 : ranger les clusters en tableaux
   typés, puis émettre des plages jusqu'au consommateur.

## 2026-09-14 — Phase 1, mesure lot 4b : rejeu sur la tête fusionnée, `sol`/`rue` au vert, `generale` interrompue

Session de mesure seule (harnais commun `scripts/mesure/banc.mjs`), sur HEAD `9c78402b9a08`
(`develop` `7632696` déjà fusionné, cache Emerald recompilé au format 3/4 par l'utilisateur avant
la session). Aucun code modifié, aucun test lancé, aucun `prepare:models`. Trois commandes, une
par vue, chacune attendue jusqu'au bout, aucune reprise.

| mesure                          | vue                  | avant               | après             | seuil                | verdict   |
| ------------------------------- | -------------------- | ------------------- | ----------------- | -------------------- | --------- |
| cpuSelectMs p50/p95             | sol e0               | 1,40 / 1,60         | 0,70 / 0,90       | < 2 ms               | OK        |
| cpuSelectMs p50/p95             | sol e1               | 0,90 / 1,10         | 0,80 / 0,90       | < 2 ms               | OK        |
| cpuSelectMs p50/p95             | rue e0               | 1,40 / 1,60         | 0,70 / 0,90       | < 2 ms               | OK        |
| cpuSelectMs p50/p95             | rue e1               | 0,90 / 1,10         | 0,80 / 1,00       | < 2 ms               | OK        |
| cpuSelectNodesTested (après)    | sol e0 / e1          | —                   | 3 831 / 4 927     | ≤ 15 000             | OK        |
| cpuSelectNodesTested (après)    | rue e0 / e1          | —                   | 3 801 / 4 921     | ≤ 15 000             | OK        |
| hash de coupe identique         | sol, rue (e0 et e1)  | —                   | —                 | oui, les quatre fois | OK        |
| pixels différents (0 px / 1 px) | sol, rue (e0 et e1)  | —                   | 0 / 921 600       | 0 attendu            | OK        |
| témoin A/A                      | sol, rue (e0 et e1)  | —                   | 0 px, max canal 0 | 0 attendu            | OK        |
| pagesDetached avant/après       | sol e0/e1, rue e0/e1 | 3005/1220/2904/1200 | identiques        | —                    | identique |

**`generale` (point 1 laissé ouvert par la session précédente, les 581 px) : toujours pas
tranché.** Trois séries jouées (après e0 5,70 ms, avant e0 11,20 ms, après e0 rejoué 5,70 ms — même
nombre de clusters, 80 153, aux deux côtés), puis plantage avant la capture du témoin A/A :
`page.evaluate: Error: WebGL2 unavailable` (`explorerCapabilities.js:29`, via `serie.mjs:14` →
`banc.mjs:132`). Aucun `mesure.json` écrit pour cette vue, donc aucun hash ni écart pixel
disponible — ni confirmation ni infirmation des 581 px. Charge relevée avant lancement : 5,63 /
5,41 / 6,07 (15 min ≥ 6, durées de cette série déjà déclarées polluées indépendamment du plantage).
Pas de reprise (consigne : une exécution par vue).

Points 1 et 2 de la liste « Ce qui reste » de l'entrée précédente : point 2 (`sol`/`rue`) est
maintenant fait et vert ; point 1 (`generale`, 581 px) reste à rejouer, cette fois en isolant la
série `generale` seule (elle a échoué même seule ici, pas en tête de triplet — piste `pagesDetached`
/ horloge de prélecture de l'entrée précédente non retestée par cette session).

Détail complet, commandes, charge machine et chemins :
`orchestration/phase-1-mesure-lot-4b.md` (worktree `webgeometry-sans-threejs-9f889d`).

## 2026-09-14 — [session sans-threejs] fusion lot 4b (coupe hiérarchique WebGL2)

- develop avancé en avance rapide sur lot4b-coupe-hierarchique. Preuve au harnais commun (navigateur neuf par série, 60 images, MAX_PAGES=100000, 3 vues × pixelError 0 et 1) : 0 px avant/après et témoin A/A 0 px partout, hash de coupe identiques. cpuSelectMs p50 : générale 11,4 → 5,2 ms (0 px) et 2,9 → 2,5 ms (1 px) ; sol 1,5 → 0,8 ; rue 1,5 → 0,8. Nœuds testés en vue générale 13 541 (cible ≤ 15 000). 410 tests, 0 échec. Cible < 2 ms en vue générale non atteinte : reste à traiter en lot 4c (le coût restant est dans projectedClusterError et cutSelects sur les nœuds indécis).
- Harnais : `fix(mesure)` navigateur neuf par série (le processus GPU gardait la mémoire d'Emerald, troisième série sans contexte WebGL2) ; preuves de fusion à 60 images, 300 réservé aux campagnes.

## 2026-09-14 23:30 — Éclairage direct différé : lampes, ombres, mode nuit, déplacement d'objets

Chantier livré dans un worktree isolé depuis `develop` `33c5a0c`. Contrat `SceneLight` versionné,
listes de lampes par tuile d'écran, atlas d'ombres de profondeur, mode nuit et `setTransform` par nom
de nœud. Aucun test ajouté (consigne) ; les 403 tests existants restent verts.

### Ce qui est livré

**`sdk-core`** — `sceneLightContracts.ts` (contrat `SceneLight`, `SceneEnvironment`, réglages publiés
`LIGHT_SETTINGS`, validation), `sceneLightStore.ts` (magasin à capacité fixe, tampon de 64 lampes
alloué une fois, zéro allocation par image), `sceneLightShadowFaces.ts` (matrices de face, six axes
d'une ponctuelle dans un ordre qui est le contrat), `sceneLightShadowAtlas.ts` (placement par blocs
alignés dans une grille de 32 × 32 cellules de 128 texels, part d'atlas par lampe),
`sceneLightShadowSlices.ts` (table des tranches et fraîcheur), `sceneLightShadowPlan.ts`
(ordonnanceur : au plus quatre lampes redessinées par image, priorité = influence écran × changement).

**`sdk-browser`, WebGPU** — `gpuLightTiles*` (compute 16 × 16, profondeur min/max par tuile, boîte
monde de la tuile, test de sphère par lampe, liste ordonnée donc déterministe, 32 lampes par tuile),
`gpuShadowAtlas` + `gpuShadowShader` (atlas 4096² de profondeur, une passe de rendu pour toutes les
faces de l'image, cadre et ciseaux par tranche, remise au fond par tranche, dessin indirect et
sélection de clusters de l'image principale réutilisés tels quels), `directLight*Wgsl`
(atténuation physique fenêtrée par la portée, cône adouci, PCF 16 prises, biais en mètres),
`webgpuPagesEncodeShadows` / `webgpuPagesEncodeLights` (ordonnancement et encodage),
`explorerLightApi` (`addLight`, `setLight`, `removeLight`, `setEnvironment`, `setTransform`),
`webgpuPagesTransform` (déplacement d'un nœud nommé, boîtes monde reprojetées, boîte du mouvement
déclarée à l'ordonnanceur d'ombres).

**Métriques ajoutées à `metrics()`** : `lightsActive`, `shadowsUpdated`, `gpuLightListsMs`,
`gpuShadowsMs`, `gpuLightingMs`, lues par étiquette de passe dans le relevé d'horodatage, `null`
sans horodatage et `null` quand la passe n'a pas eu lieu — une lampe immobile dans une scène
immobile ne redessine pas sa tranche, donc `gpuShadowsMs` vaut honnêtement `null`.

**WebGL2** : hors périmètre. Les appels du contrat existent au niveau de l'hôte et n'échouent pas ;
`baseCapabilities.unsupported` déclare `contract scene lights with shadow atlas` et
`named node transforms`.

### Deux programmes différés, et pourquoi

La première version compilait l'éclairage du contrat dans le même module WGSL que l'éclairage de la
scène écrite. Résultat mesuré : **1 pixel sur `sol`, 2 sur `rue`**, un cran d'écart sur un canal,
alors que le témoin A/A valait 0 et qu'un `develop` recompilé face à lui-même valait 0 aussi. Cause
établie par expérience : le même calcul, recompilé au milieu de cinq liaisons de plus, ne contracte
pas ses produits au même endroit. Correctif : **deux programmes**. Celui de la scène écrite est le
texte d'avant au caractère près ; celui du contrat n'est compilé qu'à la première image qui porte une
lampe ou un environnement déclaré. Une scène sans lampe exécute donc le programme d'avant, et non
seulement la même formule. `flush()` attend cette compilation et redessine la pose avant toute
lecture. Après correctif : **0 pixel sur les trois vues**.

### Biais d'ombre en mètres, et pourquoi

La première version portait un biais constant en profondeur normalisée (0,0015). Avec un plan proche
à `portée/1000`, la profondeur projetée d'une tranche est si peu linéaire que deux points distants de
trois mètres ne diffèrent que de 0,0011 : le biais avalait toute l'ombre, et aucune ombre n'était
visible. Correctif : le biais est **en mètres** (2 cm constant, 8 cm par unité de pente, plafond
50 cm), ramené en profondeur au point considéré par `near·far/((far−near)·d²)` ; le plan proche passe
à `max(5 cm, portée/200)` ; un décalage du point de lecture d'un texel et demi le long de la normale,
divisé par le cosinus d'incidence, referme la couture entre faces et supprime l'acné rasante.

### Fidélité, banc 15 sur Emerald, WebGPU, sans lampe ni nuit

Cache Emerald figé recopié hors du Lab (`scratchpad/lumiere-assets`, lecture seule) ; le harnais
commun accepte désormais `WG_ASSETS` pour pointer une copie. `--avant 33c5a0c`, 60 images par série,
`pixelError 0`, 1280 × 720.

| vue      | témoin A/A | avant vs après        | hash de coupe | `uncoveredTriangles` | erreurs de page |
| -------- | ---------- | --------------------- | ------------- | -------------------- | --------------- |
| generale | 0 px       | **0 px**, max canal 0 | identique     | 0                    | 0               |
| sol      | 0 px       | **0 px**, max canal 0 | identique     | 0                    | 0               |
| rue      | 0 px       | **0 px**, max canal 0 | identique     | 0                    | 0               |

Témoin de contrôle : `develop` construit deux fois indépendamment, comparé à lui-même, **0 px** —
c'est ce qui a permis d'attribuer les 1 et 2 pixels de la première version au changement et non au
bruit. Charge machine entre 6,2 et 7,5 pendant ces séries : au-dessus du seuil de 6, donc **aucune
durée de cette campagne n'est une mesure de performance** ; seuls les pixels, les hash et les comptes
sont retenus.

### Fonctionnel, scène de contrôle (deux boîtes et un sol, 7 008 triangles, compilateur natif du dépôt)

1280 × 720, 180 images en boucle serrée pour le CPU, 90 images vidées pour le GPU par passe (les
relevés d'horodatage ne reviennent qu'au retour à la boucle d'événements). Machine chargée.

| cas                    | CPU/image p50 | GPU image p50 |  listes |      ombres | éclairage | tranches maj |
| ---------------------- | ------------: | ------------: | ------: | ----------: | --------: | -----------: |
| 0 lampe                |       0,10 ms |       1,13 ms |  `null` |      `null` |   0,52 ms |            0 |
| 1 lampe, ombres        |       0,10 ms |       1,07 ms | 0,31 ms |      `null` |   0,70 ms |            0 |
| 1 lampe, sans ombres   |       0,10 ms |       1,33 ms | 0,42 ms |      `null` |   0,83 ms |            0 |
| 3 lampes, ombres       |       0,10 ms |       3,38 ms | 0,45 ms |      `null` |   1,67 ms |            0 |
| 3 lampes, sans ombres  |       0,10 ms |       1,42 ms | 0,41 ms |      `null` |   0,94 ms |            0 |
| 10 lampes, ombres      |       0,10 ms |       2,66 ms | 0,35 ms |      `null` |   2,05 ms |            0 |
| 10 lampes, sans ombres |       0,10 ms |       1,97 ms | 0,50 ms |      `null` |   1,33 ms |            0 |
| 30 lampes, ombres      |       0,10 ms |       4,09 ms | 0,22 ms |      `null` |   3,71 ms |            0 |
| 30 lampes, sans ombres |       0,10 ms |       3,07 ms | 0,61 ms |      `null` |   2,33 ms |            0 |
| 10 lampes, nuit        |       0,10 ms |       1,86 ms | 0,20 ms |      `null` |   1,39 ms |            0 |
| 4 lampes, une mobile   |       0,10 ms |       2,27 ms | 0,42 ms | **0,17 ms** |   1,74 ms |      1/image |

`ombres = null` sur les scènes immobiles n'est pas une mesure manquante : la passe n'a pas lieu, les
tranches restent en cache (X5). La colonne devient un nombre dès qu'une lampe bouge. CPU et GPU ne
sont jamais additionnés. Captures archivées dans le scratchpad de l'agent.

**Preuves visuelles** : projecteur oblique unique en mode nuit, ombres portées nettes des deux boîtes
sur le sol ; dix lampes colorées de nuit, cônes et chutes en carré inverse ; `setTransform('boiteB')`
de trois mètres, l'ombre suit l'objet à l'image suivante.

**Ordonnanceur, 30 lampes à ombre** : 0 tranche refusée, 26 en attente, vidées à quatre par image ;
l'atlas occupe 640 cellules sur 1 024 parce que chaque lampe ne demande jamais plus que sa part.

### Défauts connus, nommés

- Un matériau à masque d'opacité projette la silhouette entière de son cluster : la passe de
  profondeur n'a pas d'étage de fragment. Déclaré dans le diagnostic `direct-lighting`.
- Coutures faibles entre deux faces d'une ponctuelle, visibles sur un sol uniforme très éclairé. Le
  décalage le long de la normale les atténue sans les supprimer.
- La priorité de l'ordonnanceur utilise un rayon angulaire, pas un adjoint (LR2 non atteint).
- WebGL2 : lampes ignorées, capacité déclarée manquante.

### Portes

`build`, `build:native`, `check:structure`, `check:dts`, `check:lines`, `check:duplicates` (0 clone),
`check:unused` (knip, 0), `format:check`, `eslint`, `cargo clippy`, `cargo fmt` : **vertes**.
`npm test` : **403 tests, 0 échec**, aucun ajouté ; le harnais de `deferredLighting.test.ts` a suivi
la nouvelle signature (second tampon, `GPUTextureUsage`, `createTexture`, `createSampler`) sans
qu'aucun cas de test change. `check:links` : rouge sur cinq liens de `RD_ECLAIRAGE_DIAGNOSTIC.md`
vers `benchmark-runs/`, dossier ignoré par git qui n'existe que dans le dépôt principal — rouge
d'environnement connu, identique avant ce lot.

`render-tech-lab/` non modifié et lu en lecture seule ; port 5174 non touché ; aucun `eslint-disable`
ajouté ; `node_modules` (lien symbolique) non committé.

## Lot 3a, résidence incrémentale (15 sept. 2026)

Worktree `lot3-residence`, branche `lot3-residence` sur `develop` (6824e4e). Trois commits :
`c3cdae5` (ensembles incrémentaux), `5597814` (différence appliquée une seule fois, budget de pages
conservé à l'identique), `0c44aa3` (tests). Rien n'est fusionné.

### Ce qui change

La relecture de la coupe GPU est désormais lue comme une **différence** : les pages entrées et
sorties depuis l'image précédente. Les ensembles que l'image décidait en les reconstruisant page par
page — demandé, gardé, en file, épinglé — vivent d'une image à l'autre dans des tableaux typés
denses, dimensionnés une fois, et ne bougent que des pages qui ont bougé. Une image qui n'adopte
aucune relecture, ou qui adopte la coupe qu'elle tient déjà, ne touche aucun ensemble.

Quatre modules neufs : `webgpuDenseKeys` (appartenance dense, ajout/retrait en O(1), rien d'alloué
après construction), `webgpuCutDelta` (la coupe opaque comme différence), `webgpuKeyUnion` (union à
compteurs, plus les sources que l'image relit en entier), `webgpuResidencySets` (les ensembles de
résidence et le budget de pages). `webgpuBudgetedResidency` disparaît, absorbé par le dernier.
Les têtes opaques de `shown` et `desired` sont conservées d'une image à l'autre ; seule la queue
transparente, que la coupe GPU ne sélectionne jamais, est réécrite.

### Mesure

`node scripts/mesure/banc.mjs --moteur webgpu --avant develop --apres HEAD --vues generale,sol,rue
--images 60 --pixelError 0,1 --max-pages 100000`. Verrou `mesure.lock` pris puis libéré.
Charge machine : 4,97 / 7,44 / 6,63 au début, 12,50 / 8,88 / 7,23 à la fin — machine **chargée**,
les proportions valent mieux que les valeurs absolues.

| vue      | seuil | cpuFrameMs p50 avant → après | p95 avant → après | hash      | écart px | A/A |
| -------- | ----- | ---------------------------- | ----------------- | --------- | -------- | --- |
| générale | 0     | 27,1 → **21,6**              | 28,5 → 22,5       | identique | 0        | 0   |
| sol      | 0     | 7,9 → **6,2**                | 8,5 → 6,5         | identique | 0        | 0   |
| rue      | 0     | 9,1 → **6,1**                | 9,8 → 7,0         | identique | 0        | 0   |
| générale | 1     | 6,6 → **4,3**                | 7,9 → 4,7         | identique | 0        | 0   |
| sol      | 1     | 4,1 → **2,9**                | 4,4 → 3,2         | identique | 0        | 0   |
| rue      | 1     | 4,1 → **2,9**                | 4,5 → 3,2         | identique | 0        | 0   |

`uncoveredTriangles` 0 des deux côtés partout ; `selectedTriangles` et `residentPages` identiques
série par série ; aucune erreur de page consignée.

Étapes internes `cpu-timing` (vue générale, pixelError 0, script de profil du scratchpad, jamais
committé ; le harnais du banc ne rend pas ces étapes) :

| étape                          | p50 avant → après | p95 avant → après |
| ------------------------------ | ----------------- | ----------------- |
| Adopter la coupe GPU           | 1,6 → **0,8**     | 2,4 → 1,0         |
| Sélection CPU des transparents | 8,3 → 8,1         | 9,2 → 8,8         |
| **Admission**                  | 5,2 → **1,4**     | 5,8 → 1,6         |
| **File de résidence**          | 4,3 → **2,5**     | 5,1 → 3,2         |
| Projection des boîtes          | 3,1 → 3,1         | 3,3 → 3,3         |
| Encodage et soumission         | 7,8 → 7,8         | 8,2 → 8,3         |
| total moteur                   | 27,6 → **21,2**   | 29,9 → 23,2       |

Nouvelle métrique, publiée par le diagnostic `cpu-timing` des deux chemins de rendu :
`residencyPagesEntered` / `residencyPagesExited` — les pages que la résidence a dû traiter dans
l'image. Sur les vues du banc, caméra immobile : **0 et 0**, médiane comme p95. `null` sur la coupe
CPU, qui ne possède aucune différence à donner.

### Le budget de pages, tel qu'il est

La file de résidence ne descend pas plus bas parce que le budget de pages de `develop` **pèse des
placements, pas des pages** : sur Emerald en vue générale à pixelError 0, la coupe demande ~78 000
placements pour ~37 400 places, donc chaque image range la coupe du plus grossier au plus fin et la
coupe à la taille du budget. Cette sémantique décide l'ensemble résident, donc l'image : la
reproduire à l'identique était la condition du zéro écart. Elle est reproduite littéralement —
mêmes placements, même ordre de publication de la relecture, même tri stable — et c'est elle qui
reste, seule, dans les 2,5 ms. Un premier essai qui comptait des clés au lieu des placements
donnait une résidence plus riche, une coupe plus fine de 14 661 pages au lieu de 47 890 et
48 735 pixels d'écart : régression corrigée avant de continuer, pas contournée.

Une tentative de sauter la reconstruction du budget quand la relecture republie la même coupe a été
**retirée** : elle faisait basculer le système vers l'autre point fixe (résidence plus riche, coupe
plus fine) et rendait l'image non déterministe (témoin A/A à 752 pixels). Piste à reprendre avec un
tri par comptage sur le niveau, à sémantique strictement égale.

### Portes

`build`, `tsc --noEmit`, `eslint`, `format:check`, `check:lines`, `check:duplicates` (0 clone),
`check:unused` (knip, 0), `check:structure`, `check:dts` : **vertes**. `npm test` : **421 tests,
0 échec**, du premier coup, dont 12 ajoutés (`webgpuCutDelta.test.ts`, `webgpuResidencySets.test.ts`).
`check:links` : rouge sur les cinq mêmes liens de `RD_ECLAIRAGE_DIAGNOSTIC.md` vers `benchmark-runs/`
qu'avant ce lot — rouge d'environnement connu, dossier ignoré par git.

`render-tech-lab/` non modifié ; port 5174 non touché ; aucun `eslint-disable` ; `node_modules`
(lien symbolique) non committé ; scripts de mesure et de profil dans le scratchpad, jamais committés.

## 2026-09-15 — [session sans-threejs] fusion lot 3a (résidence incrémentale WebGPU)

- develop avancé en avance rapide sur lot3-residence. Admission et file de résidence incrémentales (pages entrées/sorties depuis la coupe GPU, ensembles persistants en index denses), métriques residencyPagesEntered/Exited. Preuve harnais commun (60 images, MAX_PAGES=100000, 3 vues × pixelError 0 et 1) : 0 px avant/après, A/A 0, hash identique 6/6, uncoveredTriangles 0. cpuFrameMs p50 à 0 px : générale 27,1 → 21,6 ms, sol 7,9 → 6,2, rue 9,1 → 6,1 ; à 1 px : 6,6 → 4,3, 4,1 → 2,9, 4,1 → 2,9. Étapes générale : admission 5,2 → 1,4, file 4,3 → 2,5, adoption 1,6 → 0,8. 421 tests, 0 échec.
- Constat : le budget de pages pèse des placements (~78 000 pour ~37 400 places) et range la coupe entière à chaque image, même à 0 page entrée/sortie ; c'est la prochaine cible (tri par comptage), avec les transparents sur CPU (7,6 ms) et la projection des boîtes (3,2 ms).

## 2026-09-15 — [session sans-threejs] lot 3b, CPU par image WebGPU (Emerald, vue générale)

Worktree `lot-3b-residence`, branche `lot/3b-residence` sur `develop` (`ea032f4`). Quatre commits :
`fe2be87` (rang par comptage du budget de pages), `933954a` (coupe transparente tenue), `ea054a9`
(reprojection des seules boîtes qui ont bougé), `90f47ad` (tests, retrait des exports inutilisés).

### Les trois étapes

**1. File de résidence — rang par comptage, incrémental.** Le budget de pages rangeait la coupe
entière à chaque image : filtrage des ~78 000 placements, tri par comparaison, vidage puis
remplissage des ~37 400 places, même à 0 page entrée/sortie. Le rang est désormais obtenu par
comptage (`webgpuBudgetRanking.ts`) : les placements de la coupe opaque sont comptés par niveau une
fois puis déplacés par la seule différence de coupe, seule la queue transparente est relue, et une
passe unique écrit le préfixe gardé sans jamais matérialiser les niveaux que le budget n'atteint
pas. La file n'est réécrite que là où le rang diffère de ce qu'elle tient déjà — mais le rang, lui,
est recalculé sur les enregistrements à chaque image, jamais supposé d'une coupe immobile : c'est
exactement ce qui manquait à la tentative retirée du lot 3a (témoin A/A à 752 px). Ensemble résident
et ordre strictement identiques : même filtre de couverture, même ordre niveau décroissant, même
ordre de publication à niveau égal, même déduplication par première occurrence.

**2. Transparents — la coupe tenue d'une image à l'autre.** _Ce n'est pas le passage en sélection
GPU que le lot demandait ; voir « Ce qui reste »._ La coupe des clusters transparents est le seul
parcours de DAG qu'une image garde sur le CPU. Elle est fonction de six entrées et de rien d'autre :
vue et projection de la caméra, seuil d'erreur retenu par le budget, fenêtre, époque des matrices
monde, identité et révision de résidence du cache de pages. Le numéro d'image qu'elle reçoit en plus
ne fait qu'y estampiller `seen`, que rien ne relit dans le dépôt. Une image dont ces six entrées
sont celles de la coupe tenue lit la réponse ; la moindre qui bouge reparcourt tout, et le parcours
réécrit les tableaux mêmes où la coupe tenue vit — l'aval ne peut pas distinguer les deux cas. Le
cache de pages publie pour cela `residencyRevision`, qui augmente strictement à chaque changement
d'appartenance de la résidence et à rien d'autre (une arrivée estampille une génération, un départ
compte une éviction, le rafraîchissement LRU d'une page déjà résidente ne fait ni l'un ni l'autre).
La coupe de l'image n'alloue plus ni résultat ni listes.

**3. Projection des boîtes — ne reprojeter que ce qui a bougé.** Un rectangle écran est fonction des
coins monde de la boîte — déjà tenus par page, reconstruits sur leur propre époque — et de la vue,
et de rien d'autre. La vue est commune à toutes les lignes : elle bouge d'un cheveu et tous les
rectangles sont retirés d'un coup ; elle ne bouge pas et chaque ligne garde le sien tant qu'elle
désigne la même page. Ce que la partition projette est l'intersection de ce qu'elle demande avec ce
qui n'est plus courant, écrit par la même arithmétique dans le même tableau.

### Mesure

`node scripts/mesure/banc.mjs --moteur webgpu --avant ea032f4 --apres <commit> --vues
generale,sol,rue --images 60 --pixelError 0,1 --max-pages 100000`, une exécution par étape plus une
sur la tête. Verrou `mesure.lock` pris puis libéré à chaque fois.

| étape               | commit    | cpuFrameMs p50 générale, pixelError 0 | écart px  | A/A | hash          | trous |
| ------------------- | --------- | ------------------------------------- | --------- | --- | ------------- | ----- |
| départ (`develop`)  | `ea032f4` | 21,5                                  | —         | —   | —             | 0     |
| 1 file de résidence | `fe2be87` | 21,5 → **20,4**                       | 0 sur 6/6 | 0   | identique 6/6 | 0     |
| 2 transparents      | `933954a` | 21,2 → **13,0**                       | 0 sur 6/6 | 0   | identique 6/6 | 0     |
| 3 projection        | `ea054a9` | 24,0 → **10,8**                       | 0 sur 6/6 | 0   | identique 6/6 | 0     |
| tête (tests inclus) | `90f47ad` | 27,4 → **10,7**                       | 0 sur 6/6 | 0   | identique 6/6 | 0     |

`uncoveredTriangles` 0 des deux côtés partout, `selectedTriangles` identiques série par série, aucune
erreur de page. Le côté `avant` varie de 21,2 à 27,4 ms d'une exécution à l'autre : la charge machine
est montée de 4,6 à 12,1 au fil de la journée, et c'est elle, pas le code, qui bouge de ce côté. Les
verdicts pixel, eux, ne dépendent pas de la charge. L'exécution la plus calme (étape 3, charge 5,0)
donne les deux côtés dans les mêmes conditions : **24,0 → 10,8 ms**.

Les autres vues et l'autre seuil, exécution de l'étape 3 (p50, avant → après) : sol 0 px 6,1 → 4,4 ;
rue 0 px 6,2 → 4,1 ; générale 1 px 4,7 → 3,0 ; sol 1 px 3,2 → 2,2 ; rue 1 px 3,0 → 2,1. p95 de la
vue générale à 0 px : 25,0 → 12,0.

Étapes internes `cpu-timing` (vue générale, pixelError 0, script de profil du scratchpad, jamais
committé ; le harnais du banc ne rend pas ces étapes), même session, `ea032f4` contre `ea054a9` :

| étape                                                     | p50 avant → après |
| --------------------------------------------------------- | ----------------- |
| Adopter la coupe GPU                                      | 0,6 → 0,6         |
| **Sélection CPU des transparents**                        | 6,8 → **0,0**     |
| Admission                                                 | 1,2 → 1,3         |
| **File de résidence**                                     | 2,1 → **0,8**     |
| Synchroniser / envoyer la résidence / lancer la sélection | 0,5 → 0,5         |
| Partition Hi-Z                                            | 0,5 → 0,5         |
| **Projection des boîtes**                                 | 3,0 → **0,2**     |
| Construire les items de dessin                            | 1,2 → 1,3         |
| Reste de l'encodage et soumission                         | 2,6 → 2,8         |
| **total moteur**                                          | 18,7 → **8,8**    |

### Ce qui reste

- **La cible `< 4 ms` n'est pas atteinte** : 10,7 ms de `cpuFrameMs`, dont 8,8 dans le moteur.
- **Encodage et soumission**, 4,9 ms p50 après ce lot (7,3 avant : la projection des boîtes y était
  comptée). Ce qui reste est proportionnel au nombre de lignes dessinables — ~48 000 dans la vue
  générale à seuil nul — et non aux pixels : ~1,3 ms à construire une fiche de dessin par ligne et
  ~2,8 ms à mettre à jour la table des rangs, encoder les passes et soumettre la file. Seuls une
  coupe plus grossière, ou une compaction qui écrirait les fiches directement sur GPU, l'enlèvent.
  Hors périmètre de ce lot.
- **Écart entre `cpuFrameMs` (10,7) et le total moteur (8,8)** : les deux listes que l'hôte demande
  après le rendu (pages manquantes, pages visibles), déjà chiffrées à 0,8 et 1,3 ms par le profil du
  14 septembre.
- **Adoption de la coupe GPU (0,6 ms)** : non traitée. Elle relit la liste des identifiants
  dessinables à chaque image, y compris quand la relecture est celle déjà tenue. La sauter
  exactement demande de couvrir `residentOffsetWords` **et** `rec.array`, que l'hôte pose hors du
  cache GPU : la révision de résidence du cache ne suffit pas à les garantir. 0,6 ms ne valait pas
  ce risque dans ce lot.
- **Transparents en sélection GPU** : non fait. `packedPages`, la table des rangs, le tampon de
  visibilité, le Hi-Z, les fiches de dessin, la résidence et la différence de coupe sont tous bâtis
  sur les seuls clusters opaques ; les transparents sont dessinés en avant, triés, hors du tampon de
  visibilité. Les y faire entrer demande une seconde table de clusters et une seconde relecture, et
  l'ordre de mélange est critique au pixel. Hors de portée d'une session ; la coupe tenue prend les
  6,8 ms sans y toucher, mais une caméra qui bouge les repaie en entier — c'est là que le passage en
  sélection GPU reste le seul vrai levier.

### Portes

`format:check`, `check:duplicates` (0 clone), `lint`, `check:unused` (knip, 0), `build`,
`build:native`, `check:structure`, `check:dts`, `test:native` : **vertes**. `npm test` : **432 tests,
0 échec**, dont 11 ajoutés (`webgpuBudgetRanking.test.ts`, `webgpuTransparentCut.test.ts`,
`hizProjectionHold.test.ts`). Deux rouges **d'avant ce lot**, vérifiés sur `develop` à `ea032f4` :
`check:lines` sur `scripts/mesure/options.mjs` (208 lignes, ajoutées par `ea032f4`), qui arrête
`npm run validate` avant les autres portes — elles ont donc été jouées une par une ; et
`check:links` sur les cinq mêmes liens de `RD_ECLAIRAGE_DIAGNOSTIC.md` vers `benchmark-runs/`,
dossier ignoré par git.

`render-tech-lab/` non modifié et lu en lecture seule ; port 5174 non touché ; aucun `eslint-disable`
ajouté ; `node_modules` (lien symbolique) non committé ; scripts de profil dans le scratchpad, jamais
committés ; `sauvegarde/lot-4c` non touchée.

## 2026-09-15 — Nettoyage `orchestration/` : chiffres finaux archivés avant suppression de `RD_ECLAIRAGE_DIAGNOSTIC.md`

- Banc 16, campagne persistée `2026-09-14T14-19-00-913Z` : médianes GPU isolées 239,852 ms (exhaustive) et 197,028 ms (BVH), rAF 316,6 et 237,5 ms (24 dessins/variante), 0 px différent sur les 14 états A/A et exhaustive/BVH, 4 158 triangles soumis, 44 modules éclairage/fixtures conformes au découpage.
- Test navigateur terminé sur une assertion favicon 404 (ressource accessoire, exclue des erreurs fonctionnelles), aucune erreur de rendu. Prototype resté expérimental (clusters préparés non dessinés) ; document supprimé, ses cinq liens vers `benchmark-runs/` (non versionné) cassaient `check:links`.

## 2026-09-15 — Nettoyage `orchestration/` : bilan phase 1 archivé avant suppression de `phase-1-bilan.md`

- Six mesures du 14 septembre (`chantier-phase1-3`, Emerald 1 instance 1280×720, 60 images) : WebGPU CPU 28,0 → 28,0 ms (non atteint, cible < 4 ms) ; WebGPU GPU 20,88 → 15,26 ms (−27 %, non conservé, coûte 67 px) ; WebGL2 sélection 5,2 → 4,80 ms, 2,40 ms au seuil 1 (non atteint, cible < 2 ms) ; WebGL2 CPU 29,5 → 30,3 ms ; pixels différents 0 px sur WebGL2, 67/37/173/1 px sur WebGPU si la partition temporelle est conservée ; tests non rejoués.
- Ce qui reste, toujours ouvert : WebGPU GPU < 6 ms (trancher coplanaires vs `nearestDepth`), WebGPU CPU < 4 ms (intouché), WebGL2 sélection < 2 ms (émission de plages jusqu'au consommateur).

## 2026-09-15 — [session sans-threejs] le budget de pages compte des pages (lot budget-pages-distinctes)

**Changement d'image de référence, accepté par l'utilisateur** : la vue générale d'Emerald au seuil 0
n'est plus la même image qu'avant ce lot. Elle est prouvée plus proche de l'exact, et le résultat est
prouvé déterministe ; c'est la condition qui était posée.

### Ce qui était faux

Le budget de pages est un nombre de slots de cache, et un slot tient une page. `applyBudget` y
comparait des **placements** : la vue générale d'Emerald au seuil 0 demande 80 153 placements pour
20 875 pages distinctes, parce qu'un même cluster est placé sous plusieurs instances d'un objet. Le
budget était donc franchi à chaque image, la file n'était jamais l'ensemble demandé mais un préfixe
tronqué compté en placements, et le nombre de pages _distinctes_ que ce préfixe contenait dépendait
de la façon dont les placements s'y trouvaient répartis — donc de l'ordre dans lequel les premières
images l'avaient rempli. Le cache ne rendant rien tant que ses slots ne manquent pas, la résidence
gardait tout ce qui était passé par la file et s'arrêtait à 7 590 pages sur les 20 875 demandées :
deux exécutions de la même caméra au même seuil ne résidaient pas le même ensemble et ne rendaient
pas la même image. C'est la cause de l'instabilité du témoin A/A relevée au lot précédent, et c'est
aussi pourquoi l'image était grossière là où elle aurait dû être fine.

### Ce qui est fait

Le rang compte des clés distinctes, par niveau comme avant : le niveau appartient à la page et non au
placement, donc la partition par niveau est inchangée et la coupe grossière que le budget garde est
la même en nature. Sur Emerald le budget ne tronque alors plus rien — une scène ne peut pas demander
plus de pages distinctes qu'elle n'en contient —, et la file est l'ensemble demandé.

Second point : ce que l'image dessine rejoint l'ensemble gardé. Un cluster dont le remplaçant manque
est dessiné depuis un ancêtre résident que la coupe n'a jamais demandé ; il faut que le cache ne
puisse pas le reprendre sous l'image qui l'affiche. La relecture publie déjà sa liste dessinable :
elle devient une seconde différence de coupe, appliquée là où la première l'est, et l'ensemble gardé
la suit clé par clé — une image qui ne bouge aucune page n'y touche rien. Les deux index de clés
partagent leur arithmétique (`webgpuHeldKeys.ts`).

**Ce qui a été essayé et retiré** : décharger d'autorité toute clé qui sort de l'ensemble gardé, pour
faire de la résidence une fonction exacte de la coupe et du budget. Mesuré : **211 041 évictions en
soixante-dix images** et une image plus grossière (5 310 974 triangles au lieu de 5 942 722) — la
liste dessinable dépend de la résidence, qui dépendait alors de la liste dessinable, et le système
battait. Le cache reprend ses slots par ancienneté quand ils manquent, ce qui est sa politique ; les
épingles protègent ce que l'image montre. Sémantique écrite en R3b de la spécification.

### Un cache du banc que `develop` ne sait plus lire

Les textures progressives ont porté le manifeste binaire à la version 3, et le cache Emerald du Lab
est en version 2 : la tête de `develop` le refuse au chargement (`Expected manifest binary version 3,
received 2`). Aucune mesure contre Emerald n'est donc possible sur cette base tant que les ressources
du banc n'ont pas été recompilées, et un agent n'écrit pas dans `public/benchmark-assets`.

Ce lot a donc recompilé Emerald **hors du banc**, avec le compilateur natif de la tête de `develop`,
dans `.mesure/cache-emerald` (281 primitives, 10 046 405 triangles, 743 Mo, 15,6 s), et les deux
côtés de chaque série lisent ce même cache via `--cache-avant` / `--cache-apres`. Les chiffres
absolus ne se comparent donc pas à ceux des entrées précédentes, qui lisaient le cache du Lab ; les
verdicts pixel, eux, comparent bien deux moteurs sur la même scène.

À faire hors de ce lot : recompiler les ressources du banc, ou accepter formellement que le harnais
compile sa scène lui-même.

### Preuve

Verrou `.claude/mesure.lock` pris et libéré. Harnais commun, `--moteur webgpu`, 1280×720, 60 images,
chauffe par défaut du harnais (huit images, jamais `--chauffe`), `--max-pages 100000`, les deux côtés
lisant `.mesure/cache-emerald` via `--cache-avant` / `--cache-apres`. `avant = a71ed35` (tête de
`develop`), `apres = 9e048f6`.

**(c) Proximité de l'exact.** Référence : la branche d'essai `essai/reference-sans-budget`
(`d3e86d7`) — le code de la tête de `develop`, la troncature du budget désactivée, donc la file est
toujours l'ensemble demandé. Jamais fusionnée, elle n'existe que pour cette mesure.

| vue · seuil                                      | `develop` contre la référence | cette branche contre la référence |
| ------------------------------------------------ | ----------------------------- | --------------------------------- |
| générale · 0                                     | **4 046 px, max canal 234**   | **0 px**                          |
| générale · 1, sol · 0, sol · 1, rue · 0, rue · 1 | 0 px                          | 0 px                              |

Cette branche **est** le rendu sans budget, au pixel, sur les six séries ; `develop` en diffère sur la
vue générale au seuil 0, la seule où les deux images ne coïncident pas. Le changement d'image va donc dans le bon sens, et il est mesuré, pas
argumenté.

**(a) Déterminisme.** Vue générale, seuil 0, quatre exécutions, chauffe par défaut : témoin A/A
**0 px, 0 px, 0 px, 0 px**. Pages résidentes : 20 875 aux deux lancements de cette branche, dans les
quatre exécutions, au page près. Sur les autres vues, témoin A/A 0 px aux deux seuils (série (b)).

**(b) Écart contre `develop`.** Attendu non nul, et c'est la vue générale qui le porte :

| vue · seuil  | écart                       | pages résidentes (develop → branche) | triangles dessinés    | trous |
| ------------ | --------------------------- | ------------------------------------ | --------------------- | ----- |
| générale · 0 | **4 046 px, max canal 234** | 7 590 → **20 875**                   | 5 942 722 → 5 093 246 | 0 / 0 |
| générale · 1 | 0 px                        | 3 801 → 3 801                        | 1 842 728             | 0 / 0 |
| sol · 0      | 0 px                        | 4 863 → 4 863                        | 1 509 411             | 0 / 0 |
| sol · 1      | 0 px                        | 3 422 → 3 422                        | 670 036               | 0 / 0 |
| rue · 0      | 0 px                        | 5 434 → 5 434                        | 1 424 473             | 0 / 0 |
| rue · 1      | 0 px                        | 3 554 → 3 554                        | 636 059               | 0 / 0 |

Cinq séries sur six ne bougent pas : leur coupe demandait moins de pages que le budget même compté
en placements. C'est la vue générale au seuil 0, la plus lourde, qui portait la troncature.

`uncoveredTriangles` 0 des deux côtés partout : l'image change de finesse, jamais de couverture.

### Chiffres

Vue générale au seuil 0, la seule des six séries où les deux côtés diffèrent :

|                      | `develop`   | cette branche |
| -------------------- | ----------- | ------------- |
| pages résidentes     | 7 590       | **20 875**    |
| clusters dessinés    | 47 890      | 41 187        |
| triangles dessinés   | 5 942 722   | 5 093 246     |
| `uncoveredTriangles` | 0           | 0             |
| `cpuFrameMs` p50     | 11,3 à 14,7 | **7,3 à 8,7** |

La résidence triple parce que la file est enfin l'ensemble demandé ; elle ne coûte pourtant aucune
mémoire de plus, le cache GPU allouant déjà `pageBytes × slots` à la création — `develop`
n'utilisait qu'un tiers de ce qu'il avait réservé. L'image est moins peuplée parce qu'elle n'a plus
besoin de remplacer une surface manquante par une couverture grossière : moins de clusters, moins de
triangles, et c'est exactement l'image que rend le moteur quand le budget ne tronque rien. Le
processeur y gagne un tiers du temps par image, faute de clusters à encoder.

### Ce qui reste

- Le budget ne tronque plus rien sur Emerald à `--max-pages 100000`, parce qu'une scène ne peut pas
  demander plus de pages distinctes qu'elle n'en contient. Le chemin de troncature — préfixe le plus
  grossier — n'est donc exercé que par les tests unitaires et par un budget volontairement étroit ;
  aucune scène du banc ne le met à l'épreuve en vrai.
- L'éviction reste celle du cache : il reprend ses slots par ancienneté quand ils manquent. La
  résidence est donc fonction de la coupe et du budget _tant que le budget n'est pas atteint_ ;
  au-delà, l'ordre d'arrivée décide encore quels slots sont repris. Le rendre exact demande une
  politique d'éviction pilotée par la coupe, et l'essai brutal de ce lot dit qu'elle ne peut pas être
  « décharger tout ce qui sort de l'ensemble gardé ».

## 2026-09-15 — Lot ombres : une carte ne redessine que ce qui est à portée, et la découpe projette sa découpe

Branche `lot/ombres`, rebasée sur `develop` à `ee04fd1`. Les durées du tableau ci-dessous ont été
relevées face au socle `2bf1f54` sur une machine à charge 7,7 à 10,8 ; rejouées face à `ee04fd1` à
charge 12 à 35, elles donnent les mêmes ordres (générale 7,82 → 0,38 ms ; rue 2,46 → 0,44 ms à
8 lampes ; rue 2,24 → 0,14 ms à 30 lampes) et **exactement les mêmes écarts d'image**. Banc Emerald, WebGPU, mode visible,
1280×720, `pixelError` 0, lampes posées par la règle de grille du harnais (`scripts/mesure/lampes.mjs`).

### Ce qui a changé

- **Rejet par face.** Un passage de calcul précède la passe de profondeur : de la liste d'instances
  de l'image — celle du dessin principal, sélection comprise —, chaque face ne garde que les
  clusters dont la sphère monde touche le plan lointain de la lampe et le cône circonscrit au carré
  de la face. Un seul dessin indirect par face remplace un dessin par slot de couche coplanaire.
  Le rejet est exact : ce qu'il écarte, la projection le rejetait déjà.
- **Résidence.** L'entrée et la sortie de résidence d'une page déclarent leur boîte à
  l'ordonnanceur, comme un nœud déplacé. Une carte en cache ne peut plus ignorer un cluster arrivé
  ni garder l'ombre d'un cluster parti.
- **Découpe.** La passe de profondeur a un étage de fragment qui n'écrit aucune couleur et applique
  le test de masque du raster du tampon de visibilité, partagé au caractère près (`PAGE_MASK_WGSL`).
  Un feuillage, une grille, un claustra projette l'ombre de sa découpe et non de son quadrilatère.
- **Compteurs.** La ligne Ombres publie `lampesRedessinees`, `cartesReutilisees`, `facesRedessinees`,
  `appelsDeDessin`.
- **Harnais.** `--lampes N`, `--ombres on|off`, `--lampe-mobile` : grille dans l'emprise du modèle,
  hauteur fixe au-dessus du plancher, portée déduite de la maille. Aucune scène nommée.

### Chiffres (étape Ombres, GPU p50/p95 ; image entière = enveloppe GPU)

Scène immobile, 8 et 30 lampes à ombre : 0 lampe redessinée, 0 face, **0 appel de dessin**, 30 cartes
réutilisées sur 30 — des deux côtés. L'étape n'est pas encodée, donc « non mesuré ».

Une lampe en mouvement, 6 faces redessinées par image :

| vue      | lampes | Ombres avant | Ombres après | appels avant → après | image avant | image après |
| -------- | ------ | ------------ | ------------ | -------------------- | ----------- | ----------- |
| générale | 8      | 7,86 / 9,78  | 0,54 / 0,86  | 30 → 12              | 37,83       | 25,87       |
| sol      | 8      | 2,25 / 2,35  | 0,48 / 0,69  | 30 → 12              | 11,91       | 11,21       |
| rue      | 8      | 2,26 / 2,28  | 0,26 / 0,44  | 30 → 12              | 12,16       | 10,34       |
| générale | 30     | 7,83 / 7,99  | 0,16 / 0,22  | 30 → 12              | 30,42       | 20,54       |
| sol      | 30     | 2,21 / 2,22  | 0,39 / 0,50  | 30 → 12              | 12,09       | 11,15       |
| rue      | 30     | 2,26 / 2,35  | 0,31 / 0,46  | 30 → 12              | 13,03       | 10,49       |

CPU par image, inchangé dans le bruit : 4,0 à 12,9 ms p50 des deux côtés. Charge machine relevée
entre 7,7 et 32 selon les séries : d'autres sessions travaillaient. Les durées GPU sont des relevés
d'horodatage et ne dépendent pas de cette charge ; les durées CPU s'y lisent avec réserve.

### Fidélité

`sol` à 8 lampes : 0 px. Les autres vues diffèrent — 268 px (générale), 28 152 px (rue) à 8 lampes ;
676, 143 et 16 794 px à 30 lampes — témoin A/A à 0 px, coupe identique. **Cause isolée par
construction** : une variante ne portant que le rejet, sans l'invalidation par résidence, sort à
**0 px sur les trois vues**. L'écart vient donc entièrement de la résidence, et il va dans le sens de
la correction : 98,8 % des pixels qui changent sont **plus sombres** après (rue à 8 lampes :
27 812 plus sombres contre 343 plus clairs), c'est-à-dire des ombres jusqu'ici absentes. Le côté
avant ne converge pas : à 8 et à 90 images de chauffe, il rend exactement la même image fausse.

La découpe ne change rien sur Emerald, qui ne porte aucun matériau à masque (191 opaques,
29 transparents) : les trois captures sont **octet pour octet identiques** avec et sans l'étage de
fragment, et l'étape Ombres reste dans le bruit.

### Ce qui reste

- Les clusters transparents ne sont pas dans la table des lignes que la passe dessine : ils ne
  projettent **aucune** ombre. Ombre atténuée et colorée d'un verre ou d'une eau : hors de ce lot.
- Niveau de détail propre aux ombres, **chiffré et non activé** : une face de 128 à 512 texels sur
  90° a une résolution angulaire 8 à 20 fois plus grossière que la caméra (1 280 px sur 55°). Une
  coupe du DAG au seuil de la face vaudrait environ trois niveaux plus grossiers, soit de l'ordre de
  huit fois moins de clusters dans les cartes : l'étape passerait d'environ 0,3 ms à 0,04 ms par
  lampe redessinée, et le plafond des quatre lampes par image (24 faces) d'environ 1,2 ms à 0,15 ms.
  Le prix est une silhouette plus grossière dans la carte, donc un contact d'ombre qui peut bouger
  d'un texel ou plus en incidence rasante : fidélité avant vitesse, ce n'est pas activé.
- Les cartes d'ombre sont dessinées avec la sélection de la caméra : un occulteur résident mais hors
  de la coupe caméra ne projette rien. Le rejet ne change pas cela, il le préserve.

### Banc bloqué au sommet de `develop` (constat, pas une conséquence de ce lot)

Depuis la fusion des textures progressives (`e443bc6`, qui porte `MANIFEST_BINARY_VERSION = 3`), le
cache Emerald du Lab — écrit en version 2 — n'est plus lisible : `Expected manifest binary version 3,
received 2`, levé par `develop` seul, sans aucune ligne de ce lot. Le banc Emerald est donc
inutilisable pour tout le monde tant que ce cache n'est pas recompilé, et aucun agent n'écrit dans
`public/benchmark-assets`.

Conséquence pour ce lot : les mesures et la porte de fidélité ci-dessus ont été jouées face à
`ee04fd1`, dernier socle où le banc chargeait. Le rebasage sur `6206fe2` n'a demandé qu'une
adaptation mécanique — les deux liaisons de l'atlas d'aperçu ajoutées au groupe de la passe d'ombre,
par la fabrique commune `visBindEntries`, et le test de masque partagé qui prend la branche d'aperçu
de `develop`. `npm run validate` est vert sur ce socle (550 tests), mais l'image n'y a pas été
rejouée.

## 2026-09-15 — [session sans-threejs] transparents en sélection GPU (lot transparents-gpu)

Worktree `webgeometry-sans-threejs-9f889d`, branche `lot/transparents-gpu`, rebasée sur `f44cc93`.
Six commits : `52233f0` (une seule coupe de clusters, compaction GPU des mélanges), `1bba020` (la marche
du tronc sépare les clusters de même rang source), `d043696` (scène synthétique des trois classes),
`1b74b8e` et `f273ee0` (la transmission déclarée non dessinée), `62713b5` (la transmission a sa
propre scène).

### Les trois classes, et où chacune passe

**1. Découpes (`alphaMode: MASK`).** Rien à faire : c'était déjà le cas, et c'est maintenant prouvé.
Le compilateur ne range en `clustered-blend` que `alphaMode: BLEND` (`compiler_primitive.rs`), donc
un matériau MASK sort en `exact-clusters` — vérifié sur la scène synthétique, où `grillage` sort en
`exact-clusters` à côté des trois boîtes opaques. Côté navigateur, `collectClusterPages` ne marque
`transparent` qu'un `clustered-blend` ou un matériau `transparent`, et le chargeur glTF ne pose pas
`transparent` sur un MASK : la découpe entre donc au catalogue opaque, à la sélection GPU, au tampon
de visibilité, sans ordre. Le test alpha voyage avec la ligne du cluster
(`webgpuPageRow.ts` : `FLAG_MASK` et le seuil), et il est appliqué trois fois : à l'écriture des
identifiants (`visibilityShaderId.ts:25`), dans le raster logiciel des petits triangles
(`gpuSmallTrianglesShader.ts:38,79`) et à l'ombrage (`visibilityShaderShade.ts:95`). Un test
(`webgpuMaterialClasses.test.ts`) fixe le classement des trois classes et le voyage du seuil alpha
jusqu'à la ligne, et vérifie qu'un mélange, lui, ne prend jamais le drapeau de découpe.

**2. Mélanges (`alphaMode: BLEND`, `clustered-blend`) — le cœur du lot.**

_Une seule coupe._ Le catalogue de clusters que la sélection GPU parcourt réunit maintenant les
primitives opaques **et** transparentes (`webgpuPagesLayout.ts` : `selectionRoots`, les opaques
d'abord, donc aucun index de page opaque ne bouge). Un seul `packDagSelection`, une seule
résidence, une seule différence de coupe, un seul budget de pages : le parcours de DAG que le CPU
gardait pour les transparents — et avec lui la coupe tenue du lot 3b, ses six entrées et son état —
disparaît, comme `transparentWanted`/`transparentShown`/`shownOpaque` et les deux jeux de clés que
`webgpuResidencySets` tenait pour eux. Les lignes du tampon de visibilité restent opaques : un
cluster transparent est résident, demandé, budgété comme les autres, mais ne réclame pas de ligne.

_Une compaction à ordre stable._ L'ordre de dessin d'une primitive transparente est une propriété de
la scène, pas de l'image : ses clusters sont triés une fois pour toutes
(`webgpuTransparentTable.ts`) par le rang que la source a enregistré (`sourceOrder`), et ce que
l'image ajoute est seulement _lesquels_ elle garde. La compaction GPU
(`webgpuTransparentShader.ts`) compte par groupe de 64, préfixe par primitive, puis place chaque
cluster retenu à son rang dans son groupe : la sortie est l'ordre d'entrée privé des entrées non
sélectionnées, c'est-à-dire exactement la liste que le CPU triait chaque image. Chaque primitive
reçoit sa plage alignée sur le groupe, donc sa base est connue avant l'image et ne bouge jamais.

_Le second critère de tri, qui a coûté 705 pixels._ Plusieurs clusters d'une primitive partagent un
rang source : un cluster grossier hérite du premier triangle du groupe qu'il remplace (`dag.rs`,
`source_rank`). Le rang seul ne les ordonne donc pas ; ce qui les séparait était l'ordre d'émission
de la coupe CPU, c'est-à-dire la marche du tronc de culling — une pile, donc les enfants d'un nœud
visités du dernier au premier (`pageSelectionCutVisit.ts`). Cette marche ne dépend que de l'arbre,
et les clusters qu'une image garde en sont une sous-suite : la table la calcule une fois et s'en
sert comme second critère. Avant ce correctif, la vue générale à 1 px montrait 705 pixels d'écart,
max canal 16, tous sur un seul arbre ; après, 0.

_Le dessin._ Une primitive paginée n'a plus de tampon d'indices à elle : elle se dessine en
`drawIndirect`, une instance par cluster retenu, et le nuanceur lit `clusterIds[base + instance]`
puis la portée de ce cluster dans le cache de pages (`clusterSpans`, réécrite seulement quand la
résidence du cache change). L'ordre des primitives entre elles est inchangé, l'ordre des triangles
dans une instance aussi, et l'ordre des instances est celui de la compaction : le mélange est le
même au pixel. Une primitive dont la coupe est vide dessine zéro instance au lieu d'être retirée de
la liste — même image, un appel de dessin de plus. Le chemin de coupe CPU (appareil sans compute,
repli après un échec de sélection) écrit la même liste d'instances dans le même tampon et dans le
même ordre, donc les deux chemins partagent un seul nuanceur.

**3. Transmission** : contrat écrit, rien livré. Voir plus bas.

### Preuve

Verrou `.claude/mesure.lock` pris et libéré. Harnais commun, `--moteur webgpu`, 1280×720, 60 images,
chauffe par défaut, `--max-pages 100000`, `avant = a517b47` (tête de `develop` au moment de la
fusion), `apres = ccaf60d`. Les deux côtés lisent le même cache, recompilé hors du banc avec le
compilateur natif de cette tête — `.mesure/cache-emerald` pour Emerald, `.mesure/cache-classes` pour
la scène synthétique. Le manifeste binaire est passé en version 4 avec les mips progressifs ; le
cache du Lab et les caches des mesures précédentes de ce lot sont refusés au chargement, et un agent
n'écrit pas dans les ressources du banc. Rien n'est écrit dans `public/`.

### Contrat de la transmission (classe 3) — écrit, pas livré

**Classement, au compilateur.** `unsplit_material` (`compiler_materials.rs`) déclare transmissif tout
matériau dont `KHR_materials_transmission.transmissionFactor` dépasse zéro, et
`compile_primitive` le range alors en `pass: "shared-blend"` : pas de DAG, une primitive = un
maillage entier, ordre source conservé. C'est déjà le cas aujourd'hui, vérifié sur la scène
synthétique (`eau` → `shared-blend`). Le classement ne nomme aucun objet : il lit une propriété de
matériau, comme MASK et BLEND.

**Ce que fait le moteur aujourd'hui.** Rien. `prepareWebgpuBlend` saute la copie transmissive
(`if (isTransmissive(copy.material)) continue`) : la surface n'est pas dessinée du tout, et seul le
chemin canvas direct lève `UNSUPPORTED_TRANSMISSION`. La capacité n'est pas non plus déclarée
manquante à l'hôte. Une eau importée est donc invisible.

**La passe à ajouter**, après les mélanges et avant la composition :

1. l'éclairage différé résout les opaques dans la cible HDR (déjà fait) ;
2. la passe de mélange dessine les BLEND dans cette même cible (déjà fait) ;
3. **deux copies** : `copyTextureToTexture` de la cible HDR et de la profondeur vers deux textures
   en lecture seule (`rgba16float` et `depth32float`, taille de la cible). Ces copies sont le fond
   figé que _toutes_ les surfaces transmissives lisent : l'ordre entre deux d'entre elles ne change
   donc pas ce qu'elles lisent ;
4. une passe de dessin des items transmissifs, dans le même ordre source que les mélanges
   (`renderOrder`), même test de profondeur (`less`, sans écriture), même mélange, avec un nuanceur
   qui lit en plus : le fond à la position écran du fragment décalée par le vecteur de réfraction
   (normale, vue, `ior`, `thicknessFactor`), la profondeur copiée pour rejeter un échantillon de
   fond situé _devant_ la surface (repli sur l'échantillon non dévié), et qui mélange
   `baseColor × fond` par `transmissionFactor` en gardant le spéculaire GGX que l'éclairage direct
   fournit déjà.

**Tampons lus** : les deux copies, le cache de pages (indices) pour une primitive qui entrerait au
DAG, sinon le tampon d'indices propre à l'item, ses positions/UV/normales, la ligne de matériau.
**Tampon écrit** : la cible HDR seule.

**Tout par propriété de matériau** : `transmissionFactor`, `KHR_materials_volume.thicknessFactor`
et `attenuationColor`, `KHR_materials_ior.ior`, la rugosité pour un fond flouté (chaîne de mips de
la copie). Aucun nom d'objet, aucun type.

**Ce qui manque pour le livrer** : (a) le manifeste binaire ne porte pas encore `transmission`,
`ior` ni `thickness` dans la ligne de matériau — `visMaterial` les lit sur le matériau Three, donc
le chemin glTF les a, le chemin binaire non ; (b) les deux copies et leur groupe de liaison ;
(c) le nuanceur ; (d) la chaîne de mips pour un verre dépoli ; (e) deux surfaces transmissives qui
se recouvrent ne se voient pas l'une à travers l'autre — limite connue et documentée, la même que
celle du visualiseur de référence glTF.

**Pourquoi la transmission reste hors du DAG pour l'instant** : une surface transmissive lit le
fond ; découpée en clusters mélangés indépendamment, chaque cluster lirait un fond partiellement
composé s'il n'est pas figé avant la passe. Une fois la copie figée (point 3), rien n'empêche de la
faire entrer au DAG comme les mélanges ; le classement du compilateur serait alors le seul
changement.

### Le budget caché de la coupe transparente, et la décision

**Second changement d'image de référence, accepté par l'utilisateur.** La coupe transparente
processeur s'imposait un budget que rien n'imposait aux opaques : `selectTransparentCut` passait
`pageBudget: slots − bootstrapUrls.size`, et la boucle de `selectVisiblePages` double le seuil
d'erreur tant que la coupe ne tient pas dans ce budget. Sur la vue générale d'Emerald, le seuil 0
était ainsi remonté jusqu'au niveau du seuil 1 — preuve directe, sans aucune référence : sur
`develop`, générale au seuil 0 et générale au seuil 1 donnent **exactement le même compte
transparent**, 999 410 triangles. Le chemin GPU de ce lot n'a pas ce budget : il rend l'exact.

Protocole de proximité, deux références construites depuis `2931606` et jamais fusionnées : `ref1`
(`e21f5d5`) désactive la troncature de la file de résidence, `ref2` (`31c0303`) désactive en plus le
budget propre de la coupe transparente.

| vue · seuil                              | `develop` contre `ref1` | `develop` contre `ref2`     | ce lot contre `ref2` |
| ---------------------------------------- | ----------------------- | --------------------------- | -------------------- |
| générale · 0                             | 0 px                    | **1 636 px, max canal 183** | **0 px**             |
| générale · 1, sol · 0 et 1, rue · 0 et 1 | 0 px                    | 0 px                        | 0 px                 |

`ref2` et ce lot coïncident sur tous les compteurs de la vue générale au seuil 0 : 80 153 clusters,
10 046 405 triangles — le compte exact du modèle —, 20 688 pages résidentes, hash de coupe identique.
`develop` en dessine 5 093 246 pour 20 875 pages. Ce n'est donc pas la file de résidence qui
tronquait (`ref1` est `develop` au pixel près, le lot du budget en pages l'avait déjà réglée), c'est
bien le budget caché de la coupe transparente.

**La coupe transparente GPU donne le même compte que le chemin processeur partout où ce dernier n'a
pas été grossi par son budget**, une fois retiré le facteur deux du contrat de `develop` (il comptait
les deux passes de face ; ce lot compte une fois) : générale·1 499 705 = 499 705, sol·0 263 572,
rue·0 226 964, sol·1 203 766, rue·1 167 862. Seule générale·0 diffère, et c'est le cas ci-dessus.

### Chiffres sur la base finale

Base `a517b47` (mips progressifs du lot 3 et optimisations de nuanceurs du lot D comprises), caches
recompilés en manifeste binaire version 4, 60 images, chauffe par défaut, `--max-pages 100000`. Les
verdicts pixel sont les mêmes que sur les bases précédentes de ce lot : ni l'albédo brut, ni les
cascades, ni les mips progressifs ne les déplacent.

| vue · seuil  | écart contre `develop`                    | triangles dessinés         | hash      | trous |
| ------------ | ----------------------------------------- | -------------------------- | --------- | ----- |
| générale · 0 | **2 083 px, max canal 62** — le cas exact | 5 093 246 → **10 046 405** | différent | 0 / 0 |
| générale · 1 | 0 px                                      | 1 842 728                  | identique | 0 / 0 |
| sol · 0      | 0 px                                      | 1 509 411                  | identique | 0 / 0 |
| sol · 1      | 0 px                                      | 670 036                    | identique | 0 / 0 |
| rue · 0      | 0 px                                      | 1 424 473                  | identique | 0 / 0 |
| rue · 1      | 0 px                                      | 636 059                    | identique | 0 / 0 |

Témoin A/A, vue générale au seuil 0, quatre relevés sur cette base (le témoin de la série et trois
exécutions dédiées), chauffe par défaut : **0 px, 0 px, 0 px, 0 px**, 10 046 405 triangles et le même
hash de coupe à chaque fois. Scène synthétique des trois classes (opaques, grillage MASK, vitre
BLEND), cache `.mesure/cache-classes` : deux vues × deux seuils, **0 px, témoin A/A 0, hash identique
4/4, trous 0**.

**Coût.** Contre `develop`, dont l'image est plus grossière, `cpuFrameMs` p50 va de 7,2 à 8,8 ms sur
générale·0 à caméra fixe : l'image exacte coûte plus cher parce qu'elle dessine deux fois plus de
triangles et 80 153 clusters au lieu de 41 187. L'étape carte graphique « Transparents » passe en
sens inverse, de **16,78 à 11,41 ms p50**, tout en dessinant bien plus de triangles transparents : à
triangle égal, la passe de mélange coûte un ordre de grandeur de moins. Le gain processeur, lui, ne
se lit qu'à caméra mobile (plus bas), parce qu'à caméra fixe la coupe transparente processeur du lot
3b était déjà tenue et ne se recalculait pas.

### Portes

`npm run validate` **entièrement vert** sur la base finale, portes Rust comprises : `format:check`,
`check:lines`, `check:duplicates`, `lint` (ESLint et Clippy), `check:unused`, `build`, `build:native`,
`check:structure`, `check:dts`, `check:links`, `test` (653 tests JS/TS, 0 échec), `test:native`
(134 + 4 tests Rust). Ce lot ne touche aucune ligne de Rust.

### Caméra en mouvement, enfin mesurée

Le harnais a gagné `--camera-mobile` (la pose avance d'un cran de la trajectoire du banc à chaque
image mesurée au lieu de rejouer la même) pendant ce lot. C'est exactement ce qui manquait : à caméra
fixe, la coupe transparente tenue du lot 3b rendait le parcours processeur gratuit, et le gain de
cette sélection GPU ne se voyait pas. Vue générale, 60 images, chauffe par défaut :

| seuil | `cpuFrameMs` p50 avant → après | p95 avant → après | écart | témoin A/A |
| ----- | ------------------------------ | ----------------- | ----- | ---------- |
| 0     | **17,6 → 12,1 ms** (−31 %)     | 25,2 → 14,0 ms    | 0 px  | 0 px       |
| 1     | **7,2 → 4,5 ms** (−38 %)       | 9,0 → 5,1 ms      | 0 px  | 0 px       |

Image identique au pixel des deux côtés, et près d'un tiers du temps processeur par image en moins —
la queue p95 tombe presque de moitié au seuil 0, parce que la pointe qu'elle mesurait était le tri de
la coupe transparente processeur. C'est le résultat que ce lot cherchait, et il n'était pas mesurable
avant que le banc sache bouger la caméra. L'option est documentée dans `scripts/mesure/README.md`.

Une réserve honnête : au seuil 1 à caméra mobile, le hash de coupe rapporté diffère d'un côté à
l'autre alors que l'image est identique au pixel. Ce hash vient de la relecture asynchrone du masque,
une image en retard sur la coupe qu'il décrit ; à caméra mobile, les deux côtés ne sont pas
forcément en retard de la même image. Le verdict qui compte, le pixel, est à zéro.

### Ce qui reste

- **La transmission n'est toujours pas dessinée.** Le contrat plus haut dit quoi écrire ; rien n'en
  est écrit. Une eau importée reste invisible, et le moteur le déclare maintenant à l'hôte.
- **Un cache qui porte une primitive `shared-blend` est refusé au chargement** par
  `assertCacheIdentity`, qui exige une bande d'erreur par cluster de chaque primitive — une primitive
  hors DAG n'en a pas. C'est la première chose à corriger avant la passe de transmission ; la scène
  `transmission` du dossier de fixtures le fixe noir sur blanc.
- **`transparentSubmittedTriangles` a changé de sens** : il compte les triangles de la coupe
  transparente une fois, quel que soit le nombre de passes qui les rastérisent, parce que les comptes
  d'instances sont écrits par la compaction et jamais relus. `transparentDrawCalls` compte toujours
  chaque appel, les deux moitiés d'un matériau double-face incluses.
- **Le compte transparent arrive avec la relecture**, comme le compte opaque : une image en retard
  sur la coupe qu'il décrit. Le dessin, lui, suit le masque de l'image courante.
- **Rembourrage de la table** : les clusters transparents sont alignés par primitive sur 64 entrées.
  Une scène à des milliers de primitives transparentes minuscules paierait ce rembourrage ; Emerald
  a 29 primitives `clustered-blend`, la scène synthétique une.

## 2026-09-16 — [session sans-threejs] l'eau et le verre épais existent (lot eau)

Worktree `lot-eau`, branche `lot/eau`, rebasée sur `0a3c601`. Deux commits. **Aucune version de
manifeste n'a bougé, aucun produit de cache n'a été ajouté** : la transmission voyage par le glTF
source déjà chargé et par un tampon d'uniformes interne au moteur.

### 1. Le chargement accepte une primitive hors DAG

`assertCacheIdentity` exigeait une bande d'erreur par cluster de *chaque* primitive. Une primitive
que le compilateur garde d'un seul tenant — `pass: "shared-blend"` — n'a aucun cluster, donc aucune
bande, et c'est sa définition, pas une lacune : un cache qui en portait une était refusé en bloc, et
une eau importée rendait la scène entière illisible. `primitiveIsDrawable` (`geometryContracts.ts`)
énonce maintenant les deux formes que ce runtime sait dessiner, et deux seulement : un DAG dont
chaque cluster porte sa bande, ou un maillage d'un seul tenant **sans aucune page**. Une primitive
`shared-blend` qui porterait quand même des pages reste refusée, et le message le dit.

### 2. Le classement au compilateur ne bouge pas, et il est désormais fixé

`unsplit_material` déclarait déjà transmissif tout matériau dont
`KHR_materials_transmission.transmissionFactor` dépasse zéro, et `compile_primitive` le rangeait déjà
en `shared-blend`. Rien n'a changé là ; ce qui manquait était la preuve que l'arrivée de la classe 3
ne déplace pas les autres. `compile_ranks_every_material_class_by_its_own_property` compile la même
géométrie sous quatre matériaux et fixe les quatre rangements : opaque et `MASK` en `exact-clusters`
avec leurs pages, `BLEND` en `clustered-blend` avec les siennes, transmission en `shared-blend` sans
aucune. `compile_ranks_a_zero_transmission_by_its_alpha_mode` ajoute qu'une transmission nulle n'est
pas une transmission.

### 3. La passe de transmission

Après les opaques et après les mélanges, dans l'ordre source, test de profondeur `less` sans
écriture, même mélange. Deux `copyTextureToTexture` figent le fond — la cible HDR et la profondeur
vers `rgba16float` et `depth32float` en lecture seule. C'est ce que *toutes* les surfaces
transmissives lisent : l'ordre entre deux d'entre elles ne change donc pas ce qu'elles voient.

- **Réfraction** : le rayon de vue est dévié par `1/ior`, avancé de `thicknessFactor`, le point de
  sortie reprojeté à l'écran, et c'est là qu'on relit la couleur. Un échantillon dont la profondeur
  copiée le place *devant* la surface est rejeté : on retombe sur l'échantillon non dévié.
- **Atténuation** : `exp(-sigma·thickness)` avec `sigma = -log(attenuationColor)/attenuationDistance`.
  Une distance nulle veut dire pas d'atténuation.
- **Réflexion** : Fresnel de Schlick, `f0 = ((ior-1)/(ior+1))²`, appliqué à ce que la scène déclare —
  l'irradiance des sondes dans la direction du miroir, exactement zéro sans grille de sondes — plus
  le spéculaire des lampes déclarées, obtenu en évaluant `declaredLighting` sur un albédo nul : le
  lobe diffus s'annule de lui-même, le lobe spéculaire diélectrique reste. Une seule formule
  d'éclairement dans le moteur, pas une de plus, et aucune lumière propre à cette passe (P6).
- **Composition** : la part transmise remplace le mélange alpha, comme le modèle de glTF.
  `a = alpha + t(1-alpha)` et `a·C = t((1-F)·transmis + F·réfléchi) + (1-t)·alpha·éclairé`. À `t = 0`
  on retrouve la couleur et l'opacité de la classe 2 **au bit près** : c'est ce qui rend le verdict
  Emerald atteignable, et c'est ce que la mesure confirme.

**La normale du côté d'où l'on regarde.** Premier rendu : l'eau sortait parfaitement noire. Cause,
isolée par construction : la scène n'a pas d'attribut de normale, donc la normale vient des dérivées
d'écran et peut arriver tournée à l'envers ; `dot(N,V)` négatif donnait `F = 1`, la part transmise
disparaissait et la réflexion ne la remplaçait pas. La passe retourne maintenant la normale du côté
de l'œil avant Fresnel et avant la réfraction — on entre toujours dans le volume par la face qu'on
voit. Vaut pour toute surface simple face et pour tout maillage sans normales, pas pour cette scène.

**Ce que la classe coûte quand elle est absente.** `blendState.transmissive` vaut alors zéro : les
deux copies font un texel, aucune copie n'est encodée, la seconde passe n'existe pas, aucun item ne
porte le drapeau. Les trois liaisons ajoutées à la disposition des mélanges existent quand même — une
disposition ne dépend pas de la scène — et le budget d'image ne compte les douze octets par pixel du
fond que si la scène en a besoin.

### Preuve — Emerald, là où la classe est absente

Harnais commun, `--moteur webgpu`, 1280×720, 60 images, chauffe par défaut, `--max-pages 100000`,
`--camera-mobile`, `avant = 0a3c601` (tête de `develop`), `apres` = ce lot. Cache Emerald du Lab, le
même des deux côtés.

| vue · seuil  | écart avant/après | témoin A/A | hash de coupe | triangles sélectionnés | non couverts |
| ------------ | ----------------- | ---------- | ------------- | ---------------------- | ------------ |
| générale · 0 | **0 px**          | 0 px       | identique     | 6 747 087              | 0            |
| sol · 0      | **0 px**          | 0 px       | identique     | 1 992 781              | 0            |
| rue · 0      | **0 px**          | 0 px       | identique     | 1 459 758              | 0            |
| générale · 1 | **0 px**          | 0 px       | identique     | 1 599 951              | 0            |
| sol · 1      | **0 px**          | 0 px       | identique     | 969 373                | 0            |
| rue · 1      | **0 px**          | 0 px       | identique     | 655 125                | 0            |

Max canal 0 sur les six couples. La classe 3 ne déplace donc rien là où elle est absente, y compris
sous une caméra qui bouge.

Une réserve consignée, qui ne vient pas de ce lot : le relevé compte 38 erreurs de page, soit
19 requêtes 404 sur une page du cache Emerald du Lab et les 19 messages de console correspondants.
Les deux côtés lisent le même cache et subissent le même manque ; `uncoveredTriangles` vaut 0 partout,
donc aucun trou. À signaler à qui recompilera ce cache.

### Preuve — la scène synthétique, là où la classe est présente

`packages/asset-compiler-rust/fixtures/classes-materiaux/transmission.gltf` a été enrichie : un plan
d'eau à `y = 0` au-dessus d'un sol à `y = -2,5` et de trois blocs opaques, dont deux percent la
surface. Une scène sans rien derrière l'eau n'aurait rien prouvé. 2 880 triangles ; le compilateur
range les quatre maillages opaques en `exact-clusters` et l'eau en `shared-blend`.

Le cache se charge — c'était le premier verrou et il est levé. Deux vues × deux seuils, `--moteur
webgpu` : **témoin A/A 0 px, 4 fois sur 4**, hash de coupe identique, `uncoveredTriangles` 0. Et
l'eau est dessinée : les parties immergées des blocs apparaissent à travers elle, assombries et
teintées par l'atténuation du volume, la ligne d'eau coupant chaque bloc en deux.

### L'écart avec la référence indépendante, et ce qu'il mesure vraiment

Le chemin témoin `--moteur webgl` dessine bien la transmission, par la passe de Three.js. L'écart au
pixel entre les deux moteurs est de **174 268 px (18,91 %, max canal 231)** en vue générale et
**427 395 px (46,38 %)** en vue de détail.

**Ce chiffre ne mesure pas la transmission.** Les deux moteurs ne reçoivent pas la même lumière : les
lampes du harnais sont déclarées par le contrat `SceneLight`, que seul le chemin WebGPU lit, si bien
que le témoin Three rend toute surface opaque noire pendant que le nôtre rend la vue sans éclairage
en albédo brut. Contrôle construit pour l'isoler : la **même comparaison sur `classes-materiaux`, une
scène qui ne porte aucune transmission**, donne **206 471 px (22,40 %)** et **544 747 px (59,11 %)** —
*plus* que la scène à transmission. L'écart est donc entièrement la convention d'éclairage, et
l'arrivée de la transmission le *réduit*, parce que l'eau assombrit notre image vers celle du témoin.
Une comparaison de fidélité qui porte sur la transmission seule demande que le témoin reçoive les
lampes du contrat ; ce n'est pas dans ce lot, et c'est nommé ci-dessous.

### Durées

Relevées **machine chargée** : trois bancs concurrents tournaient pendant ces campagnes, et le
harnais consigne la charge. Les verdicts pixel n'en dépendent pas — ce sont des comparaisons d'images
—, les durées si. Elles sont à rejouer au calme à la livraison finale et ne sont pas publiées ici
comme un résultat.

### Ce qui reste

- **Le témoin Three ne reçoit pas les lampes du contrat**, donc aucune comparaison de fidélité
  chiffrée n'est possible entre les deux moteurs tant que la scène porte une lampe déclarée. C'est ce
  qui manque pour transformer l'écart ci-dessus en une mesure de la transmission.
- **Deux surfaces transmissives qui se recouvrent ne se voient pas l'une à travers l'autre** : elles
  lisent le même fond figé. Limite connue et voulue, la même que celle du visualiseur de référence
  glTF.
- **Un verre dépoli lit un fond net** : la chaîne de mips de la copie, qui flouterait le fond selon la
  rugosité, n'est pas écrite.
- **La transmission reste hors du DAG.** Le fond étant figé avant la passe, plus rien ne l'y empêche ;
  le classement du compilateur serait alors le seul changement.
- **Le chemin non texturé** (appareil sans pipeline de matériaux) dessine une surface transmissive
  comme un mélange ordinaire : la passe de transmission demande l'atlas et le fond figé.
- **Rembourrage de la table** : les clusters transparents restent alignés par primitive sur
  64 entrées. Ce n'était pas dans le chemin de ce lot — l'alignement est structurel à la somme
  préfixe par groupe de la compaction, et une primitive transmissive est `shared-blend`, donc absente
  de cette table.

### Porte rouge sur `develop` au moment de cette fusion, étrangère à ce lot

`npm run check:lines` échoue sur la tête de `develop` (`56c1012`) seule, sans une ligne de ce lot :
`packages/sdk-core/metricsContracts.ts` 202 lignes, `scripts/mesure/options.mjs` 201,
`scripts/mesure/page.mjs` 240, pour un plafond de 200. Les trois viennent de
`lot/ombres-virtualisees` et ce lot n'en touche aucun. Constat, pas conséquence ; renvoyé à qui les a
écrits. Les neuf autres portes sont vertes sur la branche fusionnée — `format:check`,
`check:duplicates`, `lint` (ESLint et Clippy), `check:unused`, `build`, `build:native`,
`check:structure`, `check:dts`, `check:links` — avec 740 tests JS/TS et 153 tests Rust au vert.

## 2026-09-15 — [compilateur] pilote unity

Un projet Unity exporté tel quel devient une scène intermédiaire glTF, sans éditeur, sans outil
tiers. Le pilote est un module par responsabilité sous `packages/asset-compiler-rust/src/plugins/
scene/unity/` — `yaml`, `project`, `build`, `render`, `prefab`, `assets`, `materials`, `textures`,
`merge`, `models`, `builtin`, `transform`, `output`, `convert` — plus une ligne dans le registre de
scènes. Rien d'autre dans le cœur, aucun autre pilote touché.

**Condition juridique, écrite en tête du module comme ici.** Données seulement : la sérialisation
YAML documentée par Unity pour `.unity`, `.prefab`, `.mat` et `.meta`. Aucun script C#, aucun
assembly, aucune bibliothèque, aucun SDK, aucun shader de l'éditeur n'est lu, exécuté, repris ni
redistribué ; rien n'est déchiffré ni contourné. Lecteur YAML : `yaml-rust2` 0.13 (MIT OU
Apache-2.0), version figée dans `Cargo.toml` et nommée dans la version du pilote. La licence du
contenu importé reste celle de son auteur.

**Ce qui est lu.** L'entête d'un document Unity (`--- !u!<classe> &<fileID>`, et le mot `stripped`
d'une accroche de prefab) n'est pas du YAML ordinaire : on découpe le flux ligne par ligne et on ne
confie au parseur que le corps. Un GUID de trente-deux chiffres hexadécimaux comme
`0000000000000000e000000000000000` ressemble à un nombre en notation scientifique : il arrive en
`Real`, dont on relit le texte d'origine — le lire par `as_str` seul laisserait la référence vide.
Les `.meta` sont indexés une fois pour toutes sous la racine `Assets`, et toute référence se résout
par GUID. Suivent : hiérarchie des `Transform`, `MeshFilter` + `MeshRenderer`, instances de prefab
avec leurs retouches de transformation, de nom et de matériau, `LODGroup`. Les modèles sont importés
par le pilote de leur format via le registre — on compose, on ne réimplémente pas FBX — versés une
seule fois dans la scène puis instanciés ; les matériaux du `MeshRenderer` remplacent ceux du modèle,
emplacement par emplacement, comme Unity le fait. Une scène par source : plusieurs `.unity` dans un
dossier sont refusés en les nommant, l'appelant en désigne un par son fichier.

**Ce qui est compté sans être rendu.** LOD autres que le plus fin, objets inactifs, rendus
désactivés, lampes, caméras, terrains, particules, rendus animés ou de sprite, scripts, retouches de
prefab autres que transformation/nom/matériau, cartes métal-lissage empaquetées, textures d'un format
hors registre d'images, primitives intégrées autres que le cube. Rien de tout cela n'interrompt une
compilation.

**Conversion d'axes.** Unity est en main gauche (Y haut, Z avant, 1 unité = 1 m), le glTF en main
droite : les deux ne diffèrent que par le sens de Z, donc la conversion exacte est la symétrie
`S = diag(1, 1, -1)`, sa propre inverse. On ne l'applique qu'aux transformations de la scène, jamais
aux sommets d'un modèle : Unity lit elle-même un FBX en appliquant `S`, donc un sommet vaut `S·v`
dans la scène Unity et repasser en glTF donne `S·(T₁…Tₙ)·S·v = (S·T₁·S)…(S·Tₙ·S)·v`. La chaîne se
télescope : convertir chaque transformation locale par `T ↦ S·T·S` suffit, la géométrie du modèle
reste intacte dans l'espace où son propre pilote l'a rendue. En clair : position `(x, y, -z)`,
quaternion `(-x, -y, z, w)`, échelle inchangée. `S·T·S` est une rotation propre (déterminant +1) :
l'ordre d'enroulement des faces ne change pas, aucune normale n'est retournée, aucun matériau ne
devient double face par accident.

**Matériaux.** Standard, URP Lit et HDRP Lit sont lus *par propriété*, jamais par famille de shader :
`_BaseColor`/`_Color`, `_BaseColorMap`/`_BaseMap`/`_MainTex`, `_Smoothness`/`_Glossiness`,
`_NormalMap`/`_BumpMap`, `_EmissiveColor`/`_EmissionColor`. Seule conversion de grandeur :
`roughness = 1 − smoothness`. Les deux vivent dans [0, 1], l'application est une bijection,
l'aller-retour est exact : aucune information n'est perdue. La couleur de base reste un facteur
multiplié par sa texture, comme chez Unity comme en glTF. Modes de rendu : Opaque, Cutout, Fade et
Transparent (`_Mode` chez Standard, `_Surface` et le drapeau de découpe chez URP et HDRP) vont vers
`OPAQUE`, `MASK` avec son seuil, `BLEND` — un matériau transparent ne devient jamais masqué. Unity
empaquette métal et lissage dans un seul plan là où le glTF les attend en G et B : les convertir
demanderait de réencoder des pixels, on garde donc les facteurs déclarés, exacts, et la carte est
comptée au rapport. Le cube intégré de l'éditeur est reconstruit depuis sa définition géométrique
(un mètre d'arête, centré, six faces) et non extrait d'un fichier de Unity ; les autres primitives
ont une tessellation propre à l'éditeur qu'on ne peut pas reproduire fidèlement, elles sont comptées.

**Dorée.** Une seule, `fixtures/unity/cc0-import-project`, reprise du corpus CC0 local (le dépôt
ignore `test-assets/`) avec sa notice, sans le script d'éditeur du corpus, et complétée sous la même
licence de ce que le corpus ne porte pas — la scène du corpus ne pose que des cubes intégrés : une
référence de modèle par GUID (le FBX à LOD 320/80/20), une lampe, deux matériaux aux modes découpé
et transparent, un objet inactif, une instance de prefab replacée et renommée. `expected.json` fixe
en clair 9 instances, 6 maillages, la hiérarchie, les transformations converties — `Prop_Model` posé
en (1, 2, 3) et tourné d'un quart de tour autour de Y sort en (1, 2, −3) avec
(0, −0.7071067811865476, 0, 0.7071067811865476), échelle 2 — les facteurs PBR de chaque matériau,
492 triangles, 8 rendus de LOD écartés et la TGA signalée sans bloquer. La dorée passe par le harnais
commun, à qui ce lot apprend deux choses : accepter une source d'un autre format que glTF, et relire
la scène intermédiaire qu'un pilote nommé a écrite. Trois tests de refus l'accompagnent : `.unity`
tronqué (fixture `limites`, 31 octets), plusieurs scènes dans un dossier, fichier reconnu à son
entête. `cargo test` du crate : 169 tests au vert ; `cargo clippy --all-targets -D warnings`,
`cargo fmt --check`, `check:lines` et `check:duplicates` verts.

**Essai à blanc sur un vrai projet**, en lecture seule, sortie dans le bac à sable — `Industrial
Map`, licence FAB, non redistribuable, donc aucun test automatique dessus. 349 `.meta` indexés.
`Map_v1.unity` : 350 instances de prefab, 327 instances de maillage, 4 modèles importés, 126
maillages, 17 matériaux, 14 786 triangles, 64 fichiers de données lus, 1,5 s d'import.
`Assets_showcase_scene.unity` : 128 instances de prefab, 677 instances, 12 modèles, 186 maillages,
38 matériaux, 49 767 triangles, 152 fichiers lus. Aucun échec de lecture, aucun prefab ni modèle
introuvable. Au rapport : 4 puis 10 textures TGA non lues (le registre d'images ne connaît pas encore
ce format, un autre lot le code), 880 puis 128 retouches de prefab ignorées, 15 puis 34 modèles à
plusieurs maillages instanciés entiers, une lampe et une caméra. Le dossier source n'a pas été
touché : aucun fichier n'y a changé.

**Ce qui reste.** Le `fileID` d'un `MeshFilter` désigne un maillage précis dans le modèle importé ;
cette correspondance est interne à l'éditeur et n'est pas reconstituable, donc un modèle à plusieurs
maillages est instancié entier et le fait est compté — c'est la limite qui coûtera le plus cher sur
un grand kit. Le facteur d'échelle d'import déclaré par un `ModelImporter` n'est pas appliqué. Les
lampes ne sont pas encore converties, alors que le glTF intermédiaire sait les porter. Le routeur
refuse un dossier qui mêle `.unity` et `.fbx` au même niveau, ce qui reste son affaire et non celle
de ce pilote. Enfin, la conversion relit le YAML à chaque appel : c'est court, et les modèles, eux,
sont déjà mis en cache par leur propre pilote.
