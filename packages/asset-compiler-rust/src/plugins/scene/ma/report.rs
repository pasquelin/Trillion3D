//! Names of everything this driver does not yield, and the classification of node types.
//!
//! None of these refusals is a compilation failure: a camera, a script or a NURBS surface in the
//! middle of a scene must not prevent seeing its walls. They are counted, published in the
//! manifest's `unsupported`, and the report says how many times each was met. A scene that,
//! after all that, carries no surface is refused, itself, by `IMPORT_EMPTY`.

/// A command outside the subset that is read. The command name follows the colon: nothing is
/// executed, and the report says exactly what the file asked for.
pub(super) const COMMAND_IGNORED: &str = "ma-command-ignored";
/// A node type this driver does not convert — camera, light, NURBS surface, skeleton, script
/// node, tool node. The type follows the colon.
pub(super) const NODE_IGNORED: &str = "ma-node-ignored";
/// A `setAttr` with no node to apply it to: no `createNode` or `select` preceded it, or the
/// selected name is not a node of this file.
pub(super) const ATTRIBUTE_UNATTACHED: &str = "ma-attribute-unattached";
/// A `setAttr` whose values do not fall on its index range, whose type is not read, or whose
/// rank exceeds the driver's element ceiling.
pub(super) const ATTRIBUTE_INVALID: &str = "ma-attribute-invalid";
/// A `parent` command this driver does not replay: it does not cite a known meshed shape and
/// transform, or it removes instead of adding.
pub(super) const PARENT_UNSUPPORTED: &str = "ma-parent-unsupported";
/// A node name the file writes without a path while several nodes carry it: Maya would have
/// required the full path. It is the first written node that matches, and the mismatch is counted.
pub(super) const NAME_AMBIGUOUS: &str = "ma-name-ambiguous";
/// A `transform` node whose numbers are not finite: it stays at identity.
pub(super) const TRANSFORM_INVALID: &str = "ma-transform-invalid";
/// A hierarchy deeper than this driver walks, a circular parent chain included: the branch is
/// cut there, without overflowing the stack.
pub(super) const HIERARCHY_TOO_DEEP: &str = "ma-hierarchy-too-deep";
/// A matrix written otherwise than by its sixteen numbers — the long `xform` form of `setAttr`:
/// it is not guessed, and the node keeps the pose its other attributes give it.
pub(super) const MATRIX_UNSUPPORTED: &str = "ma-matrix-unsupported";
/// An intermediate shape: the input of a construction history, which Maya never displays.
pub(super) const SHAPE_INTERMEDIATE: &str = "ma-shape-intermediate";
/// A mesh whose tables contradict each other: corner outside the edge table, edge outside the
/// vertex table, or `.vt` missing.
pub(super) const MESH_INVALID: &str = "ma-mesh-invalid";
/// A mesh that yields no triangle: no face, or all degenerate.
pub(super) const MESH_EMPTY: &str = "ma-mesh-empty";
/// A face of fewer than three corners: nothing to triangulate.
pub(super) const DEGENERATE_FACE: &str = "ma-degenerate-face";
/// A face declares a hole. A fan from its first corner would fill it, so the face is left: the
/// silhouette of a hole is not guessed.
pub(super) const FACE_HOLE: &str = "ma-face-hole-unsupported";
/// A face that ear clipping could not cut entirely: a self-intersecting polygon, or with no
/// plane — corners all colinear, zero area. It comes out as a fan from its first corner, which
/// may fill it beyond its silhouette, and that is what this count says.
pub(super) const NGON_UNCUT: &str = "ma-ngon-untriangulable";
/// A `.fc` record outside those the documentation describes.
pub(super) const FACE_RECORD_IGNORED: &str = "ma-face-record-ignored";
/// A face record that the writing does not hang onto any face.
pub(super) const FACE_INVALID: &str = "ma-face-record-invalid";
/// Texture coordinates dropped: `mu` without a face, UV set beyond the first, or rank outside
/// the `.uvst[0].uvsp` table.
pub(super) const UV_DROPPED: &str = "ma-uv-dropped";
/// Normals dropped: `.n` counts neither one vector per vertex nor one per face corner.
pub(super) const NORMALS_DROPPED: &str = "ma-normals-dropped";
/// No written normals: they are computed from geometry and each edge's hardness flag, the only
/// smoothing mark a `.ma` carries — smooth from one end of a soft edge to the other, cut on a
/// hard edge.
pub(super) const NORMALS_COMPUTED: &str = "ma-normals-computed";
/// A face group of an `instObjGroups` whose component list does not name faces.
pub(super) const FACE_MATERIAL_INVALID: &str = "ma-face-material-invalid";
/// Faces that no `shadingGroup` claims, while other faces of the same mesh are bound: they come
/// out in a primitive without a material rather than being thrown away.
pub(super) const FACE_MATERIAL_MISSING: &str = "ma-face-material-missing";
/// A shader bound to a surface outside the four this driver converts.
pub(super) const MATERIAL_UNSUPPORTED: &str = "ma-material-unsupported";
/// A colour transparency whose three channels differ: glTF has only one alpha, and it is their
/// mean that is carried rather than a channel picked at random.
pub(super) const TRANSPARENCY_COLOUR: &str = "ma-transparency-colour-unsupported";
/// An emission beyond one, which `emissiveFactor` does not carry: it is clamped and counted.
pub(super) const EMISSION_CLAMPED: &str = "ma-emission-clamped";
/// A `bump2d` in height bump (`bumpInterp` 0): glTF carries no height map, and taking it for a
/// normal map would light the surface from an image that does not say its orientation. The bump
/// is counted, the surface stays without `normalTexture`.
pub(super) const BUMP_HEIGHT: &str = "ma-bump-height-unsupported";
/// A `bump2d` in object-space normals (`bumpInterp` 2): glTF's `normalTexture` is read in
/// tangent space, and converting would need the surface pose at render time.
pub(super) const BUMP_OBJECT: &str = "ma-bump-object-space-unsupported";
/// A `place2dTexture` that moves the mapping — repeat, offset, rotation: `KHR_texture_transform`
/// would carry it, and this repository's glTF writer does not declare that extension.
pub(super) const TEXTURE_TRANSFORM: &str = "ma-texture-transform-unsupported";
/// A `place2dTexture` that mirrors the texture (`mirrorU`, `mirrorV`): no glTF wrap mode does
/// that folding.
pub(super) const TEXTURE_MIRROR: &str = "ma-texture-mirror-unsupported";
/// A texture whose file is missing, outside the source directory, or of a format the image
/// registry does not read.
pub(super) const TEXTURE_MISSING: &str = "ma-texture-missing";
/// A texture this driver does not hang as-is: an input wired onto a computation, a metal or
/// roughness map alone, or opacity coming from an image other than the base colour.
pub(super) const TEXTURE_UNSUPPORTED: &str = "ma-texture-unsupported";

/// Does the node carry the transform of a hierarchy branch? Only `transform` is read: a `joint`
/// or an `ikHandle` carries other orientation attributes, which this driver does not read, and
/// taking it for a `transform` would betray its pose. It is therefore counted.
pub(super) fn is_transform(kind: &str) -> bool {
    kind == "transform"
}

/// Does the node describe a polygonal surface?
pub(super) fn is_mesh(kind: &str) -> bool {
    kind == "mesh"
}

/// Does the node describe a surface shader this driver converts?
pub(super) fn is_shader(kind: &str) -> bool {
    matches!(kind, "lambert" | "phong" | "blinn" | "standardSurface")
}
