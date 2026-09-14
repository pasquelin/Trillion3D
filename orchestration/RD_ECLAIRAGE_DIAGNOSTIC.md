# Éclairage dynamique : diagnostic et orientation de recherche

Date : 14 septembre 2026. Le livrable recherché est une orientation technique étayée par des expériences, pas une intégration progressive improvisée dans le moteur. Les ajouts fonctionnels au prototype sont arrêtés après le diagnostic ci-dessous.

## Diagnostic historique, avant le banc 16

Le prototype révèle surtout un algorithme de dessin trop coûteux. Déplacer le calcul CPU dans un worker ou le porter en WebAssembly ne résout pas ce blocage graphique. La piste à étudier associe une recherche spatiale des obstacles, un cache de transport lumineux réutilisable et une séparation entre interaction, calcul et dessin. Le choix du langage vient après la validation de ces idées.

Le prototype utilise `prepare()` et `createExplorer()`, mais son backend expérimental dessine les maillages source avec Three.js/WebGL2. Les pages de clusters préparées ne servent pas au dessin. Le serveur du Lab fournit l’origine et les dépendances ; son runner de banc n’est pas exécuté. Aucun résultat ci-dessous n’est une performance du moteur de production.

## Ce qui a été exécuté

Machine : Apple M2 Max, macOS arm64, 96 Gio, Chrome 152, ANGLE Metal. Scène de deux pièces, porte mobile, trois panneaux colorés mobiles, deux miroirs et une sphère GGX. 95 surfaces, 282 patches, 4 158 triangles. Résolution 1280 × 720, DPR 1 ; 256 rayons CPU par patch, 16 échantillons directs par source, 8 échantillons GGX. Aucune réduction de résolution ni de ces budgets pendant les profils comparables.

Sur 14 états de porte, lampes, couleurs et caméra, les modes recalcul et réutilisation donnent exactement la même matrice, la même radiance et la même image. L’A/A est aussi exact ; chaque capture du SDK effectue réellement un nouveau dessin. Cette égalité valide la réutilisation dans cette expérience, pas l’exactitude physique de l’éclairage. [Résultats de comparaison](../benchmark-runs/lighting-transport/2026-09-14T13-21-18-283Z/result.json)

## Où part le temps

Premier profil : 16 images par action après 4 images de préparation. Les valeurs du tableau sont des médianes de diagnostics courts, pas une campagne de gain.

| Action | Recherche des obstacles CPU | Résolution des rebonds CPU | Transport CPU total |
|---|---:|---:|---:|
| Changer une couleur, géométrie fixe | 0,2 ms | 9,4 ms | 9,5 ms |
| Déplacer la porte, réutilisation | 30,4 ms | 9,6 ms | 40,1 ms |
| Déplacer la porte, recalcul intégral | 130,5 ms | 9,3 ms | 139,8 ms |
| Déplacer une lampe, réutilisation | 27,3 ms | 9,7 ms | 36,9 ms |

La soumission du dessin côté CPU est proche de 0,2–0,3 ms dans ce profil. Quand aucun transport lumineux ne s’exécute, l’intervalle rAF médian reste proche de 300 ms. Le solveur n’est donc pas la cause principale de la lenteur actuelle. [Profil CPU et rendu](../benchmark-runs/lighting-transport/2026-09-14T13-30-17-035Z/profile.json)

Les chronomètres GPU en flux retournent des intervalles supérieurs à la cadence des soumissions ; on ne les additionne pas au CPU et on ne les convertit pas directement en FPS. Une première tentative avec `gl.finish()` n’attendait pas effectivement la fin GPU dans ce contexte : ses temps muraux ne sont pas utilisables comme durée de dessin.

Un second contrôle isole cinq dessins par des fences GPU vérifiées : **370,4 à 497,9 ms GPU, médiane 425,3 ms**. Les temps muraux jusqu’à la fence sont **374,1 à 501,4 ms**, cohérents avec ces mesures. Aucun indicateur disjoint ni erreur navigateur. Ce petit contrôle confirme le blocage graphique ; il ne décrit pas toutes les vues ni toutes les machines. [Mesures GPU isolées](../benchmark-runs/lighting-transport/2026-09-14T13-35-22-532Z/profile.json)

Pour localiser le travail, un diagnostic séparé éteint des lampes. L’intervalle rAF médian passe d’environ **8,4 ms sans source**, à **107,5 ms avec une source**, puis **316,7 ms avec trois sources**. Ce sont des images volontairement différentes : ce résultat sert à attribuer le coût, jamais à proposer une optimisation qui supprime les lampes. [Diagnostic par nombre de sources](../benchmark-runs/lighting-transport/2026-09-14T13-33-02-993Z/profile.json)

Le code explique cette dépendance : chaque point diffus peut demander 3 × 16 rayons d’ombre, chacun parcourant jusqu’à 95 rectangles. Les reflets peuvent retrouver une surface diffuse et recommencer ce calcul. C’est une borne de travail issue du code, pas un compteur GPU mesuré. Il faut éviter de rechercher chaque obstacle par un parcours exhaustif et de recommencer autant de travail dans les reflets.

## Une idée mathématique déjà vérifiée

À géométrie, albédos et formes des sources fixes, le transport diffus est linéaire par rapport aux émissions. On peut calculer la contribution d’une lampe blanche unitaire, puis la recolorer et la pondérer sans résoudre à nouveau tous les rebonds.

Pour trois lampes, trois tableaux RGB couvrent neuf réponses scalaires. Il faut conserver aussi les bases de l’irradiance indirecte pour ne pas refaire ensuite un produit matriciel dense. Pour cette scène, les deux familles de coefficients Float64 occupent exactement **40 608 octets**, hors autres données et allocations.

Une expérience indépendante avec l’oracle gaussien du même opérateur retrouve le recalcul après changement des couleurs et intensités : erreur maximale **3,55 × 10⁻¹⁵** en radiance et **5,55 × 10⁻¹⁶** en indirect. Le principe de superposition est donc confirmé pour l’opérateur échantillonné. Son gain de temps, son coût de construction et son amortissement ne sont pas mesurés. [Preuve reproductible et sources archivées](../benchmark-runs/lighting-transport/basis-diagnostic-20260914/README.md)

Une porte déplacée, un panneau déplacé ou un albédo modifié invalide ces bases. Les recalculer toutes à chaque mouvement peut annuler leur intérêt. Sur un grand monde, stocker toutes les lampes pour toutes les surfaces serait prohibitif : limitation aux zones d’influence, représentation hiérarchique et invalidation partielle restent des hypothèses à tester. Toutes les bases publiées doivent correspondre à la même version de scène ; direct et indirect reçoivent ensemble les mêmes coefficients. Le mélange se fait avant le tone mapping. Les bornes d’erreur des bases doivent tenir compte des intensités maximales.

## Rôle des technologies

| Technologie ou idée | Problème visé | Ce qu’elle ne démontre pas encore |
|---|---|---|
| Structure spatiale des obstacles, par exemple BVH | Réduire les intersections inutiles dans les ombres et reflets | Gain réel, précision aux coins et coût de mise à jour non mesurés |
| Bases par lampe et cache de transport | Recombiner couleurs et intensités à géométrie fixe | Construction et amortissement ; mouvement continu ; grande scène |
| Worker JavaScript persistant | Sortir le solveur du thread de l’interface et traiter la dernière consigne | N’accélère pas automatiquement le calcul et ne réduit pas le travail du shader |
| Rust compilé en WebAssembly dans ce worker | Essayer une autre exécution du même noyau CPU, après simplification du travail | Aucun port exécuté, aucun gain garanti, aucun effet direct sur le dessin GPU |
| WebGPU compute | Tester une répartition parallèle de travaux correctement bornés et regroupés | Changer d’API ne rend pas économique un parcours exhaustif par pixel |

Les workers exécutent des tâches dans un contexte séparé et communiquent par messages. Les transferts de buffers changent leur propriétaire : on ne détache pas les tableaux que le solveur conserve. Une hypothèse minimale conserve un état persistant, une requête active et une seule consigne suivante remplaçable ; les réponses portent une révision. Scène et lumière sont publiées ensemble. [Documentation des workers](https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API/Using_web_workers)

WebAssembly est un format d’exécution complémentaire à JavaScript ; ce n’est pas une promesse de gain sur ce noyau. Comparer exactement le même calcul, précision, données et sorties, en incluant initialisation et transferts. [FAQ officielle WebAssembly](https://webassembly.org/docs/faq/)

## Expériences proposées à la date du diagnostic

1. **Obstacles :** comparer recherche exhaustive et structure spatiale sur la même image. Même nombre de rayons, mêmes sources, même résolution ; conserver les cas de coins, surfaces fines et mouvements. Critère : image identique et coût GPU diminué, coût de mise à jour inclus.
2. **Contributions des sources :** comparer recalcul et recombinaison des bases sur des variations lumineuses, puis introduire des mouvements de porte. Mesurer construction, mélange, invalidation, erreur et mémoire pour déterminer quand conserver les bases est rentable.
3. **Réactivité :** comparer exécution actuelle, regroupement des commandes, puis un worker JavaScript persistant. Mesurer délai d’entrée, délai de réponse lumineuse, calcul et GPU séparément ; aucune réponse obsolète appliquée à une autre géométrie.
4. **Choix d’exécution :** porter uniquement le noyau encore dominant en WebAssembly, ou tester un calcul WebGPU équivalent. Garder la même référence numérique. Mesurer démarrage, échanges, mémoire et énergie si instrumentée, puis tester d’autres matériels.

Un prototype qui n’est pas encore fluide sur M2 Max ne permet aucun verdict sur machine modeste. Windows, Linux, autres navigateurs, iGPU moins puissant et rendu CPU seul restent non exécutés. Worker, WebAssembly, BVH et bases persistantes ne sont pas livrés au moteur.

## État lors du diagnostic initial

Travail isolé sur `codex/light-transport-experiment`, base SDK `78e7fe203d273c09dd4f27b4ee39016fbcb51cd1`. Aucun commit, aucune fusion ni modification des assets du Lab. 330 tests Node, build TypeScript, structure et déclarations passent. Le compilateur natif existant a été construit et utilisé ; aucune modification Rust. Images, vidéos, sources servies et données de comparaison sont conservées avec leurs empreintes dans les dossiers d’essais.


## Livraison revue du banc 16, 14 septembre 2026

Le diagnostic ci-dessus est historique. Le banc `16-lighting-transport` existe désormais dans le Lab avec préparation publique, exploration, comparaison exhaustive/BVH et archives persistantes. Le rendu demeure expérimental : les clusters préparés ne servent pas au dessin. Aucun Worker ni noyau WebAssembly ajouté.

Revue indépendante : pose initiale de porte alignée avec la source préparée ; nettoyage après erreur ; erreurs et arrêts, y compris pendant initialisation, archivés ; historique rechargeable de cinq tentatives avec dernier résultat valide protégé. Les 44 modules éclairage et fixtures respectent le découpage requis. Le découpage conserve les shaders assemblés à l'octet près.

Vérification navigateur dans le Lab : 14 états, A/A et exhaustive/BVH à zéro pixel différent, 4 158 triangles sélectionnés et soumis ; même résolution 1280 × 720, DPR 1, trois sources, budgets 16 directs et 8 reflets. Première campagne persistée `2026-09-14T14-19-00-913Z` du worktree Lab : médianes GPU isolées 239,852 ms exhaustive et 197,028 ms BVH (10 dessins par variante), intervalles rAF 316,6 et 237,5 ms (24 dessins par variante). Le test navigateur a alors terminé sur une assertion liée au favicon 404, sans erreur de rendu ; cette ressource accessoire est désormais exclue des erreurs fonctionnelles. Ce gain local laisse le prototype lent et ne vaut pas prévision sur une autre scène.

Validation : Lab `npm run validate` passe après corrections de revue. SDK : 12 tests éclairage, build TypeScript, natif, structure, déclarations, liens et 57 tests Rust passent. Suite Node complète : 336/337 ; échec préexistant `triangleDiagnostic.test.ts` sur le matériau du mode filaire. La validation globale reste rouge dans le develop hérité : format, 7 fichiers au-delà de 200 lignes, doublons, lint et éléments inutilisés. Les fichiers concernés appartiennent à la tâche qualité concurrente. La navigation du banc 04 présente aussi une exception préexistante lors de son initialisation ; elle est distincte du banc 16. Ces échecs ne sont pas présentés comme corrigés.

Après signalement de ces limites, l'utilisateur a renouvelé explicitement la demande de fusion et de maintien des dossiers principaux sur develop. Les modifications préexistantes de navigation et de journal sont conservées. Aucun push distant demandé.
