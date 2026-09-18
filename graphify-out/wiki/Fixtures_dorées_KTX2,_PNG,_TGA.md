# Fixtures dorées KTX2, PNG, TGA

> 28 nodes · cohesion 0.08

## Key Concepts

- **test/assets — corpus de formats sources, livré hors dépôt et ignoré par git** (13 connections) — `test/README.md`
- **Fixture dorée — pilote KTX 2.0** (7 connections) — `packages/asset-compiler-rust/fixtures/ktx2/README.md`
- **Fixture Unity cc0-import-project** (6 connections) — `packages/asset-compiler-rust/fixtures/unity/README.md`
- **Fixture de correction — pilote unitypackage (conteneur)** (6 connections) — `packages/asset-compiler-rust/fixtures/unitypackage/README.md`
- **Fixtures de correction — pilote usd (minuscule et corpus usda/usdc)** (6 connections) — `packages/asset-compiler-rust/fixtures/usd/README.md`
- **Fixture dorée — pilote PNG** (5 connections) — `packages/asset-compiler-rust/fixtures/png/README.md`
- **Fixture de correction — pilote usdz (conteneur)** (5 connections) — `packages/asset-compiler-rust/fixtures/usdz/README.md`
- **Fixture de correction — pilote zip (conteneur)** (4 connections) — `packages/asset-compiler-rust/fixtures/zip/README.md`
- **Ce qu'un conteneur KTX2 déclare : transfert, alpha prémultiplié, KTXorientation, KTXswizzle** (2 connections) — `packages/asset-compiler-rust/fixtures/ktx2/README.md`
- **Priorité de la courbe de transfert : iCCP, puis sRGB, puis gAMA** (2 connections) — `packages/asset-compiler-rust/fixtures/png/README.md`
- **La profondeur est une façon d'écrire l'image, jamais de la changer** (2 connections) — `packages/asset-compiler-rust/fixtures/png/README.md`
- **Fixture dorée — pilote TGA** (2 connections) — `packages/asset-compiler-rust/fixtures/tga/README.md`
- **Origine, compression et profondeur ne changent pas un octet du résultat** (2 connections) — `packages/asset-compiler-rust/fixtures/tga/README.md`
- **Routage qui traverse : chaîne unitypackage → unity via la racine Assets/** (2 connections) — `packages/asset-compiler-rust/fixtures/unitypackage/README.md`
- **Un paquet piégé doit venir d'ailleurs que du lecteur qu'il met à l'épreuve** (2 connections) — `packages/asset-compiler-rust/fixtures/usdz/README.md`
- **Une archive piégée doit venir d'ailleurs que du lecteur qu'elle met à l'épreuve** (2 connections) — `packages/asset-compiler-rust/fixtures/zip/README.md`
- **Chemin Basis Universal (UASTC / ETC1S + BASIS_LZ)** (1 connections) — `packages/asset-compiler-rust/fixtures/ktx2/README.md`
- **Socle image::blocks partagé avec le pilote dds (texture2ddecoder)** (1 connections) — `packages/asset-compiler-rust/fixtures/ktx2/README.md`
- **Supercompression = emballage sans effet sur les texels** (1 connections) — `packages/asset-compiler-rust/fixtures/ktx2/README.md`
- **Licence CC0-1.0 — fixture ma (scene.ma, checker.png)** (1 connections) — `packages/asset-compiler-rust/fixtures/ma/LICENSE.txt`
- **globalScale / useFileScale du .meta : l'échelle d'import s'applique aux nœuds, jamais à la géométrie** (1 connections) — `packages/asset-compiler-rust/fixtures/unity/README.md`
- **fileID de vrai projet au-delà de 2^53 : lus au travers d'un flottant, l'objet disparaîtrait** (1 connections) — `packages/asset-compiler-rust/fixtures/unity/README.md`
- **limites/truncated.unity : 31 octets, refus propre sans panique ni allocation non bornée** (1 connections) — `packages/asset-compiler-rust/fixtures/unity/README.md`
- **Licence CC0-1.0 — fixture unitypackage** (1 connections) — `packages/asset-compiler-rust/fixtures/unitypackage/LICENSE.txt`
- **Arbre reconstruit par GUID : pathname → chemin, asset et asset.meta recopiés (metaFiles: 11)** (1 connections) — `packages/asset-compiler-rust/fixtures/unitypackage/README.md`
- *... and 3 more nodes in this community*

## Relationships

- [Exécution des tests dorés](Exécution_des_tests_dorés.md) (5 shared connections)
- [Politiques APNG, PSD et WebP](Politiques_APNG,_PSD_et_WebP.md) (3 shared connections)
- [Fixtures de pilotes et plafond d'allocation](Fixtures_de_pilotes_et_plafond_d'allocation.md) (2 shared connections)
- [Banc de mesure : options et compteurs](Banc_de_mesure_-_options_et_compteurs.md) (2 shared connections)
- [tests · ASTC_4X4](tests_·_ASTC_4X4.md) (1 shared connections)
- [tests · gamma](tests_·_gamma.md) (1 shared connections)
- [Page de revue des découpes](Page_de_revue_des_découpes.md) (1 shared connections)
- [Fixtures TIFF et PSD, refus nommés](Fixtures_TIFF_et_PSD,_refus_nommés.md) (1 shared connections)

## Source Files

- `packages/asset-compiler-rust/fixtures/ktx2/README.md`
- `packages/asset-compiler-rust/fixtures/ma/LICENSE.txt`
- `packages/asset-compiler-rust/fixtures/png/README.md`
- `packages/asset-compiler-rust/fixtures/tga/README.md`
- `packages/asset-compiler-rust/fixtures/unity/README.md`
- `packages/asset-compiler-rust/fixtures/unitypackage/LICENSE.txt`
- `packages/asset-compiler-rust/fixtures/unitypackage/README.md`
- `packages/asset-compiler-rust/fixtures/usd/LICENSE.txt`
- `packages/asset-compiler-rust/fixtures/usd/README.md`
- `packages/asset-compiler-rust/fixtures/usdz/LICENSE.txt`
- `packages/asset-compiler-rust/fixtures/usdz/README.md`
- `packages/asset-compiler-rust/fixtures/zip/README.md`
- `test/README.md`

## Audit Trail

- EXTRACTED: 42 (88%)
- INFERRED: 5 (10%)
- AMBIGUOUS: 1 (2%)

---

*Part of the graphify knowledge wiki. See [index](index.md) to navigate.*