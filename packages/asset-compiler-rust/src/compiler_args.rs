use super::*;

pub fn parse_compiler_args(
    args: &[String],
    cancelled: Arc<AtomicBool>,
) -> std::result::Result<Options, String> {
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
  _=>return Err("Usage: web-geometry-compiler SOURCE CACHE [slice|full] [triangles] RESOURCE_BASE_URL\n       web-geometry-compiler SOURCE CACHE [slice|full] [triangles] [threads] [RAM_MB] RESOURCE_BASE_URL [none|qem-endpoints]\n       SOURCE is a directory or a file in one of the formats --version lists".into()),
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
        cancelled,
    })
}
