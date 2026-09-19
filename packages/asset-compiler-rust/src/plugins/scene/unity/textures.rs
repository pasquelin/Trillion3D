//! Textures of a Unity material: a GUID, a file, a glTF image.
//!
//! The driver decodes nothing itself. It names the image by its path, relative to the served
//! directory, and leaves the image registry to say whether this format reads: a texture of a
//! format the registry does not know is counted in the report and the scene continues without
//! it — never a failure. How to sample it, on the other hand, does not belong to the image: it
//! is the `.meta`'s `TextureImporter` that declares it, axis by axis for wrap and as a single
//! setting for filtering.
use super::*;
use std::collections::HashMap;

/// Default wrap of a Unity texture, that of the editor without a contrary mention.
const REPEAT: u32 = 10497;
/// glTF wrap modes, in the order Unity numbers them: repeat, clamp, mirror.
const WRAPS: [u32; 3] = [REPEAT, 33071, 33648];
/// glTF `magFilter`, `minFilter` pairs, in the order of Unity `filterMode`: nearest, bilinear,
/// trilinear — each with the mipmap chain the editor builds. The last is also the default
/// filtering, the one a texture without a `.meta` keeps.
const FILTERS: [[u32; 2]; 3] = [[9728, 9984], [9729, 9985], [9729, 9987]];
const WRAP_UNSUPPORTED: &str = "unity-texture-wrap-unsupported";
const FILTER_UNSUPPORTED: &str = "unity-texture-filter-unsupported";

#[derive(Default)]
pub(super) struct Textures {
    by_guid: HashMap<String, Option<usize>>,
}

impl Textures {
    /// Rank of the glTF texture for this GUID, poured on first request.
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
            .push(format!("texture outside the image registry: {name}"));
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

/// Sampler the `.meta`'s `TextureImporter` declares. A missing setting keeps the editor
/// default; a value glTF does not carry is counted by name and the axis repeats.
fn sampler(asset: &Path, name: &str, scene: &mut Scene) -> usize {
    let read = meta::document(&meta_of(asset));
    let importer = &read["TextureImporter"];
    // `sRGBTexture: 0` declares a data texture. The intermediate scene carries no per-texture
    // colour space: the fact is noted rather than lost.
    if number(&importer["sRGBTexture"]) == Some(0.0) {
        scene
            .report
            .notes
            .push(format!("texture declared linear by its .meta: {name}"));
    }
    let wrap_s = wrap(importer, &["wrapU", "wrapMode"], scene);
    let wrap_t = wrap(importer, &["wrapV", "wrapMode"], scene);
    let [mag, min] = filter(importer, scene);
    scene.sampler_filtered([wrap_s, wrap_t, mag, min])
}

/// Wrap of an axis: the setting specific to the axis, otherwise the common setting. Unity
/// writes `-1` on an axis to say “like the common setting”; that is not a mode, we move on.
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

/// Declared filtering, or the one glTF applies by default.
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

/// First of these properties that carries a positive or zero integer value.
fn setting(importer: &Yaml, keys: &[&str]) -> Option<usize> {
    keys.iter()
        .filter_map(|key| number(&importer[*key]))
        .find(|value| *value >= 0.0)
        .map(|value| value as usize)
}
