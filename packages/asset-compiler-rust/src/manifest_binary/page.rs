use super::*;

/// The bits of a page's flag word (`pageU32`). Bit 4 is free: every page has its geometry, in a
/// bundle.
pub(super) const FLAG_ROLE: u32 = 1;
pub(super) const FLAG_COARSE: u32 = 2;
pub(super) const FLAG_CLUSTER_ERROR: u32 = 8;
pub(super) const FLAG_PARENT_ERROR: u32 = 16;
pub(super) const FLAG_PARENT_ERROR_FINITE: u32 = 32;
pub(super) const FLAG_PARENT_SPHERE: u32 = 64;
pub(super) const FLAG_PARENT_SPHERE_SET: u32 = 128;
pub(super) const FLAG_GROUP: u32 = 256;
pub(super) const FLAG_SOURCE: u32 = 512;

/// Writes `page`'s row of every page column: its geometry lies at `streamOffset` of its bundle on
/// disk and at `geometry.residentOffset` of its place in the pool.
pub(super) fn encode_page(page: &Value, columns: &mut [Column]) -> Result<()> {
    let item = MANIFEST.object(page, "page")?;
    vector_into(item.get("min"), 3, "page.min", &mut columns[PAGE_BOUNDS])?;
    vector_into(item.get("max"), 3, "page.max", &mut columns[PAGE_BOUNDS])?;
    let mut flags = 0u32;
    match item.get("role") {
        None => {}
        Some(Value::String(role)) => {
            flags |= FLAG_ROLE;
            if role == "coarse" {
                flags |= FLAG_COARSE;
            }
        }
        Some(other) => return Err(MANIFEST.bad(format!("page.role is not a string: {other}"))),
    }
    let cluster_error = matches!(item.get("lodError"),Some(value) if value.is_number())
        && item.get("sphere").is_some();
    if cluster_error {
        flags |= FLAG_CLUSTER_ERROR;
        columns[PAGE_ERROR].f64(MANIFEST.number(item.get("lodError"), "page.lodError")?);
        vector_into(
            item.get("sphere"),
            4,
            "page.sphere",
            &mut columns[PAGE_SPHERE],
        )?;
    } else {
        columns[PAGE_ERROR].f64(0.);
        columns[PAGE_SPHERE].zeros(32);
    }
    match item.get("parentError") {
        None => {
            columns[PAGE_ERROR].f64(0.);
        }
        Some(Value::Null) => {
            flags |= FLAG_PARENT_ERROR;
            columns[PAGE_ERROR].f64(0.);
        }
        Some(value) => {
            flags |= FLAG_PARENT_ERROR | FLAG_PARENT_ERROR_FINITE;
            columns[PAGE_ERROR].f64(MANIFEST.number(Some(value), "page.parentError")?);
        }
    }
    match item.get("parentSphere") {
        None => {
            columns[PAGE_PARENT_SPHERE].zeros(32);
        }
        Some(Value::Null) => {
            flags |= FLAG_PARENT_SPHERE;
            columns[PAGE_PARENT_SPHERE].zeros(32);
        }
        Some(_) => {
            flags |= FLAG_PARENT_SPHERE | FLAG_PARENT_SPHERE_SET;
            vector_into(
                item.get("parentSphere"),
                4,
                "page.parentSphere",
                &mut columns[PAGE_PARENT_SPHERE],
            )?;
        }
    }
    columns[PAGE_INT].i32(as_i32(
        MANIFEST.integer(item.get("id"), "page.id")?,
        "page.id",
    )?);
    columns[PAGE_INT].i32(match item.get("level") {
        None => -1,
        Some(value) => as_i32(MANIFEST.integer(Some(value), "page.level")?, "page.level")?,
    });
    // Literal labels, not formatted per key and per page.
    for (key, label, flag) in [
        ("group", "page.group", FLAG_GROUP),
        ("source", "page.source", FLAG_SOURCE),
    ] {
        match item.get(key) {
            None => columns[PAGE_INT].i32(-1),
            Some(Value::Null) => {
                flags |= flag;
                columns[PAGE_INT].i32(-1);
            }
            Some(value) => {
                flags |= flag;
                columns[PAGE_INT].i32(as_i32(MANIFEST.integer(Some(value), label)?, label)?);
            }
        }
    }
    for (key, label) in [
        ("stream", "page.stream"),
        ("streamOffset", "page.streamOffset"),
    ] {
        columns[PAGE_INT].i32(as_i32(MANIFEST.integer(item.get(key), label)?, label)?);
    }
    columns[PAGE_INT].i32(as_i32(
        MANIFEST.integer(item.get("count"), "page.count")?,
        "page.count",
    )?);
    columns[PAGE_INT].i32(match item.get("start") {
        None => -1,
        Some(value) => as_i32(MANIFEST.integer(Some(value), "page.start")?, "page.start")?,
    });
    let geometry = MANIFEST.object(
        item.get("geometry").unwrap_or(&Value::Null),
        "page.geometry",
    )?;
    for (key, label) in [
        ("bytes", "page.geometry.bytes"),
        ("vertexCount", "page.geometry.vertexCount"),
        ("indexCount", "page.geometry.indexCount"),
        ("flags", "page.geometry.flags"),
        ("uncompressedBytes", "page.geometry.uncompressedBytes"),
        ("residentBytes", "page.geometry.residentBytes"),
        ("residentOffset", "page.geometry.residentOffset"),
    ] {
        columns[GEOMETRY_U32].u32(as_u32(MANIFEST.integer(geometry.get(key), label)?, label)?);
    }
    columns[PAGE_U32].u32(flags);
    // Layer 0 is the untouched draw, so a cache with no coplanar surface writes a column of zeros.
    columns[PAGE_DEPTH_LAYER].u32(match item.get("depthLayer") {
        None => 0,
        Some(value) => {
            let layer = as_u32(
                MANIFEST.integer(Some(value), "page.depthLayer")?,
                "page.depthLayer",
            )?;
            if layer > crate::coplanar::COPLANAR_MAX_LAYER {
                return Err(MANIFEST.bad(format!("page.depthLayer {layer} exceeds four bits")));
            }
            layer
        }
    });
    Ok(())
}
