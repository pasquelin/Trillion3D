# Reprise « Compilateur » (compilateur natif, formats d'import)

Vérifier le titre de session par `get_session("self")` avant tout ; relire `list_sessions` avant d'écrire à une
autre session (les ids changent). Lire ensuite `AGENTS.md`.

**Rôles.** Fable = chef, ne code pas, ne lit pas de code. Opus 5 = code, **un seul Opus, un seul lot à la fois**,
worktree isolé, branche `compilateur/lot-<lettre>-<sujet>` depuis `develop`. Sonnet 5 = doc, revues, tests.
Réponses de 5 à 10 lignes. Enchaînement sans redemander : livraison → Validateur → lot suivant ; « go » seulement
pour un changement de plan ou une suppression irréversible.

**Un lot** (voir l'audit ci-dessous). Reproduction en test d'abord, correction générique (par propriété, jamais par scène ni type d'objet),
dorée corrigée si elle figeait un résultat faux, preuve visuelle si le rendu change. Le non converti est compté par
code nommé dans `docs/COMPILER.md`. La sortie d'un pilote entre dans sa `version()`. Fichiers ≤ 200 lignes, 0 clone,
mots interdits nulle part. Portes : `fmt --check`, `clippy -D warnings`, `cargo test --locked`, `check:lines`,
`check:duplicates`, `check:changed` (lien `node_modules` en worktree, retiré ensuite), grep des mots interdits.
`DEVELOPER_DIR=/Library/Developer/CommandLineTools` devant cargo, lancé directement. Corpus CC0 `test-assets/` en
lecture seule. Jamais `git push`, `git stash`, `npm run validate`, ni fusion dans `develop`.

**Livraison** (message à la session « Validateur ») : SHA de tête, merge-base, tests de reproduction nommés, résultat
des portes, codes de rapport ajoutés, versions de pilotes modifiées, dorées touchées, restes. Le Validateur fusionne,
`/simplify`, `validate`, pousse ; cette session retire ensuite le worktree et la branche du lot.

**État.** 11 pilotes de scène, 12 d'image (`packages/asset-compiler-rust/FORMATS.md`), tous fusionnés.
Sur go seulement : blocs gardés sur GPU (DDS, KTX2), Draco/meshopt en entrée, Industrial Map au banc 15, licence FAB.

## Audit des pilotes, 58 constats (15 sept. 2026, état f6ac76f)

Audit en lecture seule : 268 tests lib + 4 CLI verts, 48 images décodées, reproductions dans `/tmp/wg-plugin-audit`, `/tmp/wg-scenes-audit`, `/tmp/wg-plugin-usd-audit`, `/tmp/wg-plugin-unity-audit` (volatils : chaque lot recrée sa reproduction en test). P1 = scène altérée, non déterminisme ou arrêt du processus ; P2 = fidélité, robustesse, ressources, diagnostic. Aucune preuve navigateur dans l'audit.

Ordre retenu par l'utilisateur : fidélité des scènes et cache OBJ, puis plantages, puis les autres familles. Les tests actuels laissent passer ces erreurs et certaines dorées figent un résultat faux : chaque lot corrige aussi la dorée.

### Lots, dans l'ordre (un seul à la fois)

| Lot                                             | Constats                                                                                                                                   | Périmètre                                                                      |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------ |
| A cache et MTL obj                              | 1, 2 + audit MTL — **livré 46d0d61** (obj/fbx `-gltf-5`, 9 codes, dorée obj) ; restes : `-o`/`-s` comptés, `-clamp` sans preuve navigateur | `import/runner.rs`, `import/textures.rs`, `import/materials.rs`, `src/uri.rs`  |
| B n-gones concaves — **prochain, à la reprise** | 9                                                                                                                                          | aide commune de triangulation (oreilles), utilisée par ma, blend, alembic, usd |
| C USD fidélité                                  | 35, 36, 37, 38, 40, 41                                                                                                                     | `plugins/scene/usd/`                                                           |
| D Unity fidélité                                | 29, 30, 32, 31                                                                                                                             | `plugins/scene/unity/`                                                         |
| E Maya fidélité                                 | 10, 11, 12, 13                                                                                                                             | `plugins/scene/ma/`                                                            |
| F Blend fidélité                                | 14, 15, 16, 17, 18                                                                                                                         | `plugins/scene/blend/`                                                         |
| G plantages et bornes                           | 23, 24, 28, 7, 25, 27                                                                                                                      | ma/mesh.rs, blend/dna.rs, unity/patch.rs, crate_image.rs, blend/envelope.rs    |
| H routage et archives                           | 3, 4, 5, 6, 26                                                                                                                             | route.rs, unitypackage.rs, zip_reader.rs, usdz.rs, alembic/ogawa.rs            |
| I images fidélité                               | 8, 53, 54, 55, 56, 57, 58                                                                                                                  | png.rs, exr.rs, psd/pixels.rs, ktx2/, dds/codec.rs, crate_image.rs             |
| J propriétés partielles                         | 19, 20, 21, 22, 33, 34, 39, 42–52                                                                                                          | par pilote (ma, blend, unity, usd)                                             |

### Les 58 constats (n°, priorité, titre, code, preuve)

1. P1 cache OBJ ignore le MTL — `import/runner.rs:25`, `import/scene.rs:44` — MTL modifié, sortie inchangée en cache.
2. P2 OBJ/FBX écrivent des chemins bruts, pas des URI — `import/textures.rs:99`, `texture_preview/source.rs:55` — `color%red.png` → `image-uri-undecodable`.
3. P2 routeur prend un sous-dossier pour un fichier — `scene/route.rs:61` — dossier `textures.fbx` → `SOURCE_FORMAT_AMBIGUOUS`.
4. P2 unitypackage accepte gzip tronqué ou CRC faux — `scene/unitypackage.rs:82` — exit 0 sur trois variantes.
5. P2 ZIP refusé laisse des fichiers partiels, code IO_ERROR au lieu d'ARCHIVE_UNREADABLE — `archive/zip_reader.rs:61`, `container.rs:38` — nettoyage seulement, rien n'est consommé.
6. P2 USDZ routé comme ZIP générique, première couche ignorée — `scene/usdz.rs:63`, `container.rs:68` — `.usdz` contenant un OBJ accepté ; deux couches → ambigu.
7. P2 plafond d'allocation dépassé à l'expansion RGBA — `image/crate_image.rs:18` — TGA 1×1 avec max_alloc=3 → 4 octets.
8. P2 APNG aplati sans signalement — `image/png.rs:61` — deux images → une seule, rouge.
9. P1 n-gones concaves remplis par l'éventail — `ma/mesh/part.rs:108`, `blend/build.rs:30`, `alembic/mesh/build.rs:36`, `usd/surface.rs:62` — U d'aire 7 → 11.
10. P1 MA écrase les nœuds homonymes — `ma/document/edit.rs:16`, `ma/document.rs:120` — `|A|M` perdu.
11. P1 MA jette les faces sans matériau si liaison partielle — `ma/mesh/part.rs:79` — 2 triangles au lieu de 4.
12. P1 MA exporte formes invisibles et intermédiaires — `ma/build.rs:153`, `ma/mesh.rs:33` — `.v no`, `.io yes` émis.
13. P1 MA ignore `.tx`/`.rx`/`.sx` par composante, `rotateAxis`, `inheritsTransform`, `offsetParentMatrix` — `ma/xform.rs:29` — `.tx 10` → x=0.
14. P1 Blend importe tous les OB, hors scène compris — `blend/convert.rs:38`, `blend/walker.rs:35` — code.
15. P1 Blend garde V sans inversion, images inchangées — `blend/build.rs:71`, `blend/images.rs:48` — contraste avec ma et alembic.
16. P1 Blend prend le premier Principled même déconnecté — `blend/material.rs:42` — code.
17. P1 Blend ne transporte pas la texture d'alpha séparée — `blend/material.rs:59` — code, pas de compteur.
18. P2 Blend multiplie l'émission texturée par la valeur remplacée (noir) — `blend/shading.rs:45` — code.
19. P2 MA perd les poids `.b`/`.e` dès qu'une texture est connectée — `ma/material.rs:80` — facteurs [1,1,1].
20. P2 MA prend un bump2d hauteur pour une normal map — `ma/material.rs:167` — `bumpInterp` jamais lu.
21. P2 MA ignore wrapV et les transformations place2dTexture — `ma/texture.rs:108` — code.
22. P2 arêtes lisses/dures perdues — `ma/mesh.rs:54`, `blend/mesh.rs:94`, `blend/normals.rs:22` — tout plat (ma) ou tout lisse (blend).
23. P2 MA panique en debug sur `i64::MIN` — `ma/mesh.rs:135` — exit 101 ; release non prouvé.
24. P2 Blend SDNA sans checked_mul, comptes non bornés, vues bornées au fichier pas au bloc — `blend/dna.rs:191,157,52`, `blend/view.rs:67` — exit 101 debug.
25. P2 plafond blend contourné par les fichiers non compressés — `blend/envelope.rs:40`, `blend/convert.rs:19` — code.
26. P2 Alembic accepte version inconnue et archive non frozen ; version lue 256 au lieu de 1 — `alembic/ogawa.rs:69`, `alembic/archive.rs:74` — exit 0.
27. P2 annulation seulement entre objets — ma/convert.rs:15, blend/build.rs:30, alembic/walk.rs:49 — code.
28. P1 Unity panique sur un indice de matériau `2^64−1` — `unity/patch.rs:74` — exit 101 debug.
29. P1 Unity perd les transformations du modèle importé — `unity/merge.rs:174`, `unity/render.rs:129` — enfant sans matrice.
30. P1 Unity mélange les retouches de deux objets, non déterministe — `unity/patch.rs:114`, `unity/prefab.rs:61` — x = 7,2,2,2,7 sur cinq runs.
31. P2 Unity arrondit les fileID 64 bits des `.meta` — `unity/meta.rs:100` — 2^53+1 → 2^53.
32. P1 Unity transparent + découpe → MASK — `unity/materials.rs:117` — contraire à AGENTS.md.
33. P2 Unity `_Mode=0` opaque devient BLEND par l'alpha couleur — `unity/materials.rs:127`.
34. P2 Unity HDRP `_SurfaceType` non lu — `unity/materials.rs:117`.
35. P1 USD cinq ordres Euler sur six associent les angles aux mauvais axes — `usd/xform.rs:90` — rotateZYX(90,0,0) autour de Z.
36. P1 USD unité implicite 1 au lieu de 0,01 — `usd/layer.rs:12`.
37. P1 USD defaultPrim supprime les autres racines — `usd/convert.rs:84` — 1 triangle au lieu de 2.
38. P1 USD `visibility=invisible` ignoré — `usd/visit.rs:18`.
39. P2 USD héritage des matériaux perdu — `usd/subset.rs:74` — `materials: []`.
40. P1 USD texture d'opacité chargée puis jetée — `usd/material.rs:81` — opaque au lieu de transparent.
41. P1 USD texture métal/rugosité annulée par facteurs 0/0,5 et canaux ignorés — `usd/material.rs:99`.
42. P2 USD textures d'une couche référencée résolues contre la racine — `usd/read.rs:104`, `usd/texture.rs:25` — `usd-texture-missing`.
43. P2 USD UsdUVTexture scale/bias/sourceColorSpace/wrapT ignorés — `usd/texture.rs:18`.
44. P2 USD diffuseColor absent = blanc au lieu de 0,18 ; specular/ior/clearcoat/occlusion non comptés — `usd/material.rs:38`.
45. P2 USD doubleSided perdu sans matériau lié — `usd/mesh.rs:27`.
46. P2 USD faces invalides retirées sans rapport, indices négatifs → 0 — `usd/surface.rs:67`, `usd/mesh.rs:59`, `usd/primvar.rs:72`.
47. P2 Unity retouches externes d'un prefab imbriqué perdues ; m_Removed*/m_Added* jamais lus — `unity/build.rs:83`, `unity/prefab.rs:18`.
48. P2 Unity override de matériau null ignoré — `unity/render.rs:59`, `unity/patch.rs:74`.
49. P2 Unity rebinding mute le mesh partagé, première instance changée — `unity/render.rs:146`.
50. P2 Unity LOD0 supprimé par un renderer partagé avec un LOD inférieur — `unity/build.rs:155`.
51. P2 Unity rapport du pilote modèle (unsupported/notes) perdu — `unity/models.rs:69`.
52. P2 Unity samplers ignorent wrap/filter des `.meta` — `unity/textures.rs:9`.
53. P2 EXR alpha prémultiplié livré comme droit — `image/exr.rs:160`, contrat `image.rs:50` — `demi.exr`.
54. P2 PSD canal alpha de sélection pris pour transparence ; compte de calques non lu — `psd/pixels.rs:90,28`, `psd.rs:160` — dorées figent l'hypothèse.
55. P2 EAC R11/RG11 réduits à 8 bits par `texture2ddecoder` (`val >> 3`) — `ktx2/format.rs:74`.
56. P2 DDS/KTX2 linéaire et sRGB confondus — `dds/codec.rs:105`, `ktx2/format.rs:46`, consommateur `texture_preview.rs:15`.
57. P2 KTX2 DFD et clés (prémultiplié, swizzle, orientation) ignorés sans refus — `ktx2/header.rs:76`, `ktx2/level.rs:29`.
58. P2 profils ICC abandonnés avant la sortie sRGB — `image/crate_image.rs:21`, `psd/pixels.rs:28` — `into_rgba8` présume sRGB.

Incertains, hors compte : reconstruction RGBE (borne basse ou centre), indices glTF sparse/morph dans unity/merge.rs, USD holeIndices.
