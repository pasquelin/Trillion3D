//! What every flattened material bakes (`Maps`): its maps beside its base colour, and how a
//! translucent source shows in them. The roughness and the metallic of a material that bakes no
//! map of them are a plain dielectric's (`ROUGHNESS`, `METALLIC`).
use crate::hlod::options::HlodTranslucency;

/// What a flattened material bakes. The images beside its base colour:
/// - a normal map;
/// - a packed metal-roughness map (glTF's: roughness in G, metallic in B, the material's factors
///   one, and, a layer baking it, the specular in R) holding the roughness, the metallic, the
///   specular or any of them, a channel it does not bake holding its constant (`ROUGHNESS`,
///   `METALLIC`); with none, no metal-roughness map is baked and the material's factors are the
///   constants (`publish::flattened_material`);
/// - an emission map (`emissive`);
/// - a merged layer's, beside them: the base colour's alpha, the material's opacity (`opacity`,
///   the material drawn blended) or its mask (`opacity_mask`, the material drawn masked), at most
///   one of them, a glTF material having one alpha; an occlusion map (`occlusion`, glTF's red
///   channel); and an anisotropy map (`anisotropy`, `tangent`: the direction in its red and green
///   channels, the strength in its blue, glTF's `KHR_materials_anisotropy` texture).
///
/// By default the normal map alone: the base colour and the normal are what a surface shows from
/// far, its roughness and metallic the constants of a plain dielectric. A simplified layer bakes
/// none of the others. And how a translucent source shows in every image, the layer's
/// `translucency`: seen through, over what lies behind it (`seen`, the default), or its surface
/// alone.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub(crate) struct Maps {
    pub normal: bool,
    pub roughness: bool,
    pub metallic: bool,
    pub specular: bool,
    pub emissive: bool,
    pub opacity: bool,
    pub opacity_mask: bool,
    pub occlusion: bool,
    pub anisotropy: bool,
    pub tangent: bool,
    pub translucency: HlodTranslucency,
}

impl Default for Maps {
    fn default() -> Self {
        Self {
            normal: true,
            roughness: false,
            metallic: false,
            specular: false,
            emissive: false,
            opacity: false,
            opacity_mask: false,
            occlusion: false,
            anisotropy: false,
            tangent: false,
            translucency: HlodTranslucency::default(),
        }
    }
}

/// How the base image's alpha is read by the flattened material: not at all (`Opaque`, the base
/// colour alone), as the material's opacity (`Blend`) or as its mask (`Mask`, cut at
/// `MASK_CUTOFF`).
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub(crate) enum Coverage {
    Opaque,
    Blend,
    Mask,
}

/// The alpha a masked flattened material keeps a texel at: a mask baked from a source's own
/// alpha is cut a third up, not at the cutoff its source named.
pub(crate) const MASK_CUTOFF: f64 = 0.3333;

impl Maps {
    /// Whether a metal-roughness map is baked: the roughness, the metallic and the specular share
    /// one packed image.
    pub(crate) fn metal_rough(self) -> bool {
        self.roughness || self.metallic || self.specular
    }

    /// Whether an anisotropy image is baked: the tangent and the anisotropy share one.
    pub(crate) fn anisotropic(self) -> bool {
        self.anisotropy || self.tangent
    }

    /// What the base image's alpha holds (`Coverage`).
    pub(crate) fn coverage(self) -> Coverage {
        match (self.opacity_mask, self.opacity) {
            (true, _) => Coverage::Mask,
            (false, true) => Coverage::Blend,
            (false, false) => Coverage::Opaque,
        }
    }

    /// Whether a source's occlusion or anisotropy texture is read: the two maps no other baker
    /// reads, whose textures the sources' library decodes only then (`sources::Library::new`).
    pub(crate) fn reads_extra_textures(self) -> bool {
        self.occlusion || self.anisotropic()
    }

    /// How many images an atlas holds: the base colour and each map baked beside it — the normal,
    /// the metal-roughness, the emission, the occlusion and the anisotropy —, which a merged atlas
    /// holds while it is made (`merge/tile.rs`) and cooks (`publish::images`).
    pub(crate) fn images(self) -> usize {
        let baked = [
            self.normal,
            self.metal_rough(),
            self.emissive,
            self.occlusion,
            self.anisotropic(),
        ];
        1 + baked.into_iter().filter(|&baked| baked).count()
    }

    /// Whether a translucent source is baked as it is seen through (`seen`).
    pub(crate) fn seen_through(self) -> bool {
        self.translucency == HlodTranslucency::SeenThrough
    }
}

/// The roughness and the metallic of a flattened material that bakes no map of them: a plain
/// dielectric's.
pub(crate) const ROUGHNESS: f64 = 0.5;
pub(crate) const METALLIC: f64 = 0.0;
