//! `world-roots.dag` as fixed-size little-endian records (docs/FORMAT.md, World
//! super-roots): every world cluster and the group list, what the world stream reads on its first
//! use, written as `records.rs` writes the table.
use super::records::{list, word, Records, DAG_MAGIC};
use super::*;

/// The facts of a super-root's page (`pages::page_facts`), five words and an `f32`; zeros for none.
fn page_facts(r: &mut Records, page: &Value) -> Result<()> {
    for key in [
        "pageBytes",
        "vertexCount",
        "indexCount",
        "flags",
        "uncompressedBytes",
    ] {
        r.word(if page.is_null() {
            0
        } else {
            word(&page[key], false)?
        });
    }
    let error = page["quantizationError"].as_f64().unwrap_or(0.0) as f32;
    r.out.extend(error.to_le_bytes());
    Ok(())
}

/// `world-roots.dag` of `table`'s `clusters` and `groups`: a 24-byte header (magic, version, the
/// two counts, the pool's length, zero), then 176-byte clusters — level, triangles, then the primitive it wears,
/// bundle, offset and origin (`u32::MAX` for none), then as `f64` the error, the parent's (NaN for
/// a root), the sphere, the parent's (NaN for a root), the minimum and the maximum, then its
/// page's length, vertex count, index count, attribute flags and decoded bytes, and its
/// quantization error as an `f32` (all zero for a placed object, which has no page) —, 64-byte
/// groups — level, its children and outputs in the pool, zero, then as `f64` its error and sphere
/// — and the pool.
pub(crate) fn encode_dag(table: &Value) -> Result<Vec<u8>> {
    let (clusters, groups) = (list(table, "clusters")?, list(table, "groups")?);
    let mut r = Records::default();
    r.out.extend(DAG_MAGIC);
    for value in [
        WORLD_ROOTS_VERSION,
        clusters.len() as u32,
        groups.len() as u32,
        0,
        0,
    ] {
        r.word(value);
    }
    for cluster in clusters {
        r.word(word(&cluster["level"], false)?);
        r.word(word(&cluster["triangles"], false)?);
        for key in ["primitive", "bundle", "offset", "origin"] {
            r.word(word(&cluster[key], true)?);
        }
        r.floats(&cluster["lodError"], 1);
        r.floats(&cluster["parentError"], 1);
        r.floats(&cluster["sphere"], 4);
        r.floats(&cluster["parentSphere"], 4);
        r.floats(&cluster["min"], 3);
        r.floats(&cluster["max"], 3);
        page_facts(&mut r, &cluster["page"])?;
    }
    for group in groups {
        r.word(word(&group["level"], false)?);
        r.pooled(&group["children"])?;
        r.pooled(&group["outputs"])?;
        r.word(0);
        r.floats(&group["error"], 1);
        r.floats(&group["sphere"], 4);
    }
    let words = (r.pool.len() as u32).to_le_bytes();
    r.out[16..20].copy_from_slice(&words);
    Ok(r.end())
}
