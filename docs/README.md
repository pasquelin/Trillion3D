# Documentation de Web Geometry

Le SDK livré est décrit par le [guide SDK](SDK.md), l'[architecture des paquets](../packages/README.md), le [compilateur natif](COMPILER.md) et le [format de cache](FORMAT.md). Tout ce qui n'est pas listé ici n'est pas livré.

| Document                                                         | Rôle                                                                                                                                     |
| ---------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| [Compilateur natif](COMPILER.md)                                 | `web-geometry-compiler` : arguments, événements, pointeur, mode lot, annulation, import FBX/OBJ, codes d'erreur                          |
| [Format de cache](FORMAT.md)                                     | Pointeur, `clusters.json` et son annexe binaire `clusters.bin`, DAG de clusters, hiérarchie de culling, paquets de streaming, objets SHA |
| [Principes du produit](architecture/PRINCIPES_DU_PRODUIT.md)     | Exigences de comportement : cœur portable, capacités, propriété des sources, repli                                                       |
| [Intégration Web / Electron / Node](architecture/INTEGRATION.md) | Qui possède le canvas, la boucle, la préparation et le repli                                                                             |
| [Tests et bancs de performance](TESTS.md)                        | Organisation des tests unitaires, sondes de justesse GPU et 39 bancs de performance                                                     |

La cible du moteur (éditeur, cuisson finale, sortie de Three.js, exigences et critères de sortie) est tenue dans [`docs/SPEC_MOTEUR_SANS_THREE.md`](SPEC_MOTEUR_SANS_THREE.md). Le backlog des tâches ouvertes est dans [`TODO.md`](../TODO.md) ; une tâche terminée est supprimée.
