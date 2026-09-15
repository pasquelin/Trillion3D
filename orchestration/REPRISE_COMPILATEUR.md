# Reprise de la session « Compilateur » (compilateur natif, formats d'import)

Session titrée « Compilateur » : vérifier le titre par `get_session("self")` avant tout (les ids changent au
redémarrage ; relire `list_sessions` avant d'écrire à une autre session), puis lire ce fichier et `AGENTS.md`.

**Rôles.** Fable = chef, ne code pas, ne lit pas de code. Opus 5 = code, **un seul Opus et un seul lot à la fois**,
en worktree isolé, branche `compilateur/lot-<lettre>-<sujet>` depuis `develop`. Sonnet 5 = doc, revues, tests, mesures.
Réponses de 5 à 10 lignes. Enchaînement sans redemander : livraison → Validateur → lot suivant ; « go » seulement pour
un changement de plan ou une suppression irréversible.

**Méthode d'un lot** (`orchestration/AUDIT_PLUGINS.md`) : reproduction ciblée en test d'abord, correction générique
(jamais par scène ni par type d'objet), dorée corrigée si elle figeait un résultat faux, preuve visuelle si le rendu
change. Tout ce qui n'est pas converti est compté par code nommé dans `docs/COMPILER.md`, jamais silencieux. Ce qu'un
pilote produit entre dans sa `version()`. Fichiers ≤ 200 lignes, 0 clone, mots interdits nulle part.

**Livraison au Validateur** (session « Validateur », `send_message`) : SHA de tête, merge-base `develop`, preuves de
correction (tests de reproduction nommés), contrôles (`fmt --check`, `clippy -D warnings`, `cargo test --locked`,
`check:lines`, `check:duplicates`, `check:changed`, mots interdits), versions de pilotes modifiées, dorées touchées.
Le Validateur seul fusionne, lance `/simplify` et `validate`, pousse `origin/develop` ; cette session retire ensuite le
worktree et la branche du lot. Jamais `git push`, `git stash`, `npm run validate`. Cargo direct, sans mécanisme
d'attente partagé. `export DEVELOPER_DIR=/Library/Developer/CommandLineTools` devant cargo. `check:changed` en worktree :
lien `node_modules`, retiré ensuite. Corpus CC0 `test-assets/` hors git, lecture seule.

**État.** 11 pilotes de scène, 12 pilotes d'image (`packages/asset-compiler-rust/FORMATS.md`), tous fusionnés.
Audit du 15 sept. 2026 : 58 constats, dix lots A–J ordonnés dans `AUDIT_PLUGINS.md`.

| Lot | État |
| --- | --- |
| A cache OBJ, URI, MTL | en cours (Opus, branche `compilateur/lot-a-obj-mtl`) |
| B n-gones concaves | à lancer après A |
| C à J | à lancer dans l'ordre |

Sur go de l'utilisateur seulement : blocs gardés sur GPU (DDS, KTX2), Draco/meshopt en entrée, Industrial Map au
banc 15, licence des assets FAB avant toute démonstration publique.
