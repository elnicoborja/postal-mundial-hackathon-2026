import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createServer } from '../server.mjs';

const server = createServer();
server.listen(0, '127.0.0.1');
await once(server, 'listening');
const origin = `http://127.0.0.1:${server.address().port}`;
let browser;
const checks = [];
try {
  browser = await chromium.launch({ channel: 'chromium', headless: true,
    args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] });
  const context = await browser.newContext({ permissions: ['camera'], acceptDownloads: true, viewport: { width: 1365, height: 900 } });
  const page = await context.newPage();
  const errors = [];
  const requests = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => requests.push({ url: request.url(), method: request.method() }));
  await page.goto(origin);
  assert.equal(await page.locator('#start-camera').isDisabled(), true);
  await page.locator('#adult-confirm').check();
  await page.locator('#start-camera').click();
  await page.waitForFunction(() => document.querySelector('#capture').disabled === false).catch(async error => {
    console.error(JSON.stringify({ status: await page.locator('#status').innerText(), errors, body: await page.locator('body').getAttribute('data-state') }));
    throw error;
  });
  await page.locator('#burst-count').fill('3');
  await page.locator('#capture').click();
  await page.waitForFunction(() => document.body.dataset.state === 'review');
  assert.equal(await page.locator('[data-frame]').count(), 3);
  assert.match(await page.locator('#count').innerText(), /3/);
  assert.ok(await page.evaluate(() => document.querySelector('video').srcObject === null));
  await page.locator('[data-frame="2"]').click();
  await page.locator('#lock').click();
  await page.waitForFunction(() => document.body.dataset.state === 'locked');
  const digest = await page.locator('#digest').innerText();
  assert.match(digest, /^[a-f0-9]{64}$/);
  const downloadPromise = page.waitForEvent('download');
  await page.locator('#download').click();
  const download = await downloadPromise;
  assert.equal(createHash('sha256').update(await readFile(await download.path())).digest('hex'), digest);
  await page.locator('#delivery-confirm').check();
  assert.equal(await page.locator('#digest').innerText(), digest);
  checks.push('synthetic camera burst, true count, track stop, manual selection, exact download hash, independent delivery confirmation');
  await mkdir(new URL('../evidence/', import.meta.url), { recursive: true });
  await page.screenshot({ path: fileURLToPath(new URL('../evidence/desktop-selection.png', import.meta.url)), fullPage: true });
  await page.locator('#reset').click();
  assert.equal(await page.locator('[data-frame]').count(), 0);
  assert.equal(await page.locator('#adult-confirm').isChecked(), false);
  assert.equal(await page.locator('#delivery-confirm').isChecked(), false);
  assert.equal(await page.locator('#start-camera').isDisabled(), true);
  assert.equal(await page.locator('#download').isDisabled(), true);
  checks.push('reset removes review/output and both confirmations');

  await page.evaluate(() => {
    window.originalMedia = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = async () => { throw new DOMException('Synthetic rejection', 'NotAllowedError'); };
  });
  await page.locator('#adult-confirm').check();
  await page.locator('#start-camera').click();
  await page.waitForFunction(() => document.querySelector('#status').textContent.includes('permiso'));
  assert.equal(await page.locator('#start-camera').isDisabled(), false);
  await page.evaluate(() => { navigator.mediaDevices.getUserMedia = window.originalMedia; });
  await page.locator('#start-camera').click();
  await page.waitForFunction(() => document.querySelector('#capture').disabled === false);
  await page.locator('#burst-count').fill('30');
  await page.locator('#capture').click();
  await page.waitForFunction(() => document.body.dataset.state === 'review', { timeout: 30000 });
  assert.equal(await page.locator('[data-frame]').count(), 30);
  await page.locator('[data-frame="30"]').click();
  await page.locator('#filter').selectOption('mono');
  await page.locator('#lock').click();
  await page.waitForFunction(() => document.body.dataset.state === 'locked');
  assert.match(await page.locator('#output-details').innerText(), /30/);
  checks.push('permission rejection/retry, 30 real encoded synthetic frames, last-frame review, monochrome output');
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await page.screenshot({ path: fileURLToPath(new URL('../evidence/mobile-selection.png', import.meta.url)), fullPage: true });
  await page.locator('#reset').click();
  await page.screenshot({ path: fileURLToPath(new URL('../evidence/mobile-start.png', import.meta.url)), fullPage: true });
  checks.push('390px viewport without horizontal overflow');
  await page.evaluate(() => {
    navigator.mediaDevices.getUserMedia = async options => {
      const stream = await window.originalMedia(options);
      window.heldStream = stream;
      await new Promise(resolve => { window.releaseCamera = resolve; });
      return stream;
    };
  });
  await page.locator('#adult-confirm').check();
  await page.locator('#start-camera').click();
  await page.waitForFunction(() => Boolean(window.releaseCamera));
  await page.locator('#reset').click();
  await page.evaluate(() => window.releaseCamera());
  await page.waitForFunction(() => window.heldStream.getTracks().every(track => track.readyState === 'ended'));
  assert.equal(await page.locator('#capture').isDisabled(), true);
  await page.evaluate(() => { navigator.mediaDevices.getUserMedia = window.originalMedia; });
  await page.locator('#adult-confirm').check();
  await page.locator('#start-camera').click();
  await page.waitForFunction(() => document.querySelector('#capture').disabled === false);
  await page.evaluate(() => { window.activeStream = document.querySelector('video').srcObject; });
  await page.locator('#capture').click();
  await page.waitForFunction(() => !document.querySelector('#count').textContent.startsWith('0 '));
  await page.locator('#reset').click();
  await page.waitForTimeout(500);
  assert.equal(await page.locator('[data-frame]').count(), 0);
  assert.ok(await page.evaluate(() => window.activeStream.getTracks().every(track => track.readyState === 'ended')));
  assert.equal(await page.locator('body').getAttribute('data-state'), 'idle');
  checks.push('reset during pending camera grant stops late tracks; reset during burst prevents late frame resurrection');
  const transform = await page.evaluate(async () => {
    const { prepareOutput, boundedSize } = await import('/camera.mjs');
    const canvas = document.createElement('canvas'); canvas.width = 64; canvas.height = 48;
    const ctx = canvas.getContext('2d'); ctx.fillStyle = '#ed632a'; ctx.fillRect(0, 0, 64, 48);
    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg'));
    const frame = { blob, width: 64, height: 48 };
    const first = await prepareOutput(frame, 'mono');
    const second = await prepareOutput(frame, 'mono');
    const original = await prepareOutput(frame, 'original');
    const hash = async data => [...new Uint8Array(await crypto.subtle.digest('SHA-256', await data.arrayBuffer()))].join(',');
    const bitmap = await createImageBitmap(first.blob); ctx.drawImage(bitmap, 0, 0); bitmap.close();
    const pixel = [...ctx.getImageData(20, 20, 1, 1).data];
    const preview = await createImageBitmap(first.preview);
    const dimensions = [preview.width, preview.height]; preview.close();
    return { deterministic: await hash(first.blob) === await hash(second.blob),
      original: blob === original.blob, pixel, dimensions,
      sizes: [[4000, 3000], [3000, 4000], [640, 480]].map(([w, h]) => boundedSize(w, h)) };
  });
  assert.equal(transform.deterministic, true);
  assert.equal(transform.original, true);
  assert.equal(transform.pixel[0], transform.pixel[1]);
  assert.equal(transform.pixel[1], transform.pixel[2]);
  assert.deepEqual(transform.dimensions, [64, 48]);
  assert.ok(transform.sizes.every(size => size.width * size.height <= 1280 * 720 && Math.max(size.width, size.height) <= 1280));
  checks.push('same-input monochrome byte repeatability, neutral pixels, exact original Blob, selected-only preview, portrait/landscape pixel bounds');
  assert.equal(requests.filter(r => !r.url.startsWith(origin) && !r.url.startsWith('blob:')).length, 0);
  assert.equal(requests.filter(r => r.method !== 'GET').length, 0);
  assert.deepEqual(errors, []);
  for (const path of ['/server.mjs', '/package.json', '/tests/browser.mjs', '/api/demo/health']) {
    assert.equal((await fetch(origin + path)).status, 404);
  }
  assert.equal((await fetch(origin + '/', { method: 'POST' })).status, 405);
  checks.push('no external traffic, no POST/upload, no JS errors; private/server/API routes not served');
  await writeFile(new URL('../evidence/browser-results.json', import.meta.url), JSON.stringify({ mode: 'synthetic Chromium camera, not real-device acceptance', checks, errors }, null, 2));
  console.log(JSON.stringify({ status: 'PASS', checks }, null, 2));
} finally {
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
}
