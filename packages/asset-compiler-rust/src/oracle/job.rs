//! Reading an oracle job. A missing field is a named error, never a guessed value.
use super::{
    OracleCamera, OracleJob, OracleLight, KIND_POINT, KIND_SPOT, KIND_SUN, ORACLE_VERSION,
};
use crate::shared_math::{divide, length};
use crate::{CompilerError, Result};
use serde_json::Value;
use std::path::PathBuf;

fn bad(message: impl Into<String>) -> CompilerError {
    CompilerError::new("INVALID_ORACLE_JOB", message)
}
fn number(value: Option<&Value>, what: &str) -> Result<f64> {
    value
        .and_then(Value::as_f64)
        .filter(|v| v.is_finite())
        .ok_or_else(|| bad(format!("{what} is not a finite number")))
}
fn vector(value: Option<&Value>, what: &str) -> Result<[f64; 3]> {
    let items = value
        .and_then(Value::as_array)
        .filter(|items| items.len() == 3)
        .ok_or_else(|| bad(format!("{what} is not three numbers")))?;
    Ok([
        number(items.first(), what)?,
        number(items.get(1), what)?,
        number(items.get(2), what)?,
    ])
}
fn count(value: Option<&Value>, what: &str, most: usize) -> Result<usize> {
    let read = value
        .and_then(Value::as_u64)
        .ok_or_else(|| bad(format!("{what} is not a positive integer")))? as usize;
    if read == 0 || read > most {
        return Err(bad(format!("{what} is outside 1..{most}")));
    }
    Ok(read)
}

fn light_of(value: &Value) -> Result<OracleLight> {
    let kind = match value.get("kind").and_then(Value::as_str) {
        Some("point") => KIND_POINT,
        Some("spot") => KIND_SPOT,
        Some("directional") => KIND_SUN,
        other => return Err(bad(format!("unknown light kind {other:?}"))),
    };
    let direction = if kind == KIND_POINT {
        [0.0, -1.0, 0.0]
    } else {
        let raw = vector(value.get("direction"), "light.direction")?;
        let norm = length(raw);
        if norm <= 0.0 {
            return Err(bad("light.direction has no length"));
        }
        divide(raw, norm)
    };
    Ok(OracleLight {
        kind,
        position: if kind == KIND_SUN {
            [0.0; 3]
        } else {
            vector(value.get("position"), "light.position")?
        },
        direction,
        color: vector(value.get("color"), "light.color")?,
        intensity: number(value.get("intensity"), "light.intensity")?,
        range: if kind == KIND_SUN {
            f64::INFINITY
        } else {
            number(value.get("range"), "light.range")?
        },
        cos_cone: if kind == KIND_SPOT {
            number(value.get("coneAngle"), "light.coneAngle")?.cos()
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
        return Err(bad(format!("oracle job version must be {ORACLE_VERSION}")));
    }
    let camera = value
        .get("camera")
        .ok_or_else(|| bad("camera is absent"))?
        .clone();
    Ok(OracleJob {
        source: PathBuf::from(
            value
                .get("source")
                .and_then(Value::as_str)
                .ok_or_else(|| bad("source is not a path"))?,
        ),
        width: count(value.get("width"), "width", 4096)?,
        height: count(value.get("height"), "height", 4096)?,
        camera: OracleCamera {
            position: vector(camera.get("position"), "camera.position")?,
            target: vector(camera.get("target"), "camera.target")?,
            up: camera
                .get("up")
                .map(|_| vector(camera.get("up"), "camera.up"))
                .transpose()?
                .unwrap_or([0.0, 1.0, 0.0]),
            fov_degrees: number(camera.get("fovDegrees"), "camera.fovDegrees")?,
        },
        lights: value
            .get("lights")
            .and_then(Value::as_array)
            .ok_or_else(|| bad("lights is not an array"))?
            .iter()
            .map(light_of)
            .collect::<Result<Vec<_>>>()?,
        samples: count(value.get("samples"), "samples", 65536)?,
        bounces: count(value.get("bounces"), "bounces", 8)?,
        out: PathBuf::from(
            value
                .get("out")
                .and_then(Value::as_str)
                .ok_or_else(|| bad("out is not a path"))?,
        ),
    })
}
