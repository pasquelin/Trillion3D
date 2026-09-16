//! Le corps émissif lié à une lampe, et le rayon qu'il mesure.
//!
//! Le lien est la parenté du graphe, jamais un nom ni une classe d'objet : le nœud parent de la
//! lampe, ou l'un de ses frères directs, porte le maillage du luminaire. L'émission se lit sur le
//! matériau — facteur ou texture — et sur lui seul, si bien que n'importe quelle scène importée
//! donne le même verdict. Le corps est parcouru sommet par sommet et non par son emprise : celle
//! d'une sphère déborde d'un facteur racine de trois, et exclurait des occultants que l'enveloppe
//! ne contient pas — exactement ce que `docs/SDK.md` reproche au plan proche.
use super::*;
use crate::compiler_accessor_create::accessor;
use crate::compiler_world::transform_point;

/// Le rayon de l'enveloppe autour de `centre`, si un corps émissif est lié à la lampe du nœud.
/// Plusieurs corps liés à la même lampe : la sphère la plus serrée l'emporte, parce qu'exclure
/// au-delà de l'enveloppe rejette des occultants qu'elle n'a jamais contenus.
pub(super) fn radius(e: &Emitter, node: usize, centre: [f64; 3]) -> Option<f64> {
    bound_nodes(e, node)
        .into_iter()
        .filter_map(|candidate| reach(e, candidate, centre))
        .fold(None, |best: Option<f64>, value| {
            Some(best.map_or(value, |best| best.min(value)))
        })
}

/// Les nœuds qui peuvent porter l'enveloppe : le parent de la lampe et ses frères directs. Une
/// lampe sans parent a pour frères les autres racines de la scène.
fn bound_nodes(e: &Emitter, node: usize) -> Vec<usize> {
    let parent = e.parents[node];
    let siblings = (0..e.parents.len()).filter(|id| e.parents[*id] == parent);
    parent
        .into_iter()
        .chain(siblings)
        .filter(|id| *id != node)
        .collect()
}

/// La distance la plus grande de `centre` à un sommet du corps émissif que ce nœud porte, en espace
/// monde. `None` quand le nœud ne porte pas de maillage, qu'aucun de ses matériaux n'émet, ou que
/// les positions ne se lisent pas : une lampe sans enveloppe lisible n'en déclare aucune.
fn reach(e: &Emitter, node: usize, centre: [f64; 3]) -> Option<f64> {
    let mesh = e.g.pointer("/nodes")?.get(node)?.get("mesh")?.as_u64()?;
    let materials = e.g.get("materials").and_then(Value::as_array);
    let mut farthest: Option<f64> = None;
    for primitive in
        e.g.pointer("/meshes")?
            .get(mesh as usize)?
            .get("primitives")?
            .as_array()?
    {
        let material = primitive.get("material").and_then(Value::as_u64);
        let material = materials.and_then(|list| list.get(material? as usize));
        if !material.is_some_and(emits) {
            continue;
        }
        let id = primitive.pointer("/attributes/POSITION")?.as_u64()? as usize;
        let points = accessor(e.g, e.bin, id, None).ok()?.collect_f32().ok()?;
        for point in points.as_chunks::<3>().0 {
            let world = transform_point(
                &e.world[node],
                [point[0] as f64, point[1] as f64, point[2] as f64],
            );
            let spread: f64 = (0..3).map(|k| (world[k] - centre[k]).powi(2)).sum();
            let distance = spread.sqrt();
            farthest = Some(farthest.map_or(distance, |best: f64| best.max(distance)));
        }
    }
    farthest
}

/// Un matériau émet quand son facteur d'émission n'est pas nul ou qu'il porte une texture
/// d'émission. C'est une propriété de matériau, la seule chose que le compilateur regarde ici.
fn emits(material: &Value) -> bool {
    let factor = material
        .get("emissiveFactor")
        .and_then(Value::as_array)
        .is_some_and(|channels| {
            channels
                .iter()
                .filter_map(Value::as_f64)
                .any(|channel| channel > 0.0)
        });
    factor || material.pointer("/emissiveTexture/index").is_some()
}
