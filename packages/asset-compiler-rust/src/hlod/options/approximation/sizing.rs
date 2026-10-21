//! How an approximated, merged or simplified layer sizes its atlas (`textureSizing`, a field of
//! the layer, beside its `textureSize`): one side for every map — the layer's, or the power of two
//! a density asks for once the mesh is unwrapped (`HlodTextureSizing`, `merge::atlas_sides`) —;
//! sides biased from the layer's — the normal map at it, the base colour (and a
//! merged layer's tangent map) at half, the other maps at a quarter —; or each map's own side
//! (`mapSizes`). The atlas is baked once at the largest side, each map then averaged down to its
//! own; an approximated layer's `textureSize` still sizes the views and the packing whatever the
//! sizing, a merged layer's sizes its atlas only `fixed` or `biased`.
use super::super::fields::{chosen, counted, named, ranged};
use super::super::merging::HLOD_TEXTURE_SIZINGS;
use super::*;

/// The sizings every atlas-baking layer takes beside the four one side for every map names
/// (`HLOD_TEXTURE_SIZINGS`).
const OWN_SIZINGS: [&str; 2] = ["biased", "manual"];

/// What a builder's atlas takes of the sizings: the maps its `mapSizes` names, in `HlodMapSides`'
/// order, and whether its `textureSize` is read beside any sizing (an approximated layer's, which
/// also sizes its views and its packing) or only beside `fixed` and `biased` (a merged layer's).
#[derive(Clone, Copy)]
pub(in crate::hlod::options) struct SizingFields {
    maps: &'static [&'static str],
    size_beside_any: bool,
}

/// An approximated layer's: six maps, `textureSize` beside any sizing.
pub(in crate::hlod::options) const APPROXIMATION_SIZING: SizingFields = SizingFields {
    maps: &[
        "base",
        "normal",
        "roughness",
        "metallic",
        "specular",
        "emissive",
    ],
    size_beside_any: true,
};

/// A merged layer's: the eleven maps a merge bakes, `textureSize` beside `fixed` and `biased`.
pub(in crate::hlod::options) const MERGE_SIZING: SizingFields = SizingFields {
    maps: &[
        "base",
        "normal",
        "tangent",
        "roughness",
        "metallic",
        "anisotropy",
        "specular",
        "emissive",
        "opacity",
        "opacityMask",
        "ambientOcclusion",
    ],
    size_beside_any: false,
};

/// A simplified layer's: the eight maps its transfer writes, `textureSize` beside `fixed` and
/// `biased`.
pub(in crate::hlod::options) const SIMPLIFY_SIZING: SizingFields = SizingFields {
    maps: &[
        "base",
        "normal",
        "roughness",
        "metallic",
        "specular",
        "emissive",
        "opacity",
        "opacityMask",
    ],
    size_beside_any: false,
};

/// The least sides a biased sizing gives the half-size maps and the quarter-size maps, texels: an
/// approximated atlas's 32 and 16, a merged atlas's 8 and 4.
pub type HlodBiasFloors = (usize, usize);

/// An approximated layer's floors (`HlodBiasFloors`).
pub const APPROXIMATION_FLOORS: HlodBiasFloors = (32, 16);

/// A merged layer's floors (`HlodBiasFloors`).
pub const MERGE_FLOORS: HlodBiasFloors = (8, 4);

/// Each map's side in a `manual` atlas, texels, each 1024 by default, rounded up to a power of
/// two: an approximated atlas's base colour, normal map, roughness, metallic, specular and
/// emission, and, beside them, the maps a merged atlas also bakes — tangent, anisotropy, opacity,
/// opacity mask and ambient occlusion.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub struct HlodMapSides {
    pub base: usize,
    pub normal: usize,
    pub tangent: usize,
    pub roughness: usize,
    pub metallic: usize,
    pub anisotropy: usize,
    pub specular: usize,
    pub emissive: usize,
    pub opacity: usize,
    pub opacity_mask: usize,
    pub occlusion: usize,
}

impl Default for HlodMapSides {
    fn default() -> Self {
        Self {
            base: 1024,
            normal: 1024,
            tangent: 1024,
            roughness: 1024,
            metallic: 1024,
            anisotropy: 1024,
            specular: 1024,
            emissive: 1024,
            opacity: 1024,
            opacity_mask: 1024,
            occlusion: 1024,
        }
    }
}

impl HlodMapSides {
    /// The largest of an approximated atlas's six, whichever maps the layer bakes: the side the
    /// atlas is baked at.
    pub fn largest(&self) -> usize {
        [
            self.base,
            self.normal,
            self.roughness,
            self.metallic,
            self.specular,
            self.emissive,
        ]
        .into_iter()
        .fold(1, usize::max)
    }

    /// The sides `size`'s biased sizing gives: the normal map at `size`, the base colour and the
    /// tangent map at half of it, `floors.0` at least, every other map at a quarter, `floors.1` at
    /// least.
    pub fn biased(size: usize, floors: HlodBiasFloors) -> Self {
        let (half, quarter) = ((size >> 1).max(floors.0), (size >> 2).max(floors.1));
        Self {
            base: half,
            normal: size,
            tangent: half,
            roughness: quarter,
            metallic: quarter,
            anisotropy: quarter,
            specular: quarter,
            emissive: quarter,
            opacity: quarter,
            opacity_mask: quarter,
            occlusion: quarter,
        }
    }

    /// The side of the map `mapSizes` names `key`.
    fn side_mut(&mut self, key: &str) -> Option<&mut usize> {
        Some(match key {
            "base" => &mut self.base,
            "normal" => &mut self.normal,
            "tangent" => &mut self.tangent,
            "roughness" => &mut self.roughness,
            "metallic" => &mut self.metallic,
            "anisotropy" => &mut self.anisotropy,
            "specular" => &mut self.specular,
            "emissive" => &mut self.emissive,
            "opacity" => &mut self.opacity,
            "opacityMask" => &mut self.opacity_mask,
            "ambientOcclusion" => &mut self.occlusion,
            _ => return None,
        })
    }
}

/// How an approximated or merged layer sizes its atlas (`textureSizing`, the module doc).
#[derive(Clone, Copy, PartialEq, Debug)]
pub enum HlodAtlasSizing {
    /// One side for every map: `fixed` (the default), `texelDensity`, `screenSize` or
    /// `drawDistance`, as a simplified layer reads them.
    Uniform(HlodTextureSizing),
    /// The layer's side biased per map (`'biased'`, `HlodMapSides::biased`).
    Biased,
    /// Each map's own side (`'manual'`, `mapSizes`).
    Manual(HlodMapSides),
}

impl Default for HlodAtlasSizing {
    fn default() -> Self {
        Self::Uniform(HlodTextureSizing::Fixed)
    }
}

impl HlodAtlasSizing {
    /// The largest side an atlas of a layer whose `textureSize` is `texture_size` is baked at:
    /// `texture_size` where the sizing names it or biases from it, the largest side a density may
    /// give, the largest of a manual sizing's own sides `largest` picks.
    pub fn baked_side(
        self,
        texture_size: usize,
        largest: impl Fn(&HlodMapSides) -> usize,
    ) -> usize {
        match self {
            Self::Uniform(HlodTextureSizing::Fixed) | Self::Biased => texture_size,
            Self::Uniform(_) => crate::MAX_HLOD_TEXTURE_SIZE,
            Self::Manual(sides) => largest(&sides),
        }
    }
}

/// Each side of `mapSizes` in `entry` (`what` naming the layer) among the maps `fields` names, a
/// whole number from `MIN_HLOD_TEXTURE_SIZE` to `MAX_HLOD_TEXTURE_SIZE` rounded up to a power of
/// two, 1024 when left out.
fn map_sides(entry: Option<&Value>, what: &str, fields: SizingFields) -> Result<HlodMapSides> {
    let mut sides = HlodMapSides::default();
    let Some(entry) = entry.filter(|v| !v.is_null()) else {
        return Ok(sides);
    };
    let what = format!("{what}.mapSizes");
    let named = OPTIONS.known(entry, fields.maps, &what)?;
    let bounds = (MIN_HLOD_TEXTURE_SIZE, MAX_HLOD_TEXTURE_SIZE);
    for key in fields.maps {
        if let (Some(v), Some(side)) = (counted(named, key, &what, bounds)?, sides.side_mut(key)) {
            *side = v.next_power_of_two();
        }
    }
    Ok(sides)
}

/// How layer `map` (`what` naming it) sizes its atlas (`HlodAtlasSizing`), as `fields` says what
/// its builder takes: its `textureSizing` among the simplified layer's sizings and its own, with
/// the one setting its sizing reads — `texelsPerMetre` 5, from 0.1 to 1024; `atlasScreenSize` 0.5,
/// from 0.01 to 1; `mapSizes` —, a sizing's setting named beside another sizing refused, and so is
/// a `textureSize` beside a sizing that does not read it.
pub(in crate::hlod::options) fn atlas_sizing(
    map: &Map<String, Value>,
    what: &str,
    fields: SizingFields,
) -> Result<HlodAtlasSizing> {
    let words: Vec<&str> = HLOD_TEXTURE_SIZINGS
        .iter()
        .chain(&OWN_SIZINGS)
        .copied()
        .collect();
    let sizing = chosen(map, "textureSizing", what, &words)?.unwrap_or(0);
    let reads = [
        (1, "texelsPerMetre"),
        (2, "atlasScreenSize"),
        (5, "mapSizes"),
    ];
    let unread = reads
        .iter()
        .find(|&&(k, key)| k != sizing && named(map, key))
        .map(|&(_, key)| key);
    // A merged layer's `textureSize` sizes `fixed` and `biased` atlases alone.
    let size_unread =
        (!fields.size_beside_any && ![0, 4].contains(&sizing) && named(map, "textureSize"))
            .then_some("textureSize");
    if let Some(key) = unread.or(size_unread) {
        return Err(OPTIONS.bad(format!(
            "{what}: {key} does not size a {} atlas",
            words[sizing]
        )));
    }
    Ok(match sizing {
        0 => HlodAtlasSizing::Uniform(HlodTextureSizing::Fixed),
        1 => HlodAtlasSizing::Uniform(HlodTextureSizing::TexelDensity(
            ranged(map, "texelsPerMetre", what, (0.1, 1024.0))?.unwrap_or(5.0),
        )),
        2 => HlodAtlasSizing::Uniform(HlodTextureSizing::ScreenSize(
            ranged(map, "atlasScreenSize", what, (0.01, 1.0))?.unwrap_or(0.5),
        )),
        3 => HlodAtlasSizing::Uniform(HlodTextureSizing::DrawDistance),
        4 => HlodAtlasSizing::Biased,
        _ => HlodAtlasSizing::Manual(map_sides(map.get("mapSizes"), what, fields)?),
    })
}
