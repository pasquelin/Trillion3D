//! Textures of a Unity material: a GUID, a file, a glTF image.
//!
//! The driver decodes nothing itself. It names the image by its path, relative to the served
//! directory, and leaves the image registry to say whether this format reads: a texture of a
//! format the registry does not know is counted in the report and the scene continues without
//! it — never a failure. How to sample it, on the other hand, does not belong to the image: it
//! is the `.meta`'s `TextureImporter` that declares it, axis by axis for wrap and as a single
//! setting for filtering.
use super::*;
use crate::compiler::accessor::codes::{
    CLAMP_TO_EDGE, DEFAULT_FILTER, LINEAR, LINEAR_MIPMAP_NEAREST, MIRRORED_REPEAT, NEAREST, REPEAT,
};
use crate::plugins::scene::convert::tables::media::relative_under;
use std::collections::HashMap;

/// glTF wrap modes, in the order Unity numbers them: repeat (the editor's default), clamp, mirror.
const WRAPS: [u32; 3] = [REPEAT, CLAMP_TO_EDGE, MIRRORED_REPEAT];
/// glTF `magFilter`, `minFilter` pairs, in the order of Unity `filterMode`: nearest, bilinear,
/// trilinear — nearest reads no mipmap, as the engine's nearest does, the others with the mipmap
/// chain the editor builds. The last is also the default filtering, the one a texture without a
/// `.meta` keeps.
const FILTERS: [[u32; 2]; 3] = [
    [NEAREST, NEAREST],
    [LINEAR, LINEAR_MIPMAP_NEAREST],
    DEFAULT_FILTER,
];
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
        scene: &mut SceneTables,
        project: &Project,
    ) -> Option<usize> {
        let guid = reference.guid.as_ref()?;
        *self
            .by_guid
            .entry(guid.clone())
            .or_insert_with(|| resolve(guid, scene, project))
    }
}

/// The texture of the asset `guid` names, when an image driver reads it under the served
/// directory — else the one refusal of every driver (`SceneTables::image_found`) —, sampled as its
/// `.meta` declares.
fn resolve(guid: &str, scene: &mut SceneTables, project: &Project) -> Option<usize> {
    let root = &project.source_dir;
    let asset = project.asset(guid);
    let relative = asset.and_then(|asset| relative_under(root, asset));
    let written = asset.map_or_else(|| guid.to_string(), |a| a.to_string_lossy().into_owned());
    let image = scene.image_found(root, relative, &written)?;
    // A texture found is an asset's.
    let asset = asset?;
    let name = asset.file_name()?.to_string_lossy().to_string();
    let sampler = sampler(asset, &name, scene);
    Some(scene.texture(image, sampler))
}

/// Sampler the `.meta`'s `TextureImporter` declares. A missing setting keeps the editor
/// default; a value glTF does not carry is counted by name and the axis repeats.
fn sampler(asset: &Path, name: &str, scene: &mut SceneTables) -> usize {
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
fn wrap(importer: &Yaml, keys: &[&str], scene: &mut SceneTables) -> u32 {
    match setting(importer, keys) {
        None => REPEAT,
        Some(mode) => match WRAPS.get(mode) {
            Some(wrap) => *wrap,
            None => {
                scene
                    .report
                    .add(crate::plugins::scene::codes::TEXTURE_WRAP_UNSUPPORTED);
                REPEAT
            }
        },
    }
}

/// Declared filtering, or the one glTF applies by default.
fn filter(importer: &Yaml, scene: &mut SceneTables) -> [u32; 2] {
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
