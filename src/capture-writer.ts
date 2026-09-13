import { randomUUID } from 'node:crypto';
import {
  link,
  lstat,
  mkdir,
  open,
  realpath,
  unlink,
  writeFile,
} from 'node:fs/promises';
import { dirname, join, relative, sep } from 'node:path';
import { MAX_CAPTURE_SIDECAR_BYTES, utf8Bytes } from './capture-metadata';
import { MAX_PNG_FILE_BYTES, pngHash, readBoundedFile } from './capture-files';
import { observeCapture } from './capture-observer';
import type { ScreenshotOptions, ScreenshotPage } from './capture';

async function exists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
}

async function removeIfPresent(path: string): Promise<void> {
  try {
    await unlink(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
}

/** Create one claimed capture pair. Publication never overwrites another capture. */
export async function writeRecordedCapture<Mask>(
  page: ScreenshotPage<Mask>,
  root: string,
  path: string,
  options: ScreenshotOptions<Mask>,
): Promise<string> {
  await mkdir(root, { recursive: true });
  let directory = await realpath(root);
  const pieces = relative(root, dirname(path)).split(sep).filter(Boolean);
  if (pieces.some((p) => p === '..'))
    throw new Error('Capture path must stay inside its output directory');
  for (const piece of pieces) {
    directory = join(directory, piece);
    try {
      await mkdir(directory);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    }
    const stat = await lstat(directory);
    if (!stat.isDirectory() || stat.isSymbolicLink())
      throw new Error('Capture directory cannot contain symlinks');
  }
  const sidecar = `${path}.difora.json`;
  const lock = `${path}.difora.lock`;
  let claim;
  try {
    claim = await open(lock, 'wx');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST')
      throw new Error(
        'Capture already claimed; use distinct variant names and clean attempt directories',
      );
    throw error;
  }
  const temporary = `${path}.${randomUUID()}.difora.tmp`;
  const temporarySidecar = `${temporary}.json`;
  let publishedPng = false,
    publishedSidecar = false;
  try {
    if ((await exists(path)) || (await exists(sidecar)))
      throw new Error(
        'Capture destination already exists; use distinct variant names and clean attempt directories',
      );
    const metadata = await observeCapture(page, options);
    await page.screenshot({
      path: temporary,
      type: 'png',
      animations: 'disabled',
      caret: 'hide',
      ...(options.fullPage === undefined ? {} : { fullPage: options.fullPage }),
      ...(options.mask === undefined ? {} : { mask: options.mask }),
      ...(options.clip === undefined ? {} : { clip: options.clip }),
    });
    const after = await observeCapture(page, options);
    if (JSON.stringify(metadata) !== JSON.stringify(after))
      throw new Error(
        'Capture environment changed while taking the screenshot',
      );
    const envelope = JSON.stringify({
      version: 1,
      imageHash: pngHash(readBoundedFile(temporary, MAX_PNG_FILE_BYTES)),
      metadata,
    });
    if (utf8Bytes(envelope) > MAX_CAPTURE_SIDECAR_BYTES)
      throw new Error('Capture sidecar exceeds the size limit');
    await writeFile(temporarySidecar, envelope, { flag: 'wx' });
    // Hard links atomically fail if a non-cooperating writer created the destination.
    await link(temporary, path);
    publishedPng = true;
    await link(temporarySidecar, sidecar);
    publishedSidecar = true;
    return path;
  } catch (error) {
    if (publishedSidecar) await unlink(sidecar);
    if (publishedPng) await unlink(path);
    throw error;
  } finally {
    for (const temporaryPath of [temporary, temporarySidecar]) {
      await removeIfPresent(temporaryPath);
    }
    await claim.close();
    await unlink(lock);
  }
}
