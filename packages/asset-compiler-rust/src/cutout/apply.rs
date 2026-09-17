//! Ce qu'une réponse change dans la scène, et les cas où elle est refusée.
//!
//! Une réponse porte sur une TEXTURE, et une texture sert parfois plusieurs matériaux : la réponse
//! vaut alors pour toutes ses liaisons de couleur de base, sinon deux surfaces de la même feuille
//! se contrediraient à l'écran. Deux formes sont refusées même quand la réponse dit « découpe » :
//! un matériau qui transmet la lumière — une vitre teintée garde son épaisseur — et un matériau
//! dont le facteur alpha est déjà partiel, où l'opacité ne vient pas de la texture.
use super::*;
use crate::texture_preview::{collect, source};

/// Ce que l'étape a fait. `applied` est aussi ce qui entre dans l'identité du produit : une réponse
/// « vitre », un refus, ou une réponse portant sur une texture que cette scène n'emploie pas ne
/// changent aucun octet et ne doivent donc pas déplacer la clé du cache.
pub(crate) struct CutoutApplied {
    pub applied: Vec<Value>,
    pub refused: Vec<Value>,
    /// Les matériaux que chaque texture candidate habille. Les clés sont les textures à mesurer —
    /// l'étape des aperçus les reçoit telles quelles —, et les valeurs servent à montrer d'abord
    /// celles qui tiennent le plus de primitives en mélange.
    pub materials_by_texture: BTreeMap<usize, BTreeSet<usize>>,
}

impl CutoutApplied {
    /// Les textures dont l'alpha est à mesurer : toutes les candidates, y compris celles qu'une
    /// réponse vient de faire basculer — la page les montre encore, pour qu'un avis soit repris.
    pub fn to_measure(&self) -> BTreeSet<usize> {
        self.materials_by_texture.keys().copied().collect()
    }
    pub fn report(&self, decisions: &Decisions) -> Value {
        json!({"decisions":decisions.report(),"candidateTextures":self.materials_by_texture.len(),
            "applied":self.applied,"refused":self.refused})
    }
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
    let mut materials_by_texture: BTreeMap<usize, BTreeSet<usize>> = BTreeMap::new();
    for candidate in &candidates {
        materials_by_texture
            .entry(candidate.texture)
            .or_default()
            .insert(candidate.material);
        if decisions.verdict(&candidate.image_sha) != Some(true) {
            continue;
        }
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
    Ok(CutoutApplied {
        applied,
        refused,
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
/// n'est lue et hachée qu'une fois DANS CETTE ÉTAPE — l'étape des aperçus relira les mêmes octets
/// pour les décoder, et le parcours entier est mesuré à 0,08 s sur `emerald-square`, ce qui ne
/// justifie pas de garder ces octets en mémoire entre les deux. Une image illisible n'est pas une
/// candidate, et l'étape des aperçus la nommera au rapport comme elle le fait déjà.
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
    // Lire et hacher les images candidates est ce que cette étape coûte avant toute mesure : une
    // image partagée n'est lue qu'une fois, et le compteur dit ce que ce parcours vaut.
    let _t = perf::Timer::new(perf::Phase::CutoutScan);
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
