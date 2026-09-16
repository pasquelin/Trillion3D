//! Pilotes de formats : un module par format, une ligne de registre par pilote.
//!
//! Le compilateur ne connaît aucun format d'entrée. Il demande au routeur quel pilote reconnaît la
//! source, puis lui fait produire la scène intermédiaire qu'il sait déjà lire — un glTF 2.0, son
//! binaire et son manifeste. Les images suivent le même modèle : un pilote par format, interrogé par
//! extension ou par nombre magique, qui décode vers le type de sortie du contrat.
//!
//! Ajouter un format, c'est ajouter un module et une ligne de registre ; le cœur ne bouge pas.
//! `PLUGINS.md` est le mode d'emploi d'un pilote, `FORMATS.md` la
//! politique : quels formats sont admis, lesquels sont refusés, et sous quelles conditions.
use serde_json::{json, Value};

pub mod image;
pub mod scene;
#[cfg(test)]
mod tests;

/// Ce que tout pilote déclare, quel que soit son contrat. Un pilote par format : deux formats ne
/// partagent jamais un nom, même quand ils partagent leur bibliothèque de lecture.
pub trait Plugin {
    /// Nom du format, en minuscules. Il voyage dans le manifeste, le rapport et l'identité du cache.
    fn name(&self) -> &'static str;
    /// Version du pilote. La changer change l'identité du compilateur et invalide ses caches.
    fn version(&self) -> &'static str;
    /// Extensions revendiquées, en minuscules et sans le point.
    fn extensions(&self) -> &'static [&'static str];
}

/// Le nom et la version d'un pilote, tels qu'ils voyagent dans les manifestes et les rapports.
pub fn provenance<P: Plugin + ?Sized>(plugin: &P) -> Value {
    json!({"name": plugin.name(), "version": plugin.version()})
}

/// Le pilote du registre qui revendique cette extension, en minuscules et sans le point.
fn claiming<'a, P: Plugin + ?Sized>(plugins: &[&'a P], extension: &str) -> Option<&'a P> {
    plugins
        .iter()
        .copied()
        .find(|plugin| plugin.extensions().contains(&extension))
}

/// L'extension d'un nom de fichier, en minuscules et sans le point.
fn extension_of(name: &str) -> Option<String> {
    name.rsplit_once('.')
        .map(|(_, extension)| extension.to_ascii_lowercase())
        .filter(|extension| !extension.is_empty())
}

fn append<P: Plugin + ?Sized>(plugins: &[&P], into: &mut String) {
    for plugin in plugins {
        into.push(';');
        into.push_str(plugin.name());
        into.push('=');
        into.push_str(plugin.version());
    }
}

fn registry<P: Plugin + ?Sized>(plugins: &[&P]) -> Vec<Value> {
    plugins
        .iter()
        .map(|plugin| json!({"name":plugin.name(),"version":plugin.version(),"extensions":plugin.extensions()}))
        .collect()
}

/// Empreinte du registre, versée dans l'identité du cache de compilation : un pilote ajouté, retiré
/// ou reversionné change la clé, donc rien de ce qu'a écrit l'ancien registre n'est relu comme à
/// jour. Les versions des contrats y entrent aussi : elles bornent ce qu'un pilote promet.
pub fn fingerprint() -> String {
    let mut out = format!("{}+{}", scene::VERSION, image::VERSION);
    append(scene::PLUGINS, &mut out);
    append(image::DECODERS, &mut out);
    out
}

/// Le registre publié par `--version` : ce que ce binaire sait lire, format par format.
pub fn descriptor() -> Value {
    json!({
        "sceneContract": scene::VERSION,
        "imageContract": image::VERSION,
        "scene": registry(scene::PLUGINS),
        "image": registry(image::DECODERS),
    })
}
