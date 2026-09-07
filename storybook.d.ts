import type { ScreenshotPage } from './playwright';
export interface StoryContext {
  id: string;
  title: string;
  name: string;
}
export interface PostVisitOptions {
  fullPage?: boolean;
  viewportSuffix?: boolean;
  dir?: string;
  skip?: (context: StoryContext) => boolean | Promise<boolean>;
}
export function createPostVisit(
  options?: PostVisitOptions,
): (page: ScreenshotPage<never>, context: StoryContext) => Promise<void>;
