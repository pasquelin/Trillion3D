//! One entry of the merged atlas baked into its own images, as a material is rendered into a
//! tile: the entry's triangles laid out at their texture coordinates in a square of `size`
//! texels, each texel whose centre a triangle covers — the first that covers it — reading that
//! triangle's material once, at the centre, every texture filtered over the one texel's
//! footprint carried onto it (the level whose texel the footprint's longer side spans, two levels
//! blended, each texture wrapped as its sampler wraps it). A texel no triangle covers keeps the
//! background (`smear.rs`).
//!
//! What a texel holds, as the flattened material carries it (`../bake.rs`), each map where the
//! layer's maps bake it (`bake::Maps`): the base colour — the material's factor, its texture and
//! the vertex colour —, sRGB, its alpha the opacity or the mask where the layer bakes either; the
//! normal the material gives — the vertex normal bent by its normal map over the triangle's
//! cotangent frame —, written in the frame the engine rebuilds for the merged mesh from these
//! texture coordinates (`frame.rs`, `cluster/cotangentFrameWgsl.ts`), so a quad's texel holds the
//! normal map's own value; the roughness and metallic, the factors times the metal-roughness map
//! (glTF's layout, roughness in G, metallic in B), a channel not baked its constant, and the
//! specular in the first channel where it is baked; the emission, the occlusion and the
//! anisotropy, each an image of its own (`extra.rs`). The GPU bake reads a source's texel alike
//! (`bake/gpu/shade.wgsl`'s `shade` and `cotangent`), over subsamples.
//!
//! A translucent part's texel, where the layer sees it through (`Maps::translucency`), holds its
//! base colour, roughness and metallic laid over what lies behind it (`bake::seen`): the merged
//! mesh's parts the ray from the texel's point inward along its vertex normal meets, each read over
//! the texel's footprint carried along the ray onto it, front to back until an opaque one
//! (`Behind`, `behind.rs`); its normal its own, and its alpha one, the composite being opaque.
use super::smear::{Image, BACKGROUND};
use crate::hlod::flatten::bake::sources::Sources;
use crate::hlod::flatten::bake::Maps;
use rayon::prelude::*;
use trillion3d_math::vector::vec2::{barycentric, double_area};
use trillion3d_math::vector::vecn::{add, scale};
mod behind;
mod extra;
mod frame;
mod shade;
pub(in crate::hlod) use behind::Behind;
use extra::{held, more, More, Texel};
pub(in crate::hlod) use frame::cotangent;
use shade::shaded;

/// One entry's images, each `size` texels square: base colour, and the normal map, the
/// metal-roughness map, the emission map, the occlusion map and the anisotropy map where the
/// layer's maps bake them (`bake::Maps`); the emission map's strength, the largest channel of
/// emission any of its texels holds, which its texels are held over — an image holds its colours
/// on the unit interval — and zero where nothing emits.
pub(in crate::hlod) struct Baked {
    pub base: Image,
    pub normal: Option<Image>,
    pub metal_rough: Option<Image>,
    pub emission: Option<Image>,
    pub emission_strength: f32,
    pub occlusion: Option<Image>,
    pub anisotropy: Option<Image>,
}

/// The texel a triangle covers: the triangle and its second and third weights at the texel's
/// centre.
type Covered = (u32, [f64; 2]);

/// A triangle's second and third weights' steps across one texel along `x` then `y`.
type Steps = [[f64; 2]; 2];

/// The texels of a `size` square the triangles at `coordinates` cover, each by the first that
/// covers its centre, and each triangle's steps.
fn covered(coordinates: &[[[f64; 2]; 3]], size: usize) -> (Vec<Option<Covered>>, Vec<Steps>) {
    let mut texels: Vec<Option<Covered>> = vec![None; size * size];
    let mut all = Vec::with_capacity(coordinates.len());
    for (triangle, corners) in coordinates.iter().enumerate() {
        let [a, b, c] = corners.map(|uv| scale(uv, size as f64));
        let area = double_area(a, b, c);
        let flat = area.abs() < 1e-300 || !area.is_finite();
        let steps = match flat {
            true => [[0.0; 2]; 2],
            false => [[1.0, 0.0], [0.0, 1.0]].map(|e| barycentric(a, b, c, add(a, e), area)),
        };
        all.push(steps);
        let low = [0, 1].map(|k| (a[k].min(b[k]).min(c[k]) - 0.5).floor().max(0.0) as usize);
        let high = [0, 1].map(|k| {
            (a[k].max(b[k]).max(c[k]) - 0.5)
                .ceil()
                .min(size as f64 - 1.0)
        });
        if flat || high[0] < 0.0 || high[1] < 0.0 {
            continue;
        }
        for y in low[1]..=high[1] as usize {
            for x in low[0]..=high[0] as usize {
                let texel = &mut texels[y * size + x];
                if texel.is_some() {
                    continue;
                }
                let at = barycentric(a, b, c, [x as f64 + 0.5, y as f64 + 0.5], area);
                if at[0] >= 0.0 && at[1] >= 0.0 && at[0] + at[1] <= 1.0 {
                    *texel = Some((triangle as u32, at));
                }
            }
        }
    }
    (texels, all)
}

/// The entry of `sources` — every triangle of its traced mesh, in order, each laid at its corners'
/// texture coordinates `coordinates` in the unit square — baked `size` texels square, the images
/// `maps` names beside the base colour, a translucent texel over what lies `behind` it where the
/// entry is seen through. The emission, occlusion and anisotropy are read in a pass of their own,
/// only where the layer bakes one (`Maps::has_more`).
pub(in crate::hlod) fn baked(
    sources: &Sources,
    coordinates: &[[[f64; 2]; 3]],
    (size, maps): (usize, Maps),
    behind: Option<&Behind>,
) -> Baked {
    let (texels, steps) = covered(coordinates, size);
    let shades: Vec<[[u8; 4]; 3]> = (texels.par_iter())
        .map(|texel| match *texel {
            Some((t, at)) => {
                let laid = (&coordinates[t as usize], steps[t as usize]);
                shaded(sources, laid, (t, at), (maps, behind))
            }
            None => [BACKGROUND; 3],
        })
        .collect();
    let beyond: Vec<Option<More>> = match maps.has_more() {
        false => Vec::new(),
        true => (texels.par_iter())
            .map(|texel| {
                let (t, at) = (*texel)?;
                let texel = Texel {
                    sources,
                    t: t as usize,
                    at,
                    steps: steps[t as usize],
                };
                Some(more(&texel, maps))
            })
            .collect(),
    };
    let strength = (beyond.iter().flatten())
        .flat_map(|m| m.emission)
        .fold(0.0f32, f32::max);
    let image = |k: usize| Image {
        width: size,
        height: size,
        texels: shades.iter().map(|s| s[k]).collect(),
    };
    let other = |pick: &dyn Fn(&More) -> [u8; 4]| Image {
        width: size,
        height: size,
        texels: (beyond.iter())
            .map(|m| m.as_ref().map_or(BACKGROUND, pick))
            .collect(),
    };
    Baked {
        base: image(0),
        normal: maps.normal.then(|| image(1)),
        metal_rough: maps.metal_rough().then(|| image(2)),
        emission: maps
            .emissive
            .then(|| other(&|m| held(m.emission, strength))),
        emission_strength: strength,
        occlusion: maps.occlusion.then(|| other(&|m| m.occlusion)),
        anisotropy: maps.anisotropic().then(|| other(&|m| m.anisotropy)),
    }
}
