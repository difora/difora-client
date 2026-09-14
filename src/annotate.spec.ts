import fs from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { annotateDirectory, parseAnnotate } from './annotate';
import { collectScreenshots, pngHash } from './capture-files';

// A real one-pixel PNG, solely a local file-protocol fixture.
const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a7WQAAAAASUVORK5CYII=',
  'base64',
);
describe('annotate existing captures', () => {
  let dir: string;
  const metadata = () =>
    parseAnnotate([
      'out',
      '--platform',
      'ios',
      '--device-model',
      'iPhone 15',
      '--runtime',
      'simulator',
      '--scale',
      '3',
    ]).metadata;
  beforeEach(() => {
    dir = fs.mkdtempSync(join(tmpdir(), 'difora-annotate-'));
    fs.writeFileSync(join(dir, 'Home.png'), png);
  });
  afterEach(() => {
    jest.restoreAllMocks();
    fs.rmSync(dir, { recursive: true, force: true });
  });
  it('dry runs then binds declared metadata to unchanged names and exact bytes', () => {
    expect(annotateDirectory(dir, metadata(), true)).toEqual([
      'Home.png.difora.json',
    ]);
    expect(fs.readdirSync(dir)).toEqual(['Home.png']);
    annotateDirectory(dir, metadata());
    const [file] = collectScreenshots(dir);
    expect(file).toMatchObject({
      name: 'Home',
      hash: pngHash(png),
      captureMetadata: metadata(),
    });
    expect(fs.readFileSync(file.path)).toEqual(png);
    expect(() => annotateDirectory(dir, metadata())).toThrow('already exists');
    expect(file.captureMetadata?.version).toBe(2);
  });
  it.each([
    ['out'],
    ['out', '--platform', 'ios', '--scale', 'nan'],
    ['out', '--platform', 'ios', '--scale', '-1'],
    ['out', '--platform', 'ios', '--scale'],
    ['out', '--platform', 'ios', '--platform', 'android'],
    ['out', '--platform', 'ios', '--os-version', '17'],
    ['out', '--platform', 'ios', '--logical-width', '100'],
    ['out', '--platform', 'ios', '--token', 'x'],
    ['out', 'another', '--platform', 'ios'],
  ])('rejects incomplete or unsupported commands: %j', (...args) => {
    expect(() => parseAnnotate(args)).toThrow();
  });
  it('preflights all files before writing, including pointers, orphan and stale sidecars', () => {
    const other = join(dir, 'Other.png');
    fs.writeFileSync(other, 'version https://git-lfs.github.com/spec/v1');
    expect(() => annotateDirectory(dir, metadata())).toThrow('Not a PNG');
    expect(fs.readdirSync(dir)).toEqual(['Home.png', 'Other.png']);
    fs.unlinkSync(other);
    fs.writeFileSync(`${other}.difora.json`, '{}');
    expect(() => annotateDirectory(dir, metadata())).toThrow('Orphan');
    fs.unlinkSync(`${other}.difora.json`);
    fs.writeFileSync(
      join(dir, 'Home.png.difora.json'),
      JSON.stringify({
        version: 1,
        imageHash: 'a'.repeat(64),
        metadata: metadata(),
      }),
    );
    expect(() => annotateDirectory(dir, metadata())).toThrow('hash mismatch');
  });
  it('refuses locks and symlinks and never modifies the existing owner file', () => {
    const lock = join(dir, 'Home.png.difora.lock');
    fs.writeFileSync(lock, 'owner');
    expect(() => annotateDirectory(dir, metadata())).toThrow('Incomplete');
    expect(fs.readFileSync(lock, 'utf8')).toBe('owner');
    fs.unlinkSync(lock);
    fs.symlinkSync('Home.png', join(dir, 'Home.png.difora.json'));
    expect(() => annotateDirectory(dir, metadata())).toThrow('symlink');
  });
  it('rolls back its first sidecar if a later exclusive publication fails', () => {
    fs.writeFileSync(join(dir, 'Other.png'), png);
    const original = fs.openSync;
    jest.spyOn(fs, 'openSync').mockImplementation((path, flags, mode) => {
      if (String(path).endsWith('Other.png.difora.json') && flags === 'wx')
        throw new Error('disk failure');
      return original(path, flags, mode);
    });
    expect(() => annotateDirectory(dir, metadata())).toThrow('disk failure');
    expect(fs.readdirSync(dir)).toEqual(['Home.png', 'Other.png']);
  });
});
