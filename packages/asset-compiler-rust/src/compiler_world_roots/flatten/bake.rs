//! The flattened material: per texel of the atlas, the sources' material properties, each in its
//! own channel as the material holds it — base colour, shading normal, roughness and metallic —,
//! read where the texel lies on them, filtered over the texel's footprint there; the normal written
//! in the atlas mesh's own tangent frame — the frame the engine rebuilds from a triangle without
//! tangents (`cluster/cotangentFrameWgsl.ts`) —, so the map bends the atlas mesh's normal onto the
//! sources'. The flattened material draws opaque: its opacity is the constant one the base image's
//! alpha holds, never folded into the colour. The roughness and metallic vary across the surface
//! as the colour does, and what a surface reflects is much of its colour seen from far: a glass
//! curtain wall shows the sky because it is smooth, its frames and roof do not. One constant over
//! the actor would dull the glass to the roof's roughness and grey it; so a metal-roughness map
//! (glTF's: roughness in G, metallic in B, the factors 1) holds each texel's own, read in the same
//! pass as the colour. No specular nor emission map.
//!
//! Both bakes read a source's properties as its material holds them (`appearance`), a
//! transmissive surface's too: what the flattened material bakes is what each surface is made of,
//! not how it looks once lit over what lies behind it. The shell's rays pass through what the
//! engine draws alpha-blended alone (`appearance::seen`). Each sample is written straight into the
//! images' bytes.
//! One texel's bytes live in `texel`, the atlas of every chart in `atlas`.
use super::appearance;
use super::tree::Tree;
use crate::surface_trace::Traceable;
use trillion3d_math::vecn::{scale, weighted_sum};
mod texel;
use texel::{shade, Frame};
mod atlas;
use atlas::atlas;

/// A mesh whose material is flattened: per vertex its position, normal and atlas coordinates in
/// `[0, 1]`, and its triangles.
pub(crate) struct Flat {
    pub positions: Vec<f32>,
    pub normals: Vec<f32>,
    pub uvs: Vec<f32>,
    pub indices: Vec<u32>,
}

/// The flattened material's images, RGBA8, `size` texels square: base colour (sRGB), the normal
/// map and the metal-roughness map; and the mean linear colour the bake read and the one the base image holds (`appearance::tone_gap`).
#[derive(Clone)]
pub(crate) struct Atlas {
    pub size: usize,
    pub base: Vec<u8>,
    pub normal: Vec<u8>,
    pub metal_rough: Vec<u8>,
    pub tone: [[f64; 3]; 2],
}

/// What the sources hold at a hit: linear base colour, the shading normal, and roughness and
/// metallic.
type Shade = ([f64; 3], [f64; 3], [f64; 2]);

impl Flat {
    fn corner(&self, t: usize, k: usize) -> usize {
        self.indices[t * 3 + k] as usize
    }
    fn uv(&self, v: usize) -> [f64; 2] {
        [f64::from(self.uvs[v * 2]), f64::from(self.uvs[v * 2 + 1])]
    }
    /// Triangle `t`'s corner normals.
    fn normals(&self, t: usize) -> [[f64; 3]; 3] {
        [0, 1, 2].map(|k| {
            let v = self.corner(t, k);
            [0, 1, 2].map(|a| f64::from(self.normals[v * 3 + a]))
        })
    }
}

/// The approximated shell's atlas (the `approximate` builder), `size` texels square: each texel
/// reads the sources at the hit nearest along its normal, ahead or behind within its triangle's
/// `reach` — the farthest that triangle lies from them —, filtered over the texel's footprint
/// carried onto the hit triangle (`shade`); then filled as every atlas is (`atlas`).
pub(super) fn project(
    flat: &Flat,
    sources: &Traceable,
    tree: &Tree<impl AsRef<[f32]> + Sync>,
    size: usize,
    reach: &[f64],
) -> Atlas {
    // A texel that meets no surface seen is a hole the infill fills.
    let keep = |triangle: usize, at: [f64; 2]| appearance::seen(sources, triangle, at);
    // One sample of a shell triangle at weights `w`: the sources' hit nearest along its normal,
    // seen from outside, along `−n`.
    let read = |frame: &Frame, t: usize, w: [f64; 3]| {
        let point = weighted_sum(frame.corners, w);
        let n = frame.normal(w);
        let (distance, triangle, at) = tree.nearest((point, n), reach[t], &keep)?;
        let ray = if distance > 0.0 { n } else { scale(n, -1.0) };
        let steps = sources.steps(triangle, (ray, frame.quarter));
        Some(shade(sources, triangle, at, steps, n))
    };
    atlas(flat, size, &read)
}

/// The merged mesh's atlas (a `merge` layer with `mergeMaterials`), `size` texels square, `flat`
/// the merged sources themselves given unique coordinates, triangle for triangle in the order of
/// `sources`: each texel reads its own triangle's material at its own point, filtered over the
/// texel's footprint there (`shade`) — every source's material rendered into its own charts, no
/// ray, so no neighbour's surface ever paints it. Then filled as every atlas is (`atlas`).
pub(super) fn own(flat: &Flat, sources: &Traceable, size: usize) -> Atlas {
    let read = |frame: &Frame, t: usize, w: [f64; 3]| {
        let n = frame.normal(w);
        let steps = sources.steps(t, (n, frame.quarter));
        Some(shade(sources, t, [w[1], w[2]], steps, n))
    };
    atlas(flat, size, &read)
}
