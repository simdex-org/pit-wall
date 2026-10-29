// Genera todas las versiones del logotipo en ./logos (node exportar-logos.js)
const S = require('./logo.js');
const fs = require('fs');
const path = require('path');

const out = path.join(__dirname, 'logos');
fs.mkdirSync(out, { recursive: true });
for (const k of Object.keys(S.kinds))
  for (const p of Object.keys(S.pal))
    fs.writeFileSync(path.join(out, `simdex-${k}-${p}.svg`), S.svg(k, S.pal[p]));
console.log('Listo:', fs.readdirSync(out).length, 'archivos en', out);
