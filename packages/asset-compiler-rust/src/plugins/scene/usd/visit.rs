//! Le parcours de la scène composée : un prim, son nœud glTF, sa descendance.
//!
//! Un prim `instanceable` ne cache pas ses enfants : la composition les présente comme des mandataires
//! de son prototype, et chacun sait de quel prim du prototype il vient. C'est ce prim-là qui nomme
//! la donnée, donc deux instances d'un même prototype citent le même maillage glTF sans qu'on ait à
//! parcourir le prototype à part.
use super::*;

/// Profondeur maximale d'une hiérarchie, instances dépliées comprises.
const MAX_DEPTH: usize = 64;
/// La seule valeur de `visibility` qui retire un prim de la scène ; l'autre, `inherited`, l'y laisse.
const INVISIBLE: &str = "invisible";

/// Le nœud glTF d'un prim et de sa descendance, ou rien quand il ne porte ni surface ni lampe.
/// `scale` est l'échelle du monde accumulée jusqu'au père, `metersPerUnit` compris : une longueur
/// lue sur ce prim — le rayon d'une lampe — s'écrit en mètres en passant par elle.
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
    if invisible(world, prim) {
        world.count("invisible", 1);
        return None;
    }
    report(world, prim);
    node(world, prim, type_name, (depth, scale))
}

/// Ce prim est-il une lampe ? Tous les schémas de `UsdLux` nomment ainsi leur type, y compris les
/// filtres : `light::build` convertit ceux qu'il sait rendre et compte les autres.
fn is_light(type_name: &str) -> bool {
    type_name.ends_with("Light") || type_name.ends_with("LightFilter")
}

/// Ce prim est-il déclaré invisible ? `visibility` ne prend que deux valeurs, et USD l'hérite :
/// une descendance ne revient jamais au visible sous un prim invisible, donc le parcours s'arrête
/// là et la branche entière sort de la scène.
fn invisible(world: &mut World<'_>, prim: &usd::Prim) -> bool {
    let Some((value, sampled)) = read::first(&prim.attribute("visibility")) else {
        return false;
    };
    if sampled {
        world.refuse(world::TIME_SAMPLE);
    }
    read::text(&value).as_deref() == Some(INVISIBLE)
}

/// Ce que ce prim apporte au rapport sans changer la scène.
fn report(world: &mut World<'_>, prim: &usd::Prim) {
    if layer::variants(world, prim) {
        world.refuse(world::VARIANTS);
    }
    let unresolved = layer::unresolved(world, prim);
    world.scene.report.add_count(world::COMPOSITION, unresolved);
}

/// Le nœud de ce prim, avec sa transformation locale, ce qu'il porte et ses enfants.
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

/// Le chemin qui identifie la donnée d'un prim : celui qu'il occupe dans le prototype quand il est
/// atteint à travers une instance, le sien sinon. C'est lui qui fait qu'un maillage est partagé.
fn data_key(prim: &usd::Prim) -> String {
    prim.prim_in_prototype().ok().flatten().map_or_else(
        || prim.path().as_str().to_string(),
        |inner| inner.path().as_str().to_string(),
    )
}
