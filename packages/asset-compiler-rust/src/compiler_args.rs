use super::*;
use crate::texture_preview::BlockFormat;

/// `--textures-format=` values: one family, both, or none — the cook cost is
/// bounded by cooking one family per target platform, and a measurement's
/// "before" cooks none.
pub const TEXTURE_FORMAT_OPTION: &str = "--textures-format=";
pub const TEXTURE_FORMAT_DEFAULT: &str = "bc7";

pub fn texture_formats(value: &str) -> std::result::Result<Vec<BlockFormat>, String> {
    match value {
        "both" => Ok(BlockFormat::ALL.to_vec()),
        "none" => Ok(Vec::new()),
        name => BlockFormat::named(name)
            .map(|format| vec![format])
            .ok_or_else(|| "textures-format must be bc7, astc, both or none".to_string()),
    }
}

pub fn parse_compiler_args(
    args: &[String],
    cancelled: Arc<AtomicBool>,
) -> std::result::Result<Options, String> {
    let (options, args): (Vec<String>, Vec<String>) = args
        .iter()
        .cloned()
        .partition(|arg| arg.starts_with(TEXTURE_FORMAT_OPTION));
    let texture_formats = texture_formats(options.last().map_or(TEXTURE_FORMAT_DEFAULT, |arg| {
        &arg[TEXTURE_FORMAT_OPTION.len()..]
    }))?;
    fn number(
        value: Option<&String>,
        default: usize,
        name: &str,
    ) -> std::result::Result<usize, String> {
        match value {
            Some(raw) => raw
                .parse::<usize>()
                .ok()
                .filter(|v| *v > 0)
                .ok_or_else(|| format!("{name} must be a positive integer")),
            None => Ok(default),
        }
    }
    let (scope,triangle_budget,threads,ram_budget_mb,resource_base,simplification)=match args.len(){
  5=>(args[2].clone(),number(Some(&args[3]),150000,"triangles")?,2,256,args[4].clone(),"none".into()),
  7=>(args[2].clone(),number(Some(&args[3]),150000,"triangles")?,number(Some(&args[4]),2,"threads")?,number(Some(&args[5]),256,"RAM_MB")?,args[6].clone(),"none".into()),
  8=>(args[2].clone(),number(Some(&args[3]),150000,"triangles")?,number(Some(&args[4]),2,"threads")?,number(Some(&args[5]),256,"RAM_MB")?,args[6].clone(),args[7].clone()),
  _=>return Err("Usage: trillion3d-compiler SOURCE CACHE [slice|full] [triangles] RESOURCE_BASE_URL\n       trillion3d-compiler SOURCE CACHE [slice|full] [triangles] [threads] [RAM_MB] RESOURCE_BASE_URL [none|qem-endpoints] [--textures-format=bc7|astc|both|none]\n       SOURCE is a directory or a file in one of the formats --version lists".into()),
 };
    if !["none", "qem-endpoints"].contains(&simplification.as_str()) {
        return Err("simplification must be none or qem-endpoints".into());
    }
    Ok(Options {
        source: PathBuf::from(&args[0]),
        cache: PathBuf::from(&args[1]),
        resource_base,
        scope,
        triangle_budget,
        threads,
        ram_budget_mb,
        simplification,
        texture_formats,
        cancelled,
    })
}

impl Options {
    /// Folder of this job's scope in the cache: its pointer, and one folder per key.
    pub fn scope_directory(&self) -> PathBuf {
        self.cache.join("native").join(&self.scope)
    }
    /// Folder of the product named `key` under this job's scope.
    pub fn key_directory(&self, key: &str) -> PathBuf {
        self.scope_directory().join(key)
    }
}
