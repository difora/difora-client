import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { capture, screenshotName, type ScreenshotPage } from './capture';
import { withDifora } from './playwright';
import { createPostVisit } from './storybook';

describe('capture helpers', () => {
  let dir: string;
  const screenshot = jest.fn(async ({ path }: { path: string }) => {
    await writeFile(path, Buffer.from([1]));
  });
  const page: ScreenshotPage = {
    screenshot,
    viewportSize: () => ({ width: 1280, height: 720 }),
  };
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'difora-capture-'));
    screenshot.mockClear();
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });
  it('creates nested PNG paths and passes deterministic screenshot options', async () => {
    const path = await capture(page, 'Button/Primary', {
      dir,
      fullPage: true,
      viewportSuffix: true,
    });
    expect(path).toBe(join(dir, 'Button', 'Primary@1280.png'));
    expect(await readFile(path)).toEqual(Buffer.from([1]));
    expect(screenshot).toHaveBeenCalledWith({
      path,
      fullPage: true,
      type: 'png',
      animations: 'disabled',
      caret: 'hide',
    });
  });
  it('uses the environment directory and lets an explicit directory override it', async () => {
    const previous = process.env['DIFORA_SCREENSHOT_DIR'];
    process.env['DIFORA_SCREENSHOT_DIR'] = join(dir, 'env');
    try {
      expect(await capture(page, 'one')).toBe(join(dir, 'env', 'one.png'));
      expect(await capture(page, 'two.png', { dir })).toBe(
        join(dir, 'two.png'),
      );
    } finally {
      if (previous === undefined) delete process.env['DIFORA_SCREENSHOT_DIR'];
      else process.env['DIFORA_SCREENSHOT_DIR'] = previous;
    }
  });
  it('warns on an existing same-width capture and still writes the screenshot', async () => {
    const warning = jest
      .spyOn(console, 'warn')
      .mockImplementation(() => undefined);
    try {
      await capture(page, 'home', { dir, viewportSuffix: true });
      expect(warning).not.toHaveBeenCalled();
      const second = {
        ...page,
        viewportSize: () => ({ width: 1280, height: 900 }),
      };
      await capture(second, 'home', { dir, viewportSuffix: true });
      expect(warning).toHaveBeenCalledWith(
        expect.stringContaining('overwriting screenshot'),
      );
      expect(screenshot).toHaveBeenCalledTimes(2);
      await capture(page, 'home-firefox', { dir, viewportSuffix: true });
      expect(warning).toHaveBeenCalledTimes(1);
    } finally {
      warning.mockRestore();
    }
  });
  it.each([
    '',
    '..',
    '../escape',
    'a/../b',
    '/absolute',
    'C:\\outside',
    'a//b',
  ])('refuses unsafe names: %s', (name) => {
    expect(() => screenshotName(name)).toThrow();
  });
  it('keeps sanitised names distinct and stable across runs', () => {
    const names = [
      'Hello world!',
      'Hello-world!',
      'ab:b',
      'ab?b',
      'CON',
      'NUL.txt',
    ];
    const paths = names.map((name) => screenshotName(name));
    expect(new Set(paths).size).toBe(names.length);
    expect(paths).toEqual(names.map((name) => screenshotName(name)));
    expect(paths.every((path) => /^[\w.@-]+\.png$/.test(path))).toBe(true);
  });
  it('passes masks and clipping without mutating options', async () => {
    const options = {
      dir,
      mask: [{}],
      clip: { x: 0, y: 1, width: 2, height: 3 },
    };
    await capture(page, 'masked', options);
    expect(screenshot.mock.calls[0][0]).toMatchObject({
      mask: options.mask,
      clip: options.clip,
    });
    expect(options).not.toHaveProperty('path');
  });
  it('reports missing viewports, conflicting options and browser errors', async () => {
    await expect(
      capture({ screenshot }, 'x', { dir, viewportSuffix: true }),
    ).rejects.toThrow('configured viewport');
    await expect(
      capture(page, 'x', {
        dir,
        fullPage: true,
        clip: { x: 0, y: 0, width: 1, height: 1 },
      }),
    ).rejects.toThrow('fullPage or clip');
    await expect(
      capture(
        {
          screenshot: async () => {
            throw new Error('browser closed');
          },
        },
        'x',
        { dir },
      ),
    ).rejects.toThrow('browser closed');
  });
  it('captures stories by title/name and supports asynchronous skip', async () => {
    const postVisit = createPostVisit({
      dir,
      skip: async (story) => story.id === 'skip',
    });
    await postVisit(page, { id: 'skip', title: 'Button', name: 'Skipped' });
    expect(screenshot).not.toHaveBeenCalled();
    await postVisit(page, { id: 'primary', title: 'Button', name: 'Primary' });
    expect(await readFile(join(dir, 'Button', 'Primary.png'))).toEqual(
      Buffer.from([1]),
    );
  });
  it('extends the supplied test with a page-bound capture fixture', async () => {
    const extended = {};
    const extend = jest.fn((fixtures) => {
      void fixtures;
      return extended;
    });
    expect(withDifora({ extend })).toBe(extended);
    const fixtures = extend.mock.calls[0][0];
    await fixtures.diforaScreenshot(
      { page },
      async (
        capture: (
          name: string,
          options: import('./capture').ScreenshotOptions,
        ) => Promise<string>,
      ) => {
        expect(
          await capture('fixture', {
            dir,
            mask: [page],
            clip: { x: 0, y: 0, width: 100, height: 100 },
          }),
        ).toBe(join(dir, 'fixture.png'));
        expect(screenshot).toHaveBeenCalledWith(
          expect.objectContaining({
            mask: [page],
            clip: { x: 0, y: 0, width: 100, height: 100 },
          }),
        );
      },
    );
  });
});
