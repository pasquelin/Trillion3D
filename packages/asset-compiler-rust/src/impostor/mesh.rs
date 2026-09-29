//! A source mesh in its own object space, traceable: the level-0 triangles in the oracle's
//! `World` under the one BVH constructor (`proxy::bvh`), with, per triangle in tree order, its
//! material, texture coordinates and vertex normals. The alpha-aware hit filter lives here:
//! a hit on a cut texel lets the ray through, as the engine's mask discards it.
use super::surface::Surface;
use crate::compiler_accessor_create::accessor;
use crate::compiler_validate::required_index;
use crate::dag::bounds::bounding_sphere;
use crate::proxy::bvh;
use crate::shared_math::{dot, normalized_or, scale};
use crate::texture_preview::TexturePreview;
use crate::tracer::{normal_of, trace_where, World};
use crate::Result;
use serde_json::Value;

/// Texture coordinate sets a triangle carries: a texture naming a higher set reads the last.
pub(crate) const SETS: usize = 2;

/// Per-triangle attributes, in the order the tree left the triangles; the material is the
/// triangle's tag in the `World`.
#[derive(Clone, Default)]
pub(crate) struct Corners {
    /// `uv[set]`: the three corners' coordinates, end to end.
    pub uv: [[f32; 6]; SETS],
    /// The three corners' normals, end to end; `None` when the primitive declares none.
    pub normals: Option<[f32; 9]>,
}

pub(crate) struct Traceable {
    pub world: World,
    pub corners: Vec<Corners>,
    pub surfaces: Vec<Surface>,
    /// Bounding sphere: centre and radius, object space.
    pub centre: [f64; 3],
    pub radius: f64,
}

/// What a kept hit carries to the texel.
pub(crate) struct Sample {
    pub distance: f64,
    pub colour: [f64; 3],
    pub normal: [f64; 3],
    pub orm: [f64; 3],
}

fn mix<const N: usize>(corners: &[f32], at: [f64; 2]) -> [f64; N] {
    let w = [1.0 - at[0] - at[1], at[0], at[1]];
    std::array::from_fn(|c| (0..3).map(|k| w[k] * f64::from(corners[k * N + c])).sum())
}

impl Traceable {
    /// Builds the tree over `triangles` (nine floats each) and orders `materials` (ranks in
    /// `surfaces`) and `corners` alike.
    pub fn new(
        mut triangles: Vec<f32>,
        mut tags: Vec<u32>,
        corners: Vec<Corners>,
        surfaces: Vec<Surface>,
    ) -> Self {
        let corners_count = (triangles.len() / 3) as u32;
        let sphere = bounding_sphere(&triangles, &(0..corners_count).collect::<Vec<_>>());
        let (centre, radius) = ([sphere[0], sphere[1], sphere[2]], sphere[3]);
        let (nodes, order) = bvh::build_ordered(&mut triangles, &mut tags);
        let (node_bounds, node_links) = bvh::flatten(&nodes);
        let corners = order.iter().map(|&k| corners[k].clone()).collect();
        let world = World {
            triangles,
            tags,
            node_bounds,
            node_links,
        };
        Self {
            world,
            corners,
            surfaces,
            centre,
            radius,
        }
    }

    /// Reads mesh `mesh` of `g` from `bin`: every triangle primitive, as declared.
    pub fn read(g: &Value, bin: &[u8], mesh: usize, previews: &[TexturePreview]) -> Result<Self> {
        let (mut triangles, mut tags, mut corners, mut surfaces) =
            (Vec::new(), Vec::new(), Vec::new(), Vec::new());
        let empty = Vec::new();
        let primitives = g
            .pointer(&format!("/meshes/{mesh}/primitives"))
            .and_then(Value::as_array)
            .unwrap_or(&empty);
        for primitive in primitives {
            if primitive.get("mode").and_then(Value::as_u64).unwrap_or(4) != 4 {
                continue;
            }
            let attribute = |name: &str| -> Result<Option<Vec<f32>>> {
                let Some(id) = primitive.pointer(&format!("/attributes/{name}")) else {
                    return Ok(None);
                };
                Ok(Some(
                    accessor(g, bin, required_index(Some(id), name)?, None)?.collect_f32()?,
                ))
            };
            let positions = attribute("POSITION")?.unwrap_or_default();
            let normals = attribute("NORMAL")?;
            let sets = [attribute("TEXCOORD_0")?, attribute("TEXCOORD_1")?];
            let indices: Vec<u32> = match primitive.get("indices") {
                Some(id) => {
                    accessor(g, bin, required_index(Some(id), "indices")?, None)?.collect_u32()?
                }
                None => (0..positions.len() as u32 / 3).collect(),
            };
            let material = surfaces.len() as u32;
            surfaces.push(Surface::of(
                g,
                primitive.get("material").and_then(Value::as_u64),
                previews,
            ));
            // A corner outside POSITION leaves its triangle out, never a vertex at the origin.
            let inside = |t: &&[u32; 3]| t.iter().all(|&i| (i as usize + 1) * 3 <= positions.len());
            for triangle in indices.as_chunks::<3>().0.iter().filter(inside) {
                let mut corner = Corners::default();
                let mut normal = [0.0f32; 9];
                for (k, &index) in triangle.iter().enumerate() {
                    let i = index as usize;
                    triangles.extend_from_slice(&positions[i * 3..i * 3 + 3]);
                    for (set, uv) in sets.iter().enumerate() {
                        let read = uv.as_ref().and_then(|uv| uv.get(i * 2..i * 2 + 2));
                        corner.uv[set][k * 2..k * 2 + 2].copy_from_slice(read.unwrap_or(&[0.0; 2]));
                    }
                    if let Some(n) = normals.as_ref().and_then(|n| n.get(i * 3..i * 3 + 3)) {
                        normal[k * 3..k * 3 + 3].copy_from_slice(n);
                    }
                }
                corner.normals = normals.is_some().then_some(normal);
                corners.push(corner);
                tags.push(material);
            }
        }
        Ok(Self::new(triangles, tags, corners, surfaces))
    }

    fn surface(&self, triangle: usize) -> &Surface {
        &self.surfaces[self.world.tags[triangle] as usize]
    }

    /// The coordinates texture `k` (base colour, metal-roughness, occlusion) reads at barycentric
    /// `at` of `triangle`: its set, under its transform.
    fn uv(&self, triangle: usize, at: [f64; 2], k: usize) -> [f64; 2] {
        let surface = self.surface(triangle);
        let set = (surface.sets[k] as usize).min(SETS - 1);
        let [u, v] = mix::<2>(&self.corners[triangle].uv[set], at);
        let [a, b, c, d, e, f] = surface.transforms[k];
        [a * u + b * v + c, d * u + e * v + f]
    }

    /// First hit whose material covers its texel, within `limit`.
    pub fn trace(&self, origin: [f64; 3], ray: [f64; 3], limit: f64) -> Option<Sample> {
        let keep = |triangle: usize, at| {
            let surface = self.surface(triangle);
            surface.cut.is_none() || surface.keeps(self.uv(triangle, at, 0))
        };
        let hit = trace_where(&self.world, (origin, ray), limit, false, &keep);
        if !hit.found {
            return None;
        }
        let surface = self.surface(hit.triangle);
        let facing = normal_of(&self.world, hit.triangle);
        let normal = match self.corners[hit.triangle].normals {
            Some(normals) => normalized_or(mix::<3>(&normals[..], hit.barycentric), facing),
            None => facing,
        };
        // Turned to the side the ray meets: the source has no reliable winding.
        let normal = if dot(normal, ray) > 0.0 {
            scale(normal, -1.0)
        } else {
            normal
        };
        let uv = [0, 1, 2].map(|k| self.uv(hit.triangle, hit.barycentric, k));
        Some(Sample {
            distance: hit.distance,
            colour: surface.colour(uv[0]),
            normal,
            orm: surface.orm(uv),
        })
    }
}
