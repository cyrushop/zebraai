// Extracts the JSON block and the approved narrative (section 2) from the
// latest data/QBR_Data_<date>.md into src/data/. Run automatically by dev/build.
import { readFileSync, writeFileSync, readdirSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = join(root, 'data');
const files = readdirSync(dataDir).filter((f) => /^QBR_Data_\d{4}-\d{2}-\d{2}\.md$/.test(f)).sort();
if (!files.length) throw new Error('No data/QBR_Data_<date>.md file found');
const file = files[files.length - 1];
const md = readFileSync(join(dataDir, file), 'utf8');

const jsonMatch = md.match(/```json\s*([\s\S]*?)```/);
if (!jsonMatch) throw new Error(`${file}: no \`\`\`json block found`);
const data = JSON.parse(jsonMatch[1]);
data.meta.source_file = file;

// Section 2: "### Heading" followed by "- bullet" lines or a plain paragraph.
const s2 = md.split(/^## 2\..*$/m)[1]?.split(/^## 3\..*$/m)[0];
if (!s2) throw new Error(`${file}: section "## 2." not found`);
const narrative = [];
let cur = null;
for (const raw of s2.split('\n')) {
  const line = raw.trim();
  if (line.startsWith('### ')) {
    cur = { heading: line.slice(4).trim(), bullets: [], text: '' };
    narrative.push(cur);
  } else if (cur && line.startsWith('- ')) {
    cur.bullets.push(line.slice(2).trim());
  } else if (cur && line) {
    cur.text = cur.text ? `${cur.text} ${line}` : line;
  }
}

// Confidentiality guard (spec §4): opportunity suffixes must never appear.
const all = JSON.stringify({ data, narrative });
const leak = all.match(/[A-Za-z0-9)]\s?-[FPR]\b/);
if (leak) throw new Error(`Confidentiality check failed: found "${leak[0]}"`);

mkdirSync(join(root, 'src/data'), { recursive: true });
writeFileSync(join(root, 'src/data/qbr.json'), JSON.stringify(data, null, 1) + '\n');
writeFileSync(
  join(root, 'src/data/narrative.ts'),
  `// Generated from ${file} by scripts/extract-data.mjs. Do not edit.\n` +
    `export interface NarrativeSection { heading: string; bullets: string[]; text: string }\n` +
    `export const narrative: NarrativeSection[] = ${JSON.stringify(narrative, null, 2)};\n`,
);
console.log(`Extracted ${file}: ${narrative.length} narrative sections`);
