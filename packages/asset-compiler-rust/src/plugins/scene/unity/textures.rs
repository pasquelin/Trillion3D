//! Les textures d'un matériau Unity : un GUID, un fichier, une image du glTF.
//!
//! Le pilote ne décode rien lui-même. Il nomme l'image par son chemin, relativement au dossier
//! servi, et laisse le registre d'images dire si ce format se lit : une texture d'un format que le
//! registre ne connaît pas est comptée au rapport et la scène continue sans elle — jamais un échec.
use super::*;
use std::collections::HashMap;

/// Répétition par défaut d'une texture Unity : `wrap` à `REPEAT`, comme le réglage d'import Unity
/// sauf mention contraire dans le `.meta`, que ce pilote ne lit pas encore.
const REPEAT: u32 = 10497;

#[derive(Default)]
pub(super) struct Textures {
    by_guid: HashMap<String, Option<usize>>,
}

impl Textures {
    /// Le rang de la texture glTF pour ce GUID, versée à la première demande.
    pub(super) fn texture(
        &mut self,
        reference: &Ref,
        scene: &mut Scene,
        project: &Project,
    ) -> Option<usize> {
        let guid = reference.guid.as_ref()?;
        *self
            .by_guid
            .entry(guid.clone())
            .or_insert_with(|| resolve(guid, scene, project))
    }
}

fn resolve(guid: &str, scene: &mut Scene, project: &Project) -> Option<usize> {
    let Some(asset) = project.asset(guid) else {
        scene.report.add("unity-texture-missing");
        return None;
    };
    let name = asset.file_name()?.to_string_lossy().to_string();
    let Some(decoder) = crate::plugins::image::by_extension(asset) else {
        scene.report.add("unity-texture-format");
        scene
            .report
            .notes
            .push(format!("texture hors registre d'images: {name}"));
        return None;
    };
    let Some(uri) = project.relative_uri(asset) else {
        scene.report.add("unity-texture-outside-source");
        return None;
    };
    scene
        .images
        .push(json!({"name":name,"mimeType":decoder.mime(),"uri":uri}));
    let sampler = scene.sampler(REPEAT);
    scene
        .textures
        .push(json!({"source":scene.images.len()-1,"sampler":sampler}));
    scene.count("textures", 1);
    Some(scene.textures.len() - 1)
}
