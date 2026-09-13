import {
  capture,
  type ScreenshotPage,
  type ScreenshotOptions,
} from './capture';
export type { CaptureMetadata, CaptureMetadataOptions } from './capture';

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

/** @storybook/test-runner calls this after rendering and the story's play function. */
export function createPostVisit(options: PostVisitOptions = {}) {
  return async (
    page: ScreenshotPage<never>,
    context: StoryContext,
  ): Promise<void> => {
    if (await options.skip?.(context)) return;
    await capture(page, `${context.title}/${context.name}`, options);
  };
}
