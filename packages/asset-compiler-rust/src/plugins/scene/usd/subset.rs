//! Le découpage d'un `Mesh` en parties par matériau.
//!
//! USD lie un matériau à toute la surface par `material:binding`, et en lie d'autres à des paquets
//! de faces par des `GeomSubset` de la famille `materialBind`. Une partie devient une primitive
//! glTF : même géométrie, un matériau chacune. Les faces qu'aucun sous-ensemble ne réclame
//! reviennent à la liaison du maillage, ce que dit la spécification pour une famille partielle.
use super::*;

/// Le nom de la famille de sous-ensembles qui lie les matériaux.
const FAMILY: &str = "materialBind";
/// La relation qui lie un matériau à un prim et à sa descendance.
const BINDING: &str = "material:binding";
/// La métadonnée qui donne sa force à une liaison, et la seule valeur qui la rend plus forte que
/// les liaisons de la descendance du prim qui la porte.
const STRENGTH: &str = "bindMaterialAs";
const STRONGER: &str = "strongerThanDescendants";

/// Une partie du maillage : son matériau, et les faces qu'elle porte.
pub(super) struct Part {
    pub(super) material: Option<usize>,
    pub(super) faces: Vec<usize>,
}

/// Le découpage d'un maillage, dans l'ordre où les sous-ensembles sont déclarés, la part du
/// maillage lui-même venant en dernier quand il en reste des faces.
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

/// Les faces d'un `GeomSubset` de la famille des matériaux, ou `None` pour tout autre enfant — un
/// sous-ensemble d'une autre famille, un sous-ensemble de points ou d'arêtes, un prim quelconque.
/// Un indice hors du maillage est écarté : il ne désigne aucune face.
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

/// Le matériau que ce prim reçoit. `material:binding` se résout en remontant les ancêtres et la
/// liaison la plus proche gagne : un `GeomSubset` qui n'en déclare pas prend celle de son maillage,
/// et un maillage celle du groupe qui le porte. Une liaison déclarée plus forte que sa descendance
/// l'emporte sur celles d'en dessous, et la plus haute de celles-là sur les autres.
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
    material::resolve(world, &strongest.or(nearest)?, double_sided)
}

/// La cible de `material:binding` écrite sur ce prim, sans rien hériter.
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

/// Cette liaison est-elle déclarée plus forte que celles de sa descendance ?
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

/// Un attribut de ce prim lu en texte.
fn attribute_text(prim: &usd::Prim, name: &str) -> Option<String> {
    let (value, _) = read::first(&prim.attribute(name))?;
    read::text(&value)
}
