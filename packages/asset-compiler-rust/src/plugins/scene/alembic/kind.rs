//! Ce qu un objet Alembic est, d après le schéma que sa métadonnée déclare.
//!
//! Ce pilote convertit les transformations, les maillages polygonaux, les surfaces de subdivision —
//! en polygones plats — et les face sets. Tout le reste porte ici le nom sous lequel il sera compté.
use super::archive::meta_value;

/// Ce qu'un objet est, d'après le schéma que sa métadonnée déclare.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub(super) enum Kind {
    Xform,
    Mesh,
    /// Une surface de subdivision, rendue comme les polygones plats qu'elle porte.
    SubD,
    FaceSet,
    /// Un objet que ce pilote ne convertit pas, compté au rapport sous ce nom.
    Skipped(&'static str),
}

/// Le schéma d'une métadonnée, tel qu'Alembic l'écrit.
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
