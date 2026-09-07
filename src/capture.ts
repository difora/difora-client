import { createHash } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

/** Structural browser interface: importing a helper never loads a browser package. */
export interface ScreenshotPage<Mask = unknown> {
  screenshot(options: {
    path: string;
    type: 'png';
    animations: 'disabled';
    caret: 'hide';
    fullPage?: boolean;
    mask?: Mask[];
    clip?: { x: number; y: number; width: number; height: number };
  }): Promise<unknown>;
  viewportSize?(): { width: number; height: number } | null;
}

export interface ScreenshotOptions<Mask = unknown> {
  fullPage?: boolean;
  mask?: Mask[];
  clip?: { x: number; y: number; width: number; height: number };
  viewportSuffix?: boolean;
  dir?: string;
}

/** Retain hierarchy and append a stable digest when sanitising would create collisions. */
export function screenshotName(name: string, width?: number): string {
  if (!name || /^[\\/]|^[a-z]:/i.test(name))
    throw new Error('Screenshot name must be a non-empty relative name');
  const parts = name
    .replace(/\\/g, '/')
    .replace(/\.png$/i, '')
    .split('/');
  const safe = parts
    .map((part) => {
      if (!part || part === '.' || part === '..')
        throw new Error(
          'Screenshot name contains an empty or traversal segment',
        );
      let clean =
        part
          .normalize('NFKD')
          .replace(/[\u0300-\u036f]/g, '')
          .replace(/[^a-zA-Z0-9_.@-]+/g, '-')
          .replace(/^[. -]+|[. -]+$/g, '')
          .slice(0, 80) || 'snapshot';
      if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(clean))
        clean = `_${clean}`;
      if (clean !== part)
        clean += `-${createHash('sha256').update(part).digest('hex').slice(0, 12)}`;
      return clean;
    })
    .join('/');
  if (width !== undefined && (!Number.isInteger(width) || width <= 0))
    throw new Error(
      'Viewport suffix requires a positive integer viewport width',
    );
  const result = `${safe}${width === undefined ? '' : `@${width}`}.png`;
  if (result.length > 280)
    throw new Error('Screenshot name is too long; use a shorter hierarchy');
  return result;
}

export async function capture<Mask>(
  page: ScreenshotPage<Mask>,
  name: string,
  options: ScreenshotOptions<Mask> = {},
): Promise<string> {
  if (options.fullPage && options.clip)
    throw new Error('Choose fullPage or clip for a screenshot');
  const width = options.viewportSuffix
    ? page.viewportSize?.()?.width
    : undefined;
  if (options.viewportSuffix && width === undefined)
    throw new Error(
      'viewportSuffix requires a page with a configured viewport',
    );
  const path = resolve(
    options.dir ?? process.env['DIFORA_SCREENSHOT_DIR'] ?? './screenshots',
    screenshotName(name, width),
  );
  await mkdir(dirname(path), { recursive: true });
  await page.screenshot({
    path,
    type: 'png',
    animations: 'disabled',
    caret: 'hide',
    ...(options.fullPage === undefined ? {} : { fullPage: options.fullPage }),
    ...(options.mask === undefined ? {} : { mask: options.mask }),
    ...(options.clip === undefined ? {} : { clip: options.clip }),
  });
  return path;
}
