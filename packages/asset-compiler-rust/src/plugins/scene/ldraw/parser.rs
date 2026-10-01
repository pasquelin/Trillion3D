//! Record grammar and BFC state; records are never silently discarded.
use super::*;
pub(super) struct Face {
    pub points: Vec<[f64; 3]>,
    pub color: String,
    pub reverse: bool,
    pub double: bool,
}
pub(super) struct Reference {
    pub name: String,
    pub color: String,
    pub matrix: [f64; 16],
    pub inverted: bool,
    pub double: bool,
}
pub(super) struct Line {
    pub points: Vec<[f64; 3]>,
    pub color: String,
}
pub(super) struct Model {
    pub lines: Vec<Line>,
    pub faces: Vec<Face>,
    pub references: Vec<Reference>,
}
fn number(text: &str) -> Result<f64> {
    text.parse::<f64>()
        .ok()
        .filter(|v| v.is_finite())
        .ok_or_else(|| source::invalid("ldraw", "invalid numeric field"))
}
pub(super) fn parse(
    text: &str,
    colors: &mut colors::Colors,
    request: &SceneRequest<'_>,
) -> Result<Model> {
    let mut model = Model {
        lines: Vec::new(),
        faces: Vec::new(),
        references: Vec::new(),
    };
    let (mut certified, mut clipped, mut clockwise, mut invert) = (false, true, false, false);
    for line in text.lines() {
        super::super::archive::check(request)?;
        let words: Vec<_> = line.split_whitespace().collect();
        if words.is_empty() {
            continue;
        }
        match words[0] {
            "0" => match words.get(1).copied().unwrap_or("") {
                "!COLOUR" => colors.define(&words[2..])?,
                "BFC" => {
                    for word in &words[2..] {
                        match *word {
                            "CERTIFY" => certified = true,
                            "NOCERTIFY" => certified = false,
                            "CLIP" => clipped = true,
                            "NOCLIP" => clipped = false,
                            "CW" => clockwise = true,
                            "CCW" => clockwise = false,
                            "INVERTNEXT" => invert = true,
                            _ => return Err(source::unsupported("ldraw", format!("BFC {word}"))),
                        }
                    }
                }
                "!TEXMAP" | "!DATA" => {
                    return Err(source::unsupported("ldraw", "texture/data record"))
                }
                _ => {}
            },
            "1" => {
                if words.len() < 15 {
                    return Err(source::invalid("ldraw", "truncated reference"));
                }
                let n = words[2..14]
                    .iter()
                    .map(|s| number(s))
                    .collect::<Result<Vec<_>>>()?;
                let mut matrix = [
                    n[3],
                    n[6],
                    n[9],
                    0.,
                    n[4],
                    n[7],
                    n[10],
                    0.,
                    n[5],
                    n[8],
                    n[11],
                    0.,
                    n[0] * UNIT,
                    n[1] * UNIT,
                    n[2] * UNIT,
                    1.,
                ];
                for value in &mut matrix {
                    source::finite(*value, "ldraw")?;
                }
                model.references.push(Reference {
                    name: words[14..].join(" "),
                    color: words[1].to_owned(),
                    matrix,
                    inverted: invert,
                    double: !clipped,
                });
                invert = false;
            }
            "3" | "4" => {
                if invert {
                    return Err(source::invalid(
                        "ldraw",
                        "BFC INVERTNEXT must precede a reference",
                    ));
                }
                let count = if words[0] == "3" { 3 } else { 4 };
                let points = points(&words, count)?;
                model.faces.push(Face {
                    points,
                    color: words[1].to_owned(),
                    reverse: clockwise,
                    double: !certified || !clipped,
                });
            }
            "2" | "5" => {
                let count = if words[0] == "2" { 2 } else { 4 };
                let points = points(&words, count)?;
                model.lines.push(Line {
                    points,
                    color: words[1].to_owned(),
                });
            }
            _ => return Err(source::invalid("ldraw", "unknown record type")),
        }
    }
    if invert {
        return Err(source::invalid("ldraw", "dangling BFC INVERTNEXT"));
    }
    Ok(model)
}

fn points(words: &[&str], count: usize) -> Result<Vec<[f64; 3]>> {
    if words.len() != 2 + count * 3 {
        return Err(source::invalid("ldraw", "wrong vertex record field count"));
    }
    words[2..]
        .as_chunks::<3>()
        .0
        .iter()
        .map(|p| {
            Ok([
                number(p[0])? * UNIT,
                number(p[1])? * UNIT,
                number(p[2])? * UNIT,
            ])
        })
        .collect()
}
