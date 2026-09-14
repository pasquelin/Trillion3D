# Documentation de Web Geometry

Le SDK livré est décrit par le [guide SDK](../SDK.md), l'[architecture des paquets](../packages/README.md), le [compilateur natif](COMPILER.md) et le [format de cache](FORMAT.md). Tout ce qui n'est pas listé ici n'est pas livré.

| Document | Rôle |
|---|---|
| [Compilateur natif](COMPILER.md) | `web-geometry-compiler` : arguments, événements, pointeur, mode lot, annulation, import FBX/OBJ, codes d'erreur |
| [Format de cache](FORMAT.md) | Pointeur, `clusters.json` et son annexe binaire `clusters.bin`, DAG de clusters, hiérarchie de culling, paquets de streaming, objets SHA |
| [Principes du produit](architecture/PRINCIPES_DU_PRODUIT.md) | Exigences de comportement : cœur portable, capacités, propriété des sources, repli |
| [Intégration Web / Electron / Node](architecture/INTEGRATION.md) | Qui possède le canvas, la boucle, la préparation et le repli |

La cible du moteur (éditeur, cuisson finale, sortie de Three.js, phases et critères) est tenue dans [`orchestration/SPEC_MOTEUR_SANS_THREE.md`](../orchestration/SPEC_MOTEUR_SANS_THREE.md) ; l'avancement dans [`orchestration/JOURNAL.md`](../orchestration/JOURNAL.md). Ces deux fichiers sont les seuls plans vivants ; un plan terminé est supprimé.
