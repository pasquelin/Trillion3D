# Ajouter un format au compilateur

Le compilateur ne connaît aucun format d'entrée. Il connaît des **pilotes** : un par format, chacun
dans son module, tous listés dans un registre statique. Ajouter un format, c'est ajouter un module
et une ligne ; enlever un format, c'est enlever les deux. Le cœur ne bouge pas.

Ce que le pilote doit produire est toujours la même chose : la **scène intermédiaire**, un glTF 2.0
et son binaire, que `compile` est seul à savoir lire. Les images suivent le même modèle, vers RGBA8.

La politique — quels formats sont admis, lesquels sont refusés, sous quelles conditions et sous
quelle licence — est dans [`orchestration/SPEC_FORMATS_IMPORT.md`](../../orchestration/SPEC_FORMATS_IMPORT.md).
Elle prime sur ce document : un pilote hors de cette liste ne se fusionne pas.

## Un pilote de scène

1. Un module dans `src/plugins/scene/<format>.rs`, nommé par le format, jamais par la bibliothèque
   qui le lit. Deux formats lus par la même bibliothèque restent deux pilotes, deux noms, deux
   versions ; le code commun va dans un module voisin, comme `ufbx_driver.rs` pour FBX et OBJ.
2. `impl Plugin` : `name` (le format en minuscules), `version` (la changer invalide les caches, elle
   nomme la bibliothèque et sa version), `extensions` (en minuscules, sans le point).
3. `impl ScenePlugin` : `accepts_head` reconnaît l'entête du format — `false` pour un format texte
   qui n'en a pas —, `prepare` rend `PreparedScene::InPlace` pour une entrée directe ou
   `PreparedScene::Converted` pour ce que le pilote a écrit dans `request.cache`.
4. Une ligne dans `scene::PLUGINS`.

`prepare` reçoit tous les fichiers du dossier que ce pilote revendique : c'est lui qui décide s'il en
accepte un seul ou plusieurs, et il refuse avec `SOURCE_FORMAT_AMBIGUOUS` quand il n'en veut qu'un.
Il vérifie `request.cancelled` à chaque frontière de travail bornée, publie ses étapes par
`request.progress`, et n'écrit jamais à côté de la source — seulement sous `request.cache`.

## Un pilote de conteneur

Une archive n'est pas une scène : c'est l'emballage d'une source. Un conteneur est un pilote de
scène ordinaire — `zip` en est le premier — qui extrait sous `request.cache`, traverse un unique
dossier racine, puis **route le dossier extrait par le routeur** et rend ce que le pilote de scène
retenu rend. Les règles du routeur valent telles quelles : inconnu ou ambigu, c'est un refus.

Ce qui ne dépend pas du format d'archive vit dans `scene/archive.rs` — plafonds nommés (entrées et
octets décompressés), refus de sortie du dossier d'extraction, clé d'extraction, composition avec le
routeur. Un second conteneur y ajoute son module de lecture, pas une seconde version de tout cela.
Les protections ne sont pas négociables : aucun chemin absolu ni `..`, aucun lien symbolique suivi,
aucune archive chiffrée ouverte, et un refus nommé — jamais une extraction à moitié.

## Un pilote d'image

1. Un module dans `src/plugins/image/<format>.rs`, même règle de nommage.
2. `impl Plugin`, puis `impl ImageDecoder` : `mime`, `accepts_head` (le nombre magique du format) et
   `decode`, qui rend `DecodedImage` sous le plafond d'allocation reçu.
3. Une ligne dans `image::DECODERS`.

Un décodage impossible rend une raison de rapport — une chaîne stable comme `image-decode-failed` —
jamais une erreur de compilation : une texture illisible laisse le moteur retomber sur son blanc.
Le décodeur ne rend jamais d'image vide et ne panique jamais.

## Ce qu'il faut fournir avec

- **Une fixture dorée minimale** : le plus petit fichier du format que l'on possède ou que l'on peut
  redistribuer, sous `fixtures/`, avec son `expected.json`, compilé par le harnais commun
  (`src/tests/golden.rs`) — jamais par un harnais à soi.
- **Un test par comportement du pilote** : ce qu'il reconnaît, ce qu'il refuse, ce qu'il rapporte.
  Les tests du routeur et du registre existent déjà : ne les recopiez pas par format.
- **La provenance** : d'où vient la spécification suivie, quelle bibliothèque, quelle licence. Elle
  se met dans l'entête du module et dans `orchestration/JOURNAL.md`.

## Interdit

- Reprendre du code ou un SDK d'éditeur, même disponible : lecteur écrit depuis une spécification
  publique ou depuis une bibliothèque permissive dont la licence est respectée et conservée.
- Contourner un chiffrement, une protection ou une vérification de licence d'un format.
- Réencoder une source avec perte, modifier ou écrire à côté des fichiers d'origine.
- Mettre quoi que ce soit du format dans `main.rs`, `cli_batch.rs` ou `compiler_args.rs` : la CLI est
  mince, elle ne nomme aucun format.
- Ajouter un pilote vide « pour plus tard » : un format sans lecteur n'a pas de module.
