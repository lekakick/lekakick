import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
const rules = [
  ['unsafe eval', /\beval\s*\(|new Function\s*\(/],
  ['unsafe HTML assignment', /\.innerHTML\s*=/],
  ['shell execution', /child_process|execSync|spawnSync/],
  ['possible hardcoded secret', /(?:password|api[_-]?key|secret)\s*[:=]\s*['"][^'"]{6,}['"]/i],
];
const findings = [];
async function scan(dir) {
  for (const entry of await readdir(dir,{withFileTypes:true})) {
    const file = path.join(dir,entry.name);
    if (entry.isDirectory()) await scan(file);
    else if (/\.(ts|js|ejs)$/.test(file)) {
      const text = await readFile(file,'utf8');
      for (const [name,pattern] of rules) if (pattern.test(text)) findings.push({file,rule:name});
    }
  }
}
await scan('src'); await scan('views'); await scan('public');
console.log(JSON.stringify({passed:findings.length===0,findings},null,2));
process.exitCode = findings.length ? 1 : 0;
