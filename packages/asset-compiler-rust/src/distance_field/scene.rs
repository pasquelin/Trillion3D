//! A mesh's triangles as the field's build queries them: the nearest triangle to a point, and the
//! rays that tell inside from outside. The reference's scene is the mesh's opaque and masked
//! triangles — a blended material's are left out — in centimetres, each marked two-sided when its
//! material is double-sided or the build asks for it. The mesh cards' build casts its rays on the
//! same scene with the blended triangles kept (`Scene::read`, `Scene::hit`).
use super::abi::DISTANCE_FIELD_UNITS_PER_METRE;
use crate::compiler::primitive::triangles::mesh_primitives;
use crate::hlod::flatten::bake::tree::Tree;
use crate::texture::TexturePreview;
use crate::trace::surface::Traceable;
use crate::Result;
use serde_json::Value;
use trillion3d_math::geometry::ray_box::{inverse, ray_aabb};
use trillion3d_math::geometry::triangle::triangle_cross;
use trillion3d_math::vector::vec3::normalized_or;
use trillion3d_math::vector::vecn::dot;

type Vec3 = [f64; 3];

/// A pulled-back start keeps a ray from missing the triangle its voxel lies on: a ten-thousandth of
/// the distance it travels.
pub(super) const PULLBACK: f64 = 1.0e-4;
/// A voxel is inside when more than this share of its rays meet a back face first: a quarter.
const INSIDE_SHARE: f64 = 0.25;
/// A triangle whose cross product, in centimetres, has a squared length under this is degenerate
/// and left out of the scene.
const DEGENERATE_CROSS_SQUARED: f64 = 1.0e-8;

/// The fewest back faces that are more than a quarter of `rays` rays.
pub(super) fn enough_back_faces(rays: usize) -> usize {
    (INSIDE_SHARE * rays as f64).floor() as usize + 1
}

/// The queryable triangles of one mesh.
pub(crate) struct Scene {
    tree: Tree,
    /// Per leaf slot of the tree, whether its triangle is two-sided.
    two_sided: Vec<bool>,
    /// Whether a quarter of the mesh's triangles or more are two-sided, or the build asks for all.
    pub mostly_two_sided: bool,
    /// The box of every vertex of the mesh, in the reference's unit.
    pub low: Vec3,
    pub high: Vec3,
}

/// The nearest triangle a ray meets (`Scene::hit`).
pub(crate) struct Hit {
    /// How far along the ray it lies, as a share of the ray's vector.
    pub t: f64,
    /// The triangle's leaf slot, to leave it out of the next cast along the ray.
    pub slot: usize,
    /// Its unit normal by its winding, zero for a triangle too small to give one.
    pub normal: Vec3,
    /// Whether it is two-sided.
    pub two_sided: bool,
}

/// Whether material `id` of `g` is double-sided.
fn double_sided(g: &Value, id: Option<u64>) -> bool {
    id.and_then(|id| g.pointer(&format!("/materials/{id}/doubleSided")))
        .and_then(Value::as_bool)
        .unwrap_or(false)
}

impl Scene {
    /// Mesh `mesh` of `g` as a scene, none when it has no triangle to query. `as_if_two_sided`
    /// marks every triangle two-sided; `blended` keeps the triangles of a blended material, which
    /// a distance field leaves out.
    pub(crate) fn read(
        (g, bin, previews): (&Value, &[u8], &[TexturePreview]),
        mesh: usize,
        (as_if_two_sided, blended): (bool, bool),
    ) -> Result<Option<Self>> {
        let traceable = Traceable::read(g, bin, mesh, previews)?;
        let count = traceable.world.tags.len();
        let mut flags = vec![false; count];
        for (index, primitive) in mesh_primitives(g, mesh)? {
            let sided = as_if_two_sided
                || double_sided(g, primitive.get("material").and_then(Value::as_u64));
            let range = traceable.primitives.iter().find(|(i, _)| *i == index);
            for t in range.into_iter().flat_map(|(_, r)| r.clone()) {
                flags[t] = sided;
            }
        }
        // The triangles queried: those a blended material does not draw, unless it is asked to.
        let kept: Vec<usize> = (0..count)
            .filter(|&t| blended || !traceable.surface(t).blend)
            .collect();
        let triangles = &traceable.world.triangles;
        Ok(Self::of_triangles(triangles, flags, &kept, as_if_two_sided))
    }

    /// The scene of `triangles` — nine metres a triangle, a corner after another —, `flags` giving
    /// per triangle whether it is two-sided, of which only those `kept` and not degenerate are
    /// queried; none when none is. The box is that of every corner of `triangles`, the ones left
    /// out included.
    pub(crate) fn of_triangles(
        triangles: &[f32],
        flags: Vec<bool>,
        kept: &[usize],
        as_if_two_sided: bool,
    ) -> Option<Self> {
        let unit = DISTANCE_FIELD_UNITS_PER_METRE;
        // Every corner in centimetres, once: the degenerate test, the box and the soup read it.
        let centimetres: Vec<f32> = (triangles.iter())
            .map(|&v| (f64::from(v) * unit) as f32)
            .collect();
        let corner = |t: usize, k: usize| -> Vec3 {
            std::array::from_fn(|i| f64::from(centimetres[t * 9 + k * 3 + i]))
        };
        let kept: Vec<usize> = (kept.iter().copied())
            .filter(|&t| {
                let n = triangle_cross(corner(t, 0), corner(t, 1), corner(t, 2));
                dot(n, n) >= DEGENERATE_CROSS_SQUARED
            })
            .collect();
        if kept.is_empty() {
            return None;
        }
        let count = triangles.len() / 9;
        let (corners, _) = centimetres.as_chunks::<3>();
        let (mut low, mut high) = ([f64::INFINITY; 3], [f64::NEG_INFINITY; 3]);
        for point in corners {
            for k in 0..3 {
                let v = f64::from(point[k]);
                (low[k], high[k]) = (low[k].min(v), high[k].max(v));
            }
        }
        let sided = flags.iter().filter(|&&f| f).count();
        let mostly_two_sided = sided * 4 >= count || as_if_two_sided;
        let soup: Vec<f32> = (kept.iter())
            .flat_map(|&t| centimetres[t * 9..t * 9 + 9].iter().copied())
            .collect();
        let tree = Tree::from_soup(soup);
        let two_sided = tree.order.iter().map(|&rank| flags[kept[rank]]).collect();
        Some(Self {
            tree,
            two_sided,
            mostly_two_sided,
            low,
            high,
        })
    }

    /// The scene's tree, its triangles in leaf order (`gpu.rs` packs it).
    pub(super) fn tree(&self) -> &Tree {
        &self.tree
    }

    /// Per leaf slot of the tree, whether its triangle is two-sided.
    pub(super) fn two_sided(&self) -> &[bool] {
        &self.two_sided
    }

    /// Whether a triangle lies within `radius` of `at`.
    pub(super) fn reaches(&self, at: Vec3, radius: f64) -> bool {
        self.tree.nearest(at, radius * radius).1.is_some()
    }

    /// The distance from `at` to the nearest triangle, none when none lies nearer than `limit`.
    pub(super) fn distance(&self, at: Vec3, limit: f64) -> Option<f64> {
        let (nearest2, found) = self.tree.nearest(at, limit * limit);
        found.map(|_| nearest2.sqrt())
    }

    /// The signed distance from `at` to the surface, held to `trace` either way: the nearest
    /// triangle's distance when one lies within `trace`, negative when the rays `directions` leave
    /// `at` across `volume` meet back faces first more than a quarter of the time; `trace`
    /// otherwise. The rays stop once the sign is settled: when enough have met back faces, or when
    /// the ones left, all meeting back faces, could not make enough. A tie between two triangles
    /// along a ray goes to the lower slot of the tree.
    pub(super) fn signed_distance(
        &self,
        at: Vec3,
        trace: f64,
        (directions, volume): (&[Vec3], (Vec3, Vec3)),
    ) -> f64 {
        let Some(distance) = self.distance(at, trace) else {
            return trace;
        };
        let enough = enough_back_faces(directions.len());
        let mut back = 0usize;
        for (cast, &direction) in directions.iter().enumerate() {
            if back + directions.len() - cast < enough {
                break;
            }
            let ray = direction.map(|d| d * trace);
            if !ray_aabb(volume.0, volume.1, at, inverse(ray), 1.0) {
                continue;
            }
            let start = [0, 1, 2].map(|k| at[k] - PULLBACK * trace * direction[k]);
            let Some((_, slot)) = self.tree.first_hit_beyond((start, ray), 0.0, None) else {
                continue;
            };
            if self.two_sided[slot] {
                continue;
            }
            let [a, b, c] = self.tree.corners(slot);
            if dot(direction, triangle_cross(a, b, c)) > 0.0 {
                back += 1;
                if back >= enough {
                    return -distance;
                }
            }
        }
        distance
    }

    /// The nearest triangle `origin + t·ray` meets for `near < t < 1`, either face, but for the
    /// triangle at leaf slot `skip`.
    pub(crate) fn hit(
        &self,
        (origin, ray): (Vec3, Vec3),
        (near, skip): (f64, Option<usize>),
    ) -> Option<Hit> {
        let (t, slot) = self.tree.first_hit_beyond((origin, ray), near, skip)?;
        let [a, b, c] = self.tree.corners(slot);
        Some(Hit {
            t,
            slot,
            normal: normalized_or(triangle_cross(a, b, c), [0.0; 3]),
            two_sided: self.two_sided[slot],
        })
    }
}
