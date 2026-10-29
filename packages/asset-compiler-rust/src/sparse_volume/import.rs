//! A `.vdb` file as the voxels of a sparse volume texture: which grids' components become the
//! components of the two attribute textures and in what format, the box of the active voxels,
//! the voxels themselves, and the files of a numbered sequence that make the frames of an
//! animated volume.
use super::format::*;
use super::texture::{CreateInfo, Source};
use super::vdb::{invalid, Grid};
use crate::Result;
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

/// How an attribute texture stores its components.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum StoredFormat {
    Unorm8,
    Float16,
}

/// The component of a grid that fills a component of an attribute texture.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) struct Mapping {
    pub(crate) grid: usize,
    pub(crate) component: usize,
}

/// What fills one attribute texture: the sources of its four components, none for a component left
/// empty, and its format.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct AttributesDesc {
    pub(crate) mappings: [Option<Mapping>; 4],
    pub(crate) format: StoredFormat,
}

impl AttributesDesc {
    fn empty(format: StoredFormat) -> Self {
        Self {
            mappings: [None; 4],
            format,
        }
    }
}

/// What fills the two attribute textures of a volume.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct ImportOptions {
    pub(crate) attributes: [AttributesDesc; 2],
}

/// The texture format of `format` holding `components` components; three components take a four
/// component format.
fn multi_component_format(format: StoredFormat, components: usize) -> PixelFormat {
    match (format, components) {
        (StoredFormat::Unorm8, 1) => PixelFormat::R8,
        (StoredFormat::Unorm8, 2) => PixelFormat::R8G8,
        (StoredFormat::Unorm8, 3 | 4) => PixelFormat::R8G8B8A8,
        (StoredFormat::Float16, 1) => PixelFormat::R16F,
        (StoredFormat::Float16, 2) => PixelFormat::G16R16F,
        (StoredFormat::Float16, 3 | 4) => PixelFormat::FloatRgba,
        _ => PixelFormat::Unknown,
    }
}

/// The components of the file's grids that the textures take by default: the density in the first
/// texture as eight bits and everything else in the second as half floats, where the grids hold a
/// density and at most four other components other than three (three would be padded to four
/// anyway); otherwise the components in the order of the file, four to a texture, as half floats.
pub(crate) fn default_assignment(grids: &[Grid]) -> ImportOptions {
    let mut entries: Vec<(usize, usize, &str)> = Vec::new();
    for (index, grid) in grids.iter().enumerate().filter(|(_, grid)| grid.supported) {
        for component in 0..grid.components {
            entries.push((index, component, grid.name.as_str()));
        }
    }
    let density = entries.iter().position(|entry| entry.2 == "density");
    let others = entries.len() - usize::from(density.is_some());
    let mut options = ImportOptions {
        attributes: [
            AttributesDesc::empty(StoredFormat::Float16),
            AttributesDesc::empty(StoredFormat::Float16),
        ],
    };
    let as_mapping = |entry: &(usize, usize, &str)| {
        Some(Mapping {
            grid: entry.0,
            component: entry.1,
        })
    };
    if let (Some(density), true) = (density, others <= 4 && others != 3) {
        options.attributes[0].mappings[0] = as_mapping(&entries[density]);
        options.attributes[0].format = StoredFormat::Unorm8;
        let rest = entries.iter().enumerate().filter(|(at, _)| *at != density);
        for (slot, (_, entry)) in rest.enumerate() {
            options.attributes[1].mappings[slot] = as_mapping(entry);
        }
    } else {
        for (rank, entry) in entries.iter().take(8).enumerate() {
            options.attributes[rank / 4].mappings[rank % 4] = as_mapping(entry);
        }
    }
    options
}

/// Why `options` cannot fill textures from `grids`, if it cannot: a grid or a component that is not
/// there, a grid whose values are not read, or nothing selected.
pub(crate) fn validate(options: &ImportOptions, grids: &[Grid]) -> Result<()> {
    let mut any = false;
    for mapping in options
        .attributes
        .iter()
        .flat_map(|desc| desc.mappings.iter().flatten())
    {
        any = true;
        let grid = grids.get(mapping.grid).ok_or_else(|| {
            invalid(format!(
                "the import names the grid {}, and the file holds {}",
                mapping.grid,
                grids.len()
            ))
        })?;
        if !grid.supported {
            return Err(invalid(format!(
                "the grid {:?} is of the type {}, which the importer does not read",
                grid.name, grid.type_name
            )));
        }
        if mapping.component >= grid.components {
            return Err(invalid(format!(
                "the import names the component {} of the grid {:?}, which has {}",
                mapping.component, grid.name, grid.components
            )));
        }
    }
    if any {
        Ok(())
    } else {
        Err(invalid(
            "the import selects no component of any grid, so there is nothing to import",
        ))
    }
}

/// The box of the active voxels of the grids `options` names, the upper corner excluded; none
/// where they hold nothing.
pub(crate) fn mapped_bounds(options: &ImportOptions, grids: &[Grid]) -> Option<(IVec3, IVec3)> {
    let mut found: Option<(IVec3, IVec3)> = None;
    for mapping in options
        .attributes
        .iter()
        .flat_map(|desc| desc.mappings.iter().flatten())
    {
        if let Some((low, high)) = grids[mapping.grid].active_box {
            widen_box(&mut found, low, high);
        }
    }
    found
}

/// A frame: the grids of one file read as the voxels of a volume whose lowest voxel is `origin`.
pub(crate) struct Frame<'a> {
    grids: &'a [Grid],
    origin: IVec3,
    info: CreateInfo,
    /// For each grid, the textures' components it fills: texture, component, the grid's component.
    fills: Vec<Vec<(usize, usize, usize)>>,
    /// The transform of the last grid taken.
    pub(crate) matrix: [f64; 16],
}

impl<'a> Frame<'a> {
    /// The frame of `grids` for `options`, the volume starting at `origin`.
    pub(crate) fn new(grids: &'a [Grid], options: &ImportOptions, origin: IVec3) -> Result<Self> {
        validate(options, grids)?;
        let mut formats = [PixelFormat::Unknown; 2];
        for (attribute, desc) in options.attributes.iter().enumerate() {
            let components = desc
                .mappings
                .iter()
                .rposition(Option::is_some)
                .map_or(0, |last| last + 1);
            if components > 0 {
                formats[attribute] = multi_component_format(
                    desc.format,
                    if components == 3 { 4 } else { components },
                );
            }
        }
        let mut fallback = [[0.0f32; 4]; 2];
        let mut fills = vec![Vec::new(); grids.len()];
        let mut matrix: Option<[f64; 16]> = None;
        for (attribute, desc) in options.attributes.iter().enumerate() {
            for (component, mapping) in desc.mappings.iter().enumerate() {
                let Some(mapping) = mapping else { continue };
                let grid = &grids[mapping.grid];
                fallback[attribute][component] = grid.background[mapping.component];
                fills[mapping.grid].push((attribute, component, mapping.component));
                matrix = Some(grid.matrix);
            }
        }
        let bounds = mapped_bounds(options, grids)
            .filter(|(low, high)| (0..3).all(|axis| low[axis] < high[axis]))
            .ok_or_else(|| invalid("the volume holds no active voxel"))?;
        let info = CreateInfo {
            min: sub3(bounds.0, origin),
            max: sub3(bounds.1, origin),
            formats,
            fallback,
        };
        Ok(Self {
            grids,
            origin,
            info,
            fills,
            matrix: matrix.expect("a mapping was validated"),
        })
    }
}

impl Source for Frame<'_> {
    fn info(&self) -> CreateInfo {
        CreateInfo { ..self.info }
    }

    fn visit(&self, visit: &mut dyn FnMut(IVec3, IVec3, usize, usize, f32)) {
        for (index, grid) in self.grids.iter().enumerate() {
            let fills = &self.fills[index];
            if fills.is_empty() {
                continue;
            }
            grid.visit(&mut |low, high, values| {
                for &(attribute, component, from) in fills {
                    visit(
                        sub3(low, self.origin),
                        sub3(high, self.origin),
                        attribute,
                        component,
                        values[from],
                    );
                }
            });
        }
    }
}

/// The files of the sequence `file` is one of: the files of its folder named as it is, up to the
/// number its name ends with — the same name before the number, any number after it —, from the
/// lowest number found to the last before a number is missing. `file` alone where its name does
/// not end with a number.
pub(crate) fn sequence_files(file: &Path) -> Vec<PathBuf> {
    let name = file
        .file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or_default();
    let stem = name.get(..name.len().saturating_sub(4)).unwrap_or_default();
    if !stem.ends_with(|c: char| c.is_ascii_digit()) {
        return vec![file.to_path_buf()];
    }
    let base = stem
        .trim_end_matches(|c: char| c.is_ascii_digit())
        .to_lowercase();
    let folder = crate::compiler::source::safe_path::parent_or_dot(file);
    let mut numbered: BTreeMap<u64, PathBuf> = BTreeMap::new();
    for entry in std::fs::read_dir(folder).into_iter().flatten().flatten() {
        let candidate = entry.file_name().to_string_lossy().into_owned();
        let lower = candidate.to_lowercase();
        let Some(candidate_stem) = lower.strip_suffix(".vdb") else {
            continue;
        };
        let digits = candidate_stem.trim_end_matches(|c: char| c.is_ascii_digit());
        let suffix = &candidate_stem[digits.len()..];
        let belongs = if base.is_empty() {
            candidate_stem.chars().all(|c| c.is_ascii_digit())
        } else {
            lower.starts_with(&base)
        };
        if let (true, Ok(number)) = (belongs, suffix.parse::<u64>()) {
            numbered.entry(number).or_insert_with(|| entry.path());
        }
    }
    let Some((&lowest, _)) = numbered.first_key_value() else {
        return vec![file.to_path_buf()];
    };
    let mut files = Vec::new();
    let mut number = lowest;
    while let Some(path) = numbered.get(&number) {
        files.push(path.clone());
        number += 1;
    }
    files
}
