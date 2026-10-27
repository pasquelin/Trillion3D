//! What an Alembic object is, from the schema its metadata declares.
//!
//! This driver converts transforms, polygonal meshes, subdivision surfaces — as flat polygons —,
//! face sets and curves — the strands of a groom. Everything else carries here the name under which
//! it will be counted. An instance by reference is converted only when it is a curves object: the
//! instance stands where it is and shares the group of its source, so its curves are read in place,
//! once for each instance. Instances of any other object are counted.
use super::archive::meta_value;

/// What an object is, from the schema its metadata declares.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub(super) enum Kind {
    Xform,
    Mesh,
    /// A subdivision surface, rendered as the flat polygons it carries.
    SubD,
    FaceSet,
    /// Curves, read as the strands of a groom (`curves.rs`).
    Curves,
    /// An object this driver does not convert, counted on the report under this name.
    Skipped(&'static str),
}

/// The schema of a metadata string, as Alembic writes it.
pub(super) fn kind_of(meta: &str) -> Kind {
    let schema = meta_value(meta, "schema")
        .or_else(|| meta_value(meta, "schemaObjTitle"))
        .unwrap_or_default();
    let kind = SCHEMAS
        .iter()
        .find(|(prefix, _)| schema.starts_with(prefix))
        .map_or(Kind::Skipped("alembic-object-unsupported"), |(_, kind)| {
            *kind
        });
    match meta_value(meta, "isInstance") == Some("1") && kind != Kind::Curves {
        true => Kind::Skipped("alembic-instance-unsupported"),
        false => kind,
    }
}

/// The kind each schema prefix names.
const SCHEMAS: [(&str, Kind); 9] = [
    ("AbcGeom_Xform", Kind::Xform),
    ("AbcGeom_PolyMesh", Kind::Mesh),
    ("AbcGeom_SubD", Kind::SubD),
    ("AbcGeom_FaceSet", Kind::FaceSet),
    ("AbcGeom_Curve", Kind::Curves),
    (
        "AbcGeom_Points",
        Kind::Skipped("alembic-points-unsupported"),
    ),
    (
        "AbcGeom_NuPatch",
        Kind::Skipped("alembic-nupatch-unsupported"),
    ),
    (
        "AbcGeom_Camera",
        Kind::Skipped(crate::plugins::scene::codes::CAMERA_UNSUPPORTED),
    ),
    (
        "AbcGeom_Light",
        Kind::Skipped(crate::plugins::scene::codes::LIGHT_UNSUPPORTED),
    ),
];
