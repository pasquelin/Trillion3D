use super::reduce::AtlasKind;
use super::*;

/// Une texture d'un atlas du moteur, et lequel : la même texture glTF peut alimenter les deux.
#[derive(Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Debug)]
pub(crate) struct AtlasTexture {
    pub texture: usize,
    pub kind: AtlasKind,
}

/// Les textures qui alimentent les atlas du moteur, triées par texture puis par atlas — exactement
/// ce que `collectWebgpuMaterialTextures` y range : couleur de base et émissif dans l'atlas
/// couleur ; métal-rugosité, normale et occlusion dans l'atlas de données. La couleur de base d'un
/// matériau qui découpe et l'émissif d'un autre sont une seule entrée : l'atlas ne connaît pas la
/// liaison, et la chaîne de mips non plus.
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

/// Les matériaux que les maillages compilés emploient réellement, sans doublon.
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
