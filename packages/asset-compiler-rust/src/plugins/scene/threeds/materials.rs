//! Named materials remain distinct; unsupported appearance channels are named refusals.
use super::*;
fn color(bytes: &[u8]) -> Result<[f32; 3]> {
    let mut reader = Reader::new(bytes);
    let mut srgb = None;
    let mut linear = None;
    while !reader.empty() {
        let (id, bytes) = reader.chunk()?;
        let mut value = Reader::new(bytes);
        let rgb = match id {
            0x0010 | 0x0013 => [
                value.float()? as f32,
                value.float()? as f32,
                value.float()? as f32,
            ],
            0x0011 | 0x0012 => {
                let b = value.take(3)?;
                [b[0] as f32 / 255., b[1] as f32 / 255., b[2] as f32 / 255.]
            }
            _ => return Err(source::unsupported("3ds", "colour encoding")),
        };
        value.finish()?;
        if rgb.iter().any(|v| !(0.0..=1.0).contains(v)) {
            return Err(source::invalid("3ds", "colour outside range"));
        }
        if matches!(id, 0x0012 | 0x0013) {
            linear = Some(rgb);
        } else {
            srgb = Some(rgb);
        }
    }
    linear
        .or_else(|| {
            srgb.map(|v| {
                let c = source::linear_color([v[0], v[1], v[2], 1.]);
                [c[0], c[1], c[2]]
            })
        })
        .ok_or_else(|| source::invalid("3ds", "empty colour"))
}
fn percent(bytes: &[u8]) -> Result<f64> {
    let mut reader = Reader::new(bytes);
    let (id, data) = reader.chunk()?;
    reader.finish()?;
    let mut reader = Reader::new(data);
    let value = match id {
        0x0030 => reader.u16()? as f64 / 100.,
        0x0031 => reader.float()?,
        _ => return Err(source::unsupported("3ds", "percentage encoding")),
    };
    reader.finish()?;
    if !(0.0..=1.0).contains(&value) {
        return Err(source::invalid("3ds", "percentage outside range"));
    }
    Ok(value)
}
pub(super) fn read(bytes: &[u8]) -> Result<(String, serde_json::Value)> {
    let mut reader = Reader::new(bytes);
    let mut name = None;
    let mut diffuse = [0.8, 0.8, 0.8];
    let mut opacity = 1.;
    let mut double = false;
    while !reader.empty() {
        let (id, data) = reader.chunk()?;
        match id {
            0xa000 => {
                let mut r = Reader::new(data);
                name = Some(r.string()?);
                r.finish()?;
            }
            0xa020 => diffuse = color(data)?,
            0xa050 => opacity = 1. - percent(data)?,
            0xa081 => {
                Reader::new(data).finish()?;
                double = true;
            }
            0xa010 | 0xa030 => {
                if color(data)?.iter().any(|v| *v != 0.) {
                    return Err(source::unsupported(
                        "3ds",
                        "nonzero ambient/specular colour",
                    ));
                }
            }
            0xa040 | 0xa041 | 0xa052 | 0xa053 | 0xa084 => {
                if percent(data)? != 0. {
                    return Err(source::unsupported(
                        "3ds",
                        "shininess/reflection/self-illumination",
                    ));
                }
            }
            0xa100 => {
                let mut r = Reader::new(data);
                let mode = r.u16()?;
                r.finish()?;
                if !matches!(mode, 1..=3) {
                    return Err(source::unsupported("3ds", "material shading mode"));
                }
            }
            _ => {
                return Err(source::unsupported(
                    "3ds",
                    format!("material chunk {id:04x}"),
                ))
            }
        }
    }
    let name = name.ok_or_else(|| source::invalid("3ds", "material has no name"))?;
    let mut material =
        source::material(&name, [diffuse[0], diffuse[1], diffuse[2], opacity as f32]);
    material["doubleSided"] = json!(double);
    Ok((name, material))
}
