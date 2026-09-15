# Reprise de la session « Compilateur » (formats d'import du compilateur natif) — 15 sept. 2026

Cette session s'appelle « Compilateur » : son titre, lu par `mcp__ccd_session_mgmt__get_session("self")`, id `local_03e37a47…`. Au « reprends », vérifier ce titre **avant** de lire quoi que ce soit d'autre, puis lire ce fichier et `AGENTS.md`. Ne jamais prendre un autre rôle (Validateur, Lumière, Geometry) parce que son fichier de reprise est plus récent : le titre de la session prime toujours sur l'ancienneté d'un fichier.

## Rôles

Fable = chef : ne code pas, ne lit pas de code, brief et décide. Opus 5 = code, un par pilote, en `isolation: worktree`, trois au plus en parallèle, périmètres disjoints. Sonnet 5 = doc, revues, mesures. Réponses de 5 à 10 lignes ; le détail vit dans les fichiers.

## Flux de livraison (unique)

Chaque branche `compilateur/<format>` est livrée au Validateur — session titrée « Simplify », id `local_f2f0a83d…`, joignable par `mcp__ccd_session_mgmt__send_message` — avec sa preuve : SHA de tête, merge-base avec `develop`, `cargo fmt --check`, `clippy --all-targets -D warnings`, `cargo test --locked`, `npm run check:lines`, `npm run check:duplicates`, `npm run check:changed`, grep des mots interdits, chiffres du corpus. Le Validateur fusionne, lance `/simplify`, valide, pousse `origin/develop` et confirme ; la session supprime alors le worktree et la branche du pilote livré.

Cela remplace toute mention antérieure de fusion locale, de `branch -f main develop` ou d'un Sonnet de fusion : périmé. Jamais de `git push`, jamais de fusion par cette session sauf ordre explicite de l'utilisateur.

## Règles d'agent

- Vérifier la base d'un worktree d'agent dès son lancement (`git merge-base develop HEAD`) ; rebaser immédiatement si retard, tant que rien n'est commité.
- Verrou `.claude/mesure.lock` posé par `mkdir` sans `-p`, vide, rendu par `rmdir` ; jamais retiré sans réponse de son propriétaire. Tout `cargo` sous le verrou.
- `export DEVELOPER_DIR=/Library/Developer/CommandLineTools` devant tout `cargo` (licence Xcode).
- Tests d'un pilote d'image écrits avec les helpers `rgba8()`/`rgba_f32()` de `src/plugins/tests.rs` ; jamais de `let` irréfutable sur une variante d'un enum à plusieurs variantes (`DecodedImage` notamment).
- Ce qu'un pilote produit entre dans sa `version()` : c'est l'identité du cache.
- Prévenir le Validateur avant tout changement de contrat (`scene-plugin-2`, `image-plugin-2`).
- Juridique : crates permissives en lecture seule, licence citée en commentaire dans `Cargo.toml`, jamais de code ou SDK d'éditeur, jamais de sources GPL.
- `check:changed` dans un worktree : `ln -s <racine>/node_modules node_modules`, lien retiré ensuite.

## État (vérifié dans le code, base 426bb8f)

Pilotes de scène enregistrés dans `src/plugins/scene.rs` (`PLUGINS`), neuf : `gltf`, `fbx`, `obj`, `unity`, `zip`, `unitypackage`, `alembic`, `usd`, `usdz`. Pilotes d'image dans `src/plugins/image.rs` (`DECODERS`, `VERSION = "image-plugin-2"`), neuf : `png`, `jpeg`, `tga`, `tiff`, `dds`, `webp`, `exr`, `hdr`, `ktx2`.

Vague 4 : `alembic` fusionné (lecteur Ogawa écrit depuis la spécification, aucune crate ajoutée) et `usd`/`usdz` fusionnés (crate `openusd` 0.7.0, MIT, Rust pur, lecture seule — licence en commentaire dans `Cargo.toml`) ; les deux dans `develop` via `claude/develop-validator-repo-management-f4dc23` (426bb8f). `blend` en cours : Opus, branche `compilateur/blend` (b6dbae3, sur disque, non fusionnée — pas d'entrée dans `PLUGINS`), livraison attendue. Vérifier l'état réel d'une branche `compilateur/*` par `git branch --list 'compilateur/*'` et `git worktree list` plutôt que de faire confiance à ce fichier.

Corpus CC0 `test-assets/` hors git.

## À faire ensuite, dans l'ordre

1. **Vague 4, trois Opus** : `usd`/`usdz` — **fait** : branche `compilateur/usd`, caisse `openusd` 0.7.0 (MIT, Rust pur, sans C++ ; `usd`/`rust-usd` et `openusd-rs` écartées), Xform/Scope, Mesh triangulés, GeomSubset → matériaux, instances par prototype, UsdPreviewSurface et UsdUVTexture, `metersPerUnit`/`upAxis`, premier échantillon, `usdz` = conteneur ZIP stocké et aligné, refus `usd-*` et `USDZ_LAYOUT_INVALID`, dorées `fixtures/usd` et `fixtures/usdz` —, `alembic` — **fait** : branche `compilateur/alembic`, lecteur Ogawa écrit depuis la spécification (aucune crate ajoutée ; `ogawa-rs` évaluée et écartée : `todo!()` sur les booléens, indexation non bornée, aucun plafond), `Xform`/`PolyMesh`/`SubD`/`FaceSet`, premier échantillon, refus `alembic-*`, dorée CC0 `fixtures/alembic/` —, `.blend` — **fait** : branche `compilateur/blend`, lecteur SDNA écrit depuis la description publique du format (aucune dépendance ajoutée ; `flate2` et `ruzstd`, déjà présentes, pour l'enveloppe), maillages par attributs nommés, UV, instances, Principled BSDF, images empaquetées conservées à l'octet, refus `blend-*`, dorée CC0 `fixtures/blend/` ; les fichiers antérieurs à la disposition par attributs sont refusés par leur nom, faute d'exemplaire. Corpus : `usd/`, `alembic/`, `blend/`.
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

`develop` = d2335f2. `origin/develop` = 5b95b4c (poussé par le Validateur seulement, peut être en retard sur `develop` local). Vérifier au moment de la reprise, ne pas recopier ces SHA sans contrôle.
