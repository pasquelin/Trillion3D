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

1. Finir et livrer `blend` (SDNA, maillages/UV/instances/Principled BSDF de base).
2. Vague 5 : `psd` (aplati vers RGBA8), `bmp`, `gif` (features `image`), `ma` (Maya ASCII, données seules) ; vérifier MTL (OBJ).
3. Compléments : BC6H et UASTC HDR sur `RgbaF32`, KTX 1.0, ASTC hors 4×4, TIFF palette, lampes Unity non converties, retouches d'instances imbriquées non composées, cartes métal-lissage empaquetées, subdivision USD, `TEXCOORD_1`, animation Alembic.
4. Lecture en entrée des glTF Draco / meshopt (sans perte ajoutée, perte de la source dite au rapport) : à proposer à l'utilisateur avant de coder.
5. Chantier « blocs gardés sur GPU » (`DecodedImage::Blocks`, DDS puis KTX2) : sur go de l'utilisateur seulement.
6. Industrial Map au banc 15 : dossier à copier par l'utilisateur dans `public/benchmark-assets` du Lab, puis agent Lab séparé.

Décisions ouvertes, à trancher par cette session ou par l'utilisateur : `atlasClasses: 2` et départ au sol du banc 15 (cette session) ; licence des assets FAB — réservée à l'utilisateur, avant toute démonstration publique seulement.

## Dernier état connu

`develop` = d2335f2. `origin/develop` = 5b95b4c (poussé par le Validateur seulement, peut être en retard sur `develop` local). Vérifier au moment de la reprise, ne pas recopier ces SHA sans contrôle.
