//! Les textures d'un matériau Unity : un GUID, un fichier, une image du glTF.
//!
//! Le pilote ne décode rien lui-même. Il nomme l'image par son chemin, relativement au dossier
//! servi, et laisse le registre d'images dire si ce format se lit : une texture d'un format que le
//! registre ne connaît pas est comptée au rapport et la scène continue sans elle — jamais un échec.
//! Comment l'échantillonner, en revanche, n'appartient pas à l'image : c'est le `TextureImporter`
//! du `.meta` qui le déclare, axe par axe pour la répétition et d'un seul réglage pour le filtrage.
use super::*;
use std::collections::HashMap;

/// Répétition par défaut d'une texture Unity, celle de l'éditeur sans mention contraire.
const REPEAT: u32 = 10497;
/// Les modes de répétition glTF, dans l'ordre où Unity les numérote : répéter, borner, refléter.
const WRAPS: [u32; 3] = [REPEAT, 33071, 33648];
/// Les couples `magFilter`, `minFilter` du glTF, dans l'ordre des `filterMode` Unity : au plus
/// proche, bilinéaire, trilinéaire — chacun avec la suite de mipmaps que l'éditeur construit. Le
/// dernier est aussi le filtrage par défaut, celui qu'une texture sans `.meta` garde.
const FILTERS: [[u32; 2]; 3] = [[9728, 9984], [9729, 9985], [9729, 9987]];
const WRAP_UNSUPPORTED: &str = "unity-texture-wrap-unsupported";
const FILTER_UNSUPPORTED: &str = "unity-texture-filter-unsupported";

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
    let sampler = sampler(asset, &name, scene);
    scene
        .images
        .push(json!({"name":name,"mimeType":decoder.mime(),"uri":uri}));
    scene
        .textures
        .push(json!({"source":scene.images.len()-1,"sampler":sampler}));
    scene.count("textures", 1);
    Some(scene.textures.len() - 1)
}

/// L'échantillonneur que le `TextureImporter` du `.meta` déclare. Un réglage absent garde le défaut
/// de l'éditeur ; une valeur que le glTF ne porte pas est comptée par son nom et l'axe répète.
fn sampler(asset: &Path, name: &str, scene: &mut Scene) -> usize {
    let read = meta::document(&meta_of(asset));
    let importer = &read["TextureImporter"];
    // `sRGBTexture: 0` déclare une texture de données. La scène intermédiaire ne porte pas d'espace
    // de couleur par texture : le fait est noté plutôt que perdu.
    if number(&importer["sRGBTexture"]) == Some(0.0) {
        scene
            .report
            .notes
            .push(format!("texture déclarée linéaire par son .meta: {name}"));
    }
    let wrap_s = wrap(importer, &["wrapU", "wrapMode"], scene);
    let wrap_t = wrap(importer, &["wrapV", "wrapMode"], scene);
    let [mag, min] = filter(importer, scene);
    scene.sampler_filtered([wrap_s, wrap_t, mag, min])
}

/// La répétition d'un axe : le réglage propre à l'axe, sinon le réglage commun. Unity écrit `-1`
/// sur un axe pour dire « comme le réglage commun » ; ce n'est pas un mode, on passe au suivant.
fn wrap(importer: &Yaml, keys: &[&str], scene: &mut Scene) -> u32 {
    match setting(importer, keys) {
        None => REPEAT,
        Some(mode) => match WRAPS.get(mode) {
            Some(wrap) => *wrap,
            None => {
                scene.report.add(WRAP_UNSUPPORTED);
                REPEAT
            }
        },
    }
}

/// Le filtrage déclaré, ou celui que le glTF applique par défaut.
fn filter(importer: &Yaml, scene: &mut Scene) -> [u32; 2] {
    let default = FILTERS[FILTERS.len() - 1];
    match setting(importer, &["filterMode"]) {
        None => default,
        Some(mode) => match FILTERS.get(mode) {
            Some(filter) => *filter,
            None => {
                scene.report.add(FILTER_UNSUPPORTED);
                default
            }
        },
    }
}

/// La première de ces propriétés qui porte une valeur entière positive ou nulle.
fn setting(importer: &Yaml, keys: &[&str]) -> Option<usize> {
    keys.iter()
        .filter_map(|key| number(&importer[*key]))
        .find(|value| *value >= 0.0)
        .map(|value| value as usize)
}
