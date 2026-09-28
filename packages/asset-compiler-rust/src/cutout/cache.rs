//! Optional exact alpha measurements beside the human answers, never rounded display values.
use super::*;

/// The whole compiler's source, as the compilation cache key names it, and the decoder
/// plugins' versions: any helper the measurement calls, or a driver correction that decodes the
/// same bytes differently, invalidates every stored measurement.
pub(super) fn algorithm() -> String {
    let (implementation, plugins) = (crate::implementation_hash(), crate::plugins::fingerprint());
    hash(format!("{implementation}:{plugins}").as_bytes())
}

/// Binds a record to its image: moved to another image, it no longer matches.
pub(super) fn checksum(sha: &str, values: &Value) -> String {
    hash(format!("{sha}:{values}").as_bytes())
}

pub(super) fn record(sha: &str, shape: &AlphaShape) -> Value {
    let value = json!({"texels":shape.texels,"absent":shape.absent,"present":shape.present,
        "between":shape.between,"atContour":shape.at_contour});
    json!({"values":value,"checksum":checksum(sha, &value)})
}

/// A malformed optional cache is a miss; malformed human answers remain errors in cutout.rs.
fn shape(sha: &str, stored: &Value) -> Option<AlphaShape> {
    let value = stored.get("values")?;
    if stored.get("checksum").and_then(Value::as_str) != Some(checksum(sha, value).as_str()) {
        return None;
    }
    let fraction = |key| {
        let number = value.get(key)?.as_f64()?;
        (number.is_finite() && (0.0..=1.0).contains(&number)).then_some(number as f32)
    };
    let result = AlphaShape {
        texels: value.get("texels")?.as_u64()?,
        absent: fraction("absent")?,
        present: fraction("present")?,
        between: fraction("between")?,
        at_contour: fraction("atContour")?,
    };
    (result.texels > 0
        && (result.absent + result.present + result.between - 1.0).abs() <= 4.0 * f32::EPSILON)
        .then_some(result)
}

#[derive(Default)]
pub(crate) struct MeasureCache(BTreeMap<String, AlphaShape>);

impl MeasureCache {
    #[cfg(test)]
    pub(crate) const EMPTY: &'static Self = &Self(BTreeMap::new());

    /// A cache already holding `shape` for the image `sha`.
    #[cfg(test)]
    pub(crate) fn holding(sha: &str, shape: AlphaShape) -> Self {
        Self(BTreeMap::from([(sha.to_owned(), shape)]))
    }

    pub(super) fn read(sheet: &Value) -> Self {
        if sheet.get("measurementAlgorithm").and_then(Value::as_str) != Some(algorithm().as_str()) {
            return Self::default();
        }
        Self(
            sheet
                .get("textures")
                .and_then(Value::as_object)
                .into_iter()
                .flatten()
                .filter_map(|(sha, entry)| {
                    Some((sha.clone(), shape(sha, entry.get("measurement")?)?))
                })
                .collect(),
        )
    }

    pub(crate) fn get(&self, sha: &str, image: &image::RgbaImage) -> Option<AlphaShape> {
        self.0
            .get(sha)
            .filter(|shape| shape.texels == u64::from(image.width()) * u64::from(image.height()))
            .cloned()
    }

    /// Retain valid measurements even if a scene no longer references the image: rows the scene
    /// already wrote stay as they are, so each record is built once.
    pub(super) fn keep_unused(&self, textures: &mut serde_json::Map<String, Value>) {
        for (sha, shape) in &self.0 {
            if !textures.contains_key(sha) {
                let row = json!({"used":false,"cutout":null,"measurement":record(sha, shape)});
                textures.insert(sha.clone(), row);
            }
        }
    }
}
