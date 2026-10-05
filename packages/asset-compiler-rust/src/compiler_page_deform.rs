use super::*;
/// The deformation a primitive declares (#357): all paired joints and weights per vertex,
/// from every `JOINTS_n`/`WEIGHTS_n` pair, and the position and
/// normal displacement of each of its morph targets, a silent one displacing nothing.
pub(crate) fn page_deformation(
    g: &Value,
    bin: &[u8],
    p: &Value,
    count: usize,
    validated: &BTreeSet<usize>,
) -> Result<Deformation> {
    let read = |id: &Value, name: &str, width: usize| -> Result<Vec<f32>> {
        let a = accessor(g, bin, required_index(Some(id), name)?, Some(validated))?;
        if a.count != count || a.width != width {
            return Err(CompilerError::new(
                "INVALID_PAGE_ATTRIBUTE",
                format!("{name} count or width differs from POSITION"),
            ));
        }
        a.collect_f32()
    };
    let attributes = p.get("attributes").and_then(Value::as_object);
    let set = |rank: usize| -> Result<Option<(Vec<f32>, Vec<f32>)>> {
        let named = |kind: &str| attributes.and_then(|a| a.get(&format!("{kind}_{rank}")));
        match (named("JOINTS"), named("WEIGHTS")) {
            (Some(joints), Some(weights)) => Ok(Some((
                read(joints, "JOINTS", 4)?,
                read(weights, "WEIGHTS", 4)?,
            ))),
            (None, None) => Ok(None),
            _ => Err(invalid("JOINTS and WEIGHTS come in pairs")),
        }
    };
    let ranks: BTreeSet<usize> = attributes
        .into_iter()
        .flat_map(|a| a.keys())
        .filter_map(|name| {
            name.strip_prefix("JOINTS_")
                .or_else(|| name.strip_prefix("WEIGHTS_"))
        })
        .map(|rank| {
            rank.parse()
                .map_err(|_| invalid("Invalid skin attribute rank"))
        })
        .collect::<Result<_>>()?;
    let influences = ranks.len() * 4;
    let mut all = Vec::new();
    for rank in ranks {
        all.push(set(rank)?.ok_or_else(|| invalid("Missing skin attribute"))?);
    }
    let skin = if all.is_empty() {
        None
    } else {
        let (mut joints, mut weights) = (Vec::new(), Vec::new());
        for v in 0..count {
            for (js, ws) in &all {
                for k in v * 4..v * 4 + 4 {
                    if !(js[k] >= 0.0
                        && js[k] <= 65535.0
                        && js[k].fract() == 0.0
                        && ws[k] >= 0.0
                        && ws[k].is_finite())
                    {
                        return Err(invalid("Invalid skin joint or weight"));
                    }
                    joints.push(js[k] as u32);
                    weights.push(ws[k]);
                }
            }
        }
        Some((joints, weights))
    };
    let mut targets = Vec::new();
    for target in p
        .get("targets")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
    {
        let field = |name: &str| target.get(name).map(|id| read(id, name, 3)).transpose();
        let position = field("POSITION")?.unwrap_or_else(|| vec![0.0; count * 3]);
        targets.push(MorphTarget {
            position,
            normal: field("NORMAL")?,
        });
    }
    Ok(Deformation {
        skin,
        influences,
        targets,
        soft_source: None,
    })
}
