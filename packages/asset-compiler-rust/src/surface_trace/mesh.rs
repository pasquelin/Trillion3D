//! A source mesh in its own object space, traceable: the level-0 triangles in a tracer `World`,
//! with, per triangle in the same order, its material, texture coordinates and vertex normals.
//! The alpha-aware hit filter lives here: a hit on a cut texel lets the ray through, as the
//! engine's mask discards it.
use super::surface::{Across, Surface};
use crate::proxy::tracer::{normal_of, vertex, Among, World};
use trillion3d_math::triangle::barycentric_weights;
use trillion3d_math::vec3::{cross, normalized_or};
use trillion3d_math::vecn::{dot, length, scale, sub, weighted_sum};
use trillion3d_page_codec::min_ball::point_sphere;

/// A sample's two sides on the plane its rays cross, the footprint a hit filters its textures over.
pub(crate) type Footprint = [[f64; 3]; 2];

/// Texture coordinate sets a triangle carries: a texture naming a higher set reads the last.
pub(crate) const SETS: usize = 2;

/// Per-triangle attributes, in the order of the triangles; the material is the triangle's tag in
/// the `World`.
#[derive(Default)]
pub(crate) struct Corners {
    /// `uv[set]`: the three corners' coordinates, end to end.
    pub uv: [[f32; 6]; SETS],
    /// The three corners' normals, end to end; `None` when the primitive declares none.
    pub normals: Option<[f32; 9]>,
    /// The three corners' `COLOR_0`, linear RGBA end to end (alpha 1 for a three-wide one);
    /// `None` when the primitive declares none.
    pub colours: Option<[f32; 12]>,
}

pub(crate) struct Traceable {
    pub world: World,
    pub corners: Vec<Corners>,
    pub surfaces: Vec<Surface>,
    /// Bounding sphere: centre and radius, object space.
    pub centre: [f64; 3],
    pub radius: f64,
    /// Each triangle primitive read (`read`): its index in the mesh and its triangles' ranks.
    pub primitives: Vec<(usize, std::ops::Range<usize>)>,
    /// Each surface's material in the source (`read`), by the rank `tags` hold.
    pub materials: Vec<Option<u64>>,
}

/// What a kept hit carries to the texel.
pub(crate) struct Sample {
    pub distance: f64,
    pub colour: [f64; 3],
    pub normal: [f64; 3],
    pub orm: [f64; 3],
}

pub(crate) fn mix<const N: usize>(corners: &[f32], at: [f64; 2]) -> [f64; N] {
    let values = std::array::from_fn(|k| std::array::from_fn(|c| f64::from(corners[k * N + c])));
    weighted_sum(values, barycentric_weights(at[0], at[1]))
}

impl Traceable {
    /// `triangles` (nine floats each), their materials `tags` (ranks in `surfaces`) and `corners`,
    /// in one order, and their bounding sphere.
    pub fn new(
        triangles: Vec<f32>,
        tags: Vec<u32>,
        corners: Vec<Corners>,
        surfaces: Vec<Surface>,
    ) -> Self {
        let corners_count = (triangles.len() / 3) as u32;
        let sphere = point_sphere(&triangles, &(0..corners_count).collect::<Vec<_>>());
        let (centre, radius) = ([sphere[0], sphere[1], sphere[2]], sphere[3]);
        let world = World {
            triangles,
            tags,
            ..World::default()
        };
        Self {
            world,
            corners,
            surfaces,
            centre,
            radius,
            primitives: Vec::new(),
            materials: Vec::new(),
        }
    }

    /// How far apart across their surfaces two hits are one surface (`tracer::Among`): sixteen
    /// times the rounding of a corner — a corner is an `f32`, its coordinates at most the centre's
    /// distance from the origin plus the radius —, so two faces drawn in one plane tie wherever a
    /// ray meets them, at any scale of the mesh.
    pub fn tie(&self) -> f64 {
        16.0 * f64::from(f32::EPSILON) * (length(self.centre) + self.radius)
    }

    pub(crate) fn surface(&self, triangle: usize) -> &Surface {
        &self.surfaces[self.world.tags[triangle] as usize]
    }

    /// The barycentric steps of `footprint`'s two sides carried along `ray` onto `triangle`.
    pub(crate) fn steps(
        &self,
        triangle: usize,
        (ray, footprint): ([f64; 3], Footprint),
    ) -> [[f64; 2]; 2] {
        let [p, q, w] = [0, 1, 2].map(|corner| vertex(&self.world, triangle, corner));
        let (e0, e1) = (sub(q, p), sub(w, p));
        let normal = cross(e0, e1);
        let (g00, g01, g11) = (dot(e0, e0), dot(e0, e1), dot(e1, e1));
        let gram = g00 * g11 - g01 * g01;
        footprint.map(|side| {
            let onto = sub(side, scale(ray, dot(normal, side) / dot(normal, ray)));
            let (r0, r1) = (dot(e0, onto), dot(e1, onto));
            [(g11 * r0 - g01 * r1) / gram, (g00 * r1 - g01 * r0) / gram]
        })
    }

    /// The coordinates texture `k` (`surface::SLOTS`: base colour, metal-roughness, occlusion,
    /// normal map) reads at barycentric
    /// `at` of `triangle` — its set, under its transform —, and their steps across a footprint
    /// whose barycentric steps are `steps`: the GPU's derivatives of them over a sample.
    pub(crate) fn uv(
        &self,
        triangle: usize,
        at: [f64; 2],
        k: usize,
        steps: [[f64; 2]; 2],
    ) -> ([f64; 2], Across) {
        let surface = self.surface(triangle);
        let set = (surface.sets[k] as usize).min(SETS - 1);
        let coordinates = &self.corners[triangle].uv[set];
        let [u, v] = mix::<2>(coordinates, at);
        let [a, b, c, d, e, f] = surface.transforms[k];
        let corner = |k: usize, i: usize| f64::from(coordinates[k * 2 + i]);
        let across = steps.map(|[s, t]| {
            let [du, dv] = [0, 1]
                .map(|i| s * (corner(1, i) - corner(0, i)) + t * (corner(2, i) - corner(0, i)));
            [a * du + b * dv, d * du + e * dv]
        });
        ([a * u + b * v + c, d * u + e * v + f], across)
    }

    /// The vertex colour `COLOR_0` at barycentric `at` of `triangle`, linear RGBA; white when the
    /// primitive declares none. The engine multiplies it into the base colour and its alpha.
    pub(crate) fn vertex_colour(&self, triangle: usize, at: [f64; 2]) -> [f64; 4] {
        self.corners[triangle]
            .colours
            .map_or([1.0; 4], |c| mix::<4>(&c[..], at))
    }

    /// The first hit whose material covers its texel, its surface's transmission and its triangle:
    /// a voxel reads it alone, far glass opaque.
    pub fn hit(
        &self,
        origin: [f64; 3],
        ray: [f64; 3],
        limit: f64,
        among: Among<'_>,
        footprint: Footprint,
    ) -> Option<(Sample, f64, usize)> {
        let keep = |triangle: usize, at| {
            let surface = self.surface(triangle);
            surface.cut.is_none() || {
                let steps = self.steps(triangle, (ray, footprint));
                let (uv, across) = self.uv(triangle, at, 0, steps);
                surface.keeps(uv, across, self.vertex_colour(triangle, at)[3])
            }
        };
        let hit = among.nearest(&self.world, (origin, ray), limit, &keep);
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
        let steps = self.steps(hit.triangle, (ray, footprint));
        let read = [0, 1, 2].map(|k| self.uv(hit.triangle, hit.barycentric, k, steps));
        let tint = self.vertex_colour(hit.triangle, hit.barycentric);
        let colour = surface.colour(read[0].0, read[0].1);
        let sample = Sample {
            distance: hit.distance,
            colour: [0, 1, 2].map(|c| colour[c] * tint[c]),
            normal,
            orm: surface.orm(read.map(|r| r.0), read.map(|r| r.1)),
        };
        Some((sample, surface.transmission, hit.triangle))
    }
}
