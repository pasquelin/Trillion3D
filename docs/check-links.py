from pathlib import Path
import re,subprocess,json,urllib.parse,unicodedata
sdk_root = Path(__file__).resolve().parent.parent
roots = [sdk_root]
for root in roots:
 if not root.is_dir(): raise SystemExit('Missing repository: ' + str(root))
def files(root):
 return [root/p for p in subprocess.check_output(['rg','--files','--hidden','-g','*.md','-g','!.git','-g','!.idea','-g','!node_modules','-g','!dist','-g','!target'],cwd=root,text=True).splitlines()]
def prose(s):
 return re.sub(r'^\s*(`{3,}|~{3,}).*?^\s*\1\s*$', '',s,flags=re.M|re.S)
def slug(s):
 s=re.sub(r'<[^>]*>','',s);s=re.sub(r'\[([^]]+)\]\([^)]*\)',r'\1',s)
 return ''.join(c for c in s.lower() if c in '-_ ' or unicodedata.category(c)[0] in 'LN').replace(' ','-')
def anchors(p):
 s=prose(p.read_text()); result=set(re.findall(r'(?:id|name)=["\']([^"\']+)',s)); counts={}
 for h in re.findall(r'^#{1,6}\s+(.+?)\s*#*$',s,re.M):
  key=slug(h); n=counts.get(key,0);counts[key]=n+1;result.add(key+('-'+str(n) if n else ''))
 return result
bad=[]; count=0; runtime_routes=[]
for root in roots:
 for p in files(root):
  s=prose(p.read_text())
  targets=re.findall(r'\]\(\s*(<[^>]+>|[^\s)]+)(?:\s+["\'][^\n]*?["\'])?\s*\)',s)
  targets+=re.findall(r'^\s*\[[^\]]+\]:\s*(\S+)',s,re.M)
  targets+=re.findall(r'(?:href|src)=["\']([^"\']+)',s)
  for t in targets:
   t=t.strip('<>'); u=urllib.parse.urlsplit(t)
   if u.scheme or t.startswith('//'):continue
   if t.startswith('/api/'):
    runtime_routes.append([str(p),t]);continue
   count+=1; dest=(p.parent/urllib.parse.unquote(u.path)).resolve() if u.path else p
   if not dest.exists():bad.append([str(p),t,'missing file']);continue
   if u.fragment and dest.suffix.lower()=='.md' and urllib.parse.unquote(u.fragment) not in anchors(dest):bad.append([str(p),t,'missing anchor'])
print(json.dumps({'localFileLinks':count,'errors':bad,'runtimeRoutesNotChecked':runtime_routes},ensure_ascii=False,indent=2))
raise SystemExit(1 if bad else 0)
