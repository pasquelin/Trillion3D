# Fixtures Alembic

## `procedural-static`

`scene.abc`, **CC0-1.0**, repris tel quel du corpus local `test/assets/alembic/procedural-static`
(généré par `test/assets/tools/model_formats_blender.py`, corpus WebGeometry, 15 septembre 2026,
exporté par Blender 5.2.1 LTS au travers d'Alembic 1.8.3). Le dépôt ignore `test/assets/` : le
fichier est copié ici avec sa notice, `LICENSE.txt`, sans rien y changer — 8 110 octets, conteneur
Ogawa, version de format 256.

Ce qu'il porte, et ce que la dorée fixe en clair :

- un `Xform` racine `HierarchyRoot`, trois `Xform` `SharedMesh_0`, `SharedMesh_1`, `SharedMesh_2`
  posés en x = 0, 3 et 6 — la matrice identité du premier et de la racine n'est pas écrite dans le
  glTF, qui la sous-entend ;
- sous chacun, un `PolyMesh` `Cube` : 8 positions, 6 faces de quatre côtés, normales et coordonnées
  de texture par coin de face, ces dernières indexées sur 14 valeurs uniques ;
- trois `FaceSet` par cube — `Emissive` (faces 2 et 5), `Opaque` (0 et 3), `Transparent` (1 et 4) —
  donc trois primitives par maillage et un matériau par nom, partagé par les trois cubes ;
- les trois cubes ont les mêmes octets : un seul maillage est écrit, et les deux répétitions ne
  sont plus que des nœuds. 36 triangles au total, 3 matériaux, 9 face sets lus.

## `limites`

Deux entêtes écrites à la main pour ce dépôt, sous la même licence CC0-1.0, qui ne portent aucune
géométrie : `hdf5.abc` ouvre sur le nombre magique du conteneur HDF5, l'emballage historique
d'Alembic que ce binaire ne lit pas, et `truncated.abc` sur une entête Ogawa complète dont le groupe
racine est au-delà de la fin du fichier. Chacune prouve un refus nommé au travers du compilateur
entier — `alembic-hdf5-unsupported` et `alembic-file-invalid` — et non au travers du seul lecteur.
