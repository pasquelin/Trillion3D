//! The flattened material: per texel of the atlas, the sources' material properties, each in its
//! own channel as the material holds it — base colour and, as the layer's maps name them
//! (`maps::Maps`), shading normal, roughness, metallic, specular and emission, and on a merged
//! mesh opacity or mask, occlusion and anisotropy —; the normal written in the atlas mesh's own
//! tangent frame, so the map bends the atlas mesh's normal onto the sources': an approximated
//! shell's the tangents it stores (`approximate::tangents`), each texel's frame its corners'
//! tangents and bitangents blended and made unit, the map's value the sources' normal against the
//! tangent, the bitangent and the shell's normal; a merged mesh's the frame the engine rebuilds
//! from a triangle without tangents (`cluster/cotangentFrameWgsl.ts`, `merge/tile.rs`). The
//! flattened material draws opaque unless its layer bakes the opacity or the mask (`Coverage`):
//! its opacity is then the base image's alpha, never folded into the colour. A roughness or
//! metallic not baked is the constant of a plain dielectric (`maps::ROUGHNESS`,
//! `maps::METALLIC`), carried by the material's factor. The specular rides in the packed
//! metal-roughness map's first channel; the emission, a map of its own over its strength
//! (`emission`).
//!
//! An approximated shell reads its sources as a capture of their surfaces does (`capture`,
//! `gpu/capture.wgsl`): through twenty-two views of them, each texel from the view that sees it
//! most squarely, bilinearly between that view's four pixels around it, each pixel what the view
//! draws along its ray: a translucent surface — one that transmits light, one drawn alpha-blended —
//! as it is seen through, over what lies behind it (`seen`, the layer's `translucency` by
//! default), or never, what lies behind it showing alone (`surfaceOnly`); then the first opaque
//! surface; a cut-out let through where it is cut; a back face where its surface draws one face —
//! each value as the view's buffers keep it: eight-bit sRGB colour, ten-bit normal, eight-bit
//! roughness, metallic and specular, half-precision emission. Each texture is read as an
//! anisotropic sampler reads it, at the layer's anisotropy clamp (`captureAnisotropy`). A merged
//! atlas reads a translucent part by the same rule (`merge/tile.rs`). A texel no view sees is a
//! hole, filled from the texels around it. It reads a source's properties as its material holds
//! them, each texture wrapped as its sampler wraps it, on the GPU (`gpu`), the texels placed and
//! filled on the CPU (`atlas::captured`).
use crate::hlod::options::HlodMapSides;
pub(crate) mod appearance;
mod atlas;
pub(crate) mod capture;
mod emission;
pub(super) mod gpu;
mod maps;
pub(crate) mod publish;
pub(crate) mod seen;
pub(crate) mod sources;
pub(crate) mod tree;
pub(crate) use atlas::{captured, sized, supersampling};
pub(crate) use maps::{Coverage, Maps, MASK_CUTOFF, METALLIC, ROUGHNESS};

/// A mesh whose material is flattened: per vertex its position, normal and atlas coordinates in
/// `[0, 1]`, an approximated or simplified shell's its tangent and its bitangent's sign too — four
/// floats, none for a merged mesh, whose normal map is baked in the frame the engine rebuilds from
/// a triangle —, a simplified shell's its colour where its layer carries the sources' colours
/// onto it (`allowVertexColors`) — four floats, none otherwise —, and its triangles.
pub(crate) struct Flat {
    pub positions: Vec<f32>,
    pub normals: Vec<f32>,
    pub uvs: Vec<f32>,
    pub tangents: Vec<f32>,
    pub colours: Vec<f32>,
    pub indices: Vec<u32>,
}

/// The sides of a flattened material's images, texels: base colour, normal map, metal-roughness
/// map, emission map, occlusion map and anisotropy map — one side for all of them in a simplified
/// atlas or one sized uniformly, each its own in an atlas sized per map (`HlodAtlasSizing`), the
/// packed metal-roughness map at the largest of its roughness's, metallic's and specular's.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub(crate) struct Sides {
    pub base: usize,
    pub normal: usize,
    pub metal_rough: usize,
    pub emission: usize,
    pub occlusion: usize,
    pub anisotropy: usize,
}

impl Sides {
    /// Every image at `side`.
    pub(crate) fn uniform(side: usize) -> Self {
        Self {
            base: side,
            normal: side,
            metal_rough: side,
            emission: side,
            occlusion: side,
            anisotropy: side,
        }
    }

    /// The sides `maps` gives the images of an approximated atlas, whichever it bakes.
    pub(crate) fn of(maps: &HlodMapSides) -> Self {
        Self {
            base: maps.base,
            normal: maps.normal,
            metal_rough: maps.roughness.max(maps.metallic).max(maps.specular),
            emission: maps.emissive,
            occlusion: maps.occlusion,
            anisotropy: maps.anisotropy.max(maps.tangent),
        }
    }

    /// The sides `sizes` gives the images of a merged atlas baking `baked`, and the largest of
    /// them, the side the atlas is baked at: each image the largest of the sides of the maps that
    /// share it and that `baked` bakes — the base colour with the opacity or the mask its alpha
    /// holds, the metal-roughness map with its three, the anisotropy map with the tangent —, the
    /// base colour always.
    pub(crate) fn of_baked(sizes: &HlodMapSides, baked: Maps) -> (usize, Self) {
        let largest = |sides: &[(bool, usize)]| {
            (sides.iter())
                .filter(|&&(on, _)| on)
                .map(|&(_, side)| side)
                .fold(1, usize::max)
        };
        let sides = Self {
            base: largest(&[
                (true, sizes.base),
                (baked.opacity, sizes.opacity),
                (baked.opacity_mask, sizes.opacity_mask),
            ]),
            normal: sizes.normal,
            metal_rough: largest(&[
                (baked.roughness, sizes.roughness),
                (baked.metallic, sizes.metallic),
                (baked.specular, sizes.specular),
            ]),
            emission: sizes.emissive,
            occlusion: sizes.occlusion,
            anisotropy: largest(&[
                (baked.anisotropy, sizes.anisotropy),
                (baked.tangent, sizes.tangent),
            ]),
        };
        let images = [
            (true, sides.base),
            (baked.normal, sides.normal),
            (baked.metal_rough(), sides.metal_rough),
            (baked.emissive, sides.emission),
            (baked.occlusion, sides.occlusion),
            (baked.anisotropic(), sides.anisotropy),
        ];
        (largest(&images), sides)
    }
}

/// An emission map: its RGBA8 image, the emission over its strength in sRGB, and its strength, the
/// largest channel of emission the bake read — an image holds its colours on the unit interval.
#[derive(Clone)]
pub(crate) struct Emission {
    pub image: Vec<u8>,
    pub strength: f32,
}

/// The flattened material's images, RGBA8, each `sides` texels square: base colour (sRGB) — its
/// alpha the opacity or the mask where `coverage` says —, and the normal map, the metal-roughness
/// map — its first channel the specular where `specular` —, the emission map, the occlusion map
/// and the anisotropy map where its maps bake them (`maps::Maps`); the mean linear colour the bake
/// read and the one the base image holds (`appearance::tone_gap`); and whether the material draws
/// both faces — a closed shell's never, a merged mesh's as its layer and sources say
/// (`merge/flat.rs`).
#[derive(Clone)]
pub(crate) struct Atlas {
    pub sides: Sides,
    pub base: Vec<u8>,
    pub normal: Option<Vec<u8>>,
    pub metal_rough: Option<Vec<u8>>,
    pub specular: bool,
    pub emission: Option<Emission>,
    pub occlusion: Option<Vec<u8>>,
    pub anisotropy: Option<Vec<u8>>,
    pub coverage: Coverage,
    pub tone: [[f64; 3]; 2],
    pub double_sided: bool,
}

impl Flat {
    fn corner(&self, t: usize, k: usize) -> usize {
        self.indices[t * 3 + k] as usize
    }
    /// Vertex `v`'s atlas coordinates.
    pub(crate) fn uv(&self, v: usize) -> [f64; 2] {
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
