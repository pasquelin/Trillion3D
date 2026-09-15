# Formats d'import du compilateur — inventaire (15 sept. 2026)

Objectif : un seul exécutable Rust qui accepte ce que livrent les places de marché (FAB, Quixel, Sketchfab, Unity Asset Store) sans Blender ni outil tiers. Fidélité avant tout : aucun format avec perte n'est réencodé, les sources ne sont jamais modifiées.

État actuel (relevé dans le code) : géométrie FBX et OBJ via ufbx, glTF et GLB en entrée directe, exactement un modèle par dossier source ; textures décodées PNG et JPEG seulement, les autres formats sont ignorés avec un rapport (`texture-format`) ou remplacés par un PNG/JPEG voisin s'il existe.

## Géométrie et scènes

| Format                                             | Origine typique                  | État                           | Voie                                                                                             | Priorité            |
| -------------------------------------------------- | -------------------------------- | ------------------------------ | ------------------------------------------------------------------------------------------------ | ------------------- |
| FBX                                                | FAB, Unity, Quixel, Village      | fait (ufbx)                    | —                                                                                                | —                   |
| OBJ + MTL                                          | Sketchfab, scans                 | fait (ufbx)                    | vérifier MTL et textures                                                                         | P2                  |
| glTF / GLB                                         | Sketchfab, web                   | fait                           | —                                                                                                | —                   |
| Scène Unity (`.unity`, `.prefab`, `.mat`, `.meta`) | Unity Asset Store, FAB « Unity » | absent                         | lecteur YAML Unity → instances de FBX, GUID par `.meta`, LOD le plus fin, matériaux `.mat` → PBR | P1 (Industrial Map) |
| `.unitypackage`                                    | Unity Asset Store                | absent                         | archive tar.gz à extraire vers l'arbre `.unity` ci-dessus                                        | P2                  |
| Plusieurs FBX/OBJ dans un dossier (kit de props)   | FAB, Quixel                      | absent (un modèle par dossier) | assemblage par manifeste de placement ou scène Unity                                             | P1                  |
| USD / USDZ                                         | FAB, Apple, Omniverse            | absent                         | crate `usd` Rust immature : à évaluer, sinon hors périmètre                                      | P3                  |
| `.uasset` / `.umap`                                | FAB « moteur d'Epic »            | absent                         | format propriétaire, non lisible hors de l'éditeur : hors périmètre, demander l'export FBX/glTF  | refus               |
| `.blend`                                           | Blender                          | absent                         | format interne Blender, hors périmètre (zéro Blender) : demander l'export                        | refus               |
| DAE (Collada), 3DS, STL, PLY                       | anciens dépôts, scans            | absent                         | ufbx ne les lit pas ; à évaluer au cas par cas                                                   | P3                  |
| Archives ZIP                                       | toutes les places de marché      | absent                         | extraction préalable vers le dossier source                                                      | P2                  |

## Textures

| Format                     | Origine typique                     | État                       | Voie                                                                                                   | Priorité |
| -------------------------- | ----------------------------------- | -------------------------- | ------------------------------------------------------------------------------------------------------ | -------- |
| PNG, JPEG                  | partout                             | fait (`image`, png + jpeg) | —                                                                                                      | —        |
| TGA                        | Unity, FAB (Industrial Map : 33)    | ignoré                     | feature `tga` de `image`, sans perte                                                                   | P1       |
| TIFF                       | Quixel, photogrammétrie             | ignoré                     | feature `tiff`, 8 et 16 bits                                                                           | P2       |
| EXR                        | HDR, éclairage (Industrial : 2)     | ignoré                     | feature `exr`, flottant → usage éclairage seulement                                                    | P3       |
| HDR (Radiance)             | environnements                      | ignoré                     | feature `hdr`                                                                                          | P3       |
| DDS (BC1-7 déjà compressé) | moteurs, FAB                        | ignoré (PNG voisin sinon)  | décoder les blocs vers RGBA8 (perte déjà faite à la source, donc fidèle à la source) ; crate à choisir | P2       |
| KTX2 / Basis               | web                                 | ignoré                     | transcodage vers RGBA8 ; même remarque                                                                 | P3       |
| PSD                        | sources d'artistes (Industrial : 1) | ignoré                     | hors périmètre, demander l'export                                                                      | refus    |
| WebP                       | web                                 | ignoré                     | feature `webp` sans perte uniquement                                                                   | P3       |

## Matériaux

| Source                                     | État       | Voie                                                                                                                          |
| ------------------------------------------ | ---------- | ----------------------------------------------------------------------------------------------------------------------------- |
| FBX PBR (ufbx)                             | fait       | —                                                                                                                             |
| glTF PBR                                   | fait       | —                                                                                                                             |
| Unity `.mat` (Standard, URP Lit, HDRP Lit) | absent     | table de correspondance shader → PBR glTF, cartes couleur/normal/métal-rugosité/émission/opacité, mode de rendu → `alphaMode` | P1 (avec la scène Unity) |
| OBJ `.mtl`                                 | à vérifier | —                                                                                                                             | P2                       |

## Ordre proposé

1. TGA (une feature, un test doré) — débloque Industrial Map.
2. Scène Unity : `.unity` + `.prefab` + `.mat` + `.meta`, LOD le plus fin, un test doré sur une mini-scène ; puis Industrial Map au banc 15.
3. Kits de props multi-FBX et archives ZIP.
4. TIFF, DDS, MTL.
5. USD, EXR/HDR, KTX2 selon besoin réel.

Refus déclarés : `.max`/`.ma`/`.mb`, CAO, SpeedTree, `.psd`, `.sbsar`, nuages de points — on demande l'export dans un format ouvert. `.uasset`/`.umap` et `.blend` sont possibles mais coûteux : décision après étude sur un pack réel.
