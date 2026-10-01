//! Binary detection uses the exact declared length, even when its header begins with "solid".
use super::*;
use std::collections::BTreeMap;

fn color(attribute: u16, object: Option<Color>) -> Result<Option<Color>> {
    let component = |shift: u32| ((attribute >> shift) & 31u16) as f32 / 31.0;
    if let Some(object) = object {
        return Ok(Some(if attribute & 0x8000 != 0 {
            object
        } else {
            [component(0), component(5), component(10), 1.0]
        }));
    }
    if attribute & 0x8000 != 0 {
        return Ok(Some([component(10), component(5), component(0), 1.0]));
    }
    if attribute != 0 {
        return Err(source::unsupported(
            "stl",
            "unrecognised binary facet attribute (no colour flag)",
        ));
    }
    Ok(None)
}

pub(super) fn read(
    bytes: &[u8],
    count: usize,
    request: &SceneRequest<'_>,
    scene: &mut SceneTables,
) -> Result<()> {
    let object = bytes[..80]
        .windows(6)
        .position(|v| v == b"COLOR=")
        .map(|at| {
            bytes
                .get(at + 6..at + 10)
                .filter(|_| at + 10 <= 80)
                .map(|v| <[u8; 4]>::try_from(v).unwrap().map(|x| x as f32 / 255.0))
                .ok_or_else(|| source::invalid("stl", "truncated header colour"))
        })
        .transpose()?;
    if bytes[..80].windows(9).any(|v| v == b"MATERIAL=") {
        return Err(source::unsupported("stl", "Magics MATERIAL properties"));
    }
    let mut palette = BTreeMap::new();
    let mut solid = Solid::new("solid".into());
    for (index, facet) in bytes[84..].as_chunks::<50>().0.iter().enumerate() {
        if super::super::cancel::stopped(request.cancelled, index) {
            return Err(super::super::cancel::refusal());
        }
        let mut values = [[0.0; 3]; 4];
        for (value, word) in values
            .iter_mut()
            .flatten()
            .zip(facet[..48].as_chunks::<4>().0.iter())
        {
            *value = source::finite(f32::from_le_bytes(*word) as f64, "stl")?;
        }
        let material =
            color(u16::from_le_bytes(facet[48..].try_into().unwrap()), object)?.map(|color| {
                *palette.entry(color.map(f32::to_bits)).or_insert_with(|| {
                    let rank = scene.materials.len();
                    scene.materials.push(source::material(
                        &format!("facet-colour-{rank}"),
                        source::linear_color(color),
                    ));
                    rank
                })
            });
        solid.facet(values, material)?;
    }
    scene.count("sourceTriangles", count);
    solid.emit(scene, request)
}
