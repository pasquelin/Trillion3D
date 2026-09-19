//! The emissive body linked to a light, and the radius it measures.
//!
//! The link is graph parentage, never a name nor object class: the light's parent node,
//! or one of its direct siblings, carries the luminaire mesh. Emission is read on the
//! material — factor or texture — and on it alone, so that any imported scene
//! yields the same result. The body is traversed vertex by vertex and not by its bounding box: a sphere's
//! bounding box overflows by a square root of three factor, and would exclude shadow casters that the envelope
//! does not contain — exactly what  reproaches to the near plane.
use super::*;
use crate::compiler_accessor_create::accessor;
use crate::compiler_world::transform_point;

/// Radius of the envelope around , if an emissive body is linked to the node's light.
/// Multiple bodies linked to the same light: the tightest sphere wins, because excluding
/// beyond the envelope rejects shadow casters that it never contained.
pub(super) fn radius(e: &Emitter, node: usize, centre: [f64; 3]) -> Option<f64> {
    bound_nodes(e, node)
        .into_iter()
        .filter_map(|candidate| reach(e, candidate, centre))
        .min_by(f64::total_cmp)
}

/// Nodes that can carry the envelope: the light's parent and its direct siblings. A
/// light without a parent has the scene's other roots as siblings.
fn bound_nodes(e: &Emitter, node: usize) -> Vec<usize> {
    let parent = e.parents[node];
    let siblings = (0..e.parents.len()).filter(|id| e.parents[*id] == parent);
    parent
        .into_iter()
        .chain(siblings)
        .filter(|id| *id != node)
        .collect()
}

/// Largest distance from  to a vertex of the emissive body carried by this node, in world
/// space.  when the node carries no mesh, none of its materials emit, or
/// positions cannot be read: a light without a readable envelope declares none.
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

/// A material emits when its emission factor is non-zero or it carries an emission
/// texture. This is a material property, the only thing the compiler looks at here.
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
