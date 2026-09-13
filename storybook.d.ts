export type { CaptureMetadata, CaptureMetadataOptions } from './playwright';
import type { ScreenshotPage, ScreenshotOptions } from './playwright';
export interface StoryContext {
  id: string;
  title: string;
  name: string;
}
export interface PostVisitOptions extends Omit<
  ScreenshotOptions<never>,
  'mask' | 'clip'
> {
  fullPage?: boolean;
  viewportSuffix?: boolean;
  dir?: string;
  skip?: (context: StoryContext) => boolean | Promise<boolean>;
}
export function createPostVisit(
  options?: PostVisitOptions,
): (page: ScreenshotPage<never>, context: StoryContext) => Promise<void>;
