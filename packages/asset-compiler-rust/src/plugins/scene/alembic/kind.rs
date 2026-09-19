//! What an Alembic object is, from the schema its metadata declares.
//!
//! This driver converts transforms, polygonal meshes, subdivision surfaces — as flat polygons —
//! and face sets. Everything else carries here the name under which it will be counted.
use super::archive::meta_value;

/// What an object is, from the schema its metadata declares.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub(super) enum Kind {
    Xform,
    Mesh,
    /// A subdivision surface, rendered as the flat polygons it carries.
    SubD,
    FaceSet,
    /// An object this driver does not convert, counted on the report under this name.
    Skipped(&'static str),
}

/// The schema of a metadata string, as Alembic writes it.
pub(super) fn kind_of(meta: &str) -> Kind {
    if meta_value(meta, "isInstance") == Some("1") {
        return Kind::Skipped("alembic-instance-unsupported");
    }
    let schema = meta_value(meta, "schema")
        .or_else(|| meta_value(meta, "schemaObjTitle"))
        .unwrap_or_default();
    for (prefix, kind) in [
        ("AbcGeom_Xform", Kind::Xform),
        ("AbcGeom_PolyMesh", Kind::Mesh),
        ("AbcGeom_SubD", Kind::SubD),
        ("AbcGeom_FaceSet", Kind::FaceSet),
        ("AbcGeom_Curve", Kind::Skipped("alembic-curves-unsupported")),
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
            Kind::Skipped("alembic-camera-unsupported"),
        ),
        ("AbcGeom_Light", Kind::Skipped("alembic-light-unsupported")),
    ] {
        if schema.starts_with(prefix) {
            return kind;
        }
    }
    Kind::Skipped("alembic-object-unsupported")
}
