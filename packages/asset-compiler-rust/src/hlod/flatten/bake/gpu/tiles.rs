//! A merged entry's tile as the compute pass `tile` reads it (`tile.wgsl`): the scene of the
//! entry's sources — their own, or, where the entry is seen through, every part of the merged mesh
//! and the tree its texels' rays walk — and, per source triangle, its place in the entry's image
//! (`Laid`): the footprint one texel carries onto it and the frame its coordinates there give.
use super::super::sources::Sources;
use super::super::{Coverage, Maps};
use super::layout::{LAID_RECORDS, MAP_ANISOTROPY, MAP_BLEND, MAP_MASK, MAP_OCCLUSION};
use super::records::{pack_sources, SOURCE_WORD_BYTES};
use super::scene::Scene;
use super::surfaces::pack_surfaces;
use crate::hlod::flatten::gpu::pack::{base, float};
use trillion3d_page_codec::proxy::bvh::Node;

/// The anisotropy clamp a tile's textures are read at: one sample at the level whose texel the
/// footprint's longer side spans, two levels blended — as a merged entry's texel has always read
/// its sources.
const TILE_ANISOTROPY: u32 = 1;

/// A source triangle's place in its entry's image: its slot among the scene's sources, its
/// footprint's barycentric steps across one texel along `x` then `y`, and the deltas of its second
/// and third corners' coordinates in the image from its first's.
pub(crate) type Laid = (usize, [[f64; 2]; 4]);

/// The bytes a source triangle of a tile's scene holds as words while the process packs them, until
/// they go up: those of every scene (`SOURCE_WORD_BYTES`) and its place in its entry's image, a
/// `vec4` of four words a record.
pub(crate) const TRIANGLE_WORD_BYTES: usize = SOURCE_WORD_BYTES + 16 * LAID_RECORDS;

/// What a texel holds once baked, as words: the base colour, the normal, the metal-roughness, the
/// occlusion and the anisotropy images' texels — RGBA bytes, the metal-roughness map's red the
/// specular, the anisotropy's red and green the direction and its blue the strength, each image's
/// alpha one but the base colour's —, then the emission's three channels, linear, as floats' bits.
pub(crate) type Tile = [u32; 8];

/// What a tile bakes beside what every texel reads (`layout::MAP_OCCLUSION`…): the occlusion map,
/// the anisotropy map where `maps` bakes either of its two images, and the base alpha as the
/// material's opacity or its mask.
fn baked_maps(maps: Maps) -> u32 {
    let coverage = match maps.coverage() {
        Coverage::Opaque => 0,
        Coverage::Blend => MAP_BLEND,
        Coverage::Mask => MAP_MASK,
    };
    let occlusion = if maps.occlusion { MAP_OCCLUSION } else { 0 };
    let anisotropy = if maps.anisotropic() {
        MAP_ANISOTROPY
    } else {
        0
    };
    coverage | occlusion | anisotropy
}

/// The places `laid` names appended to `out`, one record per source triangle of `triangles`
/// (`layout::LAID_RECORDS`), zeros for those no entry bakes; the `vec4` base of them all.
fn pack_laid(out: &mut Vec<u32>, laid: &[Laid], triangles: usize) -> u32 {
    let at = base(out);
    let first = out.len();
    out.resize(first + triangles * LAID_RECORDS * 4, 0);
    for &(slot, [x, y, d1, d2]) in laid {
        let from = first + slot * LAID_RECORDS * 4;
        let words = [x[0], x[1], y[0], y[1], d1[0], d1[1], d2[0], d2[1]].map(float);
        out[from..from + LAID_RECORDS * 4].copy_from_slice(&words);
    }
    at
}

impl Scene {
    /// The tile of an entry whose triangles lie at `laid` among `sources`, the tree `nodes` over
    /// them walked by its texels' rays where `behind` — it is seen through —, baking what `maps`
    /// names; each texel's textures read at the clamp `TILE_ANISOTROPY`, a layer gap the sources'
    /// tie.
    pub fn tiled(
        (sources, nodes): (&Sources, &[Node]),
        laid: &[Laid],
        (maps, behind): (Maps, bool),
    ) -> crate::Result<Self> {
        let mesh = &sources.mesh;
        let mut words = Vec::new();
        let [nodes_at, corners_at, attributes_at] = pack_sources(&mut words, mesh, nodes)?;
        let laid_at = pack_laid(&mut words, laid, mesh.corners.len());
        let head = [
            [0; 4],
            [0, nodes_at, corners_at, attributes_at],
            [0, 0, 0, laid_at],
            [
                u32::from(behind),
                float(mesh.tie()),
                TILE_ANISOTROPY,
                baked_maps(maps),
            ],
        ];
        let (surfaces, chains) = pack_surfaces(sources, (maps.occlusion, maps.anisotropic()));
        Ok(Self {
            words,
            head,
            surfaces,
            chains,
        })
    }
}
