//! A mesh's triangles as the field's build queries them: the nearest triangle to a point, and the
//! rays that tell inside from outside. The reference's scene is the mesh's opaque and masked
//! triangles — a blended material's are left out — in centimetres, each marked two-sided when its
//! material is double-sided or the build asks for it.
use super::abi::DISTANCE_FIELD_UNITS_PER_METRE;
use crate::compiler::primitive::triangles::mesh_primitives;
use crate::hlod::flatten::bake::tree::Tree;
use crate::texture::TexturePreview;
use crate::trace::surface::Traceable;
use crate::Result;
use serde_json::Value;
use trillion3d_math::geometry::ray_box::{inverse, ray_aabb};
use trillion3d_math::geometry::triangle::triangle_cross;
use trillion3d_math::vector::vecn::dot;

type Vec3 = [f64; 3];

/// A pulled-back start keeps a ray from missing the triangle its voxel lies on: a ten-thousandth of
/// the distance it travels.
const PULLBACK: f64 = 1.0e-4;
/// The share of the rays that must hit a back face for the voxel to be inside: a quarter.
const INSIDE_SHARE: f64 = 0.25;

/// The queryable triangles of one mesh.
pub(super) struct Scene {
    tree: Tree,
    /// Per leaf slot of the tree, whether its triangle is two-sided.
    two_sided: Vec<bool>,
    /// Whether a quarter of the mesh's triangles or more are two-sided, or the build asks for all.
    pub mostly_two_sided: bool,
    /// The box of every vertex of the mesh, in the reference's unit.
    pub low: Vec3,
    pub high: Vec3,
}

/// Whether material `id` of `g` is double-sided.
fn double_sided(g: &Value, id: Option<u64>) -> bool {
    id.and_then(|id| g.pointer(&format!("/materials/{id}/doubleSided")))
        .and_then(Value::as_bool)
        .unwrap_or(false)
}

impl Scene {
    /// Mesh `mesh` of `g` as a scene, none when it has no triangle to query. `as_if_two_sided`
    /// marks every triangle two-sided.
    pub(super) fn read(
        (g, bin, previews): (&Value, &[u8], &[TexturePreview]),
        mesh: usize,
        as_if_two_sided: bool,
    ) -> Result<Option<Self>> {
        let traceable = Traceable::read(g, bin, mesh, previews)?;
        let unit = DISTANCE_FIELD_UNITS_PER_METRE;
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
        let (corners, _) = traceable.world.triangles.as_chunks::<3>();
        let (mut low, mut high) = ([f64::INFINITY; 3], [f64::NEG_INFINITY; 3]);
        for point in corners {
            for k in 0..3 {
                let v = f64::from((f64::from(point[k]) * unit) as f32);
                (low[k], high[k]) = (low[k].min(v), high[k].max(v));
            }
        }
        let sided = flags.iter().filter(|&&f| f).count();
        let mostly_two_sided = sided * 4 >= count || as_if_two_sided;
        // The triangles queried: those a blended material does not draw.
        let kept: Vec<usize> = (0..count)
            .filter(|&t| !traceable.surface(t).blend)
            .collect();
        if kept.is_empty() {
            return Ok(None);
        }
        let soup: Vec<f32> = (kept.iter())
            .flat_map(|&t| traceable.world.triangles[t * 9..t * 9 + 9].iter())
            .map(|&v| (f64::from(v) * unit) as f32)
            .collect();
        let tree = Tree::from_soup(soup);
        let two_sided = tree.order.iter().map(|&rank| flags[kept[rank]]).collect();
        Ok(Some(Self {
            tree,
            two_sided,
            mostly_two_sided,
            low,
            high,
        }))
    }

    /// The signed distance from `at` to the surface, held to `trace` either way: the nearest
    /// triangle's distance when one lies within `trace`, negative when the rays `directions` leave
    /// `at` across `volume` hit back faces more than a quarter of the time; `trace` otherwise.
    pub(super) fn signed_distance(
        &self,
        at: Vec3,
        trace: f64,
        (directions, volume): (&[Vec3], (Vec3, Vec3)),
    ) -> f64 {
        let (nearest2, found) = self.tree.nearest(at, trace * trace);
        if found.is_none() {
            return trace;
        }
        let distance = nearest2.sqrt();
        let (mut hit, mut back) = (0usize, 0usize);
        for &direction in directions {
            let ray = direction.map(|d| d * trace);
            if !ray_aabb(volume.0, volume.1, at, inverse(ray), 1.0) {
                continue;
            }
            let start = [0, 1, 2].map(|k| at[k] - PULLBACK * trace * direction[k]);
            if let Some((_, slot)) = self.tree.first_hit((start, ray)) {
                hit += 1;
                let [a, b, c] = self.tree.corners(slot);
                if dot(direction, triangle_cross(a, b, c)) > 0.0 && !self.two_sided[slot] {
                    back += 1;
                }
            }
        }
        match hit > 0 && back as f64 > INSIDE_SHARE * directions.len() as f64 {
            true => -distance,
            false => distance,
        }
    }
}
