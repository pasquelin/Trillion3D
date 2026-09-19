//! Radius of the envelope surrounding a light: where it comes from, and what the contract accepts.
//!
//! A real light sits in something — glass, a reflector, a lampshade — and this
//! envelope is geometry like any other: it enters its own light's shadow map
//! and darkens it.  () declares the radius of the sphere that
//! this light, and only this light, stops shadowing. Two origins, in this order: the radius that the
//! source declares on the light, otherwise the radius measured by the emissive body linked to the light.
use super::*;
use crate::compiler_world::Mat4;

mod envelope;

/// The radius comes from the emissive body linked to the light, not from the source file: counted under this name
/// so the report tells where the written value came from.
const DERIVED: &str = "light-emitter-radius-derived";
/// A radius failing the contract — non-finite, zero, negative, or beyond range — is
/// counted under this name and the field remains absent: an envelope larger than range is no longer
/// an envelope, and excluding beyond range would reject shadow casters that the envelope does not contain.
const INVALID: &str = "light-emitter-radius-invalid";

/// What is needed from the scene to measure an envelope: the document, its bytes, the pose of
/// each node, and the parent of each — the envelope is linked to its light through parentage.
pub(super) struct Emitter<'a> {
    g: &'a Value,
    bin: &'a [u8],
    world: &'a [Mat4],
    parents: Vec<Option<usize>>,
}

impl<'a> Emitter<'a> {
    pub(super) fn new(g: &'a Value, bin: &'a [u8], world: &'a [Mat4]) -> Result<Self> {
        let nodes = values(g, "nodes")?;
        let mut parents = vec![None; nodes.len()];
        for id in 0..nodes.len() {
            for child in crate::compiler_nodes::children_of(nodes, id)? {
                parents[child] = Some(id);
            }
        }
        Ok(Self {
            g,
            bin,
            world,
            parents,
        })
    }

    /// Writes  on an already converted light, when the scene provides one satisfying
    /// the contract. A directional light has neither position nor range: the field is refused without count,
    /// since no sphere can sit around a light source having no center.
    pub(super) fn attach(&self, entry: &mut Value, light: &Value, node: usize, counts: &mut Tally) {
        let (Some(range), Some(centre)) =
            (entry.get("range").and_then(Value::as_f64), centre_of(entry))
        else {
            return;
        };
        let (radius, code) = match declared(light) {
            Some(radius) => (radius, None),
            None => match envelope::radius(self, node, centre) {
                Some(radius) => (radius, Some(DERIVED)),
                None => return,
            },
        };
        if !(radius.is_finite() && radius > 0.0 && radius < range) {
            *counts.entry(INVALID).or_insert(0) += 1;
            return;
        }
        entry["emitterRadius"] = json!(radius);
        if let Some(code) = code {
            *counts.entry(code).or_insert(0) += 1;
        }
    }
}

/// The radius declared by the source on the light itself. It travels in the light's ,
/// the channel that  already uses: a format whose light carries a radius puts it there, and
/// no second channel is opened for it. Its value is in meters, like the rest of the scene.
fn declared(light: &Value) -> Option<f64> {
    light
        .pointer("/extras/emitterRadius")
        .and_then(Value::as_f64)
}

/// Center of the light, as just written by conversion in world space.
fn centre_of(entry: &Value) -> Option<[f64; 3]> {
    let items = entry.get("position")?.as_array()?;
    let axis = |i: usize| items.get(i)?.as_f64();
    Some([axis(0)?, axis(1)?, axis(2)?])
}
