import type { ScreenshotPage, ScreenshotOptions } from './capture';
import {
  validateCaptureMetadata,
  type CaptureMetadata,
} from './capture-metadata';

export async function observeCapture(
  page: ScreenshotPage,
  options: ScreenshotOptions,
): Promise<CaptureMetadata> {
  const declared =
    typeof options.captureMetadata === 'object' ? options.captureMetadata : {};
  if (
    !declared ||
    Array.isArray(declared) ||
    Object.keys(declared).some(
      (k) => !['theme', 'os', 'environment'].includes(k),
    )
  )
    throw new Error(
      'Capture metadata options allow only theme, os and environment',
    );
  const metadata: Record<string, unknown> = {
    version: 1,
    source: 'helper',
    ...declared,
    ...(options.variant === undefined ? {} : { variant: options.variant }),
    producer: { name: 'difora', version: '0.10.1' },
    capture: {
      fullPage: options.fullPage ?? false,
      ...(options.clip ? { clip: options.clip } : {}),
      animations: 'disabled',
      caret: 'hide',
      maskLocatorCount: options.mask?.length ?? 0,
    },
  };
  const viewport = page.viewportSize?.();
  if (viewport) metadata['viewport'] = viewport;
  const browser = page.context?.().browser?.();
  const name = browser?.browserType?.().name();
  if (name)
    metadata['browser'] = {
      name,
      ...(browser?.version ? { version: browser.version() } : {}),
    };
  if (page.evaluate) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const observed = await Promise.race([
        page.evaluate(() => {
          const runtime = globalThis as unknown as {
            devicePixelRatio: number;
            matchMedia(query: string): { matches: boolean };
          };
          const resolved = Intl.DateTimeFormat().resolvedOptions();
          return {
            deviceScaleFactor: runtime.devicePixelRatio,
            colorScheme: runtime.matchMedia('(prefers-color-scheme: dark)')
              .matches
              ? 'dark'
              : runtime.matchMedia('(prefers-color-scheme: light)').matches
                ? 'light'
                : 'no-preference',
            locale: resolved.locale,
            timezone: resolved.timeZone,
          };
        }),
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => reject(new Error('Capture metadata observation timed out')),
            5000,
          );
        }),
      ]);
      if (!observed || typeof observed !== 'object' || Array.isArray(observed))
        throw new Error('Invalid browser capture observation');
      for (const key of [
        'deviceScaleFactor',
        'colorScheme',
        'locale',
        'timezone',
      ]) {
        const value = (observed as Record<string, unknown>)[key];
        if (value !== undefined) metadata[key] = value;
      }
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
  return validateCaptureMetadata(metadata);
}

export function mergeCaptureOptions(
  defaults: ScreenshotOptions,
  options: ScreenshotOptions = {},
): ScreenshotOptions {
  const result = { ...defaults, ...options };
  if (
    typeof defaults.captureMetadata === 'object' &&
    typeof options.captureMetadata === 'object'
  ) {
    result.captureMetadata = {
      ...defaults.captureMetadata,
      ...options.captureMetadata,
    };
  }
  return result;
}
