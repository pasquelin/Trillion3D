use super::blocks::quality::Channels;
use super::reduce::AtlasKind;
use super::*;

/// A texture of an engine atlas, and which one: the same glTF texture can feed
/// both. With it, what the materials read of it — the roles it plays, hence the
/// channels the gate measures and the layout its blocks take — and the alpha
/// cutoffs of the masked materials that read it.
#[derive(Clone, PartialEq, Debug)]
pub(crate) struct AtlasTexture {
    pub texture: usize,
    pub kind: AtlasKind,
    /// Union of `Role::channels` over the roles the texture plays.
    pub channels: Channels,
    /// True when every role is the normal map's: two channels, Z rebuilt.
    pub normal_only: bool,
    pub cutoffs: Vec<f32>,
}

/// Merges what one more reader reads into `channels` and `cutoffs`: the union
/// of the channels, a cutoff once. The one rule, for a texture's roles as for a
/// chain's textures.
pub(crate) fn absorb(
    channels: &mut Channels,
    cutoffs: &mut Vec<f32>,
    more: Channels,
    theirs: &[f32],
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
/// it from X and Y and the gate must measure that against the map's own.
#[derive(Clone, Copy, PartialEq, Eq)]
enum Role {
    BaseColor,
    Emissive,
    MetalRough,
    Normal,
    Occlusion,
}

impl Role {
    fn reference(self, material: &Value) -> Option<&Value> {
        match self {
            Self::BaseColor => material.pointer("/pbrMetallicRoughness/baseColorTexture"),
            Self::Emissive => material.get("emissiveTexture"),
            Self::MetalRough => material.pointer("/pbrMetallicRoughness/metallicRoughnessTexture"),
            Self::Normal => material.get("normalTexture"),
            Self::Occlusion => material.get("occlusionTexture"),
        }
    }
    /// The chain the role asks for: the one role whose alpha the shader reads for
    /// coverage — the base colour of a BLEND material, or of a MASK one that cuts —
    /// takes the chain weighted by that alpha.
    fn kind(self, coverage: bool) -> AtlasKind {
        match self {
            Self::BaseColor if coverage => AtlasKind::Coverage,
            Self::BaseColor | Self::Emissive => AtlasKind::Color,
            _ => AtlasKind::Data,
        }
    }
    fn channels(self, opaque: bool) -> Channels {
        match self {
            Self::BaseColor => [true, true, true, !opaque],
            Self::Emissive | Self::Normal => [true, true, true, false],
            Self::MetalRough => [false, true, true, false],
            Self::Occlusion => [true, false, false, false],
        }
    }
}

const ROLES: [Role; 5] = [
    Role::BaseColor,
    Role::Emissive,
    Role::MetalRough,
    Role::Normal,
    Role::Occlusion,
];

/// Textures that feed the engine atlases, sorted by texture then by atlas —
/// exactly what `collectWebgpuMaterialTextures` puts there: base colour and
/// emissive in the colour atlas; metal-roughness, normal and occlusion in the
/// data atlas. The base colour of a cutout material and the emissive of another
/// are one entry: the atlas does not know the binding, and neither does the mip
/// chain — the entry reads both roles' channels and every cutoff. Its chain is
/// `Coverage` only while every reader asks for it: one opaque or emissive reader
/// and it is the plain `Color` chain, which draws that reader as before.
pub(super) fn atlas_textures(g: &Value, meshes: &BTreeSet<usize>) -> Result<Vec<AtlasTexture>> {
    let Some(materials) = g.get("materials").and_then(Value::as_array) else {
        return Ok(Vec::new());
    };
    let mut wanted: BTreeMap<(usize, AtlasKind), AtlasTexture> = BTreeMap::new();
    for id in used_materials(g, meshes)? {
        let Some(material) = materials.get(id) else {
            continue;
        };
        let mode = material.get("alphaMode").and_then(Value::as_str);
        let opaque = mode.is_none_or(|m| m == "OPAQUE");
        let cutoff = (mode == Some("MASK")).then(|| {
            material
                .get("alphaCutoff")
                .and_then(Value::as_f64)
                .unwrap_or(crate::cutout::CUTOUT_ALPHA) as f32
        });
        // A MASK cutoff at or under 0 cuts nothing: the engine draws it opaque
        // (`alphaTest > 0`, `collectWebgpuMaterialTextures`), the RGB under alpha 0 included.
        // So does a mode glTF does not name, which the material table writes `OPAQUE`
        // (`compiler_tables/materials.rs`): only BLEND and a cutting MASK take coverage.
        let coverage = mode == Some("BLEND") || cutoff.is_some_and(|c| c > 0.0);
        for role in ROLES {
            let Some(texture) = texture_index(role.reference(material)) else {
                continue;
            };
            let kind = role.kind(coverage);
            let atlas = kind.atlas();
            let entry = wanted
                .entry((texture, atlas))
                .or_insert_with(|| AtlasTexture {
                    texture,
                    kind,
                    channels: [false; 4],
                    normal_only: true,
                    cutoffs: Vec::new(),
                });
            // Readers that disagree on coverage share the plain chain.
            if entry.kind != kind {
                entry.kind = atlas;
            }
            let cutoffs: Vec<f32> = cutoff
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
    Ok(wanted.into_values().collect())
}

pub(crate) fn texture_index(reference: Option<&Value>) -> Option<usize> {
    reference?
        .get("index")
        .and_then(Value::as_u64)
        .map(|value| value as usize)
}

/// Materials that compiled meshes actually use, without duplicates.
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
