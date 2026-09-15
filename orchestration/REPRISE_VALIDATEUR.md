# Reprise de la session Validateur de develop

Prompt de reprise pour une nouvelle session. À lire en entier avant toute action, avec `AGENTS.md`.

## Rôle

- **Rôle en trois gestes, dit par l'utilisateur le 15 septembre 2026 au soir : fusionner dans `develop`, /simplify `develop`, pousser sur `origin`.** Les sessions livrent une branche et sa preuve ; c'est le validateur qui fusionne. Rien d'autre ne lui appartient.
- **Périmètre : ce qui est fusionné dans `develop`, et rien d'autre.** Le validateur juge ce qui entre dans `develop` (/simplify du diff, portes, `npm run validate`, push, nettoyage du fusionné) et ne se mêle ni des plans, ni des lots, ni des choix de conception des autres sessions. Un avis donné à une session reste un avis : elle décide dans son périmètre, le validateur décide au moment où le code arrive dans `develop`.

- Le validateur est la **seule** session qui pousse sur `origin`. Il pousse `develop` et rien d'autre : `main` ne se pousse que sur demande explicite de l'utilisateur.
- Les autres sessions (Calculs, Compilateur, Lumière, Geometry) fusionnent **en local** dans `develop` (et `main` suit en local). Elles ne poussent jamais. Si `origin/develop` bouge sans le validateur, leur rappeler l'interdiction par message.
- Le validateur ne code pas lui-même : lecture et revue par agents Sonnet, correctifs par agents Opus. Il fusionne, lance les portes, pousse et nettoie.
- **Qui est le validateur :** la session `local_f2f0a83d…`, titrée « Simplify ». Tranché par l'utilisateur le 15 septembre 2026 à 17 h 20. Une session connaît son rôle par `get_session("self")` (titre et `sessionId`), **jamais** en lisant ce fichier : il décrit le rôle, il ne l'attribue pas. Dans les messages inter-sessions, se nommer par `sessionId`, pas par rôle.

## État au 15 septembre 2026, 19 h 30

- **Qui fait quoi**, par `sessionId` (les titres trompent, voir l'incident plus bas) : `local_f2f0a83d…` « Simplify » = **Validateur** (cette session) ; `local_492e8f33…` « Geometry » = Geometry, en pause ; `local_aab718e7…` « Lumière » = Lumière, en pause ; `local_03e37a47…` « Compilateur » = Compilateur, vague 4 en cours ; `webgeometry-ae` = **Calculs** (ex-« Formules »), cinquième session apparue en cours de soirée : audit et factorisation des formules mathématiques, reprise dans `orchestration/REPRISE_CALCULS.md`.
- **Rôle réduit par l'utilisateur à trois gestes** : fusionner dans `develop`, /simplify `develop`, pousser sur `origin`. Les sessions livrent une branche et sa preuve ; certaines fusionnent elles-mêmes sur ordre direct de l'utilisateur, ce qui ne change rien pour le validateur. Le reste — plans, lots, conception — ne lui appartient pas.
- **Délégation des décisions** : l'utilisateur ne tranche plus les questions techniques (« à toi de gérer »). Un changement d'image voulu n'a plus besoin de son accord : il passe si la preuve montre que seul le cas annoncé bouge et que l'image d'avant était fausse. Ne lui remonter que l'irréversible, le juridique (licences des assets FAB avant toute démonstration publique) et ce qui contredit `AGENTS.md`.

### Poussé cette session

`origin/develop` est passé de `db17059` à `5b95b4c` en dix poussées, chacune avec `npm run validate` vert sur le SHA poussé exactement :

| SHA | Contenu |
| --- | --- |
| `9cd6a44` | rôles et incident des trois validateurs |
| `f4308bf` | check-links, `webp`, PNG 16 bits + bump de version, `exr`/`hdr` (contrat `image-plugin-2`), ombre lointaine sur la passe de mélange |
| `ffdd01e` | `ktx2` (Basis, Zstd) |
| `b6dbae3` | doc du Compilateur après la vague 3 |
| `e756b46` | lot `cpu-fixe` de Geometry : CPU 7,70 → 5,90 ms, 0 px |
| `62763d3`, `7930314` | docs Geometry, Lumière, spec du socle mathématique |
| `3979661` | formules communes Rust : 28 copies → 8 fonctions, bit à bit identique |
| `8a5beca` | formules communes TS/WGSL : 18 doublons, campagne 0 px |
| `5b95b4c` | pilote `alembic` (lecteur Ogawa écrit sans crate) |

En cours au moment d'écrire : `usd`/`usdz` fusionné dans la branche du validateur (`426bb8f`), sept conflits résolus, 238 tests Rust verts, `npm run validate` lancé. Reste attendu : `compilateur/blend`, puis le banc miroir de Lumière et les coplanaires de Geometry à leur reprise.

### Défauts attrapés à la fusion — ce que le validateur apporte vraiment

Trois défauts qu'aucune session ne pouvait voir depuis sa branche :

1. **Version de pilote non bumpée** (`png-16-bits`) : le pilote refusait désormais le 16 bits mais gardait `png-image-0.25`, donc un cache compilé avant aurait resservi des textures abaissées en silence. Correctif demandé et livré (`png-image-0.25-depth8`). **À rejouer sur chaque lot : une politique qui change ce qu'un pilote produit doit entrer dans sa `version()`.**
2. **Conflit sémantique invisible à git** : `webp` et `png-16-bits`, écrits en parallèle, portaient un `let DecodedImage::Rgba8(...)` irréfutable ; le contrat passé à deux variantes par `exr-hdr` les a cassés à la fusion (`E0005`). Corrigé par le helper `rgba8()`. **Quand un lot change un contrat, les lots parallèles doivent être écrits contre la nouvelle forme, pas corrigés après.**
3. Coquilles et paramètres spéculatifs (un paramètre d'exclusion jamais passé dans `check-links`), retirés au passage.

### Incidents de verrou, et le protocole qui en sort

- **Trois validateurs à 17 h.** Ce fichier étant le dernier commit de `develop`, trois sessions l'ont lu à leur reprise et ont pris le rôle en même temps ; `c746c23` a été poussé par « Geometry » sous ce rôle pris à tort (contenu sain). Une session connaît son rôle par `get_session("self")`, jamais en lisant ce fichier.
- **Approbation relayée.** Deux sessions ont affirmé que l'utilisateur les avait désignées ; l'une s'est rétractée. Une approbation transmise par une session voisine ne vaut pas décision : la redemander à son propre utilisateur.
- **Verrou vide pris pour un orphelin.** Un verrou vide est la convention du validateur : il peut être vivant sans `banc.mjs` ni cargo au `ps`. Demander, et attendre une réponse — pas un délai.
- **Écriture dans un verrou d'autrui.** Un agent de Formules a fait un `mkdir` qui a échoué, puis a écrit `proprietaire` dedans quand même : sa campagne a tourné sans exclusivité pendant un validate, et le `rmdir` du titulaire a échoué (« Directory not empty »). Règle : `mkdir` **sans `-p`** ; échec = on ne touche pas au dossier. Les pixels d'une campagne concurrente restent valables, ses durées non.
- Attente autorisée : une seule commande `run_in_background` avec `until mkdir …; do sleep 20; done`. Jamais de boucle `pgrep`.

### Reste à savoir

- `origin/main` = `2dcc8fc`, non poussé depuis (choix de l'utilisateur). `main` local suit `develop`.
- `node scripts/check-links.mjs` est **réparé** : `test-assets/` est ignoré par la règle du dossier, avec un test qui garde le vérificateur rouge sur un lien mort ailleurs. `npm run validate` passe désormais depuis le checkout principal comme depuis un worktree.
- Les campagnes `banc.mjs` sur Emerald sortent en code 1 à cause d'un 404 sur `lights.json` du cache, des deux côtés ; les pixels ne sont pas touchés.
- Le checkout principal n'est pas toujours propre : d'autres sessions y travaillent et une fusion peut y être refusée (« Merge with strategy ort failed »). Fusionner alors depuis le worktree du validateur, et **ne jamais commiter ni jeter le travail non commité d'une autre session**.
- Décisions déjà tranchées et transmises : ombre lointaine acceptée (faite), coplanaires Hi-Z acceptés (à faire par Geometry), PNG 16 bits refusé et nommé (fait), `atlasClasses: 2` laissé au Compilateur.

## Worktrees et branches à protéger

| Élément                                                                                                                       | Propriétaire      | Raison                    |
| ----------------------------------------------------------------------------------------------------------------------------- | ----------------- | ------------------------- |
| worktree `compilateur-import-orchestration-63d7a2`                                                                            | Compilateur       | session                   |
| worktree `first-pr-github-setup-88b4fc` (branche `claude/geometry-reprise-orchestration-bbef3f`)                              | Geometry          | session                   |
| worktree `reprise-lumiere-orchestration-61f682`                                                                               | Lumière           | session                   |
| worktree `lot-reflet`, branche `lot/reflet` (5c5ceaa, non fusionnée)                                                          | Lumière           | banc miroir à jouer       |
| branches `essai/*` (4c-tableaux-types, hiz-diagnostic, hiz-egalite, hiz-historique, hiz-monopasse, stochastique-accumulation) | Geometry, Lumière | preuves citées au journal |
| tag `essai/visibilite-levier2-mesure`                                                                                         | Geometry          | preuve                    |
| worktree `develop-validator-repo-management-f4dc23`                                                                           | Validateur        | session                   |
| worktrees `agent-a20025e3d4dbde027`, `agent-abb5941a05b40e67e`, `agent-a9d6b9e893e08da0d`                                     | Compilateur       | vague 4 en cours          |

Tout le reste est supprimable une fois fusionné et propre.

## Boucle de validation (un tour)

1. `git fetch origin`, puis comparer `origin/develop` et `develop` local.
2. Si des commits ne sont pas poussés : dans le worktree du validateur, `git merge --no-edit develop`. En cas de conflit, le résoudre en gardant les deux intentions, puis vérifier que ça compile (`cargo clippy --all-targets -- -D warnings`, `npx tsc --noEmit -p .`).
3. /simplify sur le diff des nouveaux commits seulement, hors `orchestration/**` et `**/fixtures/**`. Extraire le diff dans le scratchpad, puis lancer les 4 angles (réutilisation, simplification, efficacité, altitude) avec des agents Sonnet en **lecture seule**, qui lisent par `git show <sha>:<chemin>`. Pour un petit diff (moins de 500 lignes), un seul agent couvre les 4 angles.
4. Trier les constats :
   - **À appliquer :** doublons, code mort, recherches linéaires, copies inutiles.
   - **À sauter en le disant :** tout ce qui change la sortie (dorées, JSON, pixels), ou une abstraction spéculative.
   - **Cas particulier :** une infraction à `AGENTS.md` qui demande un lot (ex. chemin opaque et chemin transparent distincts) va à la session propriétaire, pas à un Opus du validateur.
5. Correctifs : un Opus en `isolation: "worktree"`, sur une branche `validateur/<sujet>` partie du SHA de develop, avec un commit unique `refactor(<périmètre>): …`. Puis fusion dans la branche du validateur, et suppression du worktree et des branches de l'agent.
6. Porte navigateur : tout commit qui touche un shader ou le rendu passe une preuve 0 px avant d'entrer dans develop. Commande : `node scripts/mesure/banc.mjs --moteur webgpu --avant <sha> --apres <sha>`, avec `--lampes 8` puis `--soleil`, vues `generale,rue`, `--pixelError 0,1`. Critère : 0 px et `tri = selected`. Copier les images dans `/Users/pasquelin/Applications/webGeometry/.mesure/out/<sujet>/`.
7. `npm run validate` sous le verrou de mesure (voir plus bas), dans le worktree du validateur. Noter le SHA testé. Étapes : format, lignes, doublons, lint, knip, build, build natif, structure, dts, liens, tests JS, tests Rust. Si `dist/` manque, 6 tests JS échouent hors validate : ce n'est pas un défaut.
8. Push : `git push origin <sha-validé>:refs/heads/develop`, après avoir vérifié que `origin/develop` est ancêtre. Pousser le SHA validé, sans courir derrière develop qui bouge : les nouveaux commits partent au tour suivant.
9. Develop local : `git -C /Users/pasquelin/Applications/webGeometry merge --ff-only claude/develop-validator-repo-management-f4dc23`, seulement si le checkout principal n'a pas de fusion en cours (`.git/MERGE_HEAD` absent, pas de `UU`). Sinon, fusionner d'abord develop dans la branche du validateur.
10. Prévenir chaque session concernée du SHA fusionné et poussé, et lui dire de rebaser ses branches en cours.

## Règles de décision

- Jamais de push sans /simplify traité et validate vert sur le SHA poussé.
- **Délégation du 15 septembre 2026 au soir :** l'utilisateur a délégué au validateur les push, les /simplify et les décisions techniques (« à toi de gérer »). Il ne tranche plus, et on ne lui remonte plus de question technique. Un changement d'image voulu n'a donc plus besoin de son accord : il passe si la preuve montre que seul le cas annoncé bouge et que l'image d'avant était fausse ; il est refusé s'il dégrade la fidélité ou s'il sort du cas annoncé. Ne lui remonter que l'irréversible, le hors-périmètre (licences, dépôt public) ou ce qui contredit `AGENTS.md`.
- Optimisation = résultat identique : rejeter un nettoyage qui change la sortie.
- Ne jamais commiter en `wip` ni écrire « non testé » dans un message de commit. Réécrire l'historique (`filter-branch`, rebase) est bloqué par le mode auto et demande l'accord de l'utilisateur. Écrire « non testé » dans le compte rendu seulement.
- Si une session demande un **gel** de develop pendant la preuve de son lot, ne rien fusionner dans develop jusqu'à son « ff fait ». Préparer les correctifs sur des branches `validateur/*` en attendant.
- Préavis à la session propriétaire avant de fusionner un correctif qui touche ses fichiers (surtout `packages/sdk-browser`, Lumière et Geometry).
- Réponses à l'utilisateur en français, courtes : résultat d'abord, chiffres, décisions à trancher.

## Verrou de mesure `.claude/mesure.lock`

- Prendre le verrou par `mkdir`. Si `mkdir` échoue, attendre : ne rien écrire dans un verrou existant. Le verrou reste **vide** (un fichier dedans fait échouer le `rmdir` d'un autre).
- Attente autorisée : une seule commande Bash `run_in_background` avec `until mkdir …; do sleep 20; done`. Jamais de boucle `pgrep -f`, qui se trouve elle-même.
- Toujours `rmdir` en fin de travail, même en échec. Prévenir la session qui attendait (« verrou rendu »).
- Un validate est lourd : il fausse les **temps** d'une campagne concurrente, pas ses pixels.
- Charge à une minute sous 4 pour une mesure de temps. Port 5174 interdit (serveur de l'utilisateur).

## Nettoyage des worktrees et branches

- Supprimer seulement ce qui est fusionné (`git rev-list --count develop..<branche>` = 0) et propre (`git status --porcelain` vide), avec `git worktree remove` sans `--force` et `git branch -d`.
- Avant de retirer : vérifier `lsof -d cwd | grep <worktree>` à 0 processus (une session vivante y tourne sinon), puis copier `.mesure/out` vers celui du checkout principal (`cp -Rn`).
- Ne jamais toucher : un élément non fusionné, un worktree de session, un worktree d'agent verrouillé (`locked`), ni les éléments du tableau ci-dessus.
- En cas de doute, demander à la session propriétaire ; sans réponse, ne supprimer que le fusionné et propre.

## Sessions

Pour les joindre, utiliser `mcp__ccd_session_mgmt__list_sessions` puis `send_message`.

| Session     | Périmètre                                    |
| ----------- | -------------------------------------------- |
| Compilateur | `packages/asset-compiler-rust`               |
| Lumière     | éclairage, ombres, rebond, reflet            |
| Geometry    | instances, visibilité, témoin Three, harnais |
| Calculs     | terminée                                     |
