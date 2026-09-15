# Formats d'import du compilateur — inventaire et politique (15 sept. 2026)

Règle de fidélité et de légèreté (utilisateur, 15 sept. 2026) : on n'ajoute jamais de perte. Une texture reçue sans perte reste exacte (RGBA8 à l'écran, PNG ou Zstd sans perte sur le fil, niveaux progressifs pour la première image) ; une texture reçue déjà compressée pour GPU garde son format compressé sur le GPU quand la machine l'accepte, et n'est décodée qu'en repli. Un éventuel mode « léger » qui recompresse serait une option produit avec écart mesuré et affiché, jamais le défaut.

Objectif : un seul exécutable Rust qui accepte ce que livrent les places de marché (FAB, Unity Asset Store, Quixel, Sketchfab) sans outil tiers. Fidélité avant tout : aucun format avec perte n'est réencodé, les sources ne sont jamais modifiées.

Politique juridique fixée par l'utilisateur : aucun format propriétaire, sauf lecture légale établie. Cette page n'est pas un avis d'avocat ; les verdicts viennent d'une analyse documentaire (directive 2009/24/CE art. 1, 5 § 3, 6 ; CJUE SAS Institute C‑406/10 ; 17 USC § 102(b) ; SAS v. WPL, 4th Cir. 2017 sur la portée des contrats). Règles de dépôt : lecteur écrit à partir de spécifications publiques ou de bibliothèques permissives dont la licence est respectée, jamais de code ni de SDK d'éditeur repris, jamais de contournement de protection, provenance de chaque lecteur documentée, jeux de tests redistribuables.

État actuel du code : géométrie FBX (ufbx, MIT, sans SDK Autodesk) et OBJ, glTF et GLB en entrée directe, un modèle par dossier source ; textures PNG et JPEG décodées, les autres ignorées avec rapport.

## Architecture : un pilote par format

Le compilateur ne connaît aucun format. Il route chaque source vers un pilote (plugin d'interprétation) enregistré dans un registre statique, sur le modèle d'un pilote de périphérique :

- **un pilote par format, sans exception, existants compris** : `gltf`, `fbx`, `obj` pour les scènes ; `png`, `jpeg` pour les images ; puis `tga`, `tiff`, `dds`, `exr`, `hdr`, `ktx2`, `webp`, `psd`, `bmp`, `gif`, `zip`, `unitypackage`, `unity`, `usd`, `alembic`, `blend`, `ma` ;
- chaque pilote est un module Rust avec son nom, sa version, sa détection (extension, nombre magique, structure de dossier), son rapport nommé et son test doré minimal ; deux pilotes peuvent partager une bibliothèque interne (ufbx pour `fbx` et `obj`, la crate `image` pour les images) mais restent deux entrées du registre ;
- ajouter ou retirer un format = ajouter ou retirer un module et une ligne de registre, sans toucher au cœur ni au CLI ;
- deux contrats versionnés : pilote de scène (produit la scène intermédiaire glTF + bin + rapport) et pilote d'image (produit RGBA8, plus tard flottant pour EXR et HDR) ; la version des pilotes entre dans l'identité du cache ;
- le pilote retenu (nom, version) est consigné dans le manifeste et le rapport pour la provenance ;
- une source inconnue ou ambiguë est refusée avec la liste des formats acceptés, jamais interprétée par défaut ;
- le mode d'emploi pour écrire un pilote est `packages/asset-compiler-rust/PLUGINS.md` ; chaque format à venir est confié à un agent indépendant qui ne touche qu'à son module et à sa ligne de registre.

## Sûrs — à faire

| Format                  | Base                                                    | État    | Voie                                                 | Priorité |
| ----------------------- | ------------------------------------------------------- | ------- | ---------------------------------------------------- | -------- |
| glTF / GLB              | standard Khronos                                        | fait    | —                                                    | —        |
| OBJ / MTL               | spécification publiée                                   | fait    | MTL à vérifier                                       | P2       |
| PNG, JPEG classique     | standards                                               | fait    | —                                                    | —        |
| TGA                     | spécification publiée                                   | fait    | —                                                     | —        |
| TIFF (profils déclarés) | spécification publiée                                   | fait    | —                                                     | —        |
| OpenEXR, Radiance HDR   | documentés, BSD-3                                       | à coder | features `exr`, `hdr`, usage éclairage               | P3       |
| USD / USDZ              | AOUSD public, OpenUSD sous TOST 1.0                     | à coder | crate Rust à évaluer, sinon lecteur usda/usdc propre | P3       |
| Alembic                 | ouvert, BSD-3                                           | à coder | géométrie statique seulement                         | P3       |
| `.blend`                | SDNA documenté ; lire un .blend n'impose pas la GPL     | à coder | maillages, UV, instances, Principled BSDF de base    | P3       |
| PSD / PSB               | spécification publiée par Adobe pour les lecteurs tiers | à coder | aplati seulement, vers RGBA8                         | P3       |
| BMP, GIF                | ouverts                                                 | à coder | features `image`                                     | P3       |
| ZIP                     | ouvert                                                  | fait    | —                                                     | —        |

## Sûrs sous conditions — à faire, condition écrite dans le code et le journal

| Format                                     | Condition                                                                                      | État    | Voie                                                                                      | Priorité            |
| ------------------------------------------ | ---------------------------------------------------------------------------------------------- | ------- | ----------------------------------------------------------------------------------------- | ------------------- |
| FBX                                        | ufbx MIT, version figée, notices conservées, jamais le SDK Autodesk                            | fait    | —                                                                                         | —                   |
| Unity `.unity`, `.prefab`, `.mat`, `.meta` | sous-ensemble YAML documenté par Unity ; données seulement, jamais de scripts ni de code Unity | fait    | —                                                                                          | —                    |
| `.unitypackage`                            | archive tar.gz ; chaque fichier garde sa licence                                               | fait    | —                                                                                          | —                    |
| DDS                                        | conteneur documenté par Microsoft ; codecs déclarés un par un                                  | fait    | —                                                                                          | —                   |
| KTX / KTX2, Basis Universal                | Khronos ; Basis Apache-2 ; codecs listés dans le build                                         | à coder | transcodage vers RGBA8                                                                    | P3                  |
| WebP                                       | libwebp BSD-3 ; portée brevets à vérifier si décodeur réécrit                                  | à coder | sans perte uniquement                                                                     | P3                  |
| Maya ASCII `.ma`                           | format documenté ; données seulement, aucun script exécuté                                     | à coder | sous-ensemble nœuds, attributs, connexions                                                | P3                  |

## À éviter — pas d'import natif

`.uasset` / `.umap`, `.max`, `.mb` (binaire), SpeedTree natif, Substance `.sbsar`, CAO (`.step`, `.3dm`), nuages de points, HEIC. On demande l'export dans un format de la liste.

## Licences de contenu — indépendantes du format

- FAB Standard License : usage avec d'autres outils et moteurs autorisé, redistribution de l'asset seul interdite ; certaines fiches relèvent d'une licence historique, garder l'EULA de l'achat.
- Quixel Megascans obtenus sous un plan du moteur d'Epic : réservés à ce moteur, inutilisables dans WebGeometry.
- Unity Asset Store : usage dans d'autres moteurs autorisé, mais pas un produit dont la fonction est de donner accès aux assets bruts ; un éditeur qui distribue une bibliothèque de modèles n'est pas un jeu fini.
- Sketchfab : licence par téléchargement (CC-BY exige attribution et mention des modifications).
- Démonstrations et tests publics du dépôt : assets dont on possède tous les droits ou sous licence autorisant la redistribution.

## Ordre proposé

1. TGA.
2. Scène Unity (`.unity` + `.prefab` + `.mat` + `.meta`), test doré sur une mini-scène, puis Industrial Map au banc 15.
3. Kits multi-FBX, ZIP, `.unitypackage`.
4. TIFF, DDS, MTL.
5. USD, Alembic, `.blend`, PSD, EXR/HDR, KTX2, WebP, `.ma` selon besoin réel.
