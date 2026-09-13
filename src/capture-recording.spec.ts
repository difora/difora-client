import {
  mkdtemp,
  readdir,
  readFile,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { capture, screenshotName, type ScreenshotPage } from './capture';
import { collectScreenshots, readUploadPng } from './capture-files';
import { mergeCaptureOptions } from './capture-observer';

describe('recorded capture files', () => {
  let dir: string;
  const screenshot = jest.fn(async ({ path }: { path: string }) => {
    await writeFile(path, Buffer.from([1, 2, 3]));
  });
  const page: ScreenshotPage = {
    screenshot,
    viewportSize: () => ({ width: 640, height: 480 }),
    context: () => ({
      browser: () => ({
        browserType: () => ({ name: () => 'firefox' }),
        version: () => '145.0',
      }),
    }),
    evaluate: async () => ({
      deviceScaleFactor: 2,
      colorScheme: 'dark',
      locale: 'de-AT',
      timezone: 'Europe/Vienna',
    }),
  };
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'capture-record-'));
    screenshot.mockClear();
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });
  it('keeps old names and screenshot options while binding observed evidence to exact bytes', async () => {
    const path = await capture(page, 'Home', {
      dir,
      captureMetadata: {
        theme: 'custom',
        os: { name: 'Linux' },
        environment: { id: 'ci' },
      },
      mask: [{}],
    });
    expect(path).toBe(join(dir, 'Home.png'));
    const files = collectScreenshots(dir);
    expect(files).toHaveLength(1);
    expect(files[0].captureMetadata).toMatchObject({
      browser: { name: 'firefox', version: '145.0' },
      viewport: { width: 640, height: 480 },
      deviceScaleFactor: 2,
      colorScheme: 'dark',
      theme: 'custom',
      locale: 'de-AT',
      timezone: 'Europe/Vienna',
      capture: { maskLocatorCount: 1 },
    });
    expect(readUploadPng(files[0])).toEqual(Buffer.from([1, 2, 3]));
    expect(screenshot).toHaveBeenCalledTimes(1);
    expect(await readdir(dir)).toEqual(['Home.png', 'Home.png.difora.json']);
    await writeFile(path, Buffer.from([4]));
    expect(() => readUploadPng(files[0])).toThrow('changed after collection');
    expect(() => collectScreenshots(dir)).toThrow('hash mismatch');
  });
  it('requires explicit variants for same-name captures and never derives names from versions', async () => {
    const a = await capture(page, 'Home', { dir, variant: 'firefox-dark' });
    const b = await capture(page, 'Home', { dir, variant: 'chromium-dark' });
    expect(a).not.toBe(b);
    expect(screenshotName('Home', 640, 'cafe\u0301')).toBe(
      screenshotName('Home', 640, 'café'),
    );
    expect(screenshotName('Home', undefined, 'a?b')).not.toBe(
      screenshotName('Home', undefined, 'a:b'),
    );
    await expect(
      capture(page, 'Home', { dir, variant: 'firefox-dark' }),
    ).rejects.toThrow('already exists');
    await expect(
      capture(page, 'Other', { dir, variant: 'x', captureMetadata: false }),
    ).rejects.toThrow('requires capture metadata');
    expect(collectScreenshots(dir)).toHaveLength(2);
  });
  it('serializes duplicate claims, leaves a detectable incomplete lock and cleans up a failed capture', async () => {
    let release!: () => void;
    let entered!: () => void;
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    const first = capture(
      {
        ...page,
        screenshot: async () => {
          entered();
          await pending;
          throw new Error('browser closed');
        },
      },
      'Home',
      { dir, captureMetadata: true },
    );
    await started;
    expect(() => collectScreenshots(dir)).toThrow('Incomplete capture');
    await expect(
      capture(page, 'Home', { dir, captureMetadata: true }),
    ).rejects.toThrow('already claimed');
    release();
    await expect(first).rejects.toThrow('browser closed');
    expect(await readdir(dir)).toEqual([]);
    await capture(page, 'Home', { dir, captureMetadata: true });
    expect(collectScreenshots(dir)).toHaveLength(1);
  });
  it('rejects orphan, oversized, malformed and linked sidecars', async () => {
    const sidecar = join(dir, 'Home.png.difora.json');
    await writeFile(sidecar, '{}');
    expect(() => collectScreenshots(dir)).toThrow('Orphan');
    await writeFile(join(dir, 'Home.png'), 'png');
    await writeFile(sidecar, '{private-value');
    expect(() => collectScreenshots(dir)).toThrow('Malformed JSON');
    await writeFile(sidecar, ' '.repeat(4097));
    expect(() => collectScreenshots(dir)).toThrow('size limit');
    await rm(sidecar);
    await symlink(join(dir, 'Home.png'), sidecar);
    expect(() => collectScreenshots(dir)).toThrow('symlink');
  });
  it('refuses linked descendants and a changing viewport; optional observations stay unknown', async () => {
    await symlink(dir, join(dir, 'linked'));
    await expect(
      capture(page, 'linked/Home', { dir, captureMetadata: true }),
    ).rejects.toThrow('symlinks');
    let width = 640;
    await expect(
      capture(
        { ...page, viewportSize: () => ({ width: width++, height: 480 }) },
        'Home',
        { dir, captureMetadata: true },
      ),
    ).rejects.toThrow('environment changed');
    const path = await capture({ screenshot }, 'Minimal', {
      dir,
      captureMetadata: true,
    });
    const { metadata } = JSON.parse(
      await readFile(`${path}.difora.json`, 'utf8'),
    );
    expect(metadata.browser).toBeUndefined();
    expect(metadata.viewport).toBeUndefined();
    expect(metadata.os).toBeUndefined();
  });
  it('merges wrapper defaults without mutating them and permits explicit opt-out', () => {
    const defaults = {
      captureMetadata: { theme: 'light', environment: { id: 'ci' } },
    };
    expect(
      mergeCaptureOptions(defaults, { captureMetadata: { theme: 'dark' } })
        .captureMetadata,
    ).toEqual({ theme: 'dark', environment: { id: 'ci' } });
    expect(
      mergeCaptureOptions(defaults, { captureMetadata: false }).captureMetadata,
    ).toBe(false);
    expect(defaults.captureMetadata.theme).toBe('light');
  });
});
