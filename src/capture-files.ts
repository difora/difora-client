import { createHash } from 'node:crypto';
import {
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  openSync,
  readSync,
  readdirSync,
} from 'node:fs';
import { join, relative, sep } from 'node:path';
import {
  MAX_CAPTURE_SIDECAR_BYTES,
  validateCaptureMetadata,
  type CaptureMetadata,
} from './capture-metadata';

export interface ScreenshotFile {
  name: string;
  path: string;
  hash: string;
  captureMetadata?: CaptureMetadata;
}
export const MAX_PNG_FILE_BYTES = 25 * 1024 * 1024;

/** Open a regular file without following symlinks and bound allocation before reading. */
export function readBoundedFile(path: string, max: number): Buffer {
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.size > max)
      throw new Error('File is not regular or exceeds the size limit');
    const result = Buffer.alloc(Math.min(stat.size + 1, max + 1));
    let length = 0;
    while (length < result.length) {
      const count = readSync(fd, result, length, result.length - length, null);
      if (!count) break;
      length += count;
    }
    if (length > stat.size || length > max)
      throw new Error('File changed or exceeds the size limit');
    return result.subarray(0, length);
  } finally {
    closeSync(fd);
  }
}
export function pngHash(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

export function collectScreenshots(dir: string): ScreenshotFile[] {
  const results: ScreenshotFile[] = [];
  const sidecars = new Set<string>();
  const walk = (current: string) => {
    for (const entry of readdirSync(current)) {
      const path = join(current, entry);
      const stat = lstatSync(path);
      if (entry.endsWith('.difora.lock'))
        throw new Error(
          `Incomplete capture: ${relative(dir, path)}. Finish capture or use a clean attempt directory.`,
        );
      if (stat.isSymbolicLink()) {
        if (entry.endsWith('.difora.json'))
          throw new Error(
            `Metadata sidecar cannot be a symlink: ${relative(dir, path)}`,
          );
        continue;
      }
      if (stat.isDirectory()) walk(path);
      else if (entry.endsWith('.difora.json')) sidecars.add(path);
      else if (/\.png$/i.test(entry)) {
        const name = relative(dir, path)
          .split(sep)
          .join('/')
          .replace(/\.png$/i, '');
        results.push({
          name,
          path,
          hash: pngHash(readBoundedFile(path, MAX_PNG_FILE_BYTES)),
        });
      }
    }
  };
  walk(dir);
  for (const file of results) {
    const path = `${file.path}.difora.json`;
    if (!sidecars.delete(path)) continue;
    try {
      const value = JSON.parse(
        readBoundedFile(path, MAX_CAPTURE_SIDECAR_BYTES).toString('utf8'),
      );
      if (
        !value ||
        Array.isArray(value) ||
        typeof value !== 'object' ||
        Object.keys(value).some(
          (k) => !['version', 'imageHash', 'metadata'].includes(k),
        ) ||
        value.version !== 1 ||
        value.imageHash !== file.hash
      ) {
        throw new Error('Unsupported sidecar or PNG hash mismatch');
      }
      file.captureMetadata = validateCaptureMetadata(value.metadata);
    } catch (error) {
      throw new Error(
        `Invalid capture sidecar for ${file.name}: ${error instanceof SyntaxError ? 'Malformed JSON' : (error as Error).message}`,
      );
    }
  }
  if (sidecars.size)
    throw new Error(
      `Orphan capture sidecar: ${relative(dir, sidecars.values().next().value as string)}`,
    );
  return results.sort((a, b) => a.name.localeCompare(b.name));
}

export function readUploadPng(file: ScreenshotFile): Buffer {
  const bytes = readBoundedFile(file.path, MAX_PNG_FILE_BYTES);
  if (pngHash(bytes) !== file.hash)
    throw new Error(
      `Screenshot changed after collection: ${file.name}. Upload only completed capture output.`,
    );
  return bytes;
}
