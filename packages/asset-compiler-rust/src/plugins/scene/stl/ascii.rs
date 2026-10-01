//! Line grammar keeps multiword solid names and rejects truncated or surplus facet data.
use super::*;
use std::str::Lines;

fn line<'a>(lines: &mut Lines<'a>) -> Result<&'a str> {
    lines
        .find(|s| !s.trim().is_empty())
        .map(str::trim)
        .ok_or_else(|| source::invalid("stl", "unexpected end of facet"))
}
fn expect(lines: &mut Lines<'_>, wanted: &str) -> Result<()> {
    let found = line(lines)?;
    if found.split_whitespace().collect::<Vec<_>>().join(" ") != wanted {
        return Err(source::invalid(
            "stl",
            format!("expected {wanted:?}, found {found:?}"),
        ));
    }
    Ok(())
}
fn vector(text: &str, tag: &str) -> Result<[f32; 3]> {
    let mut words = text.split_whitespace();
    for expected in tag.split_whitespace() {
        if words.next() != Some(expected) {
            return Err(source::invalid("stl", format!("expected {tag}")));
        }
    }
    let fields: Vec<_> = words.collect();
    let [x, y, z] = fields.as_slice() else {
        return Err(source::invalid("stl", "a vector needs three numbers"));
    };
    let parse = |v: &str| {
        source::finite(
            v.parse()
                .map_err(|_| source::invalid("stl", "invalid number"))?,
            "stl",
        )
    };
    Ok([parse(x)?, parse(y)?, parse(z)?])
}

pub(super) fn read(
    bytes: &[u8],
    request: &SceneRequest<'_>,
    scene: &mut SceneTables,
) -> Result<()> {
    let text = std::str::from_utf8(bytes)
        .map_err(|_| source::invalid("stl", "invalid binary length or ASCII encoding"))?;
    let mut lines = text.lines();
    let mut facets = 0;
    while let Some(header) = lines.find(|s| !s.trim().is_empty()) {
        let header = header.trim();
        let name = header
            .strip_prefix("solid")
            .filter(|s| s.is_empty() || s.starts_with(char::is_whitespace))
            .ok_or_else(|| source::invalid("stl", "expected solid header"))?
            .trim();
        let mut solid = Solid::new(name.to_string());
        loop {
            if super::super::cancel::stopped(request.cancelled, facets) {
                return Err(super::super::cancel::refusal());
            }
            let next = line(&mut lines)?;
            if let Some(end) = next
                .strip_prefix("endsolid")
                .filter(|s| s.is_empty() || s.starts_with(char::is_whitespace))
            {
                if !end.trim().is_empty() && end.trim() != name {
                    return Err(source::invalid("stl", "solid names do not match"));
                }
                break;
            }
            let normal = vector(next, "facet normal")?;
            expect(&mut lines, "outer loop")?;
            let mut points = [normal; 4];
            for point in &mut points[1..] {
                *point = vector(line(&mut lines)?, "vertex")?;
            }
            expect(&mut lines, "endloop")?;
            expect(&mut lines, "endfacet")?;
            source::admit(
                (facets + 1).saturating_mul(256),
                request.ram_budget / 2,
                "stl",
            )?;
            solid.facet(points, None)?;
            facets += 1;
        }
        solid.emit(scene, request)?;
    }
    Ok(())
}
