//! A glTF light that names a profile: `extras.iesProfile`, the path of an IES file relative to the
//! scene, beside the image files. The light entry of `lights.json` then carries the product's name
//! (`iesProfile`), the frame the profile is read in (`direction` and `emitterAxis`: the node's -Z and
//! +Y in the world) and the two brightness switches the light's `extras` name: `useIesBrightness`
//! (a boolean) and `iesBrightnessScale` (a number of at least 0).
use super::format::{encode, file_name};
use super::ies::parse;
use super::Photometry;
use crate::compiler::cache::storage::{product, Product};
use crate::compiler::lights::{axis, up_axis, Tally};
use crate::compiler::source::node_transform::Mat4;
use crate::Result;
use serde_json::{json, Value};
use std::collections::BTreeMap;
use std::path::Path;

const URI_REFUSED: &str = "light-profile-uri-refused";
const UNREADABLE: &str = "light-profile-unreadable";
const INVALID: &str = "light-profile-invalid";
const DEGENERATE_FRAME: &str = "light-profile-degenerate-frame";
const SCALE_INVALID: &str = "light-profile-brightness-scale-invalid";
const SWITCH_INVALID: &str = "light-profile-brightness-switch-invalid";

/// Counts one more light that left a field out for `reason`.
fn count(counts: &mut Tally, reason: &'static str) {
    *counts.entry(reason).or_insert(0) += 1;
}

/// The profiles a job's lights name: where their files are, where the products go, and what has
/// been made so far (each profile once, however many lights name it).
pub(crate) struct Profiles<'a> {
    root: &'a Path,
    directory: &'a Path,
    made: BTreeMap<String, Option<String>>,
    products: Vec<Product>,
}

impl<'a> Profiles<'a> {
    /// The profiles of a job whose relative paths resolve under `root` and whose products go in
    /// `directory`.
    pub(crate) fn new(root: &'a Path, directory: &'a Path) -> Self {
        Self {
            root,
            directory,
            made: BTreeMap::new(),
            products: Vec::new(),
        }
    }

    /// The products written, one for each distinct profile.
    pub(crate) fn into_products(self) -> Vec<Product> {
        self.products
    }

    /// The name of the product of the IES file at `uri`, made on the first ask; none, the reason
    /// counted, when the file cannot be had.
    fn product_of(&mut self, uri: &str, counts: &mut Tally) -> Result<Option<String>> {
        if let Some(name) = self.made.get(uri) {
            return Ok(name.clone());
        }
        let name = match self.read(uri) {
            Ok(photometry) => {
                let bytes = encode(&photometry);
                let name = file_name(&bytes);
                if !self.products.iter().any(|made| made.name == name) {
                    self.products.push(product(self.directory, &name, &bytes)?);
                }
                Some(name)
            }
            Err(reason) => {
                count(counts, reason);
                None
            }
        };
        self.made.insert(uri.to_string(), name.clone());
        Ok(name)
    }

    fn read(&self, uri: &str) -> std::result::Result<Photometry, &'static str> {
        let path = crate::support::uri::resolve_under(self.root, uri).map_err(|_| URI_REFUSED)?;
        let file = std::fs::read(path).map_err(|_| UNREADABLE)?;
        parse(&file).map_err(|_| INVALID)
    }

    /// Writes the profile `light` names onto `entry`, a point or a spot already converted, placed
    /// by the node's world matrix `m`: the profile's name, the light's direction and its
    /// `emitterAxis`, the one axis the profile's angle and a tube both run round. A light that names none is left as it is; one whose file,
    /// path or frame fails is counted and keeps no profile, as a light with none.
    pub(crate) fn attach(
        &mut self,
        entry: &mut Value,
        light: &Value,
        m: &Mat4,
        counts: &mut Tally,
    ) -> Result<()> {
        let Some(uri) = light.pointer("/extras/iesProfile").and_then(Value::as_str) else {
            return Ok(());
        };
        if !matches!(entry.get("kind").and_then(Value::as_str), Some("point" | "spot")) {
            return Ok(());
        }
        // The contract refuses an axis parallel to the direction (a sheared matrix could give one).
        let frame = axis(m).zip(up_axis(m)).filter(|(direction, up)| {
            let along: f64 = direction.iter().zip(up).map(|(d, u)| d * u).sum();
            along * along < 1.0 - 1e-12
        });
        let Some((direction, up)) = frame else {
            count(counts, DEGENERATE_FRAME);
            return Ok(());
        };
        let Some(name) = self.product_of(uri, counts)? else {
            return Ok(());
        };
        entry["iesProfile"] = json!(name);
        entry["direction"] = json!(direction);
        entry["emitterAxis"] = json!(up);
        brightness(entry, light, counts);
        Ok(())
    }
}

/// `useIesBrightness` and `iesBrightnessScale` of the light's `extras`, onto `entry` when they read:
/// a boolean, and a finite number of at least 0.
fn brightness(entry: &mut Value, light: &Value, counts: &mut Tally) {
    if let Some(named) = light.pointer("/extras/useIesBrightness") {
        match named.as_bool() {
            Some(true) => entry["useIesBrightness"] = json!(true),
            Some(false) => {}
            None => count(counts, SWITCH_INVALID),
        }
    }
    if let Some(named) = light.pointer("/extras/iesBrightnessScale") {
        match named.as_f64().filter(|scale| scale.is_finite() && *scale >= 0.0) {
            Some(scale) => entry["iesBrightnessScale"] = json!(scale),
            None => count(counts, SCALE_INVALID),
        }
    }
}

/// The IES files the scene's lights name by relative path, in the order of the lights, each with
/// the fingerprint of the file found (`null` for none): what a cache key holds beside the images,
/// so that a changed profile is another key. Empty for a scene whose lights name none.
pub(crate) fn linked_profiles(g: &Value, root: &Path) -> Vec<Value> {
    let Some(lights) = g
        .pointer("/extensions/KHR_lights_punctual/lights")
        .and_then(Value::as_array)
    else {
        return Vec::new();
    };
    lights
        .iter()
        .filter_map(|light| light.pointer("/extras/iesProfile").and_then(Value::as_str))
        .map(|uri| {
            let sha = crate::support::uri::resolve_under(root, uri)
                .ok()
                .and_then(|path| crate::hash_file(&path).ok());
            json!({"uri":uri,"sha256":sha})
        })
        .collect()
}
