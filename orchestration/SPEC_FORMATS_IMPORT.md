# Formats d'import du compilateur — inventaire et politique (15 sept. 2026)

Objectif : un seul exécutable Rust qui accepte ce que livrent les places de marché (FAB, Unity Asset Store, Quixel, Sketchfab) sans outil tiers. Fidélité avant tout : aucun format avec perte n'est réencodé, les sources ne sont jamais modifiées.

Politique juridique fixée par l'utilisateur : aucun format propriétaire, sauf lecture légale établie. Cette page n'est pas un avis d'avocat ; les verdicts viennent d'une analyse documentaire (directive 2009/24/CE art. 1, 5 § 3, 6 ; CJUE SAS Institute C‑406/10 ; 17 USC § 102(b) ; SAS v. WPL, 4th Cir. 2017 sur la portée des contrats). Règles de dépôt : lecteur écrit à partir de spécifications publiques ou de bibliothèques permissives dont la licence est respectée, jamais de code ni de SDK d'éditeur repris, jamais de contournement de protection, provenance de chaque lecteur documentée, jeux de tests redistribuables.

État actuel du code : géométrie FBX (ufbx, MIT, sans SDK Autodesk) et OBJ, glTF et GLB en entrée directe, un modèle par dossier source ; textures PNG et JPEG décodées, les autres ignorées avec rapport.

## Sûrs — à faire

| Format                  | Base                                                    | État    | Voie                                                 | Priorité |
| ----------------------- | ------------------------------------------------------- | ------- | ---------------------------------------------------- | -------- |
| glTF / GLB              | standard Khronos                                        | fait    | —                                                    | —        |
| OBJ / MTL               | spécification publiée                                   | fait    | MTL à vérifier                                       | P2       |
| PNG, JPEG classique     | standards                                               | fait    | —                                                    | —        |
| TGA                     | spécification publiée                                   | à coder | feature `tga` de `image`, sans perte                 | P1       |
| TIFF (profils déclarés) | spécification publiée                                   | à coder | feature `tiff`, 8 et 16 bits, compressions listées   | P2       |
| OpenEXR, Radiance HDR   | documentés, BSD-3                                       | à coder | features `exr`, `hdr`, usage éclairage               | P3       |
| USD / USDZ              | AOUSD public, OpenUSD sous TOST 1.0                     | à coder | crate Rust à évaluer, sinon lecteur usda/usdc propre | P3       |
| Alembic                 | ouvert, BSD-3                                           | à coder | géométrie statique seulement                         | P3       |
| `.blend`                | SDNA documenté ; lire un .blend n'impose pas la GPL     | à coder | maillages, UV, instances, Principled BSDF de base    | P3       |
| PSD / PSB               | spécification publiée par Adobe pour les lecteurs tiers | à coder | aplati seulement, vers RGBA8                         | P3       |
| BMP, GIF                | ouverts                                                 | à coder | features `image`                                     | P3       |
| ZIP                     | ouvert                                                  | à coder | extraction préalable                                 | P2       |

## Sûrs sous conditions — à faire, condition écrite dans le code et le journal

| Format                                     | Condition                                                                                      | État    | Voie                                                                                      | Priorité            |
| ------------------------------------------ | ---------------------------------------------------------------------------------------------- | ------- | ----------------------------------------------------------------------------------------- | ------------------- |
| FBX                                        | ufbx MIT, version figée, notices conservées, jamais le SDK Autodesk                            | fait    | —                                                                                         | —                   |
| Unity `.unity`, `.prefab`, `.mat`, `.meta` | sous-ensemble YAML documenté par Unity ; données seulement, jamais de scripts ni de code Unity | à coder | lecteur YAML → instances de FBX par GUID, LOD le plus fin, `.mat` Standard/URP/HDRP → PBR | P1 (Industrial Map) |
| `.unitypackage`                            | archive tar.gz ; chaque fichier garde sa licence                                               | à coder | extraction vers l'arbre Unity                                                             | P2                  |
| DDS                                        | conteneur documenté par Microsoft ; codecs déclarés un par un                                  | à coder | BC1-7 → RGBA8 (perte déjà faite à la source)                                              | P2                  |
| KTX / KTX2, Basis Universal                | Khronos ; Basis Apache-2 ; codecs listés dans le build                                         | à coder | transcodage vers RGBA8                                                                    | P3                  |
| WebP                                       | libwebp BSD-3 ; portée brevets à vérifier si décodeur réécrit                                  | à coder | sans perte uniquement                                                                     | P3                  |
| Maya ASCII `.ma`                           | format documenté ; données seulement, aucun script exécuté                                     | à coder | sous-ensemble nœuds, attributs, connexions                                                | P3                  |
| `.uasset` / `.umap`                        | lecteur indépendant sans code d'Epic ni déchiffrement ; audit d'avocat AVANT diffusion         | non     | étude après avis juridique seulement                                                      | bloqué              |

## À éviter — pas d'import natif

`.max`, `.mb` (binaire), SpeedTree natif, Substance `.sbsar`, CAO (`.step`, `.3dm`), nuages de points, HEIC. On demande l'export dans un format de la liste.

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
