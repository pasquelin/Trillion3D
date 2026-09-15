# Reprise de la session Validateur de develop

Prompt de reprise pour une nouvelle session. À lire en entier avant toute action, avec `AGENTS.md`.

## Rôle

- Le validateur est la **seule** session qui pousse sur `origin`. Il pousse `develop` et rien d'autre : `main` ne se pousse que sur demande explicite de l'utilisateur.
- Les autres sessions (Calculs, Compilateur, Lumière, Geometry) fusionnent **en local** dans `develop` (et `main` suit en local). Elles ne poussent jamais. Si `origin/develop` bouge sans le validateur, leur rappeler l'interdiction par message.
- Le validateur ne code pas lui-même : lecture et revue par agents Sonnet, correctifs par agents Opus. Il fusionne, lance les portes, pousse et nettoie.
- **Qui est le validateur :** la session `local_f2f0a83d…`, titrée « Simplify ». Tranché par l'utilisateur le 15 septembre 2026 à 17 h 20. Une session connaît son rôle par `get_session("self")` (titre et `sessionId`), **jamais** en lisant ce fichier : il décrit le rôle, il ne l'attribue pas. Dans les messages inter-sessions, se nommer par `sessionId`, pas par rôle.

## État au 15 septembre 2026, 17 h 30

- Répartition tranchée par l'utilisateur : `local_f2f0a83d…` « Simplify » = **Validateur** ; `local_492e8f33…` « Geometry » = Geometry (bissection GPU, CPU 7,7 → 4 ms, coplanaires) ; `local_aab718e7…` « Lumière » = Lumière (dette `SUN_FAR_STUB`, banc miroir) ; Compilateur inchangé ; Calculs terminée.
- **Incident des trois validateurs (17 h).** Ce fichier étant le dernier commit de `develop`, trois sessions l'ont lu à leur reprise et ont pris le rôle en même temps. Conséquences, toutes refermées : `c746c23` poussé à 17 h 00 37 par « Geometry » sous le rôle pris à tort (contenu sain, rien à défaire) ; `.claude/mesure.lock` retiré comme orphelin par le Validateur alors qu'il ne l'était peut-être pas (un verrou vide est la convention du validateur : il peut être vivant sans processus visible) ; un `npm run validate` lancé dans le worktree du validateur pendant qu'une autre session l'avançait de `c746c23` à `4aea47b`, verdict donc non opposable à `4aea47b`. Aucune session ne pousse plus sans le mot de son propre utilisateur ; une approbation relayée par une session voisine ne vaut pas décision.
- `origin/develop` = `c746c23`. `develop` local = `4aea47b`. `npm run validate` vert sur `c746c23` (182 tests Rust, 4 tests CLI, code 0) et sur `db17059` (774 tests JS, 182 Rust) ; le SHA poussé au tour courant est revalidé avant push.
- Sessions vivantes : Lumière, Geometry, Compilateur, Validateur. Un Opus du Compilateur travaille dans le worktree verrouillé `agent-a8a42ce9a0f3ee372` (branche `compilateur/exr-hdr`, vague 3 des pilotes d'image).
- `node scripts/check-links.mjs` échoue au checkout principal seulement : six `upstream-LICENSE.md` sous `test-assets/gltf/*` (dossier ignoré par git) ; vert dans un worktree sans `test-assets`. Signalé au Compilateur ; jusqu'au correctif, lancer validate dans le worktree du validateur.
- `origin/main` = `2dcc8fc`, non poussé depuis (choix de l'utilisateur).
- Changement d'image accepté par l'utilisateur : lot `unlit-identite` (vue sans lampe composée par l'identité, ACES réservé à la vue éclairée).
- Dette ouverte, prise par Lumière en premier lot à sa reprise : l'ombre lointaine du soleil manque sur la passe de mélange (`SUN_FAR_STUB_WGSL` renvoie 1.0 pour les transparents), contraire à « une seule façon d'éclairer toute surface ».
- Les campagnes `banc.mjs` sur Emerald sortent en code 1 à cause d'un 404 sur `lights.json` du cache, des deux côtés ; les pixels ne sont pas touchés.
- Trois décisions attendent l'utilisateur : coplanaires Hi-Z (Geometry, recommandation « accepter »), PNG 16 bits refusé ou porté jusqu'à l'écran (Compilateur), option `atlasClasses: 2` et départ au sol du banc 15.

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
- Un changement d'image voulu (nouvelle référence) exige l'accord explicite de l'utilisateur avant le push.
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
