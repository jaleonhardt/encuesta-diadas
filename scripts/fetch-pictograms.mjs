// Descarga desde ARASAAC los pictogramas que usa el instrumento (shared/instrument.json)
// y los deja en frontend/public/pictos. Solo descarga los que faltan.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const { pictos } = JSON.parse(readFileSync(join(root, 'shared', 'instrument.json'), 'utf8'));
const out = join(root, 'frontend', 'public', 'pictos');
mkdirSync(out, { recursive: true });

let failed = 0;
for (const id of pictos.ids) {
  const file = join(out, `${id}.png`);
  if (existsSync(file)) continue;
  let ok = false;
  for (let attempt = 1; attempt <= 4 && !ok; attempt++) {
    try {
      const res = await fetch(`https://static.arasaac.org/pictograms/${id}/${id}_500.png`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      writeFileSync(file, Buffer.from(await res.arrayBuffer()));
      ok = true;
      console.log(`pictograma ${id} descargado`);
    } catch (e) {
      console.warn(`pictograma ${id}, intento ${attempt}: ${e.message}`);
      await new Promise((r) => setTimeout(r, 1500 * attempt));
    }
  }
  if (!ok) failed++;
}
if (failed) {
  console.error(`Faltan ${failed} pictogramas. El módulo P los necesita: se detiene la construcción.`);
  process.exit(1);
}
console.log(`Pictogramas listos (${pictos.ids.length}).`);
