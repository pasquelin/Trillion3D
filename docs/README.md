# Documentation de Web Geometry

Le SDK livré est décrit par [packages/README.md](../packages/README.md), le [guide SDK](../SDK.md) et le [format 1 actuel](FORMAT.md). Les documents de ce dossier qui ne sont pas listés ci-dessous sont des **spécifications de conception**, pas des fonctionnalités livrées.

[Principes du produit](architecture/PRINCIPES_DU_PRODUIT.md) : core portable, capacités, propriété des sources et repli.

## Lecture produit

| Document | Rôle |
|---|---|
| [Format 1 actuel](FORMAT.md) | Pointeur, `clusters.json`, pages SHA, namespaces `native/` vs `reference/` |
| [Principes](architecture/PRINCIPES_DU_PRODUIT.md) | Exigences de comportement |
| [Architecture SDK](../packages/README.md) | Ce qui est implémenté, limites ouvertes |
| [Exemple hôte](../examples/minimal-webgl/README.md) | Canvas + `manifestUrl` |

## Spécifications de conception (non livrées)

Les dossiers sous [`vision/`](vision/README.md) (mathématiques, compilation, runtime, extensions, annexes, architecture cible) décrivent un moteur virtualisé futur. Ils ne remplacent pas le format lu par le SDK.
