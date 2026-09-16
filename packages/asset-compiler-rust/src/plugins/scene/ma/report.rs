//! Les noms de tout ce que ce pilote ne rend pas, et le classement des types de nœuds.
//!
//! Aucun de ces refus n'est un échec de compilation : une caméra, un script ou une surface NURBS au
//! milieu d'une scène ne doit pas empêcher d'en voir les murs. Ils sont comptés, publiés dans
//! `unsupported` du manifeste, et le rapport dit combien de fois chacun a été rencontré. Une scène
//! qui, après tout cela, ne porte aucune surface est refusée, elle, par `IMPORT_EMPTY`.

/// Une commande hors du sous-ensemble lu. Le nom de la commande suit les deux points : rien n'est
/// exécuté, et le rapport dit exactement ce que le fichier demandait.
pub(super) const COMMAND_IGNORED: &str = "ma-command-ignored";
/// Un type de nœud que ce pilote ne convertit pas — caméra, lampe, surface NURBS, squelette, nœud
/// de script, nœud d'outil. Le type suit les deux points.
pub(super) const NODE_IGNORED: &str = "ma-node-ignored";
/// Un `setAttr` sans nœud à qui l'appliquer : aucun `createNode` ni `select` ne l'a précédé, ou le
/// nom sélectionné n'est pas un nœud de ce fichier.
pub(super) const ATTRIBUTE_UNATTACHED: &str = "ma-attribute-unattached";
/// Un `setAttr` dont les valeurs ne tombent pas sur son intervalle d'indices, dont le type n'est pas
/// lu, ou dont le rang dépasse le plafond d'éléments du pilote.
pub(super) const ATTRIBUTE_INVALID: &str = "ma-attribute-invalid";
/// Une commande `parent` que ce pilote ne rejoue pas : elle ne cite pas une forme maillée et un
/// transform connus, ou elle retire au lieu d'ajouter.
pub(super) const PARENT_UNSUPPORTED: &str = "ma-parent-unsupported";
/// Un nom de nœud que le fichier écrit sans chemin alors que plusieurs nœuds le portent : Maya
/// aurait exigé le chemin complet. C'est le premier nœud écrit qui répond, et l'écart est compté.
pub(super) const NAME_AMBIGUOUS: &str = "ma-name-ambiguous";
/// Un nœud `transform` dont les nombres ne sont pas finis : il reste à l'identité.
pub(super) const TRANSFORM_INVALID: &str = "ma-transform-invalid";
/// Une hiérarchie plus profonde que ce que ce pilote parcourt, une chaîne de pères circulaire
/// comprise : la branche est coupée là, sans faire déborder la pile.
pub(super) const HIERARCHY_TOO_DEEP: &str = "ma-hierarchy-too-deep";
/// Une matrice écrite autrement que par ses seize nombres — la forme longue `xform` de `setAttr` :
/// elle n'est pas devinée, et le nœud garde la pose que ses autres attributs lui donnent.
pub(super) const MATRIX_UNSUPPORTED: &str = "ma-matrix-unsupported";
/// Une forme intermédiaire : l'entrée d'un historique de construction, que Maya n'affiche jamais.
pub(super) const SHAPE_INTERMEDIATE: &str = "ma-shape-intermediate";
/// Un maillage dont les tableaux se contredisent : coin hors de la table des arêtes, arête hors de
/// la table des sommets, ou `.vt` absent.
pub(super) const MESH_INVALID: &str = "ma-mesh-invalid";
/// Un maillage qui ne donne aucun triangle : aucune face, ou toutes dégénérées.
pub(super) const MESH_EMPTY: &str = "ma-mesh-empty";
/// Une face de moins de trois coins : rien à trianguler.
pub(super) const DEGENERATE_FACE: &str = "ma-degenerate-face";
/// Une face déclare un trou. L'éventail depuis son premier coin le remplirait, donc la face est
/// laissée : la silhouette d'un trou n'est pas devinée.
pub(super) const FACE_HOLE: &str = "ma-face-hole-unsupported";
/// Une face que la coupe par oreilles n'a pas su découper entièrement : polygone qui se recoupe,
/// ou sans plan — coins tous alignés, aire nulle. Elle sort en éventail depuis son premier coin,
/// ce qui peut la remplir au-delà de sa silhouette, et c'est ce que ce compte dit.
pub(super) const NGON_UNCUT: &str = "ma-ngon-untriangulable";
/// Un enregistrement de `.fc` hors de ceux que la documentation décrit.
pub(super) const FACE_RECORD_IGNORED: &str = "ma-face-record-ignored";
/// Un enregistrement de face que l'écriture ne raccroche à aucune face.
pub(super) const FACE_INVALID: &str = "ma-face-record-invalid";
/// Des coordonnées de texture écartées : `mu` sans face, jeu d'UV au-delà du premier, ou rang hors
/// de la table `.uvst[0].uvsp`.
pub(super) const UV_DROPPED: &str = "ma-uv-dropped";
/// Des normales écartées : `.n` ne compte ni un vecteur par sommet ni un par coin de face.
pub(super) const NORMALS_DROPPED: &str = "ma-normals-dropped";
/// Aucune normale écrite : elles sont calculées depuis la géométrie et le drapeau de dureté de
/// chaque arête, la seule marque de lissage qu'un `.ma` porte — lisse d'un bout à l'autre d'une
/// arête douce, coupé sur une arête dure.
pub(super) const NORMALS_COMPUTED: &str = "ma-normals-computed";
/// Un groupe de faces d'un `instObjGroups` dont la liste de composants ne désigne pas des faces.
pub(super) const FACE_MATERIAL_INVALID: &str = "ma-face-material-invalid";
/// Des faces qu'aucun `shadingGroup` ne réclame, alors que d'autres faces du même maillage sont
/// liées : elles sortent dans une primitive sans matériau plutôt que d'être jetées.
pub(super) const FACE_MATERIAL_MISSING: &str = "ma-face-material-missing";
/// Un nuanceur lié à une surface hors des quatre que ce pilote convertit.
pub(super) const MATERIAL_UNSUPPORTED: &str = "ma-material-unsupported";
/// Une transparence de couleur dont les trois canaux diffèrent : glTF n'a qu'un alpha, et c'est
/// leur moyenne qui est portée plutôt qu'un canal choisi au hasard.
pub(super) const TRANSPARENCY_COLOUR: &str = "ma-transparency-colour-unsupported";
/// Une émission au-delà de un, que `emissiveFactor` ne porte pas : elle est ramenée et comptée.
pub(super) const EMISSION_CLAMPED: &str = "ma-emission-clamped";
/// Un `bump2d` en relief de hauteur (`bumpInterp` 0) : glTF ne porte pas de carte de hauteur, et la
/// prendre pour une carte de normales éclairerait la surface par une image qui n'en dit pas
/// l'orientation. Le relief est compté, la surface reste sans `normalTexture`.
pub(super) const BUMP_HEIGHT: &str = "ma-bump-height-unsupported";
/// Un `bump2d` en normales d'espace objet (`bumpInterp` 2) : `normalTexture` de glTF est lue en
/// espace tangent, et convertir demanderait la pose de la surface au moment du rendu.
pub(super) const BUMP_OBJECT: &str = "ma-bump-object-space-unsupported";
/// Un `place2dTexture` qui déplace le placage — répétition, décalage, rotation : `KHR_texture_transform`
/// le porterait, et l'écrivain glTF de ce dépôt ne déclare pas cette extension.
pub(super) const TEXTURE_TRANSFORM: &str = "ma-texture-transform-unsupported";
/// Un `place2dTexture` qui renvoie la texture en miroir (`mirrorU`, `mirrorV`) : aucun mode de
/// répétition de glTF ne fait ce pliage.
pub(super) const TEXTURE_MIRROR: &str = "ma-texture-mirror-unsupported";
/// Une texture dont le fichier est absent, hors du dossier de la source, ou d'un format que le
/// registre d'images ne lit pas.
pub(super) const TEXTURE_MISSING: &str = "ma-texture-missing";
/// Une texture que ce pilote n'accroche pas telle quelle : entrée branchée sur un calcul, carte de
/// métal ou de rugosité seule, ou opacité venant d'une autre image que la couleur de base.
pub(super) const TEXTURE_UNSUPPORTED: &str = "ma-texture-unsupported";

/// Le nœud porte-t-il la transformation d'une branche de la hiérarchie ? Seul `transform` est lu :
/// un `joint` ou un `ikHandle` porte d'autres attributs d'orientation, que ce pilote ne lit pas, et
/// le prendre pour un `transform` trahirait sa pose. Il est donc compté.
pub(super) fn is_transform(kind: &str) -> bool {
    kind == "transform"
}

/// Le nœud décrit-il une surface polygonale ?
pub(super) fn is_mesh(kind: &str) -> bool {
    kind == "mesh"
}

/// Le nœud décrit-il un nuanceur de surface que ce pilote convertit ?
pub(super) fn is_shader(kind: &str) -> bool {
    matches!(kind, "lambert" | "phong" | "blinn" | "standardSurface")
}
