//! Reading an oracle job. A missing field is a named error, never a guessed value.
use super::{
    OracleCamera, OracleJob, OracleLight, KIND_POINT, KIND_SPOT, KIND_SUN, ORACLE_VERSION,
};
use crate::compiler::validate::Fields;
use crate::Result;
use serde_json::Value;
use std::path::PathBuf;
use trillion3d_math::vector::vec3::normalize_where;

/// The readers of a job, each refusal an invalid job.
const JOB: Fields = Fields("INVALID_ORACLE_JOB");

/// A count in `1..=most`.
fn count(value: Option<&Value>, what: &str, most: usize) -> Result<usize> {
    let read = JOB.index(value, what)?;
    if read == 0 || read > most {
        return Err(JOB.bad(format!("{what} is outside 1..{most}")));
    }
    Ok(read)
}

fn light_of(value: &Value) -> Result<OracleLight> {
    let kind = match value.get("kind").and_then(Value::as_str) {
        Some("point") => KIND_POINT,
        Some("spot") => KIND_SPOT,
        Some("directional") => KIND_SUN,
        other => return Err(JOB.bad(format!("unknown light kind {other:?}"))),
    };
    let direction = if kind == KIND_POINT {
        [0.0, -1.0, 0.0]
    } else {
        let raw = JOB.numbers(value.get("direction"), "light.direction")?;
        normalize_where(raw, |norm| norm > 0.0 || norm.is_nan())
            .ok_or_else(|| JOB.bad("light.direction has no length"))?
    };
    Ok(OracleLight {
        kind,
        position: if kind == KIND_SUN {
            [0.0; 3]
        } else {
            JOB.numbers(value.get("position"), "light.position")?
        },
        direction,
        color: JOB.numbers(value.get("color"), "light.color")?,
        intensity: JOB.number(value.get("intensity"), "light.intensity")?,
        range: if kind == KIND_SUN {
            f64::INFINITY
        } else {
            JOB.number(value.get("range"), "light.range")?
        },
        cos_cone: if kind == KIND_SPOT {
            JOB.number(value.get("coneAngle"), "light.coneAngle")?.cos()
        } else {
            -2.0
        },
        casts_shadow: value
            .get("castsShadow")
            .and_then(Value::as_bool)
            .unwrap_or(true),
    })
}

/// Job re-read and re-checked. A missing field is a named error, never a guessed value.
pub fn job_of(value: &Value) -> Result<OracleJob> {
    if value.get("version").and_then(Value::as_u64) != Some(ORACLE_VERSION as u64) {
        return Err(JOB.bad(format!("oracle job version must be {ORACLE_VERSION}")));
    }
    let camera = value
        .get("camera")
        .ok_or_else(|| JOB.bad("camera is absent"))?
        .clone();
    Ok(OracleJob {
        source: PathBuf::from(JOB.text(value.get("source"), "source")?),
        width: count(value.get("width"), "width", 4096)?,
        height: count(value.get("height"), "height", 4096)?,
        camera: OracleCamera {
            position: JOB.numbers(camera.get("position"), "camera.position")?,
            target: JOB.numbers(camera.get("target"), "camera.target")?,
            up: camera
                .get("up")
                .map(|up| JOB.numbers(Some(up), "camera.up"))
                .transpose()?
                .unwrap_or([0.0, 1.0, 0.0]),
            fov_degrees: JOB.number(camera.get("fovDegrees"), "camera.fovDegrees")?,
        },
        lights: JOB
            .array(&value["lights"], "lights")?
            .iter()
            .map(light_of)
            .collect::<Result<Vec<_>>>()?,
        samples: count(value.get("samples"), "samples", 65536)?,
        bounces: count(value.get("bounces"), "bounces", 8)?,
        out: PathBuf::from(JOB.text(value.get("out"), "out")?),
    })
}
