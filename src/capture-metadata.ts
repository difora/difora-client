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
export interface CaptureMetadataCapability {
  versions: number[];
  maxMetadataBytes: number;
  maxManifestBytes: number;
}
export const MAX_CAPTURE_METADATA_BYTES = 2048;
export const MAX_CAPTURE_METADATA_V2_BYTES = 3072;
export const MAX_CAPTURE_SIDECAR_BYTES = 4096;
export const MAX_MANIFEST_BYTES = 5 * 1024 * 1024;

export function utf8Bytes(value: string): number {
  return new TextEncoder().encode(value).length;
}

function invalid(path: string): never {
  throw new Error(`Invalid capture metadata: ${path}`);
}
function object(
  value: unknown,
  keys: readonly string[],
  path: string,
): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    invalid(path);
  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) invalid(path);
  const own = Object.keys(value);
  if (!own.length || own.some((k) => !keys.includes(k)))
    invalid(`${path} has unsupported fields`);
  return value as Record<string, unknown>;
}
function label(value: unknown, path: string, max = 64): string {
  if (typeof value !== 'string') invalid(path);
  const result = value.normalize('NFC');
  // Reject lone surrogates and bidi/control characters as well as invisible-only labels.
  if (
    !result.trim() ||
    Array.from(result).length > max ||
    /[\p{Cc}\p{Cf}\p{Cs}]/u.test(result)
  )
    invalid(path);
  return result;
}
function number(
  value: unknown,
  path: string,
  min: number,
  max: number,
  integer = false,
): number {
  if (
    typeof value !== 'number' ||
    !Number.isFinite(value) ||
    value < min ||
    value > max ||
    (integer && !Number.isInteger(value))
  )
    invalid(path);
  return Object.is(value, -0) ? 0 : value;
}
function choice<const T extends string>(
  value: unknown,
  values: readonly T[],
  path: string,
): T {
  if (typeof value !== 'string' || !values.includes(value as T)) invalid(path);
  return value as T;
}
function identity(
  value: unknown,
  path: string,
  requiredVersion = false,
): { name: string; version?: string } {
  const o = object(value, ['name', 'version'], path);
  const result: { name: string; version?: string } = {
    name: label(o['name'], `${path}.name`, 32),
  };
  if (o['version'] !== undefined || requiredVersion)
    result.version = label(o['version'], `${path}.version`);
  return result;
}

const v2Keys = [
  'platform',
  'device',
  'display',
  'fontScale',
  'framework',
  'renderer',
  'surface',
  'document',
  'group',
] as const;

/** Validates before reconstructing in fixed key order; never silently strips unknown input. */
export function validateCaptureMetadata(value: unknown): CaptureMetadata {
  const o = object(
    value,
    [
      'version',
      'source',
      'variant',
      'browser',
      'viewport',
      'deviceScaleFactor',
      'colorScheme',
      'theme',
      'locale',
      'timezone',
      'os',
      'environment',
      'capture',
      'producer',
      ...v2Keys,
    ],
    'record',
  );
  if (o['version'] !== 1 && o['version'] !== 2) invalid('unsupported version');
  if (o['version'] === 1 && v2Keys.some((k) => k in o))
    invalid('version 2 fields in version 1');
  const m: CaptureMetadata = {
    version: o['version'],
    source: choice(o['source'], ['helper', 'provided'], 'source'),
  };
  if ('variant' in o) m.variant = label(o['variant'], 'variant');
  if ('browser' in o) m.browser = identity(o['browser'], 'browser');
  if ('viewport' in o) {
    const v = object(o['viewport'], ['width', 'height'], 'viewport');
    m.viewport = {
      width: number(v['width'], 'viewport.width', 1, 32768, true),
      height: number(v['height'], 'viewport.height', 1, 32768, true),
    };
  }
  if ('deviceScaleFactor' in o) {
    m.deviceScaleFactor = number(
      o['deviceScaleFactor'],
      'deviceScaleFactor',
      Number.MIN_VALUE,
      16,
    );
  }
  if ('colorScheme' in o)
    m.colorScheme = choice(
      o['colorScheme'],
      ['light', 'dark', 'no-preference'],
      'colorScheme',
    );
  if ('theme' in o) m.theme = label(o['theme'], 'theme');
  if ('locale' in o) m.locale = label(o['locale'], 'locale');
  if ('timezone' in o) m.timezone = label(o['timezone'], 'timezone');
  if ('os' in o) m.os = identity(o['os'], 'os');
  if ('environment' in o) {
    const e = object(o['environment'], ['id', 'revision'], 'environment');
    m.environment = { id: label(e['id'], 'environment.id') };
    if ('revision' in e)
      m.environment.revision = label(
        e['revision'],
        'environment.revision',
        128,
      );
  }
  if ('capture' in o) {
    const c = object(
      o['capture'],
      ['fullPage', 'clip', 'animations', 'caret', 'maskLocatorCount'],
      'capture',
    );
    m.capture = {};
    if ('fullPage' in c) {
      if (typeof c['fullPage'] !== 'boolean') invalid('capture.fullPage');
      m.capture.fullPage = c['fullPage'];
    }
    if ('clip' in c) {
      const r = object(
        c['clip'],
        ['x', 'y', 'width', 'height'],
        'capture.clip',
      );
      m.capture.clip = {
        x: number(r['x'], 'clip.x', 0, 1e6),
        y: number(r['y'], 'clip.y', 0, 1e6),
        width: number(r['width'], 'clip.width', Number.MIN_VALUE, 1e6),
        height: number(r['height'], 'clip.height', Number.MIN_VALUE, 1e6),
      };
    }
    if (m.capture.fullPage && m.capture.clip)
      invalid('fullPage and clip are mutually exclusive');
    if ('animations' in c)
      m.capture.animations = choice(
        c['animations'],
        ['disabled', 'allow'],
        'capture.animations',
      );
    if ('caret' in c)
      m.capture.caret = choice(
        c['caret'],
        ['hide', 'initial'],
        'capture.caret',
      );
    if ('maskLocatorCount' in c)
      m.capture.maskLocatorCount = number(
        c['maskLocatorCount'],
        'capture.maskLocatorCount',
        0,
        10000,
        true,
      );
  }
  if ('producer' in o)
    m.producer = identity(
      o['producer'],
      'producer',
      true,
    ) as CaptureMetadata['producer'];
  if (m.version === 2) {
    if ('platform' in o)
      m.platform = choice(
        o['platform'],
        ['web', 'ios', 'android', 'flutter', 'desktop', 'document'],
        'platform',
      );
    if ('device' in o) {
      const d = object(o['device'], ['model', 'runtime'], 'device');
      m.device = {};
      if ('model' in d) m.device.model = label(d['model'], 'device.model');
      if ('runtime' in d)
        m.device.runtime = choice(
          d['runtime'],
          ['simulator', 'emulator', 'device', 'host-render'],
          'device.runtime',
        );
    }
    if ('display' in o) {
      const d = object(
        o['display'],
        ['scale', 'density', 'orientation', 'logicalWidth', 'logicalHeight'],
        'display',
      );
      m.display = {};
      if ('scale' in d)
        m.display.scale = number(
          d['scale'],
          'display.scale',
          Number.MIN_VALUE,
          16,
        );
      if ('density' in d)
        m.display.density = number(d['density'], 'display.density', 1, 2400);
      if ('orientation' in d)
        m.display.orientation = choice(
          d['orientation'],
          ['portrait', 'landscape'],
          'display.orientation',
        );
      if ('logicalWidth' in d || 'logicalHeight' in d) {
        m.display.logicalWidth = number(
          d['logicalWidth'],
          'display.logicalWidth',
          Number.MIN_VALUE,
          32768,
        );
        m.display.logicalHeight = number(
          d['logicalHeight'],
          'display.logicalHeight',
          Number.MIN_VALUE,
          32768,
        );
      }
      if (
        m.deviceScaleFactor !== undefined &&
        m.display.scale !== undefined &&
        m.deviceScaleFactor !== m.display.scale
      )
        invalid('display.scale and deviceScaleFactor disagree');
    }
    if ('fontScale' in o)
      m.fontScale = number(o['fontScale'], 'fontScale', Number.MIN_VALUE, 16);
    if ('framework' in o) m.framework = identity(o['framework'], 'framework');
    if ('renderer' in o) m.renderer = identity(o['renderer'], 'renderer');
    if ('surface' in o)
      m.surface = choice(
        o['surface'],
        ['page', 'screen', 'window', 'element', 'document-page'],
        'surface',
      );
    if ('document' in o) {
      if (m.platform !== 'document')
        invalid('document requires platform document');
      const d = object(o['document'], ['page', 'pages', 'dpi'], 'document');
      m.document = {};
      if ('page' in d)
        m.document.page = number(d['page'], 'document.page', 1, 100000, true);
      if ('pages' in d)
        m.document.pages = number(
          d['pages'],
          'document.pages',
          1,
          100000,
          true,
        );
      if ('dpi' in d)
        m.document.dpi = number(d['dpi'], 'document.dpi', 1, 2400);
      if (
        m.document.page !== undefined &&
        m.document.pages !== undefined &&
        m.document.page > m.document.pages
      )
        invalid('document.page exceeds pages');
    }
    if ('group' in o) m.group = label(o['group'], 'group');
    if (
      m.platform &&
      m.platform !== 'web' &&
      (m.browser ||
        m.capture ||
        m.viewport ||
        m.deviceScaleFactor !== undefined)
    )
      invalid('web fields require platform web or unspecified');
    if (m.surface === 'document-page' && m.platform !== 'document')
      invalid('document-page requires platform document');
  }
  const limit =
    m.version === 1
      ? MAX_CAPTURE_METADATA_BYTES
      : MAX_CAPTURE_METADATA_V2_BYTES;
  if (utf8Bytes(JSON.stringify(m)) > limit)
    invalid(`record exceeds ${limit} UTF-8 bytes`);
  return m;
}

/** MySQL returns JSON as an object or string. Legacy absence stays unknown. */
export function readCaptureMetadata(value: unknown): CaptureMetadata | null {
  return value == null
    ? null
    : validateCaptureMetadata(
        typeof value === 'string' ? JSON.parse(value) : value,
      );
}
export function captureMetadataJson(value: unknown): string | null {
  const m = readCaptureMetadata(value);
  return m ? JSON.stringify(m) : null;
}
