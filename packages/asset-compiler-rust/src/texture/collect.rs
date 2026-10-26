use super::blocks::quality::Channels;
use super::cut::Cut;
use super::reduce::AtlasKind;
use super::*;
use crate::compiler::materials::AlphaMode;

/// A texture of an engine atlas, and which one: the same glTF texture can feed
/// both. With it, what the materials read of it — the roles it plays, hence the
/// channels the gate measures and the layout its blocks take — and the alpha
/// cuts — cutoff and colour factor alpha — of the masked materials that read it.
#[derive(Clone, PartialEq, Debug)]
pub(crate) struct AtlasTexture {
    pub texture: usize,
    pub kind: AtlasKind,
    /// Union of `Role::channels` over the roles the texture plays.
    pub channels: Channels,
    /// True when every role is the normal map's: two channels, Z rebuilt.
    pub normal_only: bool,
    pub cutoffs: Vec<Cut>,
}

/// Merges what one more reader reads into `channels` and `cutoffs`: the union
/// of the channels, a cutoff once. The one rule, for a texture's roles as for a
/// chain's textures.
pub(crate) fn absorb(
    channels: &mut Channels,
    cutoffs: &mut Vec<Cut>,
    more: Channels,
    theirs: &[Cut],
) {
    for (mine, read) in channels.iter_mut().zip(more) {
        *mine |= read;
    }
    for &cutoff in theirs {
        if !cutoffs.contains(&cutoff) {
            cutoffs.push(cutoff);
        }
    }
}

/// A material binding, and the channels its shader reads: the base colour's
/// alpha only when the material is not opaque; metallic in B, roughness in G;
/// occlusion in R; the normal's three, Z included, since the shader rebuilds
/// it from X and Y and the gate must measure that against the map's own; the
/// height of a displaced material in R (`tables/displacement.rs`).
#[derive(Clone, Copy, PartialEq, Eq)]
enum Role {
    BaseColor,
    Emissive,
    MetalRough,
    Normal,
    Occlusion,
    Displacement,
}

impl Role {
    fn reference(self, material: &Value) -> Option<&Value> {
        match self {
            Self::BaseColor => material.pointer("/pbrMetallicRoughness/baseColorTexture"),
            Self::Emissive => material.get("emissiveTexture"),
            Self::MetalRough => material.pointer("/pbrMetallicRoughness/metallicRoughnessTexture"),
            Self::Normal => material.get("normalTexture"),
            Self::Occlusion => material.get("occlusionTexture"),
            Self::Displacement => crate::compiler::tables::displacement::height_map(material),
        }
    }
    /// The atlas the role is read from.
    fn kind(self) -> AtlasKind {
        match self {
            Self::BaseColor | Self::Emissive => AtlasKind::Color,
            _ => AtlasKind::Data,
        }
    }
    fn channels(self, opaque: bool) -> Channels {
        match self {
            Self::BaseColor => [true, true, true, !opaque],
            Self::Emissive | Self::Normal => [true, true, true, false],
            Self::MetalRough => [false, true, true, false],
            Self::Occlusion | Self::Displacement => [true, false, false, false],
        }
    }
}

const ROLES: [Role; 6] = [
    Role::BaseColor,
    Role::Emissive,
    Role::MetalRough,
    Role::Normal,
    Role::Occlusion,
    Role::Displacement,
];

/// Textures that feed the engine atlases, sorted by texture then by atlas —
/// exactly what `collectWebgpuMaterialTextures` puts there: base colour and
/// emissive in the colour atlas; metal-roughness, normal, occlusion and the
/// height map of a displaced material in the data atlas. The base colour of a
/// cutout material and the emissive of another
/// are one entry: the atlas does not know the binding, and neither does the mip
/// chain — the entry reads both roles' channels and every cutoff. `used` are the
/// materials of the compiled meshes (`used_materials`).
pub(super) fn atlas_textures(g: &Value, used: &BTreeSet<usize>) -> Vec<AtlasTexture> {
    let Some(materials) = g.get("materials").and_then(Value::as_array) else {
        return Vec::new();
    };
    let mut wanted: BTreeMap<(usize, AtlasKind), AtlasTexture> = BTreeMap::new();
    for &id in used {
        let Some(material) = materials.get(id) else {
            continue;
        };
        let mode = AlphaMode::of(material);
        let opaque = mode == AlphaMode::Opaque;
        let cut = match mode {
            AlphaMode::Mask(cutoff) => Some(super::cut::material_cut(material, cutoff as f32)),
            _ => None,
        };
        for role in ROLES {
            let Some(texture) = texture_index(role.reference(material)) else {
                continue;
            };
            let kind = role.kind();
            let entry = wanted
                .entry((texture, kind))
                .or_insert_with(|| AtlasTexture {
                    texture,
                    kind,
                    channels: [false; 4],
                    normal_only: true,
                    cutoffs: Vec::new(),
                });
            let cutoffs: Vec<Cut> = cut
                .filter(|_| role == Role::BaseColor)
                .into_iter()
                .collect();
            absorb(
                &mut entry.channels,
                &mut entry.cutoffs,
                role.channels(opaque),
                &cutoffs,
            );
            entry.normal_only &= role == Role::Normal;
        }
    }
    wanted.into_values().collect()
}

pub(crate) fn texture_index(reference: Option<&Value>) -> Option<usize> {
    reference?
        .get("index")
        .and_then(Value::as_u64)
        .map(|value| value as usize)
}

/// Materials that compiled meshes actually use, without duplicates: read once per compilation,
/// for the image fingerprints and the atlas textures.
pub(crate) fn used_materials(g: &Value, meshes: &BTreeSet<usize>) -> Result<BTreeSet<usize>> {
    let Some(mesh_values) = g.get("meshes").and_then(Value::as_array) else {
        return Ok(BTreeSet::new());
    };
    let mut used = BTreeSet::new();
    for id in meshes {
        let mesh = item(mesh_values, *id, "mesh")?;
        for primitive in values(mesh, "primitives")? {
            if let Some(material) = primitive.get("material").and_then(Value::as_u64) {
                used.insert(material as usize);
            }
        }
    }
    Ok(used)
}
