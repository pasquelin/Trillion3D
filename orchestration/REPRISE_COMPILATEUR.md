# Prompt de reprise — session Compilateur (formats d'import), 15 sept. 2026, pause

Colle ce fichier tel quel dans la nouvelle session. Les agents de la session précédente sont morts avec elle ; leur travail est sur disque (develop, journal, fixtures).

## Rôles et règles (rappel ferme)

Fable = chef : ne code pas, ne lit pas de code, décide et brief ; Opus 5 = code ; Sonnet 5 = fusion, validation, tests, mesures. Réponses de 5 à 10 lignes. Règles du dépôt : `AGENTS.md` (mots interdits, plafond 200 lignes/fichier, portes). Enchaînement automatique autorisé : livraison → fusion locale → lot suivant du plan, sans redemander « go » ; « go » seulement pour un changement de plan ou une suppression irréversible. Jamais de `git stash`, jamais de `git push` : seule la session « Validateur » pousse `origin/develop` après `/simplify` + validate ; nos fusions restent locales (`develop` puis `main` alignée) et on prévient le Validateur à chaque commit de fusion, il nettoie les worktrees fusionnés. Quatre sessions en parallèle (Compilateur, Calculs, Lumière, Geometry) qui se parlent par messages inter-sessions : annoncer chaque fusion par SHA, respecter les gels demandés (mesure sous `.claude/mesure.lock`, aucun cargo/validate pendant une mesure de temps ; re-preuve de Geometry, aucun commit intercalé). `test-assets/` = corpus CC0 de ChatGPT, hors git, reconstruit par `telecharger.sh`, index dans `INDEX.md`/`COVERAGE.md` ; `check:links` l'ignore désormais (le corpus hors git n'est plus un rouge de faux positif). Licence Xcode : `DEVELOPER_DIR=/Library/Developer/CommandLineTools` devant cargo.

Politique des formats : `orchestration/COMPILATEUR_IMPORT.md` (règle de tête : jamais de perte ajoutée ; aucun format propriétaire hors lecture légale). Mode d'emploi d'un pilote : `packages/asset-compiler-rust/PLUGINS.md`. Un format = un module + une ligne de registre + une dorée minimale, confié à un Opus en worktree ; trois Opus au plus en parallèle, périmètres disjoints ; un Sonnet fusionne et valide à la livraison (`npm run validate`, `cargo test --locked`, grep des mots interdits, `branch -f main develop`, suppression du worktree et de la branche).

Règles ajoutées à la pause :

- (a) La session connaît son rôle par `get_session("self")` (titre « Compilateur », id `local_03e37a47…`), jamais par le dernier fichier de reprise lu ; le Validateur est la session titrée « Simplify » (id `local_f2f0a83d…`), seule à fusionner `develop`, `/simplify`, valider et pousser : on lui livre des branches avec preuve (SHA, `cargo test --locked`, portes), on ne fusionne plus soi-même.
- (b) Vérifier la base d'un worktree d'agent dès son lancement (`git merge-base develop HEAD`) : quatre agents sont partis de `2dcc8fc` aujourd'hui, un `git rebase develop` immédiat corrige un retard tant que rien n'est encore commité.
- (c) Verrou `.claude/mesure.lock` posé par `mkdir` sans `-p`, vide, rendu par `rmdir` ; jamais retiré sans réponse de son propriétaire.
- (d) Tests d'un pilote d'image écrits avec les helpers `rgba8()`/`rgba_f32()` de `src/plugins/tests.rs`, jamais un `let` irréfutable sur une variante de `DecodedImage`.
- (e) Toute politique qui change ce qu'un pilote produit fait bouger sa `version()` : c'est l'identité du cache.

## État de develop à la pause (SHA dans la dernière ligne de ce fichier)

Routeur à pilotes fusionné en premier (contrats `scene-plugin-2`, `image-plugin-2`, registre statique, empreinte du registre dans la clé de cache). Pilotes de scène (6) : `gltf`, `fbx` (ufbx, `-gltf-4`, opacité FBX lue, `originalUnitMeters`), `obj`, `zip` (socle conteneur `archive/container.rs`, refus `ARCHIVE_*`), `unity` (données YAML seules, LOD le plus fin, .mat Standard/URP/HDRP → PBR, axes `diag(1,1,−1)`, sous-maillage par `fileID` via `internalIDToNameTable`, échelle d'import, retouches de prefab, `fileID` en i64, priorité de projet dans le routeur `project_inputs`), `unitypackage` (tar.gz → arbre Unity → `unity`). Pilotes d'image (9), contrat `image-plugin-2` à deux sorties (`Rgba8`, `RgbaF32`) : `png` (16 bits refusé `image-depth-unsupported`, version `png-image-0.25-depth8`), `jpeg`, `tga` (sans perte, toutes variantes), `tiff` (profils déclarés, 16 bits refusé), `dds` (BC1–BC5, BC7, non compressé ; décodeur `texture2ddecoder` MIT ; BC6H et 16 bits refusés), `webp` (sans perte uniquement, crate `image-webp` via `image` 0.25.10, refus nommés `image-lossy-unsupported` et `image-animation-unsupported`), `exr` (crate `exr` 1.74.2, BSD-3, refus `image-float-unsupported` chez un consommateur RGBA8), `hdr` (Radiance RGBE, lecteur écrit depuis la spécification, aucune crate), `ktx2` (crates `basisu` 0.1.0 Apache-2.0, `texture2ddecoder` 0.1.2, `ruzstd` 0.7.3 ; socle `image/blocks.rs` partagé avec `dds`). Une seule racine de résolution des images de l'import aux aperçus (`plugins::scene::image_root`). Toutes les dorées sur fixtures CC0 minuscules ; `expected.json` inchangés hors ajouts.

Essai à blanc Industrial Map (`/Users/pasquelin/Desktop/AI/map/Industrial Map`, FAB, lecture seule, jamais commis) : `Map_v1` 401 instances, 25 modèles, 108 matériaux, 51 images, 60 694 triangles ; `Assets_showcase_scene` 170 instances, 35 modèles, 24 566 triangles ; toutes les TGA lues ; 0 modèle entier en repli.

## Branches vivantes

Aucune à la pause : chaque lot de la vague 3 (`compilateur/webp`, `compilateur/png-16-bits`, `compilateur/exr-hdr`, `compilateur/ktx2`) a été fusionné puis son worktree supprimé — vérifié (`git worktree list`, `git branch --list 'compilateur/*'`). Si un `compilateur/*` réapparaît sans avoir été annoncé fusionné, c'est qu'un lot n'a pas atteint develop : relancer un Sonnet de fusion (merge develop, validate, cargo test, main, nettoyage).

## Décisions en attente de l'utilisateur

1. Licence des assets FAB (Village, Industrial Map) : réservée à l'utilisateur, à trancher seulement avant une démonstration publique — pas un blocage de développement.
2. Option `atlasClasses: 2` et départ au sol du banc 15 : à trancher par la session Compilateur (voir `REPRISE_2026-09-15.md`).

## À faire ensuite, dans l'ordre

1. **Vague 4, trois Opus** : `usd`/`usdz` **fait** (branche `compilateur/usd` : caisse `openusd` 0.7.0 MIT, Rust pur ; Xform/Scope, Mesh triangulés, GeomSubset, instances, UsdPreviewSurface, `metersPerUnit`/`upAxis` sur la racine ; conteneur `usdz` ZIP stocké et aligné ; dorées `fixtures/usd` et `fixtures/usdz` ; refus `usd-*` et `USDZ_LAYOUT_INVALID`) ; restent `alembic` (statique) et `.blend` (SDNA, maillages/UV/instances/Principled BSDF de base). Corpus : `alembic/`, `blend/`.
2. **Vague 5** : `psd` (aplati vers RGBA8), `bmp`, `gif` (features `image`), `.ma` (Maya ASCII, données seules), MTL à vérifier (OBJ).
3. **Chantiers restants** :
   - BC6H de `dds` en flottant (attend le contrat `RgbaF32` côté DDS).
   - KTX 1.0 (autre conteneur, donc un autre pilote), si une source réelle l'impose.
   - ASTC hors 4×4 et UASTC HDR côté `ktx2` (le transcodeur `basisu` sait les produire, aucun consommateur flottant n'est branché).
   - Chantier « blocs gardés sur GPU » (`DecodedImage::Blocks`, DDS puis KTX2) : sur go de l'utilisateur seulement.
   - Lampes Unity non converties, retouches d'instances imbriquées non composées, cartes métal-lissage empaquetées.
   - TIFF palette (crate `tiff`), test d'archive chiffrée.
   - `docs/COMPILER.md` : relire à chaque pilote livré pour les codes de rapport.
   - Industrial Map au banc 15 : le dossier de mesure est à copier dans `public/benchmark-assets` du Lab par l'utilisateur ; ensuite agent Lab séparé (projet render-tech-lab, un agent par projet), entrée de catalogue comme le Village, `prepare()` du SDK sur le dossier du projet Unity, preuve navigateur WebGPU + Three témoin, chiffres au journal. Machine calme exigée pour les durées ; les verdicts pixel n'en dépendent pas.
4. Chantiers hors compilateur listés dans `REPRISE_2026-09-15.md` (loop-code P1/P2, poids sans perte, virtualisation par tuiles).

## Dernier état connu

develop = main = origin/develop = ffdd01e ; origin/develop poussé par le Validateur seulement.
