// Set a GLB's glTF asset.generator in place (2026-11-15: v1's paddler figures carried "lakeshore paddler-….py", an
// internal name, into the public build). Only the generator's string changes: the rest of the JSON chunk keeps its
// bytes (a text replace, not a re-serialise), the chunk is re-padded with spaces to 4 bytes, the BIN chunk is copied
// byte for byte. Deterministic: a second run changes nothing.
//   node tools/glb-set-generator.mjs <generator> <file.glb>...
import { readFileSync, writeFileSync } from 'node:fs';

export function setGenerator(buf, generator) {
  if (buf.readUInt32LE(0) !== 0x46546c67 || buf.readUInt32LE(4) !== 2) throw new Error('not a glTF 2 binary');
  const jl = buf.readUInt32LE(12);
  if (buf.readUInt32LE(16) !== 0x4e4f534a) throw new Error('first chunk is not JSON');
  const text = buf.subarray(20, 20 + jl).toString('utf8').trimEnd();
  const asset = /("asset"\s*:\s*\{[^{}]*?"generator"\s*:\s*)"(?:[^"\\]|\\.)*"/;
  if (!asset.test(text)) throw new Error('no asset.generator');
  let js = Buffer.from(text.replace(asset, `$1${JSON.stringify(generator)}`), 'utf8');
  JSON.parse(js.toString('utf8'));   // still valid JSON
  js = Buffer.concat([js, Buffer.alloc((4 - (js.length % 4)) % 4, 0x20)]);
  const rest = buf.subarray(20 + jl);   // the BIN chunk (header + data), untouched
  const head = Buffer.alloc(20);
  head.writeUInt32LE(0x46546c67, 0); head.writeUInt32LE(2, 4); head.writeUInt32LE(20 + js.length + rest.length, 8);
  head.writeUInt32LE(js.length, 12); head.writeUInt32LE(0x4e4f534a, 16);
  return Buffer.concat([head, js, rest]);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [generator, ...files] = process.argv.slice(2);
  if (!generator || !files.length) { console.error('usage: node tools/glb-set-generator.mjs <generator> <file.glb>...'); process.exit(2); }
  for (const f of files) {
    const before = readFileSync(f), after = setGenerator(before, generator);
    if (!after.equals(before)) writeFileSync(f, after);
    console.log(`${f}: ${before.length} -> ${after.length} bytes${after.equals(before) ? ' (unchanged)' : ''}`);
  }
}
