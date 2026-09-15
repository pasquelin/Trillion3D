# Prompt de reprise — session Compilateur (formats d'import), 15 sept. 2026, pause

Colle ce fichier tel quel dans la nouvelle session. Les agents de la session précédente sont morts avec elle ; leur travail est sur disque (develop, journal, fixtures).

## Rôles et règles (rappel ferme)

Fable = chef : ne code pas, ne lit pas de code, décide et brief ; Opus 5 = code ; Sonnet 5 = fusion, validation, tests, mesures. Réponses de 5 à 10 lignes. Règles du dépôt : `AGENTS.md` (mots interdits, plafond 200 lignes/fichier, portes). Enchaînement automatique autorisé : livraison → fusion locale → lot suivant du plan, sans redemander « go » ; « go » seulement pour un changement de plan ou une suppression irréversible. Jamais de `git stash`, jamais de `git push` : seule la session « Validateur » pousse `origin/develop` après `/simplify` + validate ; nos fusions restent locales (`develop` puis `main` alignée) et on prévient le Validateur à chaque commit de fusion, il nettoie les worktrees fusionnés. Quatre sessions en parallèle (Compilateur, Calculs, Lumière, Geometry) qui se parlent par messages inter-sessions : annoncer chaque fusion par SHA, respecter les gels demandés (mesure sous `.claude/mesure.lock`, aucun cargo/validate pendant une mesure de temps ; re-preuve de Geometry, aucun commit intercalé). `test-assets/` = corpus CC0 de ChatGPT, hors git, reconstruit par `telecharger.sh`, index dans `INDEX.md`/`COVERAGE.md` ; `check:links` y est rouge, constat connu, pas un blocage. Licence Xcode : `DEVELOPER_DIR=/Library/Developer/CommandLineTools` devant cargo.

Politique des formats : `orchestration/COMPILATEUR_IMPORT.md` (règle de tête : jamais de perte ajoutée ; aucun format propriétaire hors lecture légale). Mode d'emploi d'un pilote : `packages/asset-compiler-rust/PLUGINS.md`. Un format = un module + une ligne de registre + une dorée minimale, confié à un Opus en worktree ; trois Opus au plus en parallèle, périmètres disjoints ; un Sonnet fusionne et valide à la livraison (`npm run validate`, `cargo test --locked`, grep des mots interdits, `branch -f main develop`, suppression du worktree et de la branche).

## État de develop à la pause (SHA dans la dernière ligne de ce fichier)

Routeur à pilotes fusionné en premier (contrats `scene-plugin-2`, `image-plugin-1`, registre statique, empreinte du registre dans la clé de cache). Pilotes de scène (6) : `gltf`, `fbx` (ufbx, `-gltf-4`, opacité FBX lue, `originalUnitMeters`), `obj`, `zip` (socle conteneur `archive/container.rs`, refus `ARCHIVE_*`), `unity` (données YAML seules, LOD le plus fin, .mat Standard/URP/HDRP → PBR, axes `diag(1,1,−1)`, sous-maillage par `fileID` via `internalIDToNameTable`, échelle d'import, retouches de prefab, `fileID` en i64, priorité de projet dans le routeur `project_inputs`), `unitypackage` (tar.gz → arbre Unity → `unity`). Pilotes d'image (5) : `png`, `jpeg`, `tga` (sans perte, toutes variantes), `tiff` (profils déclarés, 16 bits refusé `image-depth-unsupported`), `dds` (BC1–BC5, BC7, non compressé ; décodeur `texture2ddecoder` MIT ; BC6H et 16 bits refusés). Une seule racine de résolution des images de l'import aux aperçus (`plugins::scene::image_root`) : les aperçus 16×16 après import FBX sont revenus. Toutes les dorées sur fixtures CC0 minuscules ; `expected.json` inchangés hors ajouts.

Essai à blanc Industrial Map (`/Users/pasquelin/Desktop/AI/map/Industrial Map`, FAB, lecture seule, jamais commis) : `Map_v1` 401 instances, 25 modèles, 108 matériaux, 51 images, 60 694 triangles ; `Assets_showcase_scene` 170 instances, 35 modèles, 24 566 triangles ; toutes les TGA lues ; 0 modèle entier en repli.

## Branches vivantes

Aucune attendue à la pause : chaque lot est fusionné puis son worktree supprimé. Vérifier `git worktree list` et `git branch --list 'compilateur/*'` ; si `compilateur/unity-suite` existe encore, c'est que sa fusion n'a pas eu lieu : relancer un Sonnet de fusion (merge develop, validate, cargo test, main, nettoyage).

## Décisions en attente de l'utilisateur

1. **PNG 16 bits abaissé en 8 bits en silence** par le pilote `png` (via `to_rgba8()` de la crate `image`), vérifié sur `test-assets/textures/png-matrix/rgb16.png` : perte ajoutée, contraire à la règle. Deux voies : refuser avec rapport comme `tiff` (rapide), ou porter le 16 bits jusqu'à l'écran (variante `Rgba16`, contrat d'image relevé, chaque consommateur adapté : lot Opus dédié). Question posée, sans réponse.
2. Licence des assets FAB (Village, Industrial Map) avant toute démonstration publique.
3. Option `atlasClasses: 2` et départ au sol du banc 15 (voir REPRISE_2026-09-15.md).

## À faire ensuite, dans l'ordre

1. **Industrial Map au banc 15** : agent Lab séparé (projet render-tech-lab, règle un agent par projet), entrée de catalogue comme pour le Village (`15-virtualized-integration/assets/modelCatalog.ts`), `prepare()` du SDK sur le dossier du projet Unity (le routeur choisit `unity` seul), preuve navigateur WebGPU + Three témoin, chiffres au journal. Machine calme exigée pour les durées ; les verdicts pixel n'en dépendent pas.
2. **Vague 3, trois Opus** : `exr` + `hdr` (variante flottante de `DecodedImage`, usage éclairage), `ktx2` (Basis Apache-2, transcodage vers RGBA8 ; blocs gardés sur GPU = même chantier que DDS). Corpus : `textures/hdr-matrix`, `ktx2-matrix`. `webp` est fait : sans perte uniquement, refus nommés pour le flux avec perte et l'animation.
3. **Vague 4** : `usd`/`usdz` (crate à évaluer, sinon lecteur usda/usdc propre), `alembic` (statique), `blend` (SDNA), corpus `usd/`, `alembic/`, `blend/`.
4. **Vague 5** : `psd` (aplati), `bmp`, `gif`, `ma` (Maya ASCII, données seules), MTL à vérifier.
5. **Chantier « blocs gardés sur GPU »** (règle de tête de COMPILATEUR_IMPORT.md) : variante `DecodedImage::Blocks { codec, width, height, data }`, `match` dans `texture_preview.rs`, transport et atlas en blocs, repli décodé ; concerne DDS puis KTX2. À ne lancer qu'avec un go.
6. Restes des pilotes : lampes Unity non converties, retouches d'instances imbriquées non composées, cartes métal-lissage empaquetées ; TIFF palette (crate `tiff`), test d'archive chiffrée ; `docs/COMPILER.md` à relire pour les codes de rapport.
7. Chantiers hors compilateur listés dans `REPRISE_2026-09-15.md` (loop-code P1/P2, poids sans perte, virtualisation par tuiles).

## Dernier état connu

develop = main = 6a4457c ; origin/develop poussé par le Validateur seulement.
