# Reprise « Compilateur » (compilateur natif, formats d'import)

Vérifier le titre de session par `get_session("self")` avant tout ; relire `list_sessions` avant d'écrire à une
autre session (les ids changent). Lire ensuite `AGENTS.md` et `orchestration/AUDIT_PLUGINS.md`.

**Rôles.** Fable = chef, ne code pas, ne lit pas de code. Opus 5 = code, **un seul Opus, un seul lot à la fois**,
worktree isolé, branche `compilateur/lot-<lettre>-<sujet>` depuis `develop`. Sonnet 5 = doc, revues, tests.
Réponses de 5 à 10 lignes. Enchaînement sans redemander : livraison → Validateur → lot suivant ; « go » seulement
pour un changement de plan ou une suppression irréversible.

**Un lot.** Reproduction en test d'abord, correction générique (par propriété, jamais par scène ni type d'objet),
dorée corrigée si elle figeait un résultat faux, preuve visuelle si le rendu change. Le non converti est compté par
code nommé dans `docs/COMPILER.md`. La sortie d'un pilote entre dans sa `version()`. Fichiers ≤ 200 lignes, 0 clone,
mots interdits nulle part. Portes : `fmt --check`, `clippy -D warnings`, `cargo test --locked`, `check:lines`,
`check:duplicates`, `check:changed` (lien `node_modules` en worktree, retiré ensuite), grep des mots interdits.
`DEVELOPER_DIR=/Library/Developer/CommandLineTools` devant cargo, lancé directement. Corpus CC0 `test-assets/` en
lecture seule. Jamais `git push`, `git stash`, `npm run validate`, ni fusion dans `develop`.

**Livraison** (message à la session « Validateur ») : SHA de tête, merge-base, tests de reproduction nommés, résultat
des portes, codes de rapport ajoutés, versions de pilotes modifiées, dorées touchées, restes. Le Validateur fusionne,
`/simplify`, `validate`, pousse ; cette session retire ensuite le worktree et la branche du lot.

**État.** 11 pilotes de scène, 12 d'image (`packages/asset-compiler-rust/FORMATS.md`). Audit du 15 sept. 2026 :
58 constats, dix lots A–J (`AUDIT_PLUGINS.md`).

| Lot | État |
| --- | --- |
| A cache OBJ, URI, MTL | livré 46d0d61 : obj et fbx `-gltf-5`, 9 codes, dorée `fixtures/obj/` ; restes : `-o`/`-s` comptés (pas de KHR_texture_transform), `-clamp` sans preuve navigateur |
| B n-gones concaves | prochain, à la reprise |
| C à J | dans l'ordre |

Sur go seulement : blocs gardés sur GPU (DDS, KTX2), Draco/meshopt en entrée, Industrial Map au banc 15, licence FAB.
