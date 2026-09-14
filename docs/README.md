# Documentation de Web Geometry

Le SDK livré est décrit par [packages/README.md](../packages/README.md), le [guide SDK](../SDK.md) et le [format de cache actuel](FORMAT.md). Les documents de ce dossier qui ne sont pas listés ci-dessous sont des **spécifications de conception**, pas des fonctionnalités livrées.

[Principes du produit](architecture/PRINCIPES_DU_PRODUIT.md) : core portable, capacités, propriété des sources et repli.

## Lecture produit

| Document | Rôle |
|---|---|
| [Compilateur natif](COMPILER.md) | `web-geometry-compiler` : arguments, événements, pointeur, mode lot, annulation, import FBX/OBJ, codes d'erreur, usage depuis Node ou tout autre hôte |
| [Format de cache actuel](FORMAT.md) | Pointeur, `clusters.json` et son annexe binaire `clusters.bin`, DAG de clusters, hiérarchie de culling, paquets de streaming, objets SHA sous `native/` |
| [Principes](architecture/PRINCIPES_DU_PRODUIT.md) | Exigences de comportement |
| [Architecture SDK](../packages/README.md) | Ce qui est implémenté, limites ouvertes |

## Spécifications de conception (non livrées)

Les dossiers sous [`vision/`](vision/README.md) (mathématiques, compilation, runtime, extensions, annexes, architecture cible) décrivent un moteur virtualisé futur. Ils ne remplacent pas le format lu par le SDK.
