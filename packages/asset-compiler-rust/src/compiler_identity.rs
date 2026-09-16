//! L'identité du produit compilé : ce dont la clé du cache est faite, et rien d'autre.
//!
//! La clé nomme un dossier de cache que des consommateurs réutilisent sans le relire : deux
//! compilations qui rendraient des octets différents doivent en porter deux. Les images liées de la
//! scène, lues plus tard pour les aperçus, trahissaient cette promesse — leurs pixels entrent dans
//! le sidecar sans entrer dans l'identité qui le nomme.
//!
//! L'identité, c'est donc ce que la source déclare **et** l'empreinte des ressources que la
//! compilation consomme vraiment : le binaire de géométrie et chaque fichier d'image que la scène
//! cite.
use super::*;

/// Les images que la scène cite par URI relative, dans son ordre, avec l'empreinte du fichier
/// trouvé. `null` dit l'absence : une image qui apparaît change l'identité autant qu'une image dont
/// les octets changent. Les images embarquées n'y sont pas — leurs octets sont déjà ceux du binaire.
fn linked_images(g: &Value, image_root: &Path) -> Vec<Value> {
    let Some(images) = g.get("images").and_then(Value::as_array) else {
        return Vec::new();
    };
    images
        .iter()
        .filter_map(|image| {
            let uri = image.get("uri").and_then(Value::as_str)?;
            let path = crate::uri::resolve_under(image_root, uri).ok()?;
            Some(json!({"uri":uri,"sha256":hash_file(&path).ok()}))
        })
        .collect()
}

/// La clé du cache : l'identité de la source, celle des ressources qu'elle consomme, et les options
/// qui décident du produit. Un consommateur qui réutilise par cette clé retrouve les mêmes octets.
/// `image_root` est la racine où les URI relatives d'images se résolvent, que le routeur a nommée.
pub(super) fn cache_key(o: &Options, loaded: &RuntimeSource, image_root: &Path) -> Result<String> {
    let source = hash(&serde_json::to_vec(&loaded.manifest)?);
    let images = linked_images(&loaded.g, image_root);
    let bin_hash = &loaded.bin_hash;
    let material = json!({
        "source":source,"binary":bin_hash,"images":images,
        "compiler":COMPILER_VERSION,"implementation":implementation_hash(),
        "plugins":plugins::fingerprint(),"scope":o.scope,"budget":o.triangle_budget,
        "resourceBase":o.resource_base,"simplification":o.simplification,
        "errorModel":DAG_ERROR_MODEL,
    });
    Ok(hash(serde_json::to_string(&material)?.as_bytes()))
}
