//! Le parcours de la scène composée : un prim, son nœud glTF, sa descendance.
//!
//! Un prim `instanceable` ne cache pas ses enfants : la composition les présente comme des mandataires
//! de son prototype, et chacun sait de quel prim du prototype il vient. C'est ce prim-là qui nomme
//! la donnée, donc deux instances d'un même prototype citent le même maillage glTF sans qu'on ait à
//! parcourir le prototype à part.
use super::*;

/// Profondeur maximale d'une hiérarchie, instances dépliées comprises.
const MAX_DEPTH: usize = 64;

/// Le nœud glTF d'un prim et de sa descendance, ou rien quand il ne porte aucune surface.
pub(super) fn visit(world: &mut World<'_>, prim: &usd::Prim, depth: usize) -> Option<usize> {
    if depth > MAX_DEPTH {
        world.refuse(world::XFORM_UNSUPPORTED);
        return None;
    }
    world.check()?;
    if !prim.is_active().unwrap_or(true) {
        world.count("inactive", 1);
        return None;
    }
    // Un prim abstrait — une `class` — est un gabarit dont d'autres héritent, pas une surface de la
    // scène : le composer une seconde fois à sa place de gabarit le ferait apparaître deux fois.
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
    report(world, prim);
    node(world, prim, type_name, depth)
}

/// Ce que ce prim apporte au rapport sans changer la scène.
fn report(world: &mut World<'_>, prim: &usd::Prim) {
    if layer::variants(world, prim) {
        world.refuse(world::VARIANTS);
    }
    let unresolved = layer::unresolved(world, prim);
    world.scene.report.add_count(world::COMPOSITION, unresolved);
}

/// Le nœud de ce prim, avec sa transformation locale, son maillage et ses enfants.
fn node(world: &mut World<'_>, prim: &usd::Prim, type_name: &str, depth: usize) -> Option<usize> {
    let mut node = json!({ "name": prim.path().name().unwrap_or("Prim") });
    let local = xform::local(world, prim);
    if local != matrix::IDENTITY {
        node["matrix"] = json!(local);
    }
    if type_name == "Mesh" {
        if let Some(mesh) = mesh::build(world, prim, &data_key(prim)) {
            node["mesh"] = json!(mesh);
            world.count("meshInstances", 1);
        }
    }
    let children: Vec<usize> = prim
        .children()
        .unwrap_or_default()
        .iter()
        .filter_map(|child| visit(world, child, depth + 1))
        .collect();
    if node.get("mesh").is_none() && children.is_empty() {
        return None;
    }
    if !children.is_empty() {
        node["children"] = json!(children);
    }
    Some(world.scene.node(node))
}

/// Le chemin qui identifie la donnée d'un prim : celui qu'il occupe dans le prototype quand il est
/// atteint à travers une instance, le sien sinon. C'est lui qui fait qu'un maillage est partagé.
fn data_key(prim: &usd::Prim) -> String {
    prim.prim_in_prototype().ok().flatten().map_or_else(
        || prim.path().as_str().to_string(),
        |inner| inner.path().as_str().to_string(),
    )
}
