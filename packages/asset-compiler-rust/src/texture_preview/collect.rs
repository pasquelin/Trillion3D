use super::reduce::AtlasKind;
use super::*;

/// A texture of an engine atlas, and which one: the same glTF texture can feed both.
#[derive(Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Debug)]
pub(crate) struct AtlasTexture {
    pub texture: usize,
    pub kind: AtlasKind,
}

/// Textures that feed the engine atlases, sorted by texture then by atlas —
/// exactly what `collectWebgpuMaterialTextures` puts there: base colour and
/// emissive in the colour atlas; metal-roughness, normal and occlusion in the
/// data atlas. The base colour of a cutout material and the emissive of another
/// are one entry: the atlas does not know the binding, and neither does the mip
/// chain.
pub(super) fn atlas_textures(g: &Value, meshes: &BTreeSet<usize>) -> Result<Vec<AtlasTexture>> {
    let Some(materials) = g.get("materials").and_then(Value::as_array) else {
        return Ok(Vec::new());
    };
    let mut wanted = BTreeSet::new();
    for id in used_materials(g, meshes)? {
        let Some(material) = materials.get(id) else {
            continue;
        };
        let bindings = [
            (
                material.pointer("/pbrMetallicRoughness/baseColorTexture"),
                AtlasKind::Color,
            ),
            (material.get("emissiveTexture"), AtlasKind::Color),
            (
                material.pointer("/pbrMetallicRoughness/metallicRoughnessTexture"),
                AtlasKind::Data,
            ),
            (material.get("normalTexture"), AtlasKind::Data),
            (material.get("occlusionTexture"), AtlasKind::Data),
        ];
        for (reference, kind) in bindings {
            if let Some(texture) = texture_index(reference) {
                wanted.insert(AtlasTexture { texture, kind });
            }
        }
    }
    Ok(wanted.into_iter().collect())
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
