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

/// A material binding, and the channels its shader reads: the base colour's
/// alpha only when the material is not opaque; metallic in B, roughness in G;
/// occlusion in R; the normal's three, Z included, since the shader rebuilds
/// it from X and Y and the gate must measure that against the map's own.
struct Role {
    kind: AtlasKind,
    channels: Channels,
    normal: bool,
    /// The base colour: the one channel a mask cutoff reads.
    mask: bool,
}

fn roles(material: &Value) -> [(Option<&Value>, Role); 5] {
    let opaque = material
        .get("alphaMode")
        .and_then(Value::as_str)
        .is_none_or(|mode| mode == "OPAQUE");
    let role = |kind, channels, normal, mask| Role {
        kind,
        channels,
        normal,
        mask,
    };
    [
        (
            material.pointer("/pbrMetallicRoughness/baseColorTexture"),
            role(AtlasKind::Color, [true, true, true, !opaque], false, true),
        ),
        (
            material.get("emissiveTexture"),
            role(AtlasKind::Color, [true, true, true, false], false, false),
        ),
        (
            material.pointer("/pbrMetallicRoughness/metallicRoughnessTexture"),
            role(AtlasKind::Data, [false, true, true, false], false, false),
        ),
        (
            material.get("normalTexture"),
            role(AtlasKind::Data, [true, true, true, false], true, false),
        ),
        (
            material.get("occlusionTexture"),
            role(AtlasKind::Data, [true, false, false, false], false, false),
        ),
    ]
}

/// Textures that feed the engine atlases, sorted by texture then by atlas —
/// exactly what `collectWebgpuMaterialTextures` puts there: base colour and
/// emissive in the colour atlas; metal-roughness, normal and occlusion in the
/// data atlas. The base colour of a cutout material and the emissive of another
/// are one entry: the atlas does not know the binding, and neither does the mip
/// chain — the entry reads both roles' channels and every cutoff.
pub(super) fn atlas_textures(g: &Value, meshes: &BTreeSet<usize>) -> Result<Vec<AtlasTexture>> {
    let Some(materials) = g.get("materials").and_then(Value::as_array) else {
        return Ok(Vec::new());
    };
    let mut wanted: BTreeMap<(usize, AtlasKind), AtlasTexture> = BTreeMap::new();
    for id in used_materials(g, meshes)? {
        let Some(material) = materials.get(id) else {
            continue;
        };
        let cutoff =
            (material.get("alphaMode").and_then(Value::as_str) == Some("MASK")).then(|| {
                material
                    .get("alphaCutoff")
                    .and_then(Value::as_f64)
                    .unwrap_or(0.5) as f32
            });
        for (reference, role) in roles(material) {
            let Some(texture) = texture_index(reference) else {
                continue;
            };
            let entry = wanted
                .entry((texture, role.kind))
                .or_insert_with(|| AtlasTexture {
                    texture,
                    kind: role.kind,
                    channels: [false; 4],
                    normal_only: true,
                    cutoffs: Vec::new(),
                });
            for (mine, theirs) in entry.channels.iter_mut().zip(role.channels) {
                *mine |= theirs;
            }
            entry.normal_only &= role.normal;
            if let Some(cutoff) = cutoff.filter(|_| role.mask) {
                if !entry.cutoffs.contains(&cutoff) {
                    entry.cutoffs.push(cutoff);
                }
            }
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
