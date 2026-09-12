# Principes de Web Geometry

Source canonique des exigences d’architecture et de comportement du produit. Ces exigences sont des objectifs à valider : elles ne déclarent pas les fonctionnalités toutes implémentées. Voir [les capacités et limites du SDK](../../packages/README.md).

1. **Core portable.** Les algorithmes, formats, oracles et contrats du moteur restent indépendants de React et d’Electron. L’interface pilote et observe les campagnes ; elle ne contient pas la logique fondamentale du moteur.
2. **Préparation compilée et versionnée.** Les assets coûteux à construire sont préparés hors de la boucle interactive, versionnés avec leur schéma et chargés après validation de leur manifeste. Aucun coût de préparation caché n’est attribué au rendu courant.
3. **Préparateurs autonomes.** Tout cœur Rust de préparation ou compilation d'assets réside dans un package autonome dans le dépôt Web Geometry sous `packages/`. Un banc ne contient que ses manifests, contrats, scénarios, adaptateurs et tests, et consomme l'API publique du package. Les packages moteur et préparateur n'importent ni React, Vite, Electron, ni l'intérieur d'un banc.
4. **Ne jamais dégrader l'application.** Le SDK négocie les capacités et conserve une baseline standard. Il désactive une optimisation lorsque son coût mesuré dépasse son bénéfice et revient au backend compatible après erreur, perte du périphérique, épuisement mémoire ou thrashing. L'interface expose le backend, le niveau actif, le fallback et sa raison sans inventer de métrique. Le repli WebGL reste non prouvé tant qu'un test physique dédié n'a pas été exécuté et archivé.
5. **Repli transparent.** Pour l'utilisateur final, le fallback est automatique et silencieux : aucun avertissement technique ne paraît pendant un lancement normal. Le diagnostic complet reste réservé à un mode diagnostic ou développeur. Un message simple est affiché uniquement lorsqu'aucun rendu compatible n'est possible. Une bascule de backend conserve la scène et ne provoque ni flash, ni écran vide, ni redémarrage visible.

## Propriété des sources et intégrations

Web Geometry possède physiquement `asset-compiler-rust`, `asset-compiler-core`, `sdk-core`, `sdk-node` et `sdk-browser` dans `packages/`. Le SDK expose des points d’entrée publics et produit JavaScript et déclarations. Les adaptateurs React et Electron restent facultatifs et ne sont pas livrés comme packages dédiés. Les hôtes consomment les exports publics ; les interfaces de conception décrites dans `docs/vision/` ne sont pas des API livrées.
