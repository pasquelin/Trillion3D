# Fixtures Blender

## `procedural-materials`

Scène Blender originale **CC0-1.0**, reprise telle quelle du corpus local
`test/assets/blend/procedural-materials` (corpus WebGeometry, génération procédurale, 15 septembre
2026, écrite par Blender 5.2.1 LTS). Le dépôt ignore `test/assets/` : le fichier dont le pilote a
besoin est copié ici avec sa notice, `LICENSE.txt`. Aucun fichier n'est produit par le dépôt et
aucune installation de Blender n'est nécessaire pour rejouer la dorée.

`scene.blend` (92 065 octets, compressé en Zstandard comme Blender le fait par défaut) porte :

- un objet vide `HierarchyRoot` — compté et non rendu — et **trois objets maillage**
  `SharedMesh_0`, `SharedMesh_1` et `SharedMesh_2`, accrochés à lui, posés en (0, 0, 0), (3, 0, 0)
  et (6, 0, 0) : la matrice monde se compose donc par la chaîne des pères, la matrice d'accrochage
  et la transformation locale, aucune matrice n'étant écrite dans un fichier de cette génération ;
- **un seul maillage** `Cube` pour les trois objets — huit sommets, six faces à quatre coins,
  vingt-quatre coins —, ce qui fait de ces objets des instances : le glTF n'écrit le maillage
  qu'une fois ;
- des **indices de matériau par face** (0, 1, 2, 0, 1, 2), donc trois primitives dans le maillage ;
- une couche d'**UV** par coin, nommée `UVMap`, et un `sharp_face` unique à vrai : toutes les faces
  sont nettes, les normales sont donc calculées à plat ;
- **trois matériaux** à nœud `Principled BSDF` : `Emissive` (couleur d'émission d'intensité 3, donc
  bornée par le glTF et comptée), `Opaque` (couleur de base branchée sur une image) et
  `Transparent` (couleur de base et alpha branchés sur la même image) ;
- **une image PNG empaquetée** dans le fichier (`checker_rgba.png`, 291 octets), dont le chemin
  déclaré sort de l'arborescence servie : ce sont les octets empaquetés qui servent, versés tels
  quels dans le binaire de la scène intermédiaire par une vue de tampon.

L'attendu de la dorée est dans `procedural-materials/expected.json`.

## `limites`

`truncated.blend` : les 4 096 premiers octets du même fichier une fois déballé — un entête valide
suivi d'un bloc qui n'est pas entier. Le pilote doit le refuser par `blend-truncated`, sans panique
ni allocation non bornée. Même licence CC0-1.0, notice dans `LICENSE.txt`.

## Ce que le dépôt ne possède pas

Aucun fichier écrit par un Blender antérieur à la disposition par attributs nommés, ni par un
Blender 32 bits ou sur une machine en boutisme gros. Les refus correspondants sont donc prouvés sur
un fichier minimal écrit dans le test à partir de la description du format
(`src/plugins/scene/blend/tests.rs`), jamais sur une fixture commise.
