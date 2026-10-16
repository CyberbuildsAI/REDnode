// Checks that a BBCode file's tags are balanced and known to Nexus Mods, before it is pasted there.
//   node tools/check-bbcode.mjs nexus/description.bbcode
import * as fs from "node:fs";

const file = process.argv[2] ?? "nexus/description.bbcode";
const text = fs.readFileSync(file, "utf8");
// Tags Nexus's editor understands. [*] and [line] stand alone.
const known = new Set(["b", "i", "u", "s", "size", "color", "font", "center", "left", "right", "quote", "code", "list", "url", "email", "img", "youtube", "spoiler", "sup", "sub"]);
const alone = new Set(["*", "line"]);
const stack = [];
const problems = [];
let line = 1;
let last = 0;
for (const m of text.matchAll(/\[(\/?)([a-z*]+)(=[^\]]*)?\]/gi)) {
  line += (text.slice(last, m.index).match(/\n/g) ?? []).length;
  last = m.index;
  const [, close, rawName] = m;
  const name = rawName.toLowerCase();
  if (alone.has(name)) continue;
  if (!known.has(name)) {
    problems.push(`line ${line}: [${close}${name}] is not a Nexus tag`);
    continue;
  }
  if (!close) stack.push({ name, line });
  else if (stack.at(-1)?.name === name) stack.pop();
  else problems.push(`line ${line}: [/${name}] closes [${stack.at(-1)?.name ?? "nothing"}] (opened on line ${stack.at(-1)?.line ?? "-"})`);
}
for (const open of stack) problems.push(`line ${open.line}: [${open.name}] is never closed`);
for (const url of text.matchAll(/\[url=([^\]]+)\]/g)) if (!/^https:\/\//.test(url[1])) problems.push(`link without https: ${url[1]}`);
if (problems.length) {
  console.log(problems.join("\n"));
  process.exit(1);
}
console.log(`${file}: tags balanced, ${text.length.toLocaleString()} characters`);
