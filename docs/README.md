# Documentation de Web Geometry

Le site GitHub Pages (`/docs` sur `main`) sert le dernier rapport de campagne : `index.html` et `vignettes/`, posés par `node scripts/mesure/publierRapport.mjs` après `rapportGlobal.mjs`. `.nojekyll` empêche Jekyll de transformer cette page.

Le SDK livré est décrit par le [guide SDK](SDK.md), l'[architecture des paquets](../packages/README.md), le [compilateur natif](COMPILER.md) et le [format de cache](FORMAT.md). Tout ce qui n'est pas listé ici n'est pas livré.

| Document                                                         | Rôle                                                                                                                                     |
| ---------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| [Compilateur natif](COMPILER.md)                                 | `web-geometry-compiler` : arguments, événements, pointeur, mode lot, annulation, import FBX/OBJ, codes d'erreur                          |
| [Format de cache](FORMAT.md)                                     | Pointeur, `clusters.json` et son annexe binaire `clusters.bin`, DAG de clusters, hiérarchie de culling, paquets de streaming, objets SHA |
| [Principes du produit](architecture/PRINCIPES_DU_PRODUIT.md)     | Exigences de comportement : cœur portable, capacités, propriété des sources, repli                                                       |
| [Intégration Web / Electron / Node](architecture/INTEGRATION.md) | Qui possède le canvas, la boucle, la préparation et le repli                                                                             |
| [Tests et bancs de performance](TESTS.md)                        | Organisation des tests unitaires, sondes de justesse GPU et 39 bancs de performance                                                     |
| [La référence en chiffres](REFERENCE_UE5.md)                     | Les constantes, les octets par triangle et le profil publiés par la référence, en regard des nôtres ; ce qui se compare et ce qui ne se compare pas |

La cible du moteur (éditeur, cuisson finale, sortie de Three.js, exigences et critères de sortie) est tenue dans [`docs/SPEC_MOTEUR_SANS_THREE.md`](SPEC_MOTEUR_SANS_THREE.md). Le backlog des tâches ouvertes est dans [`TODO.md`](../TODO.md) ; une tâche terminée est supprimée.
