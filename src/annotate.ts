import {
  closeSync,
  fstatSync,
  lstatSync,
  openSync,
  realpathSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { collectScreenshots, readUploadPng } from './capture-files';
import {
  MAX_CAPTURE_SIDECAR_BYTES,
  utf8Bytes,
  validateCaptureMetadata,
  type CaptureMetadata,
} from './capture-metadata';

export const ANNOTATE_USAGE = `difora annotate <dir> --platform <web|ios|android|flutter|desktop|document> [options]

Write declared capture metadata beside existing PNGs. No network requests or renaming.
Use a clean, completed capture directory; existing sidecars are never overwritten.
Place device combinations in explicit stable variant directories before annotation.

  --dry-run                      Validate and list files without writing
  --variant <id>                 Declared variant (does not change snapshot names)
  --device-model <label>          Device model
  --runtime <value>               simulator, emulator, device, host-render
  --os <name> --os-version <v>    Capture operating system / Android API level
  --scale <n> --density <dpi>     Display scale / pixel density
  --orientation <value>          portrait, landscape
  --logical-width <n> --logical-height <n>
  --font-scale <n>                Declared text scale
  --framework <name> --framework-version <v>
  --renderer <name> --renderer-version <v>
  --surface <value>              page, screen, window, element, document-page
  --document-page <n> --document-pages <n> --document-dpi <n>
  --group <label> --theme <label> --color-scheme <light|dark|no-preference>
  --locale <label> --timezone <label>
  --environment <id> --environment-revision <revision>
`;

const flags: Record<string, [string, string?, boolean?]> = {
  '--platform': ['platform'],
  '--variant': ['variant'],
  '--device-model': ['device', 'model'],
  '--runtime': ['device', 'runtime'],
  '--os': ['os', 'name'],
  '--os-version': ['os', 'version'],
  '--scale': ['display', 'scale', true],
  '--density': ['display', 'density', true],
  '--orientation': ['display', 'orientation'],
  '--logical-width': ['display', 'logicalWidth', true],
  '--logical-height': ['display', 'logicalHeight', true],
  '--font-scale': ['fontScale', undefined, true],
  '--framework': ['framework', 'name'],
  '--framework-version': ['framework', 'version'],
  '--renderer': ['renderer', 'name'],
  '--renderer-version': ['renderer', 'version'],
  '--surface': ['surface'],
  '--document-page': ['document', 'page', true],
  '--document-pages': ['document', 'pages', true],
  '--document-dpi': ['document', 'dpi', true],
  '--group': ['group'],
  '--theme': ['theme'],
  '--color-scheme': ['colorScheme'],
  '--locale': ['locale'],
  '--timezone': ['timezone'],
  '--environment': ['environment', 'id'],
  '--environment-revision': ['environment', 'revision'],
};
export function parseAnnotate(argv: string[]): {
  dir: string;
  metadata: CaptureMetadata;
  dryRun: boolean;
} {
  let dir = '',
    dryRun = false;
  const metadata: Record<string, unknown> = {
    version: 2,
    source: 'provided',
    producer: { name: 'difora-annotate', version: '0.12.0' },
  };
  const seen = new Set<string>();
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--dry-run') {
      dryRun = true;
      continue;
    }
    if (!arg.startsWith('-')) {
      if (dir) throw new Error(`Unexpected argument ${arg}`);
      dir = arg;
      continue;
    }
    if (!Object.hasOwn(flags, arg))
      throw new Error(`Unknown annotate option ${arg}`);
    if (seen.has(arg)) throw new Error(`Duplicate option ${arg}`);
    seen.add(arg);
    const value = argv[++i];
    if (value === undefined || value.startsWith('--'))
      throw new Error(`Missing value for ${arg}`);
    const [key, child, numeric] = flags[arg];
    if (numeric && !/^(?:\d+(?:\.\d*)?|\.\d+)$/.test(value))
      throw new Error(`Invalid number for ${arg}`);
    const parsed = numeric ? Number(value) : value;
    if (child) {
      const nested = (metadata[key] ??= {}) as Record<string, unknown>;
      nested[child] = parsed;
    } else metadata[key] = parsed;
  }
  if (!dir || !seen.has('--platform'))
    throw new Error(
      'annotate requires a directory and --platform; see difora annotate --help',
    );
  return { dir, metadata: validateCaptureMetadata(metadata), dryRun };
}

/** All input is checked before writes. Existing capture locks also block the uploader. */
export function annotateDirectory(
  dir: string,
  value: CaptureMetadata,
  dryRun = false,
): string[] {
  const metadata = validateCaptureMetadata(value);
  const rootStat = lstatSync(dir);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink())
    throw new Error('Capture root must be a regular directory, not a symlink');
  const root = realpathSync(dir);
  const files = collectScreenshots(root);
  if (!files.length) throw new Error('No .png files found');
  const prepared = files.map((file) => {
    if (file.captureMetadata)
      throw new Error(`Sidecar already exists: ${file.name}`);
    const bytes = readUploadPng(file);
    if (
      bytes.length < 33 ||
      bytes.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a' ||
      bytes.readUInt32BE(8) !== 13 ||
      bytes.toString('ascii', 12, 16) !== 'IHDR'
    )
      throw new Error(`Not a PNG capture: ${file.name}`);
    const width = bytes.readUInt32BE(16),
      height = bytes.readUInt32BE(20);
    if (!width || !height || width * height > 30_000_000)
      throw new Error(`PNG dimensions exceed capture limits: ${file.name}`);
    const envelope = JSON.stringify({
      version: 1,
      imageHash: file.hash,
      metadata,
    });
    if (utf8Bytes(envelope) > MAX_CAPTURE_SIDECAR_BYTES)
      throw new Error('Capture sidecar exceeds the size limit');
    return { file, envelope };
  });
  const outputs = prepared.map(({ file }) =>
    relative(root, `${file.path}.difora.json`),
  );
  if (dryRun) return outputs;
  const locks: string[] = [];
  const created: { path: string; ino: number; dev: number }[] = [];
  try {
    for (const { file } of prepared) {
      // Refuse an ancestor replaced by a symlink since collection.
      if (realpathSync(dirname(file.path)) !== resolve(dirname(file.path)))
        throw new Error('Capture directory changed');
      const lock = `${file.path}.difora.lock`;
      const fd = openSync(lock, 'wx');
      locks.push(lock);
      closeSync(fd);
    }
    for (const { file, envelope } of prepared) {
      readUploadPng(file);
      const path = `${file.path}.difora.json`;
      const fd = openSync(path, 'wx');
      try {
        const { ino, dev } = fstatSync(fd);
        created.push({ path, ino, dev });
        writeFileSync(fd, envelope);
      } finally {
        closeSync(fd);
      }
    }
    for (const { file } of prepared) readUploadPng(file);
    return outputs;
  } catch (error) {
    for (const file of created.reverse()) {
      let stat;
      try {
        stat = lstatSync(file.path);
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code === 'ENOENT') continue;
        throw e;
      }
      if (stat.ino === file.ino && stat.dev === file.dev) unlinkSync(file.path);
    }
    throw error;
  } finally {
    for (const lock of locks.reverse()) unlinkSync(lock);
  }
}

export function annotate(argv: string[]): void {
  if (argv.length === 1 && ['--help', '-h'].includes(argv[0])) {
    console.log(ANNOTATE_USAGE);
    return;
  }
  const { dir, metadata, dryRun } = parseAnnotate(argv);
  const paths = annotateDirectory(dir, metadata, dryRun);
  for (const path of paths)
    console.log(
      `${dryRun ? 'Would annotate' : 'Annotated'}: ${JSON.stringify(path)}`,
    );
  console.log(
    `${paths.length} capture${paths.length === 1 ? '' : 's'} ${dryRun ? 'validated (no files written)' : 'annotated'}. Snapshot names are unchanged.`,
  );
}
