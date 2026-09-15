use super::*;

/// Une texture couleur et, s'il y a lieu, le seuil de découpe dont il faut préserver la couverture.
pub(super) struct ColorTexture {
    pub texture: usize,
    pub cutoff: Option<f32>,
}

/// Seuil de découpe par défaut de glTF, employé seulement quand le matériau MASK n'en déclare pas.
const DEFAULT_ALPHA_CUTOFF: f32 = 0.5;

#[derive(Default)]
struct Binding {
    /// Une liaison qui n'est pas la couleur de base d'un matériau MASK : émissif, BLEND ou OPAQUE.
    plain: bool,
    cutoff: Option<f32>,
}

/// Les textures qui alimentent l'atlas couleur du moteur : couleur de base et émissif des matériaux
/// des maillages retenus — exactement ce que `collectWebgpuMaterialTextures` y range.
pub(super) fn color_textures(g: &Value, meshes: &BTreeSet<usize>) -> Result<Vec<ColorTexture>> {
    let Some(materials) = g.get("materials").and_then(Value::as_array) else {
        return Ok(Vec::new());
    };
    let mut bindings: BTreeMap<usize, Binding> = BTreeMap::new();
    for id in used_materials(g, meshes)? {
        let Some(material) = materials.get(id) else {
            continue;
        };
        let mask = material.get("alphaMode").and_then(Value::as_str) == Some("MASK");
        let cutoff = material
            .get("alphaCutoff")
            .and_then(Value::as_f64)
            .map(|value| value as f32)
            .unwrap_or(DEFAULT_ALPHA_CUTOFF);
        if let Some(base) =
            texture_index(material.pointer("/pbrMetallicRoughness/baseColorTexture"))
        {
            let entry = bindings.entry(base).or_default();
            if mask {
                entry.cutoff = Some(entry.cutoff.map_or(cutoff, |known| known.min(cutoff)));
            } else {
                entry.plain = true;
            }
        }
        if let Some(emissive) = texture_index(material.get("emissiveTexture")) {
            bindings.entry(emissive).or_default().plain = true;
        }
    }
    // Une texture partagée n'est corrigée que si toutes ses liaisons sont des couleurs de base de
    // matériaux MASK, et alors au plus petit de leurs seuils : la moindre liaison BLEND, OPAQUE ou
    // émissive laisse l'alpha intact, car l'y remettre à l'échelle fausserait cette liaison-là.
    Ok(bindings
        .into_iter()
        .map(|(texture, binding)| ColorTexture {
            texture,
            cutoff: if binding.plain { None } else { binding.cutoff },
        })
        .collect())
}

fn texture_index(reference: Option<&Value>) -> Option<usize> {
    reference?
        .get("index")
        .and_then(Value::as_u64)
        .map(|value| value as usize)
}

/// Les matériaux que les maillages compilés emploient réellement, sans doublon.
fn used_materials(g: &Value, meshes: &BTreeSet<usize>) -> Result<BTreeSet<usize>> {
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
