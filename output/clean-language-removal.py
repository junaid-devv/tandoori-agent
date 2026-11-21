from pathlib import Path
for p in Path('lib').rglob('*.ts'):
 s=p.read_text(encoding='utf-8')
 # Clean only files changed by the language removal.
 import subprocess
 changed=subprocess.check_output(['git','-c','core.fsmonitor=false','diff','--name-only','--',str(p)],text=True).strip()
 if changed:
  import re
  s='\n'.join(line.rstrip() for line in s.split('\n'));s=re.sub(r'\n(?:[ \t]*\n){2,}','\n\n',s);p.write_text(s,encoding='utf-8')
p=Path('lib/agent/reply.ts');s=p.read_text(encoding='utf-8').replace('      const catList = categories.slice(0, 5).join(", ");\n','');p.write_text(s,encoding='utf-8')
p=Path('lib/agent/pipeline.ts');s=p.read_text(encoding='utf-8').replace('|stare?\\s*mashay|pa\\s*kher','');p.write_text(s,encoding='utf-8')
