//! Optional exact alpha measurements beside the human answers, never rounded display values.
use super::*;
use std::sync::OnceLock;

/// Source and constants invalidate together, including the externally declared cutoff and
/// decoder versions: the same encoded bytes may decode differently after a driver correction.
pub(super) fn algorithm() -> &'static str {
    static KEY: OnceLock<String> = OnceLock::new();
    KEY.get_or_init(|| {
        hash(
            format!(
                "{}:{}:{}",
                include_str!("measure.rs"),
                CUTOUT_ALPHA.to_bits(),
                crate::plugins::fingerprint()
            )
            .as_bytes(),
        )
    })
}

pub(super) fn record(sha: &str, shape: &AlphaShape) -> Value {
    let value = json!({"texels":shape.texels,"absent":shape.absent,"present":shape.present,
        "between":shape.between,"atContour":shape.at_contour});
    json!({"values":value,"checksum":hash(format!("{sha}:{value}").as_bytes())})
}

/// A malformed optional cache is a miss; malformed human answers remain errors in cutout.rs.
fn shape(sha: &str, stored: &Value) -> Option<AlphaShape> {
    let value = stored.get("values")?;
    let checksum = hash(format!("{sha}:{value}").as_bytes());
    if stored.get("checksum").and_then(Value::as_str) != Some(checksum.as_str()) {
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
    pub(crate) fn empty() -> &'static Self {
        static EMPTY: OnceLock<MeasureCache> = OnceLock::new();
        EMPTY.get_or_init(Self::default)
    }

    pub(crate) fn get_or_else(
        &self,
        sha: &str,
        image: &image::RgbaImage,
        calculate: impl FnOnce() -> AlphaShape,
    ) -> AlphaShape {
        self.get(sha, image).unwrap_or_else(calculate)
    }

    pub(super) fn read(sheet: &Value) -> Self {
        if sheet.get("measurementAlgorithm").and_then(Value::as_str) != Some(algorithm()) {
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

    /// Retain valid measurements even if a scene no longer references the image.
    pub(super) fn entries(&self) -> serde_json::Map<String, Value> {
        self.0
            .iter()
            .map(|(sha, shape)| {
                (
                    sha.clone(),
                    json!({"used":false,"cutout":null,"measurement":record(sha, shape)}),
                )
            })
            .collect()
    }
}
