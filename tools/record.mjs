// Frame-by-frame recorder: drives ?director=1 in headless Chrome over CDP, one screenshot per frame.
// usage: node tools/record.mjs <url> <outDir> [seconds=30] [fps=30] [width=1920] [height=1080]
import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';

const [, , url, outDir, secs = '30', fps = '30', w = '1920', h = '1080'] = process.argv;
if (!url || !outDir) { console.error('usage: node tools/record.mjs <url> <outDir> [seconds] [fps] [w] [h]'); process.exit(1); }
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = 9333;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

await mkdir(outDir, { recursive: true });
const chrome = spawn(CHROME, [
  '--headless=new', `--remote-debugging-port=${PORT}`, '--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist',
  '--hide-scrollbars', `--window-size=${w},${h}`, `--user-data-dir=${outDir}/.profile`, 'about:blank',
], { stdio: 'ignore' });

let page;
for (let i = 0; i < 60 && !page; i++) {
  try { page = (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()).find((t) => t.type === 'page'); } catch { /* not up yet */ }
  if (!page) await sleep(250);
}
if (!page) { chrome.kill(); throw new Error('chrome did not expose a page target'); }

const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
let nextId = 0;
const pending = new Map();
ws.onmessage = (m) => {
  const msg = JSON.parse(m.data);
  const p = msg.id && pending.get(msg.id);
  if (!p) return;
  pending.delete(msg.id);
  msg.error ? p.rej(new Error(msg.error.message)) : p.res(msg.result);
};
const send = (method, params = {}) => new Promise((res, rej) => {
  const id = ++nextId; pending.set(id, { res, rej }); ws.send(JSON.stringify({ id, method, params }));
});
const evaluate = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
  return r.result.value;
};

await send('Emulation.setDeviceMetricsOverride', { width: +w, height: +h, deviceScaleFactor: 1, mobile: false });
await send('Page.enable');
await send('Page.navigate', { url });
let ready = false;
for (let i = 0; i < 300 && !ready; i++) {
  try { ready = await evaluate('typeof window.__ready === "function" && window.__ready()'); } catch { /* page still loading */ }
  if (!ready) await sleep(200);
}
if (!ready) { chrome.kill(); throw new Error('scene never became ready'); }
await sleep(800); // let web fonts settle

const N = Math.round(+secs * +fps);
const t0 = Date.now();
for (let f = 0; f < N; f++) {
  await evaluate(`window.__renderAt(${(f / +fps).toFixed(5)})`);
  const { data } = await send('Page.captureScreenshot', { format: 'jpeg', quality: 94 });
  await writeFile(`${outDir}/f_${String(f).padStart(4, '0')}.jpg`, Buffer.from(data, 'base64'));
  if (f % 90 === 0) console.log(`frame ${f}/${N}  ${((Date.now() - t0) / 1000).toFixed(0)}s`);
}
await writeFile(`${outDir}/audio_log.json`, await evaluate('JSON.stringify(window.__audioLog)'));
console.log(`done ${N} frames in ${((Date.now() - t0) / 1000).toFixed(0)}s`);
ws.close();
chrome.kill();
