// Generates the offline audio fallback: one WAV clip per spoken phrase
// (every coaching message plus the voice test/enabled cues) for each
// language, using eSpeak NG locally (scripts/espeak_synth.py). Clips are
// written to public/audio/<lang>/<messageId>.mp3 with a manifest.
//
// The phrases are read from the i18n resources, so clips always match the
// displayed text. Requires Python 3 with `pip install espeakng-loader lameenc`.
// Usage: node scripts/voice-clips.mjs [--required]
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import ts from 'typescript';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'public/audio');
const required = process.argv.includes('--required');
const python = process.env.PYTHON || 'python3';

/** Loads a resource file by transpiling it (it only has type imports). */
async function loadResource(file, exportName) {
  const src = readFileSync(join(root, 'src/i18n', file), 'utf8');
  const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
  const tmp = join(tmpdir(), `tennis-i18n-${process.pid}-${file}.mjs`);
  writeFileSync(tmp, js);
  try {
    return (await import(pathToFileURL(tmp).href))[exportName];
  } finally {
    rmSync(tmp, { force: true });
  }
}

/** Same ids as src/coaching/messageKeys.ts messageId(), plus speech cues. */
function phrases(lang, m) {
  const out = [];
  for (const [issue, v] of Object.entries(m.coaching.issues)) {
    for (const variant of ['now', 'repeated', 'improved']) out.push({ id: `issue.${issue}.${variant}`, text: v[variant] });
  }
  for (const [cat, text] of Object.entries(m.coaching.praise)) out.push({ id: `praise.${cat}`, text });
  out.push({ id: 'goodStroke', text: m.coaching.goodStroke });
  out.push({ id: 'okStroke', text: m.coaching.okStroke });
  out.push({ id: 'visibility', text: m.coaching.visibility });
  out.push({ id: 'visibility.repeated', text: m.coaching.visibilityRepeated });
  out.push({ id: 'speech.test', text: m.speech.test });
  out.push({ id: 'speech.enabled', text: m.speech.enabled });
  return out.map((p) => ({ ...p, lang }));
}

const all = [
  ...phrases('zh-CN', await loadResource('zh-CN.ts', 'zhCN')),
  ...phrases('en-US', await loadResource('en-US.ts', 'enUS')),
];

const list = join(tmpdir(), `tennis-phrases-${process.pid}.json`);
writeFileSync(list, JSON.stringify(all));
try {
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });
  execFileSync(python, [join(root, 'scripts/espeak_synth.py'), list, outDir], { stdio: 'inherit' });
  const manifest = {};
  for (const p of all) (manifest[p.lang] ??= []).push(p.id);
  writeFileSync(join(outDir, 'manifest.json'), JSON.stringify(manifest));
  console.log(`[voice-clips] wrote ${all.length} clips + manifest to public/audio`);
} catch (err) {
  const msg = `[voice-clips] could not generate clips (${err.message.split('\n')[0]}). ` +
    'Install with: pip install espeakng-loader lameenc. The app still works; the audio-clip fallback is just unavailable.';
  if (required) {
    console.error(msg);
    process.exit(1);
  }
  console.warn(msg);
} finally {
  rmSync(list, { force: true });
}
