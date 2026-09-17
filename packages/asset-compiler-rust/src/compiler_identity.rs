//! L'identité du produit compilé : ce dont la clé du cache est faite, et rien d'autre.
//!
//! La clé nomme un dossier de cache que des consommateurs réutilisent sans le relire. Elle doit donc
//! tenir deux promesses opposées : deux compilations qui rendraient les mêmes octets portent la même
//! clé, et deux compilations qui rendraient des octets différents en portent deux. Un manifeste
//! d'import haché tel quel trahissait la première — il porte le temps mesuré de la conversion et le
//! chemin de la machine qui l'a faite, que deux passages n'accordent jamais. Les images liées de la
//! scène, lues plus tard pour les aperçus, trahissaient la seconde — leurs pixels entrent dans le
//! sidecar sans entrer dans l'identité qui le nomme.
//!
//! L'identité se construit donc en deux parts : ce que la source déclare, dépouillé de ses mesures
//! et de sa provenance d'exécution, et l'empreinte des ressources que la compilation consomme
//! vraiment — le binaire de géométrie et chaque fichier d'image que la scène cite.
use super::*;

/// Les champs qu'un manifeste porte pour l'exploitation et non pour l'identité : un temps mesuré, le
/// chemin de la machine qui a converti. Ils sont retirés à tout niveau — un relevé par fichier
/// d'entrée porte les siens — et le reste entre dans la clé, y compris ce qu'un pilote y ajoutera
/// demain : oublier d'exclure resserre l'identité, oublier d'inclure la relâcherait.
const VOLATILE: [&str; 4] = ["importMs", "ms", "parseMs", "path"];

/// Recopie une valeur sans ses champs volatils, à tout niveau.
fn stable(value: &Value) -> Value {
    match value {
        Value::Object(fields) => Value::Object(
            fields
                .iter()
                .filter(|(name, _)| !VOLATILE.contains(&name.as_str()))
                .map(|(name, value)| (name.clone(), stable(value)))
                .collect(),
        ),
        Value::Array(items) => Value::Array(items.iter().map(stable).collect()),
        other => other.clone(),
    }
}

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
/// `cutouts` est ce qu'une réponse a VRAIMENT changé dans la scène : une liaison reclassée change le
/// classement de ses primitives, donc les octets du produit ; une réponse sans effet ne déplace pas
/// la clé.
pub(super) fn cache_key(
    o: &Options,
    loaded: &RuntimeSource,
    image_root: &Path,
    cutouts: &Value,
) -> Result<String> {
    let source = hash(&serde_json::to_vec(&stable(&loaded.manifest))?);
    let images = linked_images(&loaded.g, image_root);
    let bin_hash = &loaded.bin_hash;
    let material = json!({
        "source":source,"binary":bin_hash,"images":images,
        "compiler":COMPILER_VERSION,"implementation":implementation_hash(),
        "plugins":plugins::fingerprint(),"scope":o.scope,"budget":o.triangle_budget,
        "resourceBase":o.resource_base,"simplification":o.simplification,
        "errorModel":DAG_ERROR_MODEL,"cutouts":cutouts,
    });
    Ok(hash(serde_json::to_string(&material)?.as_bytes()))
}

#[cfg(test)]
mod tests {
    use super::*;

    // Comportement : un temps mesuré ou un chemin de machine sort de l'identité, à tout niveau ; le
    // reste du manifeste y entre tel quel.
    #[test]
    fn les_mesures_et_la_provenance_sortent_de_lidentite() {
        let manifest = json!({"runtime":{"sha256":"abc"},
            "source":{"plugin":"usd","path":"/chez/moi/s.usd","importMs":12.5,
                "files":[{"file":"s.usd","sha256":"def","parseMs":3.0,"ms":4.0}]}});
        assert_eq!(
            stable(&manifest),
            json!({"runtime":{"sha256":"abc"},
                "source":{"plugin":"usd","files":[{"file":"s.usd","sha256":"def"}]}})
        );
    }
}
