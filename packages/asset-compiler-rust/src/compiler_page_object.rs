use super::*;
use crate::dag::DagCluster;
use crate::geometry_page_deform::{Deformation, MorphTarget};

/// The geometry-page format every page of the cache is written in, declared once at the top of
/// the manifest (`geometryPages`): the page header's magic and the sidecar version are the gates.
pub fn geometry_page_format() -> Value {
    json!({"formatVersion":trillion3d_page_codec::VERSION,"codec":"quantized"})
}

/// The attributes a page carries beside its positions, read from the primitive's accessors: each
/// holds `count` vertices, the width the format expects, or three for a colour.
pub(super) fn page_attributes(
    g: &Value,
    bin: &[u8],
    p: &Value,
    count: usize,
    validated: &BTreeSet<usize>,
) -> Result<Vec<geometry_page::Attribute>> {
    let mut attributes = Vec::new();
    for &(name, width, flag) in &geometry_page::PAGE_ATTRIBUTES {
        let Some(id) = p
            .get("attributes")
            .and_then(Value::as_object)
            .and_then(|attributes| attributes.get(name))
        else {
            continue;
        };
        let a = accessor(g, bin, required_index(Some(id), name)?, Some(validated))?;
        if a.count != count || (a.width != width && !(name == "COLOR_0" && a.width == 3)) {
            return Err(CompilerError::new(
                "INVALID_PAGE_ATTRIBUTE",
                format!("{name} count or width differs from POSITION"),
            ));
        }
        attributes.push(geometry_page::Attribute {
            flag,
            width: a.width,
            values: a.collect_f32()?,
        });
    }
    Ok(attributes)
}

/// The deformation a primitive declares (#357): its four strongest joints and weights per vertex,
/// out of `JOINTS_0`/`WEIGHTS_0` and `JOINTS_1`/`WEIGHTS_1` when present, and the position and
/// normal displacement of each of its morph targets, a silent one displacing nothing.
pub(super) fn page_deformation(
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
    let skin = match (set(0)?, set(1)?) {
        (None, _) => None,
        (Some((joints, weights)), more) => Some(strongest(joints, weights, more)?),
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
    Ok(Deformation { skin, targets })
}

/// Each vertex's four strongest influences among its first set and its second, if any: the joint
/// indices as integers, the weights as read.
fn strongest(
    joints: Vec<f32>,
    weights: Vec<f32>,
    more: Option<(Vec<f32>, Vec<f32>)>,
) -> Result<(Vec<u32>, Vec<f32>)> {
    if joints.iter().any(|j| !(*j >= 0.0 && j.fract() == 0.0)) {
        return Err(invalid("JOINTS holds a value that is not a joint"));
    }
    let Some((extra_joints, extra_weights)) = more else {
        return Ok((joints.iter().map(|&j| j as u32).collect(), weights));
    };
    let (mut out_joints, mut out_weights) = (Vec::new(), Vec::new());
    for v in 0..joints.len() / 4 {
        let mut pairs: Vec<(f32, f32)> = (v * 4..v * 4 + 4)
            .map(|i| (weights[i], joints[i]))
            .chain((v * 4..v * 4 + 4).map(|i| (extra_weights[i], extra_joints[i])))
            .collect();
        pairs.sort_by(|a, b| b.0.total_cmp(&a.0));
        out_joints.extend(pairs[..4].iter().map(|&(_, j)| j as u32));
        out_weights.extend(pairs[..4].iter().map(|&(w, _)| w));
    }
    Ok((out_joints, out_weights))
}

/// Writes a geometry page into the content-addressed store and returns its
/// manifest entry.
///
/// A page already present whose fingerprint matches is not rewritten: two
/// compilations of the same source share their objects, and the reused-page
/// counter says so.
pub(super) fn store_page(
    o: &Options,
    slice: &[u32],
    (pos, page_attributes): (&[f32], &[&geometry_page::Attribute]),
    deformed: (&Deformation, &[u32]),
    (position_exponent, uv_exponent): (i32, i32),
) -> Result<(Value, bool)> {
    let exponents = (position_exponent, uv_exponent);
    let encoded = geometry_page::encode_deformed(slice, pos, page_attributes, deformed, exponents)?;
    let digest = hash(&encoded.bytes);
    let target = object_path(o, &digest);
    let reused = object_intact(&target, &digest)?.is_some();
    if !reused {
        store_object(&target, &encoded.bytes)?;
    }
    Ok((geometry_record(&digest, &encoded, slice.len()), reused))
}

/// The `geometry` object of a page record: the packed page stored under `digest`.
pub(crate) fn geometry_record(
    digest: &str,
    page: &geometry_page::Encoded,
    indices: usize,
) -> Value {
    let header = &page.header;
    json!({"url":format!("../../objects/{digest}.bin"),"sha256":digest,"bytes":page.bytes.len(),"vertexCount":header.vertex_count,"indexCount":indices,"flags":header.flags,"uncompressedBytes":header.decoded_bytes(),"quantizationError":header.quantization_error})
}

/// The manifest record of the page at culling `rank`: its index bytes stored under `digest` (their
/// `length`) at `offset` in bundle `stream`, their bounds and normal cone, and its packed
/// `geometry`. `compiler_primitive::cost` charges each page by this shape.
pub(crate) fn page_record(
    (rank, cluster): (usize, &DagCluster),
    (digest, length): (&str, usize),
    (min, max): ([f64; 3], [f64; 3]),
    [x, y, z, angle]: [f64; 4],
    geometry: Value,
    (stream, offset): (usize, usize),
) -> Value {
    let parent = |value: fn(&DagCluster) -> Value| match cluster.parent_error.is_finite() {
        true => value(cluster),
        false => Value::Null,
    };
    json!({"id":rank,"url":format!("../../objects/{digest}.bin"),"sha256":digest,"bytes":length,
        "count":cluster.indices.len(),"start":cluster.source_rank as usize*3,"min":min,"max":max,
        "cone":{"axis":[x,y,z],"angle":angle},"role":if cluster.level==0{"exact"}else{"coarse"},
        "geometry":geometry,"level":cluster.level,"lodError":cluster.lod_error,"sphere":cluster.sphere,
        "parentError":parent(|c|json!(c.parent_error)),
        "parentSphere":parent(|c|json!(c.parent_sphere)),
        "group":cluster.group.map_or(Value::Null,|index|json!(index)),
        "source":cluster.source.map_or(Value::Null,|index|json!(index)),
        "stream":stream,"streamOffset":offset})
}

/// What the primitive's grid cost, for the manifest: the grid exponents and the largest position
/// displacement over every page, in object units; `null` on a primitive without pages, which
/// was quantized on no grid.
pub(super) fn quantization_report(
    pages: &[Value],
    position_exponent: i32,
    uv_exponent: i32,
) -> Value {
    if pages.is_empty() {
        return Value::Null;
    }
    let worst = pages
        .iter()
        .filter_map(|page| page["geometry"]["quantizationError"].as_f64())
        .fold(None, |worst: Option<f64>, error| {
            Some(worst.map_or(error, |w| w.max(error)))
        });
    json!({
        "positionExponent": position_exponent,
        "uvExponent": uv_exponent,
        "maxPositionError": worst,
    })
}
