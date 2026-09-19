//! Walk of the composed scene: a prim, its glTF node, its descendants.
//!
//! An `instanceable` prim does not hide its children: composition presents them as proxies of
//! its prototype, and each knows which prim of the prototype it comes from. It is that prim
//! that names the data, so two instances of the same prototype cite the same glTF mesh without
//! walking the prototype separately.
use super::*;

/// Maximum depth of a hierarchy, unfolded instances included.
const MAX_DEPTH: usize = 64;
/// The only `visibility` value that removes a prim from the scene; the other, `inherited`,
/// leaves it in.
const INVISIBLE: &str = "invisible";

/// glTF node of a prim and its descendants, or nothing when it carries neither surface nor
/// light. `scale` is the world scale accumulated up to the parent, `metersPerUnit` included: a
/// length read on this prim — a light's radius — is written in metres by going through it.
pub(super) fn visit(
    world: &mut World<'_>,
    prim: &usd::Prim,
    depth: usize,
    scale: f64,
) -> Option<usize> {
    if depth > MAX_DEPTH {
        world.refuse(world::XFORM_UNSUPPORTED);
        return None;
    }
    world.check()?;
    if !prim.is_active().unwrap_or(true) {
        world.count("inactive", 1);
        return None;
    }
    // An abstract prim — a `class` — is a template others inherit from, not a scene surface:
    // composing it a second time at its template place would make it appear twice.
    if prim.is_abstract().unwrap_or(false) {
        world.count("abstract", 1);
        return None;
    }
    let type_name = prim.type_name().ok().flatten();
    let type_name = type_name.as_ref().map_or("", |name| name.as_str());
    if let Some(reason) = world::refusal(type_name) {
        world.refuse(reason);
        return None;
    }
    if type_name == "GeomSubset" {
        return None;
    }
    if invisible(world, prim) {
        world.count("invisible", 1);
        return None;
    }
    report(world, prim);
    node(world, prim, type_name, (depth, scale))
}

/// Is this prim a light? Every `UsdLux` schema names its type that way, filters included:
/// `light::build` converts those it knows how to yield and counts the others.
fn is_light(type_name: &str) -> bool {
    type_name.ends_with("Light") || type_name.ends_with("LightFilter")
}

/// Is this prim declared invisible? `visibility` takes only two values, and USD inherits it: a
/// descendant never comes back to visible under an invisible prim, so the walk stops there and
/// the whole branch leaves the scene.
fn invisible(world: &mut World<'_>, prim: &usd::Prim) -> bool {
    let Some((value, sampled)) = read::first(&prim.attribute("visibility")) else {
        return false;
    };
    if sampled {
        world.refuse(world::TIME_SAMPLE);
    }
    read::text(&value).as_deref() == Some(INVISIBLE)
}

/// What this prim brings to the report without changing the scene.
fn report(world: &mut World<'_>, prim: &usd::Prim) {
    if layer::variants(world, prim) {
        world.refuse(world::VARIANTS);
    }
    let unresolved = layer::unresolved(world, prim);
    world.scene.report.add_count(world::COMPOSITION, unresolved);
}

/// Node of this prim, with its local transform, what it carries and its children.
fn node(
    world: &mut World<'_>,
    prim: &usd::Prim,
    type_name: &str,
    (depth, scale): (usize, f64),
) -> Option<usize> {
    let mut node = json!({ "name": prim.path().name().unwrap_or("Prim") });
    let local = xform::local(world, prim);
    if local != matrix::IDENTITY {
        node["matrix"] = json!(local);
    }
    let scale = scale * matrix::uniform_scale(&local);
    if type_name == "Mesh" {
        if let Some(mesh) = mesh::build(world, prim, &data_key(prim)) {
            node["mesh"] = json!(mesh);
            world.count("meshInstances", 1);
        }
    }
    if is_light(type_name) {
        if let Some(light) = light::build(world, prim, type_name, scale) {
            node["extensions"] = crate::import::light_extension(light);
        }
    }
    let children: Vec<usize> = prim
        .children()
        .unwrap_or_default()
        .iter()
        .filter_map(|child| visit(world, child, depth + 1, scale))
        .collect();
    if node.get("mesh").is_none() && node.get("extensions").is_none() && children.is_empty() {
        return None;
    }
    if !children.is_empty() {
        node["children"] = json!(children);
    }
    Some(world.scene.node(node))
}

/// Path that identifies a prim's data: the one it occupies in the prototype when it is reached
/// through an instance, its own otherwise. That is what makes a mesh shared.
fn data_key(prim: &usd::Prim) -> String {
    prim.prim_in_prototype().ok().flatten().map_or_else(
        || prim.path().as_str().to_string(),
        |inner| inner.path().as_str().to_string(),
    )
}
