//! Splitting a `Mesh` into parts by material.
//!
//! USD binds a material to the whole surface by `material:binding`, and binds others to packs of
//! faces by `GeomSubset` of the `materialBind` family. A part becomes a glTF primitive: same
//! geometry, one material each. Faces no subset claims go back to the mesh binding, which is
//! what the specification says for a partial family.
use super::*;

/// Name of the subset family that binds materials.
const FAMILY: &str = "materialBind";
/// Relationship that binds a material to a prim and its descendants.
const BINDING: &str = "material:binding";
/// Metadata that gives a binding its strength, and the only value that makes it stronger than
/// the bindings of the descendants of the prim that carries it.
const STRENGTH: &str = "bindMaterialAs";
const STRONGER: &str = "strongerThanDescendants";

/// A mesh part: its material, and the faces it carries.
pub(super) struct Part {
    pub(super) material: Option<usize>,
    pub(super) faces: Vec<usize>,
}

/// Split of a mesh, in the order subsets are declared, the mesh's own share coming last when
/// faces remain.
pub(super) fn parts(
    world: &mut World<'_>,
    prim: &usd::Prim,
    faces: usize,
    double_sided: bool,
) -> Vec<Part> {
    let mut out = Vec::new();
    let mut claimed = vec![false; faces];
    for child in prim.children().unwrap_or_default() {
        let Some(indices) = subset_faces(&child, faces) else {
            continue;
        };
        let material = binding(world, &child, double_sided);
        for face in &indices {
            claimed[*face] = true;
        }
        out.push(Part {
            material,
            faces: indices,
        });
    }
    let rest: Vec<usize> = (0..faces).filter(|face| !claimed[*face]).collect();
    if !rest.is_empty() || out.is_empty() {
        let material = binding(world, prim, double_sided);
        out.push(Part {
            material,
            faces: rest,
        });
    }
    out
}

/// Faces of a `GeomSubset` of the material family, or `None` for any other child — a subset of
/// another family, a subset of points or edges, any prim. An index outside the mesh is dropped:
/// it names no face.
fn subset_faces(prim: &usd::Prim, faces: usize) -> Option<Vec<usize>> {
    if prim.type_name().ok().flatten()?.as_str() != "GeomSubset" {
        return None;
    }
    let family = attribute_text(prim, "familyName");
    let element = attribute_text(prim, "elementType");
    if family.as_deref() != Some(FAMILY) || element.as_deref().unwrap_or("face") != "face" {
        return None;
    }
    let (value, _) = read::first(&prim.attribute("indices"))?;
    Some(
        read::integers(&value)?
            .into_iter()
            .filter_map(|index| usize::try_from(index).ok())
            .filter(|index| *index < faces)
            .collect(),
    )
}

/// Material this prim receives. `material:binding` resolves by walking ancestors and the
/// nearest binding wins: a `GeomSubset` that declares none takes that of its mesh, and a mesh
/// that of the group that carries it. A binding declared stronger than its descendants wins
/// over those below, and the highest of those over the others.
fn binding(world: &mut World<'_>, prim: &usd::Prim, double_sided: bool) -> Option<usize> {
    let mut nearest = None;
    let mut strongest = None;
    for path in prim.path().ancestors_below_root() {
        let Some(target) = bound_at(world, &path) else {
            continue;
        };
        if nearest.is_none() {
            nearest = Some(target.clone());
        }
        if stronger(world, &path) {
            strongest = Some(target);
        }
    }
    match strongest.or(nearest) {
        Some(target) => material::resolve(world, &target, double_sided),
        // Without a material to carry double-sided, both faces would leave the scene.
        None if double_sided => material::double_sided(world),
        None => None,
    }
}

/// Target of `material:binding` written on this prim, inheriting nothing.
fn bound_at(world: &World<'_>, path: &sdf::Path) -> Option<sdf::Path> {
    world
        .stage
        .prim(path.clone())
        .ok()?
        .relationship(BINDING)
        .forwarded_targets()
        .ok()?
        .into_iter()
        .next()
}

/// Is this binding declared stronger than those of its descendants?
fn stronger(world: &World<'_>, path: &sdf::Path) -> bool {
    path.append_property(BINDING)
        .ok()
        .and_then(|property| world.stage.field::<sdf::Value>(property, STRENGTH).ok())
        .flatten()
        .as_ref()
        .and_then(read::text)
        .as_deref()
        == Some(STRONGER)
}

/// An attribute of this prim read as text.
fn attribute_text(prim: &usd::Prim, name: &str) -> Option<String> {
    let (value, _) = read::first(&prim.attribute(name))?;
    read::text(&value)
}
