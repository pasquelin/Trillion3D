# Reprise — WebGeometry sans Three.js (15 septembre 2026, ~15 h 50, session Geometry en pause)

## Rôles, non négociables
- Toi (Fable) : chef d'orchestre. Tu ne codes pas, tu ne lis pas de code, tu ne lis que les rapports courts des agents (≤ 10 lignes). Réponses à l'utilisateur en 5 lignes, simples, un tableau si des chiffres. Images du harnais à conserver et à montrer (SendUserFile).
- Opus 5 : tout le code. Plusieurs Opus en parallèle sur des périmètres de fichiers disjoints. Sonnet 5 : lecture, relecture de docs, rapports. Haiku : jamais.
- Règle de l'utilisateur (15 sept., 14 h) : il y a TOUJOURS un Opus qui développe le lot suivant pendant qu'un autre attend un verrou, une mesure ou une fusion. Attendre sans agent de code actif est une faute.
- Tests écrits à la fin selon ce qui est retenu ; par lot : tsc, check:changed, check:unused, check:lines, check:duplicates, preuve 0 px ; `npm run validate` complet = le validateur (voir plus bas), pas nous.
- Spec : orchestration/SPEC_MOTEUR_SANS_THREE.md. Journal : orchestration/JOURNAL.md, entrées « [session sans-threejs] » (dates « 16 septembre » corrigées en 15 sur docs/geometry-reprise). Mots interdits : nom du système de géométrie virtualisée d'Epic et nom de son moteur. Lab (render-tech-lab/) jamais modifié. Port 5174 réservé.
- Emerald n'est QU'une scène de test ; rien dans le code ne se cale sur elle. Cache Emerald du Lab périmé : chaque campagne sort 19 × 404 `lights.json` (sans effet sur les pixels, code de retour non nul du banc) ; l'utilisateur régénère avec `npm run prepare:models`.
- Fidélité avant vitesse : 0 px au harnais `node scripts/mesure/banc.mjs --moteur webgpu|webgl --avant <ref> --apres <ref> --vues generale,sol,rue --images 60 --pixelError 0,1 --max-pages 100000` (+ caméra mobile, + scène synthétique classes-materiaux), témoin A/A, hash identique, trous 0. Les pixels ne dépendent pas de la charge ; les durées relevées machine chargée sont indicatives, à rejouer au calme à la livraison finale. Un rebase sur des commits de docs seuls ne demande pas de re-preuve ; un rebase sur du code, si.

## Verrou de mesure (protocole nominatif, adopté par les quatre sessions le 15 sept. à 14 h 30)
- Prise : `mkdir /Users/pasquelin/Applications/webGeometry/.claude/mesure.lock && echo "<session lot> $(date)" > .claude/mesure.lock/proprietaire`. mkdir raté = pas de mesure, un seul nouvel essai après avoir fait le reste, jamais de boucle d'attente (interdiction absolue de `until pgrep … sleep` : `pgrep -f banc.mjs` se trouve lui-même et ne finit jamais ; banc au premier plan avec timeout 600000 ou `run_in_background` de l'outil Bash).
- Libération : `rm proprietaire && rmdir` seulement par celui dont le nom est dans le fichier, après CHAQUE campagne, jamais tenu entre deux. Un verrou sans propriétaire et sans `banc.mjs` vivant depuis plus d'une minute est orphelin : le retirer et le noter au journal.
- Une campagne de coût (durées) exige charge à une minute < 4 et aucune autre session qui compile ou teste ; une campagne pixels seuls tolère la charge mais reste sérialisée. Prévenir par message avant de prendre le verrou si une autre session l'attend ; le second à fusionner un lot touchant `packages/sdk-browser` rebase et rejoue sa preuve.
- Fusion : `git -C /Users/pasquelin/Applications/webGeometry merge --ff-only <branche>` puis `branch -f main develop`. INTERDICTION de push sur origin : seule la session « Validateur » pousse develop après simplify + validate. Jamais de `git stash`. Chaque Opus copie son `.mesure/out` dans `/Users/pasquelin/Applications/webGeometry/.mesure/out/<lot>/` avant de supprimer son worktree.

## Fusionnés cette session (develop = main, rien poussé par nous)
| Lot | SHA | Résultat |
|---|---|---|
| Correctif WEBGPU_LOST (Lumière, tampon de rebond 64 → 176 octets) | 2dcc8fc | nouvelle référence d'image WebGPU = 2dcc8fc (écart 4 390 px vs d3dcd69 dû aux lots fusionnés entre les deux, justifié au journal Lumière) |
| Lot 4c coupe hiérarchique WebGL2 | 840a935 | sélection générale seuil 0 : 5,5 → 4,5 ms, 0 px sur 12 séries fixe + mobile ; cible < 2 ms ouverte (reste la retenue, 80 000 fiches/image). Tableaux typés REFUSÉS à la mesure (−7,9 % seuil 0, −17 % seuil 1, A/A ±1 %), preuve sur `essai/4c-tableaux-types`, ne pas retenter sans sortir cône et résidence du chemin |
| Lot instances GPU (R7b, une géométrie, N matrices) | db44508 | géométrie 420,6 → 209,1 Mo à 1 instance, 2 652,8 → 209,1 Mo à 9 ; 0 px sur 7 campagnes (1, 9, mobile 1 et 9, classes-matériaux, WebGL, base de fusion) ; temps par image inchangé (proportionnel aux placements). Hors lot : fixture classes-matériaux à 9 instances (boîtes coplanaires à espacer), catalogue gabarit × instance |
| Lot visibilité WebGPU (D3, passes, delta) | 3657c91 | levier 1 préfixe parallèle du tirage : compaction GPU 0,93 → 0,37 ms ; levier 3 liste dessinée en delta : sélection CPU 0,2 → 0,0 ms ; levier 2 (transparents tenus) retiré, sans gain mesurable, tag `essai/visibilite-levier2-mesure`. 16 séries 0 px. CPU fixe 7,9 → 7,7 ms : CIBLE 4 ms NON ATTEINTE, les passes sont déjà persistantes, le coût restant est avant `cpuStart` (à profiler plus finement, lot futur). Piège : la première série d'une campagne paie 1,7 ms de pénalité d'ordre, conclure sur le profil par étape |
Autres sessions ce jour dans develop : textures H3 (Calculs, 32c95b9), ombres lointaines (Lumière, b3cf4e9), stochastique (Lumière, 9318023), validateur (e242027 : gpuPeriodicReadback, grantCapability), compilateur (pilotes tiff/unity/unitypackage, 9ae0c14). Mesure finale de Calculs : orchestration/mesures/calculs-finale-2026-09-15.md (base 15297dd → db44508, n'inclut pas visibilité).

## Témoin Three.js avec lampes du contrat : fusionné 86f3f67 (harnais seulement)
Le témoin Three reçoit les lampes du magasin `SceneLight` via `sceneLighting` de `createExplorer` ; `--moteur-avant`/`--moteur-apres` donnent un moteur par côté (avant = témoin Three en WebGL, après = moteur WebGPU), l'écart avant/après est le chiffre de fidélité par vue. Limites : pas d'ombre portée côté témoin (`--ombres off` des deux côtés), ni rebond ni sondes. Scène `transmission` des fixtures, soleil du contrat, seuil 0, A/A 0 px sur 9 séries :
| vue | moteur contre témoin | max canal | px ≥ 32 | px ≥ 128 |
|---|---|---|---|---|
| générale | 181 413 px (19,7 %) | 186 | 148 866 | 258 |
| sol | 386 695 px (42,0 %) | 124 | 269 173 | 0 |
| rue | 287 333 px (31,2 %) | 186 | 228 138 | 3 |
Lecture : sur la scène sans transmission (classes-materiaux) l'écart tombe à 17 au pire et tout l'écart franc tient dans le seul panneau BLEND ; sur la scène à transmission l'écart franc couvre l'eau et ce qu'on voit à travers : la lumière est la même des deux côtés, ce qui reste est le matériau (mélange, transmission). DÉFAUT TROUVÉ chez Lumière (signalé, non corrigé, ses fichiers) : `...sceneLightingApi(sceneLights)` étale un accesseur et fige `sceneLit` à la construction dans les quatre moteurs Three (exactPagesBackend.ts:191, referenceBackend.ts:61, autonomousPages.ts:154, threeLod.ts:143) ; une lampe posée après création ne rallume jamais ACES ni l'exposition. Avant unlit-identite, la scène sans transmission donnait 83 412 px tous à exactement 1/255 (égalité au quantum). Le tableau ci-dessus est dégradé par ce défaut, pas par le témoin : à rejouer après le correctif de Lumière (attendu max canal ≤ 1 sur classes-materiaux). Images : `.mesure/out/lot-temoin-three/`.

## Incidents de la journée (à ne pas reproduire)
- Boucles `until ! pgrep -f banc.mjs` sans fin (4 processus, 25 min) ; verrou `mkdir` non vide qui fait échouer le `rmdir` ; verrou repris 11 s après une libération ; verrou anonyme sans banc vivant ; un Opus a écrit `proprietaire` dans un verrou existant (validateur) : tous consignés au journal, protocole nominatif ci-dessus en réponse.
- Le validateur fait avancer develop pendant une re-preuve de fusion : demander un gel explicite à Validateur, Compilateur et Calculs avant la re-preuve, fusionner en ff dans la foulée.

## Décision utilisateur toujours en attente
Surfaces à profondeur exactement égale (coplanaires v2 : 57-77 % des égalités intra-cluster, hors format, rien fusionné, branches `essai/hiz-*`) : accepter un déplacement de référence de 0,007 % (67/173 px générale, 1 sol, 39 rue) avec vainqueur fixé à la compilation (une couche par cluster) ouvre l'historique d'occlusion en mouvement (−3 ms CPU) et la partition Hi-Z temporelle (−27 % GPU). Recommandation : accepter. Réglages : DEPTH_LAYER_BIAS_UNITS = 16 (sdk-core/depthLayer.ts), plafonds CoplanarBounds::default().

## Suite prévue (dans l'ordre)
1. CPU fixe WebGPU 7,7 → 4 ms : profil plus fin en amont de `cpuStart` (préparation des pages, listes, encodage 4,9 ms), un levier à la fois, gardé seulement si gain mesuré et 0 px.
2. Sélection WebGL2 < 2 ms : sortir cône et résidence du chemin de la coupe (préalable aux tableaux typés).
3. Coplanaires (après go utilisateur) : historique d'occlusion + Hi-Z temporel.
4. Rembourrage 64 entrées par primitive transparente ; phase 3 première image (chantier/premiere-image-v3, 22 conflits) ; phase 2 sans Three dans l'hôte.
Aucun worktree ni branche de lot Geometry en attente à la pause (tags/branches de preuve gardés : `essai/4c-tableaux-types`, `essai/visibilite-levier2-mesure`, `essai/hiz-*`).
Tableau de suivi pour l'utilisateur : CPU image générale seuil 0 : 33,6 ms (14 sept.) → 7,8 (15 sept. midi) → 7,7 (15 sept. soir) ; GPU 29 ms seuil 0 (goulot) ; géométrie 209 Mo quel que soit le nombre d'instances.

## Sessions voisines (ListAgents)
- « Lumière » (éclairage, ombres, reflet LR7 en worktree lot-reflet, unlit-identite en cours) : préavis mutuel avant toute fusion touchant sdk-browser ; ne pas toucher ses fichiers d'éclairage/ombres/sondes/proxy/reflet.
- « Calculs » (audit des calculs, bilan clos, mesure finale faite) : D3 était chez nous, livré.
- « Compilateur » (pilotes d'import, Rust) : ses builds Rust/clang chargent la machine à 100+ ; demander un gel de develop pendant une re-preuve de fusion.
- « Validateur » (ordre de l'utilisateur) : seul à pousser origin ; nettoie les worktrees et branches fusionnés ; lui dire ce qu'il ne doit pas supprimer (worktrees actifs, branches `essai/*` gardées comme preuves, tag `essai/visibilite-levier2-mesure`).

## Mémoire
~/.claude/projects/-Users-pasquelin-Applications-webGeometry/memory/ (index MEMORY.md) : toujours-un-agent-sur-la-suite, banc-pas-de-boucle-pgrep, mesure-verrou-serialisation (protocole propriétaire), opus-paralleles-autorises, directive-optimiser-sans-perte, emerald-scene-de-test-pas-le-moteur, images-harnais-a-conserver.
