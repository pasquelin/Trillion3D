//! The scene a bake works on: the world-space triangles of the compiled objects, one instance a
//! node, each triangle with its material's slot. The voxelisation draws the instances whose
//! material is opaque or masked; the paths trace the surfaces behind `proxy::bvh`'s tree
//! (`trace::tracer`), each with the colour and the emission of its material (the factor times the
//! mean of its texture). A blended material lets everything through, a masked one whose factor
//! is under its cutoff too; a surface one side of which is drawn is met from behind as a hole in
//! the sample (`Hit::usable`).
use super::sampling::Vec3;
use crate::compiler::materials::{coverage_cutoff, MaterialFactors};
use crate::compiler::source::node_transform::Mat4;
use crate::texture::TexturePreview;
use crate::trace::tracer::{normal_of, trace, World};
use crate::Result;
use serde_json::Value;
use std::collections::BTreeSet;
use trillion3d_math::matrix::transform_point_f32;
use trillion3d_math::vector::vec3::triple;
use trillion3d_math::vector::vecn::{add, dot, scale};
use trillion3d_page_codec::proxy::bvh;

/// What a surface answers a path with.
#[derive(Clone, Copy)]
struct Surface {
    base: Vec3,
    emission: Vec3,
    two_sided: bool,
}

/// What a ray met.
pub struct Hit {
    pub point: Vec3,
    /// The geometric normal, turned to the side the ray came from.
    pub normal: Vec3,
    pub distance: f64,
    pub base: Vec3,
    /// The emission the surface gives toward the ray.
    pub emission: Vec3,
    /// False for the back of a surface that is drawn on one side only.
    pub usable: bool,
}

/// Everything the scene is read from.
pub struct SceneInputs<'a> {
    pub g: &'a Value,
    pub bin: &'a [u8],
    pub world: &'a [Mat4],
    pub shown: &'a BTreeSet<usize>,
    pub previews: &'a [TexturePreview],
}

/// The triangles of one node.
pub struct Instance {
    /// Three corners of three floats each, in the world.
    pub triangles: Vec<f32>,
    /// The material slot of each triangle.
    pub slots: Vec<u32>,
}

impl Instance {
    /// The box of the instance: lower then upper corner.
    pub fn bounds(&self) -> (Vec3, Vec3) {
        let mut low = [f64::INFINITY; 3];
        let mut high = [f64::NEG_INFINITY; 3];
        for point in self.triangles.as_chunks::<3>().0 {
            for k in 0..3 {
                low[k] = low[k].min(f64::from(point[k]));
                high[k] = high[k].max(f64::from(point[k]));
            }
        }
        (low, high)
    }
}

/// How each material slot is seen: by the paths (none: they pass through) and by the voxelisation.
pub struct Materials {
    surfaces: Vec<Option<Surface>>,
    drawn: Vec<bool>,
}

fn surface_of(material: Option<&Value>, previews: &[TexturePreview]) -> Option<Surface> {
    let Some(material) = material else {
        return Some(Surface {
            base: [1.0; 3],
            emission: [0.0; 3],
            two_sided: false,
        });
    };
    let factors = MaterialFactors::of(material);
    // The engine's own judgement of coverage: a blended material lets everything through, a
    // masked one whose factor is under its cutoff too (its texture's alpha is not read).
    match coverage_cutoff(material) {
        Some(None) => return None,
        Some(Some(cutoff)) if (factors.base_colour[3] as f32) < cutoff => return None,
        _ => {}
    }
    let mean = |slot: &str| {
        let texture = material.pointer(slot)?.as_u64()?;
        crate::proxy::albedo::average(previews, texture)
    };
    let tint = mean("/pbrMetallicRoughness/baseColorTexture/index").unwrap_or([1.0; 3]);
    let glow = mean("/emissiveTexture/index").unwrap_or([1.0; 3]);
    Some(Surface {
        base: std::array::from_fn(|k| factors.base_colour[k] * tint[k]),
        emission: std::array::from_fn(|k| factors.emission[k] * glow[k]),
        two_sided: material.get("doubleSided").and_then(Value::as_bool) == Some(true),
    })
}

impl Materials {
    /// The scene's materials, then the default one glTF gives a primitive that names none.
    pub fn of(inputs: &SceneInputs<'_>) -> Self {
        let declared = inputs.g.get("materials").and_then(Value::as_array);
        let count = declared.map_or(0, Vec::len);
        let slot = |k: usize| declared.and_then(|m| m.get(k));
        Self {
            surfaces: (0..=count)
                .map(|k| surface_of(slot(k), inputs.previews))
                .collect(),
            drawn: (0..=count)
                .map(|k| {
                    slot(k)
                        .is_none_or(|m| m.get("alphaMode").and_then(Value::as_str) != Some("BLEND"))
                })
                .collect(),
        }
    }

    /// Whether the voxelisation draws triangles of `slot`: opaque or masked, whatever the mask.
    pub fn draws(&self, slot: u32) -> bool {
        self.drawn[slot as usize]
    }

    fn default_slot(&self) -> u32 {
        (self.surfaces.len() - 1) as u32
    }
}

/// The linear part of `m` turns a triangle inside out.
fn mirrors(m: &Mat4) -> bool {
    triple([m[0], m[1], m[2]], [m[4], m[5], m[6]], [m[8], m[9], m[10]]) < 0.0
}

fn add_primitive(
    inputs: &SceneInputs<'_>,
    (primitive, matrix, slot): (&Value, &Mat4, u32),
    out: &mut Instance,
) -> Result<()> {
    let (positions, indices, _) =
        crate::compiler::primitive::triangles::read(inputs.g, inputs.bin, primitive, None)?;
    let points = positions.collect_f32()?;
    let corner = |index: u32| {
        let at = index as usize * 3;
        transform_point_f32(matrix, [points[at], points[at + 1], points[at + 2]])
    };
    let order = if mirrors(matrix) {
        [0, 2, 1]
    } else {
        [0, 1, 2]
    };
    for triangle in indices.as_chunks::<3>().0 {
        for k in order {
            out.triangles.extend(corner(triangle[k]));
        }
    }
    out.slots.resize(out.triangles.len() / 9, slot);
    Ok(())
}

/// The instances of the shown nodes, one a node that has a mesh.
pub fn instances(inputs: &SceneInputs<'_>, materials: &Materials) -> Result<Vec<Instance>> {
    let nodes = inputs.g.get("nodes").and_then(Value::as_array);
    let last = materials.default_slot();
    let mut out = Vec::new();
    for &id in inputs.shown {
        let Some(mesh) = nodes.and_then(|n| n.get(id)?.get("mesh")?.as_u64()) else {
            continue;
        };
        let mut instance = Instance {
            triangles: Vec::new(),
            slots: Vec::new(),
        };
        for (_, primitive) in
            crate::compiler::primitive::triangles::mesh_primitives(inputs.g, mesh as usize)?
        {
            let slot = primitive
                .get("material")
                .and_then(Value::as_u64)
                .map_or(last, |m| (m as u32).min(last));
            add_primitive(inputs, (primitive, &inputs.world[id], slot), &mut instance)?;
        }
        if !instance.slots.is_empty() {
            out.push(instance);
        }
    }
    Ok(out)
}

/// The traced scene.
pub struct BakeWorld {
    tracer: World,
    surfaces: Vec<Surface>,
}

impl BakeWorld {
    /// The traced world of `instances`, each freed once its triangles are taken; none when no
    /// surface remains.
    pub fn build(instances: Vec<Instance>, materials: &Materials) -> Option<Self> {
        let mut tracer = World::default();
        for instance in instances {
            for (corners, &slot) in instance
                .triangles
                .as_chunks::<9>()
                .0
                .iter()
                .zip(&instance.slots)
            {
                if materials.surfaces[slot as usize].is_some() {
                    tracer.triangles.extend_from_slice(corners);
                    tracer.tags.push(slot);
                }
            }
        }
        if tracer.tags.is_empty() {
            return None;
        }
        let (bounds, links) = bvh::flatten(&bvh::build(&mut tracer.triangles, &mut tracer.tags));
        tracer.node_bounds = bounds;
        tracer.node_links = links;
        let nothing = Surface {
            base: [0.0; 3],
            emission: [0.0; 3],
            two_sided: true,
        };
        Some(Self {
            tracer,
            surfaces: materials
                .surfaces
                .iter()
                .map(|s| s.unwrap_or(nothing))
                .collect(),
        })
    }

    /// The nearest surface along `direction` from `origin` within `limit`.
    pub fn closest(&self, origin: Vec3, direction: Vec3, limit: f64) -> Option<Hit> {
        let found = trace(&self.tracer, origin, direction, limit, false);
        if !found.found {
            return None;
        }
        let surface = self.surfaces[self.tracer.tags[found.triangle] as usize];
        let winding = normal_of(&self.tracer, found.triangle);
        let front = dot(winding, direction) < 0.0;
        let usable = front || surface.two_sided;
        Some(Hit {
            point: add(origin, scale(direction, found.distance)),
            normal: if front { winding } else { scale(winding, -1.0) },
            distance: found.distance,
            base: surface.base,
            emission: if usable { surface.emission } else { [0.0; 3] },
            usable,
        })
    }

    /// Whether anything stands on the way from `origin` along `direction` for `limit`.
    pub fn blocked(&self, origin: Vec3, direction: Vec3, limit: f64) -> bool {
        trace(&self.tracer, origin, direction, limit, true).found
    }
}

/// The ray origin pushed off a surface met at distance `hit_distance`, along its `normal`: the
/// larger of 2⁻⁸ centimetres and sixteen steps of a single float at the origin's size.
pub fn offset_origin(origin: Vec3, hit_distance: f64, normal: Vec3) -> Vec3 {
    const CENTIMETRES: f64 = 100.0;
    let reference = origin
        .iter()
        .map(|c| (c * CENTIMETRES).abs())
        .fold(hit_distance * CENTIMETRES, f64::max) as f32;
    let step = f32::from_bits(reference.to_bits() + 16) - reference;
    let offset = f64::from(step).max(0.003_906_25) / CENTIMETRES;
    add(origin, scale(normal, offset))
}
