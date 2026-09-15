# Reprise de la session « Compilateur » (formats d'import du compilateur natif)

Session titrée « Compilateur », contrôlée par `get_session("self")`, id `local_ebd236da…` (change au
redémarrage : relire `list_sessions` avant d'écrire à une autre session). Vérifier ce titre avant
tout, puis lire ce fichier et `AGENTS.md`.

**Rôles et flux.** Fable = chef, ne code pas. Opus 5 = code, un pilote par worktree, un seul à la
fois sauf périmètres disjoints. Sonnet 5 = doc, revues, mesures. Chaque branche `compilateur/<format>`
est livrée au Validateur avec : SHA de tête, merge-base `develop`, `fmt --check`, `clippy -D warnings`,
`cargo test --locked`, `check:lines`, `check:duplicates`, `check:changed`, mots interdits. Le
Validateur seul fusionne, lance `/simplify` et `validate`, et pousse `origin/develop`.

**Règles d'agent.** Vérifier `git merge-base develop HEAD` au lancement, rebaser tant que rien n'est
commité. Une seule commande `cargo` à la fois, sous
`DEVELOPER_DIR=/Library/Developer/CommandLineTools`. Tests d'image avec `rgba8()`/`rgba_f32()`,
jamais de `let` irréfutable sur `DecodedImage`. Version d'un pilote = identité de son cache. Licence
permissive citée dans `Cargo.toml`. `check:changed` en worktree : lien `node_modules`, retiré ensuite.

**État courant.** Onze pilotes de scène, douze pilotes d'image, tous listés dans
`packages/asset-compiler-rust/FORMATS.md`. `psd` fusionné, `bmp-gif` livré (6cebbd8).
`ma` **non livré** : agent arrêté par l'utilisateur le 15 sept. 2026 à 21 h 30 ; worktree
`agent-a2c029f4d59f598cd`, branche `compilateur/ma` (0606e32 sur 0fd6834), `fixtures/ma/expected.json`
régénéré non commis ; reste à commettre, rejouer `cargo test --locked`, livrer. Worktrees psd et
bmp-gif : retirés par le Validateur après push.

**À faire ensuite.** Un seul Opus à la fois, sur reprise explicite : `compilateur/mtl` d'abord (dorée
`obj`, MTL absent/tronqué en rapport nommé, `Ks`/`Ni`/`Ka` comptés, garde bump/normal, options de map
comptées) ; puis BC6H, UASTC HDR, KTX 1.0, ASTC hors 4×4, TIFF palette, lampes Unity, instances
imbriquées, métal-lissage, subdivision USD, `TEXCOORD_1`, animation Alembic, restes `blend`. Sur go
utilisateur seulement : blocs gardés sur GPU, Draco/meshopt, Industrial Map au banc 15, licence FAB.

Vérifier `develop` au moment de la reprise.
