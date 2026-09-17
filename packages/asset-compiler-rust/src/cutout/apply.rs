//! Ce qu'une réponse change dans la scène, et les cas où elle est refusée.
//!
//! Une réponse porte sur une TEXTURE, et une texture sert parfois plusieurs matériaux : la réponse
//! vaut alors pour toutes ses liaisons de couleur de base, sinon deux surfaces de la même feuille
//! se contrediraient à l'écran. Deux formes sont refusées même quand la réponse dit « découpe » :
//! un matériau qui transmet la lumière — une vitre teintée garde son épaisseur — et un matériau
//! dont le facteur alpha est déjà partiel, où l'opacité ne vient pas de la texture.
use super::*;
use crate::texture_preview::{collect, source};

/// Ce que l'étape a fait, et ce qu'elle laisse à la page : les textures qu'une réponse a fait
/// basculer restent montrées, pour qu'un avis puisse être repris.
pub(crate) struct CutoutApplied {
    pub report: Value,
    /// Ce qui a vraiment changé la scène, et qui entre à ce titre dans l'identité du produit : les
    /// liaisons reclassées. Une réponse « vitre », ou une réponse portant sur une texture que cette
    /// scène n'emploie pas, ne change aucun octet et ne doit donc pas déplacer la clé du cache.
    pub identity: Value,
    pub answered: BTreeSet<usize>,
    /// Les matériaux que chaque texture candidate habille : ce qui permet à la page de montrer
    /// d'abord les textures qui tiennent le plus de primitives en mélange.
    pub materials_by_texture: BTreeMap<usize, BTreeSet<usize>>,
}

/// Une liaison candidate : un matériau déclaré en mélange dont la couleur de base porte une texture.
struct Candidate {
    material: usize,
    texture: usize,
    image_sha: String,
}

pub(crate) fn apply_decisions(
    g: &mut Value,
    bin: &[u8],
    image_root: &Path,
    meshes: &BTreeSet<usize>,
    decisions: &Decisions,
) -> Result<CutoutApplied> {
    let candidates = candidates(g, bin, image_root, meshes)?;
    let (mut applied, mut refused) = (Vec::new(), Vec::new());
    let (mut answered, mut pending) = (BTreeSet::new(), BTreeSet::new());
    let mut materials_by_texture: BTreeMap<usize, BTreeSet<usize>> = BTreeMap::new();
    for candidate in &candidates {
        materials_by_texture
            .entry(candidate.texture)
            .or_default()
            .insert(candidate.material);
        match decisions.verdict(&candidate.image_sha) {
            Some(true) => {}
            Some(false) => continue,
            None => {
                pending.insert(candidate.image_sha.clone());
                continue;
            }
        }
        answered.insert(candidate.texture);
        if let Some(reason) = refusal(g, candidate.material) {
            refused.push(json!({"material":candidate.material,"reason":reason}));
            continue;
        }
        let Some(material) = g
            .get_mut("materials")
            .and_then(Value::as_array_mut)
            .and_then(|materials| materials.get_mut(candidate.material))
        else {
            continue;
        };
        material["alphaMode"] = json!("MASK");
        if material.get("alphaCutoff").is_none() {
            material["alphaCutoff"] = json!(CUTOUT_ALPHA);
        }
        applied.push(
            json!({"material":candidate.material,"texture":candidate.texture,"image":candidate.image_sha}),
        );
    }
    let identity = json!({ "applied": applied, "refused": refused });
    let report = json!({"decisions":decisions.report(),"candidates":candidates.len(),
        "applied":applied,"refused":refused,"pendingTextures":pending.len()});
    Ok(CutoutApplied {
        report,
        identity,
        answered,
        materials_by_texture,
    })
}

/// Pourquoi ce matériau reste en mélange malgré la réponse, ou `None` quand rien ne s'y oppose.
fn refusal(g: &Value, material: usize) -> Option<&'static str> {
    let material = g
        .get("materials")
        .and_then(Value::as_array)
        .and_then(|materials| materials.get(material))?;
    if unsplit_material(Some(material)) {
        return Some("transmission");
    }
    let factor = material
        .pointer("/pbrMetallicRoughness/baseColorFactor")
        .and_then(Value::as_array)
        .and_then(|factor| factor.get(3))
        .and_then(Value::as_f64);
    if factor.is_some_and(|alpha| alpha < 1.0) {
        return Some("alpha-factor");
    }
    None
}

/// Les liaisons candidates de la scène, chacune avec l'empreinte de son image. Une image partagée
/// n'est lue et hachée qu'une fois ; une image illisible n'est pas une candidate, et l'étape des
/// aperçus la nommera au rapport comme elle le fait déjà.
fn candidates(
    g: &Value,
    bin: &[u8],
    image_root: &Path,
    meshes: &BTreeSet<usize>,
) -> Result<Vec<Candidate>> {
    let (Some(materials), Some(textures), Some(images)) = (
        g.get("materials").and_then(Value::as_array),
        g.get("textures").and_then(Value::as_array),
        g.get("images").and_then(Value::as_array),
    ) else {
        return Ok(Vec::new());
    };
    let mut hashes: BTreeMap<usize, String> = BTreeMap::new();
    let mut found = Vec::new();
    for id in collect::used_materials(g, meshes)? {
        let Some(material) = materials.get(id) else {
            continue;
        };
        if material.get("alphaMode").and_then(Value::as_str) != Some("BLEND") {
            continue;
        }
        let Some(texture) =
            collect::texture_index(material.pointer("/pbrMetallicRoughness/baseColorTexture"))
        else {
            continue;
        };
        let Some(image) = textures
            .get(texture)
            .and_then(|texture| texture.get("source"))
            .and_then(Value::as_u64)
            .map(|image| image as usize)
        else {
            continue;
        };
        let sha = match hashes.get(&image) {
            Some(known) => known.clone(),
            None => {
                let Some(bytes) = images
                    .get(image)
                    .and_then(|image| source::raw_image_bytes(g, bin, image_root, image).ok())
                else {
                    continue;
                };
                let sha = hash(&bytes.0);
                hashes.insert(image, sha.clone());
                sha
            }
        };
        found.push(Candidate {
            material: id,
            texture,
            image_sha: sha,
        });
    }
    Ok(found)
}
