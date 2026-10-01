//! Header schemas are checked before any declared array is allocated.
use super::schema::{add, validate};
use super::*;
#[derive(Clone, Copy)]
pub(super) enum Scalar {
    I8,
    U8,
    I16,
    U16,
    I32,
    U32,
    F32,
    F64,
}
impl Scalar {
    pub(super) fn parse(name: &str) -> Result<Self> {
        Ok(match name {
            "char" | "int8" => Self::I8,
            "uchar" | "uint8" => Self::U8,
            "short" | "int16" => Self::I16,
            "ushort" | "uint16" => Self::U16,
            "int" | "int32" => Self::I32,
            "uint" | "uint32" => Self::U32,
            "float" | "float32" => Self::F32,
            "double" | "float64" => Self::F64,
            _ => return Err(source::unsupported("ply", format!("scalar type {name}"))),
        })
    }
    pub(super) fn integral(self) -> bool {
        !matches!(self, Self::F32 | Self::F64)
    }
    pub(super) fn color_scale(self) -> Result<f64> {
        match self {
            Self::U8 => Ok(255.0),
            Self::U16 => Ok(65535.0),
            Self::F32 | Self::F64 => Ok(1.0),
            _ => Err(source::unsupported(
                "ply",
                "colour scalar must be uchar, ushort or floating point",
            )),
        }
    }
}
pub(super) struct Property {
    pub name: String,
    pub scalar: Scalar,
    pub list: Option<Scalar>,
}
pub(super) struct Element {
    pub name: String,
    pub count: usize,
    pub properties: Vec<Property>,
}
#[derive(Clone, Copy)]
pub(super) enum Format {
    Ascii,
    Little,
    Big,
}

pub(super) fn read(bytes: &[u8]) -> Result<(Format, Vec<Element>, usize)> {
    let mut offset = 0;
    let mut elements: Vec<Element> = Vec::new();
    let mut format = None;
    for (line_index, raw) in bytes.split_inclusive(|v| *v == b'\n').enumerate() {
        offset += raw.len();
        let line = std::str::from_utf8(raw)
            .map_err(|_| source::invalid("ply", "header is not ASCII"))?
            .trim();
        let words: Vec<_> = line.split_whitespace().collect();
        if line_index == 0 {
            if words != ["ply"] {
                return Err(source::invalid("ply", "missing ply signature"));
            }
            continue;
        }
        match words.as_slice() {
            ["comment", ..] | ["obj_info", ..] => {}
            ["format", name, "1.0"] if format.is_none() && elements.is_empty() => {
                format = Some(match *name {
                    "ascii" => Format::Ascii,
                    "binary_little_endian" => Format::Little,
                    "binary_big_endian" => Format::Big,
                    _ => return Err(source::unsupported("ply", format!("encoding {name}"))),
                })
            }
            ["element", name, count] if format.is_some() => {
                if !["vertex", "face", "material"].contains(name) {
                    return Err(source::unsupported("ply", format!("element {name}")));
                }
                if elements.iter().any(|e| e.name == *name) {
                    return Err(source::invalid("ply", "duplicate element"));
                }
                let count = count
                    .parse()
                    .map_err(|_| source::invalid("ply", "invalid element count"))?;
                elements.push(Element {
                    name: name.to_string(),
                    count,
                    properties: Vec::new(),
                });
            }
            ["property", kind, name] => add(&mut elements, name, Scalar::parse(kind)?, None)?,
            ["property", "list", length, kind, name] => {
                let length = Scalar::parse(length)?;
                if !length.integral() {
                    return Err(source::invalid("ply", "list length must be an integer"));
                }
                add(&mut elements, name, Scalar::parse(kind)?, Some(length))?;
            }
            ["end_header"] => {
                let format = format.ok_or_else(|| source::invalid("ply", "missing format"))?;
                validate(&elements)?;
                return Ok((format, elements, offset));
            }
            _ => {
                return Err(source::invalid(
                    "ply",
                    format!("unrecognised header line {line:?}"),
                ))
            }
        }
    }
    Err(source::invalid("ply", "missing end_header"))
}
