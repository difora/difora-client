import {
  capture,
  type ScreenshotOptions,
  type ScreenshotPage,
} from './capture';
import { mergeCaptureOptions } from './capture-observer';
export type {
  ScreenshotOptions,
  ScreenshotPage,
  CaptureMetadataOptions,
  CaptureMetadata,
} from './capture';

export const diforaScreenshot = capture;
export type DiforaScreenshot = (
  name: string,
  options?: ScreenshotOptions,
) => Promise<string>;
export interface DiforaFixtures {
  diforaScreenshot: DiforaScreenshot;
}

/** Call with your own Playwright test (including any existing fixtures). */
export function withDifora<T>(
  base: {
    extend(fixtures: {
      diforaScreenshot: (
        args: { page: ScreenshotPage },
        use: (capture: DiforaScreenshot) => Promise<void>,
      ) => Promise<void>;
    }): T;
  },
  defaults: ScreenshotOptions = {},
): T {
  return base.extend({
    diforaScreenshot: async ({ page }, use) => {
      await use((name, options) =>
        capture(page, name, mergeCaptureOptions(defaults, options)),
      );
    },
  });
}
