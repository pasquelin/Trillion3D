use super::*;
use crate::compiler_page_object::{GEOMETRY_PAGE_CODEC, GEOMETRY_PAGE_VERSION};

pub(super) fn encode_page(
    page: &Value,
    columns: &mut [Column],
    templates: &Templates,
) -> Result<()> {
    let item = object(page, "page")?;
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
        Some(other) => return Err(bad(format!("page.role is not a string: {other}"))),
    }
    let cluster_error = matches!(item.get("lodError"),Some(value) if value.is_number())
        && item.get("sphere").is_some();
    if cluster_error {
        flags |= FLAG_CLUSTER_ERROR;
        columns[PAGE_ERROR].f64(number(item.get("lodError"), "page.lodError")?);
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
            columns[PAGE_ERROR].f64(number(Some(value), "page.parentError")?);
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
    columns[PAGE_INT].i32(as_i32(integer(item.get("id"), "page.id")?, "page.id")?);
    columns[PAGE_INT].i32(match item.get("level") {
        None => -1,
        Some(value) => as_i32(integer(Some(value), "page.level")?, "page.level")?,
    });
    // Literal labels: previously formatted twice per key and per page.
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
                columns[PAGE_INT].i32(as_i32(integer(Some(value), label)?, label)?);
            }
        }
    }
    let stream = match item.get("stream") {
        None => -1,
        Some(value) => as_i32(integer(Some(value), "page.stream")?, "page.stream")?,
    };
    columns[PAGE_INT].i32(stream);
    columns[PAGE_INT].i32(if stream < 0 {
        -1
    } else {
        as_i32(
            integer(item.get("streamOffset"), "page.streamOffset")?,
            "page.streamOffset",
        )?
    });
    columns[PAGE_INT].i32(as_i32(
        integer(item.get("count"), "page.count")?,
        "page.count",
    )?);
    columns[PAGE_INT].i32(match item.get("start") {
        None => -1,
        Some(value) => as_i32(integer(Some(value), "page.start")?, "page.start")?,
    });
    columns[PAGE_U32].u32(as_u32(
        integer(item.get("bytes"), "page.bytes")?,
        "page.bytes",
    )?);
    let sha = text(item.get("sha256"), "page.sha256")?;
    templated(templates.page, text(item.get("url"), "page.url")?, sha)?;
    columns[PAGE_SHA].sha(sha)?;
    match item.get("geometry") {
        None | Some(Value::Null) => {
            columns[GEOMETRY_SHA].zeros(64);
            columns[GEOMETRY_U32].zeros(20);
        }
        Some(value) => {
            flags |= FLAG_GEOMETRY;
            let geometry = object(value, "page.geometry")?;
            let digest = text(geometry.get("sha256"), "page.geometry.sha256")?;
            templated(
                templates.geometry,
                text(geometry.get("url"), "page.geometry.url")?,
                digest,
            )?;
            if integer(geometry.get("formatVersion"), "page.geometry.formatVersion")?
                != i64::from(GEOMETRY_PAGE_VERSION)
            {
                return Err(bad("page.geometry.formatVersion is not the quantized page's"));
            }
            if text(geometry.get("codec"), "page.geometry.codec")? != GEOMETRY_PAGE_CODEC {
                return Err(bad("page.geometry.codec is not quantized"));
            }
            columns[GEOMETRY_SHA].sha(digest)?;
            for (key, label) in [
                ("bytes", "page.geometry.bytes"),
                ("vertexCount", "page.geometry.vertexCount"),
                ("indexCount", "page.geometry.indexCount"),
                ("flags", "page.geometry.flags"),
                ("uncompressedBytes", "page.geometry.uncompressedBytes"),
            ] {
                columns[GEOMETRY_U32].u32(as_u32(integer(geometry.get(key), label)?, label)?);
            }
        }
    }
    columns[PAGE_U32].u32(flags);
    // Layer 0 is the untouched draw, so a cache with no coplanar surface writes a column of zeros.
    columns[PAGE_DEPTH_LAYER].u32(match item.get("depthLayer") {
        None => 0,
        Some(value) => {
            let layer = as_u32(integer(Some(value), "page.depthLayer")?, "page.depthLayer")?;
            if layer > 15 {
                return Err(bad(format!("page.depthLayer {layer} exceeds four bits")));
            }
            layer
        }
    });
    Ok(())
}
