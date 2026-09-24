// Checks that a deployed build serves every file the app needs.
// Usage: node scripts/verify-deployment.mjs https://<user>.github.io/<repo>/
// Fails (exit 1) on any non-200 response or wrong content type, so a broken
// deployment (bad base path, missing WASM/model) is caught immediately.

const base = process.argv[2];
if (!base) {
  console.error('Usage: node scripts/verify-deployment.mjs <site-url-ending-with-/>');
  process.exit(2);
}
const root = new URL(base.endsWith('/') ? base : `${base}/`);

async function get(path, attempts = 6) {
  const url = new URL(path, root);
  for (let i = 1; ; i++) {
    try {
      const res = await fetch(url, { redirect: 'follow', cache: 'no-store' });
      if (res.ok || i >= attempts) return { url, res };
    } catch (err) {
      if (i >= attempts) throw err;
    }
    // Pages can take a moment to serve a fresh deployment.
    await new Promise((r) => setTimeout(r, 5000 * i));
  }
}

const problems = [];
function check(label, url, res, expectType) {
  const type = res.headers.get('content-type') ?? '';
  const ok = res.status === 200 && (!expectType || type.includes(expectType));
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${res.status} ${type.padEnd(32)} ${url.pathname}  (${label})`);
  if (!ok) problems.push(`${label}: ${res.status} ${type} ${url}`);
}

const index = await get('./');
check('index.html', index.url, index.res, 'text/html');
const html = await index.res.text();

// Every script/stylesheet/icon/manifest referenced by index.html.
const refs = [...html.matchAll(/(?:src|href)="([^"#]+)"/g)]
  .map((m) => m[1])
  .filter((r) => !/^(https?:|data:|mailto:)/.test(r));
for (const ref of new Set(refs)) {
  const { url, res } = await get(ref);
  check('referenced by index.html', url, res);
}

// Runtime assets loaded by MediaPipe and the service worker.
const runtime = [
  ['mediapipe/wasm/vision_wasm_internal.js', 'javascript'],
  ['mediapipe/wasm/vision_wasm_internal.wasm', 'application/wasm'],
  ['mediapipe/wasm/vision_wasm_nosimd_internal.js', 'javascript'],
  ['mediapipe/wasm/vision_wasm_nosimd_internal.wasm', 'application/wasm'],
  ['models/pose_landmarker_lite.task', null],
  ['sw.js', 'javascript'],
  ['audio/manifest.json', 'json'],
  ['audio/zh-CN/speech.test.mp3', 'audio/mpeg'],
  ['audio/zh-CN/issue.late-contact.now.mp3', 'audio/mpeg'],
  ['icon-512.png', 'image/png'],
];
for (const [path, type] of runtime) {
  const { url, res } = await get(path);
  check('runtime asset', url, res, type);
  if (path.endsWith('.task') && res.ok) {
    const size = (await res.arrayBuffer()).byteLength;
    if (size < 1_000_000) problems.push(`model too small (${size} bytes)`);
  }
}

if (root.protocol !== 'https:' && !['localhost', '127.0.0.1'].includes(root.hostname)) {
  problems.push('site is not served over HTTPS: phones will block camera access');
}

if (problems.length) {
  console.error(`\n${problems.length} problem(s):\n- ${problems.join('\n- ')}`);
  process.exit(1);
}
console.log('\nDeployment verified: all assets served correctly.');
