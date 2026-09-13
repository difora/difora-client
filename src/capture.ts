import { createHash } from 'node:crypto';
import { writeRecordedCapture } from './capture-writer';
import {
  validateCaptureMetadata,
  type CaptureMetadataOptions,
} from './capture-metadata';
export type {
  CaptureMetadataOptions,
  CaptureMetadata,
} from './capture-metadata';
import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

/** Structural browser interface: importing a helper never loads a browser package. */
export interface ScreenshotPage<Mask = unknown> {
  context?(): {
    browser?(): {
      browserType?(): { name(): string };
      version?(): string;
    } | null;
  };
  evaluate?(fn: () => Record<string, unknown>): Promise<unknown>;
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
  captureMetadata?: boolean | CaptureMetadataOptions;
  variant?: string;
  fullPage?: boolean;
  mask?: Mask[];
  clip?: { x: number; y: number; width: number; height: number };
  viewportSuffix?: boolean;
  dir?: string;
}

/** Retain hierarchy and append a stable digest when sanitising would create collisions. */
export function screenshotName(
  name: string,
  width?: number,
  variant?: string,
): string {
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
  let suffix = '';
  if (variant !== undefined) {
    const id = validateCaptureMetadata({
      version: 1,
      source: 'helper',
      variant,
    }).variant as string;
    const slug =
      id
        .normalize('NFKD')
        .replace(/[^a-zA-Z0-9-]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .toLowerCase()
        .slice(0, 32) || 'variant';
    suffix = `@v-${slug}-${createHash('sha256').update(id).digest('hex').slice(0, 16)}`;
  }
  const result = `${safe}${width === undefined ? '' : `@${width}`}${suffix}.png`;
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
    screenshotName(name, width, options.variant),
  );
  if (options.variant !== undefined && options.captureMetadata === false)
    throw new Error('A variant requires capture metadata');
  if (
    options.captureMetadata !== undefined &&
    typeof options.captureMetadata !== 'boolean' &&
    (typeof options.captureMetadata !== 'object' ||
      options.captureMetadata === null)
  )
    throw new Error('Invalid capture metadata options');
  if (options.captureMetadata || options.variant !== undefined)
    return writeRecordedCapture(
      page,
      resolve(
        options.dir ?? process.env['DIFORA_SCREENSHOT_DIR'] ?? './screenshots',
      ),
      path,
      options,
    );
  await mkdir(dirname(path), { recursive: true });
  if (existsSync(path)) {
    console.warn(
      `difora: WARNING: overwriting screenshot ${path}. Use distinct names for each viewport, browser or theme.`,
    );
  }
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
