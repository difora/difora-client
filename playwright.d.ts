/** Versioned, client-reported capture evidence. Never part of a baseline identity. */
export interface CaptureMetadata {
  version: 1 | 2;
  source: 'helper' | 'provided';
  variant?: string;
  browser?: { name: string; version?: string };
  viewport?: { width: number; height: number };
  deviceScaleFactor?: number;
  colorScheme?: 'light' | 'dark' | 'no-preference';
  theme?: string;
  locale?: string;
  timezone?: string;
  os?: { name: string; version?: string };
  environment?: { id: string; revision?: string };
  capture?: {
    fullPage?: boolean;
    clip?: { x: number; y: number; width: number; height: number };
    animations?: 'disabled' | 'allow';
    caret?: 'hide' | 'initial';
    maskLocatorCount?: number;
  };
  producer?: { name: string; version: string };
  platform?: 'web' | 'ios' | 'android' | 'flutter' | 'desktop' | 'document';
  device?: {
    model?: string;
    runtime?: 'simulator' | 'emulator' | 'device' | 'host-render';
  };
  display?: {
    scale?: number;
    density?: number;
    orientation?: 'portrait' | 'landscape';
    logicalWidth?: number;
    logicalHeight?: number;
  };
  fontScale?: number;
  framework?: { name: string; version?: string };
  renderer?: { name: string; version?: string };
  surface?: 'page' | 'screen' | 'window' | 'element' | 'document-page';
  document?: { page?: number; pages?: number; dpi?: number };
  group?: string;
}

export type CaptureMetadataOptions = Pick<
  CaptureMetadata,
  'theme' | 'os' | 'environment'
>;
/** Browser types are structural; this module does not import or load Playwright. */
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
export function diforaScreenshot<Mask>(
  page: ScreenshotPage<Mask>,
  name: string,
  options?: ScreenshotOptions<Mask>,
): Promise<string>;
export type DiforaScreenshot = (
  name: string,
  options?: ScreenshotOptions,
) => Promise<string>;
export interface DiforaFixtures {
  diforaScreenshot: DiforaScreenshot;
}

type Callable = (...args: never[]) => unknown;
type Body<T extends Callable> = Extract<Parameters<T>[number], Callable>;
type CaptureBody<T extends Callable> = (
  args: Parameters<Body<T>>[0] & DiforaFixtures,
  info: Parameters<Body<T>>[1],
) => ReturnType<Body<T>>;
type CaptureCalls<T extends Callable> = {
  (title: string, body: CaptureBody<T>): ReturnType<T>;
  (
    title: string,
    details: Exclude<Parameters<T>[1], Callable>,
    body: CaptureBody<T>,
  ): ReturnType<T>;
};
type CaptureHook<T extends Callable> = {
  (body: CaptureBody<T>): void;
  (title: string, body: CaptureBody<T>): void;
};
export type DiforaTest<T extends Callable> = CaptureCalls<T> & {
  [K in keyof T]: K extends 'only' | 'skip' | 'fixme' | 'fail'
    ? CaptureCalls<T> & T[K]
    : K extends 'beforeEach' | 'afterEach'
      ? CaptureHook<T>
      : T[K];
};
/** Apply to your test after defining existing custom fixtures. */
export function withDifora<T extends Callable & { extend: Callable }>(
  base: T,
  defaults?: ScreenshotOptions,
): DiforaTest<T>;
