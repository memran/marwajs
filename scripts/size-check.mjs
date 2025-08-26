import fs from 'node:fs';
import path from 'node:path';
import { gzipSize } from 'gzip-size';
import brotliSize from 'brotli-size';

async function sizeReport(file) {
  const buf = fs.readFileSync(file);
  const raw = buf.length;
  const gz = await gzipSize(buf);
  const br = brotliSize.sync(buf);
  return { file, raw, gz, br };
}
const dir = process.argv[2] || 'dist';
const files = fs.readdirSync(dir).filter(f => f.endsWith('.js')).map(f => path.join(dir, f));
const rows = await Promise.all(files.map(sizeReport));
rows.forEach(r => console.log(`${path.basename(r.file)} raw:${(r.raw/1024).toFixed(2)}kb gz:${(r.gz/1024).toFixed(2)}kb br:${(r.br/1024).toFixed(2)}kb`));
