import fs from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import {
  extractMessage,
  HttpError,
  MAX_ATTEMPTS,
  retryDelay,
  sleep,
} from './transport';

const ROOT = '/read/v1';
const MAX_JSON_BYTES = 16 * 1024 * 1024;
const MAX_IMAGE_BYTES = 128 * 1024 * 1024;
const MAX_SNAPSHOTS = 100_000;
const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const HELP = `Read build results with DIFORA_READ_TOKEN (a dfr_ project read token).
  difora builds [--branch <name>] [--commit <sha>] [--limit <1-100>] [--before <id>] [--json]
  difora inspect <build-number> [--changed-only] [--json] [--download <new-directory>]
  difora inspect --build-id <id> [--changed-only] [--json] [--download <new-directory>]
Both commands accept --api-url <url> (or DIFORA_API_URL).
Inspect numbers are project build numbers; --build-id explicitly selects an API ID.
Reading succeeds with exit 0 regardless of review status. Failures exit 2.
Downloads require a new directory. An absent manifest.json means the download is incomplete.`;

export interface ReadOptions {
  command: 'builds' | 'inspect';
  apiUrl: string;
  token: string;
  json: boolean;
  branch?: string;
  commit?: string;
  limit: number;
  before?: number;
  reference?: number;
  byId: boolean;
  changedOnly: boolean;
  download?: string;
}
export interface ReadBuild {
  id: number;
  number: number;
  comparisonRevision: number;
  status: string;
  branch: string;
  commitSha: string;
  reviewUrl: string;
  expiredAt: string | null;
  snapshotsTotal: number;
  snapshotsChanged: number;
  snapshotsNew: number;
  snapshotsRemoved: number;
}
export interface ReadSnapshot {
  id: number;
  buildId: number;
  name: string;
  status: string;
  classification: string | null;
  images: {
    current: string | null;
    baseline: string | null;
    diff: string | null;
  };
}

function positive(
  value: string,
  name: string,
  max = Number.MAX_SAFE_INTEGER,
): number {
  if (
    !/^[1-9]\d*$/.test(value) ||
    !Number.isSafeInteger(Number(value)) ||
    Number(value) > max
  )
    throw new Error(`${name} must be an integer from 1 to ${max}.`);
  return Number(value);
}

export function parseRead(
  command: 'builds' | 'inspect',
  args: string[],
  env: NodeJS.ProcessEnv = process.env,
): ReadOptions {
  const opts: ReadOptions = {
    command,
    apiUrl: env['DIFORA_API_URL'] || 'https://app.difora.eu/api',
    token: env['DIFORA_READ_TOKEN'] || '',
    json: false,
    byId: false,
    changedOnly: false,
    limit: 20,
  };
  const seen = new Set<string>();
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (seen.has(arg) && arg.startsWith('--'))
      throw new Error(`Repeated option ${arg}.`);
    seen.add(arg);
    const next = () => {
      const value = args[++i];
      if (!value || value.startsWith('--'))
        throw new Error(`Missing value for ${arg}.`);
      return value;
    };
    if (arg === '--api-url') opts.apiUrl = next();
    else if (arg === '--json') opts.json = true;
    else if (command === 'builds' && arg === '--branch') opts.branch = next();
    else if (command === 'builds' && arg === '--commit') opts.commit = next();
    else if (command === 'builds' && arg === '--limit')
      opts.limit = positive(next(), '--limit', 100);
    else if (command === 'builds' && arg === '--before')
      opts.before = positive(next(), '--before');
    else if (command === 'inspect' && arg === '--changed-only')
      opts.changedOnly = true;
    else if (command === 'inspect' && arg === '--download')
      opts.download = next();
    else if (
      command === 'inspect' &&
      arg === '--build-id' &&
      opts.reference === undefined
    ) {
      opts.reference = positive(next(), '--build-id');
      opts.byId = true;
    } else if (
      command === 'inspect' &&
      !arg.startsWith('-') &&
      opts.reference === undefined
    )
      opts.reference = positive(arg, 'Build number');
    else
      throw new Error(
        `Unexpected argument ${arg}. See difora ${command} --help.`,
      );
  }
  if (command === 'inspect' && opts.reference === undefined)
    throw new Error('Provide a build number or --build-id <id>.');
  if (!/^dfr_[A-Za-z0-9_-]{43}$/.test(opts.token))
    throw new Error(
      'Set DIFORA_READ_TOKEN to a project read token (dfr_). Upload tokens cannot read review results.',
    );
  const url = new URL(opts.apiUrl);
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (
    (url.protocol !== 'https:' && !(url.protocol === 'http:' && local)) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    throw new Error(
      'The API URL must use HTTPS (HTTP is allowed for loopback development), without credentials, query or fragment.',
    );
  opts.apiUrl = url.href.replace(/\/+$/, '');
  return opts;
}

/** Removes terminal control sequences; JSON output deliberately preserves exact customer text. */
export function terminalText(value: string): string {
  return value
    .replace(/\p{Cc}\[[0-?]*[ -/]*[@-~]/gu, '')
    .replace(/[\p{Cc}\p{Cf}]/gu, ' ');
}

async function boundedBody(response: Response, max: number): Promise<Buffer> {
  if (Number(response.headers.get('content-length') ?? 0) > max) {
    await response.body?.cancel();
    throw new Error('API response exceeds the size limit.');
  }
  if (!response.body) throw new Error('API response has no body.');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      bytes += next.value.byteLength;
      if (bytes > max) throw new Error('API response exceeds the size limit.');
      chunks.push(next.value);
    }
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    throw error;
  }
  return Buffer.concat(chunks);
}

export async function readResponse(
  opts: ReadOptions,
  path: string,
  version: string,
): Promise<Response> {
  if (
    !path.startsWith(ROOT + '/') ||
    path.includes('..') ||
    path.includes('\\') ||
    path.includes('#')
  )
    throw new Error('The API returned an invalid read route.');
  for (let attempt = 0; ; attempt++) {
    let response: Response;
    try {
      response = await fetch(`${opts.apiUrl}${path}`, {
        method: 'GET',
        redirect: 'manual',
        headers: {
          authorization: `Bearer ${opts.token}`,
          'user-agent': `difora-cli/${version}`,
        },
        signal: AbortSignal.timeout(
          path.includes('/images/') ? 120_000 : 30_000,
        ),
      });
    } catch {
      if (attempt >= MAX_ATTEMPTS - 1)
        throw new Error(
          `Read API network request failed after ${MAX_ATTEMPTS} attempts.`,
        );
      await sleep(retryDelay(attempt, null));
      continue;
    }
    if (response.ok) return response;
    if (response.status >= 300 && response.status < 400) {
      await response.body?.cancel();
      throw new Error(
        'The read API redirected the request. Use its final HTTPS API URL.',
      );
    }
    if (
      (response.status === 429 || response.status >= 500) &&
      attempt < MAX_ATTEMPTS - 1
    ) {
      const delay = retryDelay(attempt, response.headers.get('retry-after'));
      await response.body?.cancel();
      await sleep(delay);
      continue;
    }
    const body = await boundedBody(response, 64 * 1024);
    throw new HttpError(
      response.status,
      `Read API failed (${response.status}): ${extractMessage(body.toString('utf8'))}`,
    );
  }
}

async function json<T>(
  opts: ReadOptions,
  path: string,
  version: string,
): Promise<T> {
  const response = await readResponse(opts, path, version);
  if (!response.headers.get('content-type')?.includes('application/json')) {
    await response.body?.cancel();
    throw new Error('The read API did not return JSON. Check the API URL.');
  }
  return JSON.parse(
    (await boundedBody(response, MAX_JSON_BYTES)).toString('utf8'),
  ) as T;
}

function checkBuild(build: ReadBuild) {
  if (
    !build ||
    !Number.isSafeInteger(build.id) ||
    build.id < 1 ||
    !Number.isSafeInteger(build.number) ||
    !Number.isSafeInteger(build.comparisonRevision) ||
    build.comparisonRevision < 1 ||
    typeof build.status !== 'string' ||
    typeof build.branch !== 'string'
  )
    throw new Error('The read API returned an invalid build.');
}

export async function inspectBuild(
  opts: ReadOptions,
  version: string,
): Promise<{ build: ReadBuild; snapshots: ReadSnapshot[] }> {
  const path = opts.byId
    ? `/builds/${opts.reference}`
    : `/builds/by-number/${opts.reference}`;
  const build = await json<ReadBuild>(opts, ROOT + path, version);
  checkBuild(build);
  const snapshots: ReadSnapshot[] = [];
  if (build.expiredAt || ['uploading', 'processing'].includes(build.status)) {
    if (opts.download)
      throw new Error(
        'This build has no complete retained comparison to download.',
      );
    return { build, snapshots };
  }
  let after: number | null = null;
  const ids = new Set<number>();
  do {
    const query = new URLSearchParams({
      revision: String(build.comparisonRevision),
      limit: '100',
    });
    if (opts.changedOnly) query.set('changedOnly', 'true');
    if (after !== null) query.set('after', String(after));
    const page = await json<{
      comparisonRevision: number;
      snapshots: ReadSnapshot[];
      nextAfter: number | null;
    }>(opts, `${ROOT}/builds/${build.id}/snapshots?${query}`, version);
    if (
      page.comparisonRevision !== build.comparisonRevision ||
      !Array.isArray(page.snapshots) ||
      page.snapshots.length > 100
    )
      throw new Error('The read API returned inconsistent snapshot evidence.');
    for (const snapshot of page.snapshots) {
      if (
        !Number.isSafeInteger(snapshot.id) ||
        snapshot.id < 1 ||
        snapshot.buildId !== build.id ||
        ids.has(snapshot.id) ||
        typeof snapshot.name !== 'string' ||
        typeof snapshot.status !== 'string' ||
        !snapshot.images
      )
        throw new Error('The read API returned invalid snapshot evidence.');
      ids.add(snapshot.id);
      snapshots.push(snapshot);
    }
    if (snapshots.length > MAX_SNAPSHOTS)
      throw new Error(
        `Inspection exceeds ${MAX_SNAPSHOTS} snapshots. Use the paginated API.`,
      );
    if (
      page.nextAfter !== null &&
      (!Number.isSafeInteger(page.nextAfter) ||
        page.nextAfter <= (after ?? 0) ||
        !ids.has(page.nextAfter))
    )
      throw new Error('The read API returned an invalid pagination cursor.');
    after = page.nextAfter;
  } while (after !== null);
  return { build, snapshots };
}

export async function downloadImages(
  opts: ReadOptions,
  result: { build: ReadBuild; snapshots: ReadSnapshot[] },
  version: string,
) {
  const requested = resolve(opts.download!);
  const directory = join(
    fs.realpathSync(dirname(requested)),
    basename(requested),
  );
  // mkdir without recursive is the atomic refusal of existing directories, files and symlinks.
  fs.mkdirSync(directory, { mode: 0o700 });
  const files: {
    snapshotId: number;
    name: string;
    kind: string;
    file: string;
    bytes: number;
    sha256: string;
  }[] = [];
  try {
    for (const snapshot of result.snapshots) {
      for (const kind of ['current', 'baseline', 'diff'] as const) {
        const route = snapshot.images[kind];
        if (route === null) continue;
        const expected = `${ROOT}/builds/${result.build.id}/snapshots/${snapshot.id}/images/${kind}?revision=${result.build.comparisonRevision}`;
        if (route !== expected)
          throw new Error('The read API returned an unexpected image route.');
        const response = await readResponse(opts, route, version);
        if (
          response.headers.get('content-type')?.split(';')[0] !== 'image/png' ||
          !response.body ||
          Number(response.headers.get('content-length') ?? 0) > MAX_IMAGE_BYTES
        ) {
          await response.body?.cancel();
          throw new Error('Invalid or oversized PNG download.');
        }
        const file = `${snapshot.id}-${kind}.png`;
        const fd = fs.openSync(
          join(directory, file),
          fs.constants.O_WRONLY |
            fs.constants.O_CREAT |
            fs.constants.O_EXCL |
            fs.constants.O_NOFOLLOW,
          0o600,
        );
        const reader = response.body.getReader();
        const hash = createHash('sha256');
        let bytes = 0;
        let signature = Buffer.alloc(0);
        try {
          for (;;) {
            const next = await reader.read();
            if (next.done) break;
            bytes += next.value.byteLength;
            if (bytes > MAX_IMAGE_BYTES)
              throw new Error('PNG exceeds the download size limit.');
            if (signature.length < 8)
              signature = Buffer.concat([
                signature,
                Buffer.from(next.value),
              ]).subarray(0, 8);
            hash.update(next.value);
            let written = 0;
            while (written < next.value.length)
              written += fs.writeSync(fd, next.value, written);
          }
          if (!signature.equals(PNG_SIGNATURE))
            throw new Error('The downloaded image is not a PNG.');
          const declared = response.headers.get('content-length');
          if (declared !== null && bytes !== Number(declared))
            throw new Error('The image download is incomplete.');
        } catch (error) {
          await reader.cancel().catch(() => undefined);
          throw error;
        } finally {
          fs.closeSync(fd);
        }
        files.push({
          snapshotId: snapshot.id,
          name: snapshot.name,
          kind,
          file,
          bytes,
          sha256: hash.digest('hex'),
        });
      }
    }
    fs.writeFileSync(
      join(directory, 'manifest.json'),
      JSON.stringify(
        {
          version: 1,
          complete: true,
          build: result.build,
          changedOnly: opts.changedOnly,
          files,
        },
        null,
        2,
      ) + '\n',
      { flag: 'wx', mode: 0o600 },
    );
    return { directory, files };
  } catch (error) {
    throw new Error(
      `Download incomplete in ${directory}; no completion manifest was written. ${(error as Error).message}`,
    );
  }
}

export async function runReadCommand(
  command: 'builds' | 'inspect',
  args: string[],
  version: string,
): Promise<void> {
  if (args.length === 1 && ['--help', '-h'].includes(args[0])) {
    console.log(HELP);
    return;
  }
  let opts: ReadOptions | undefined;
  try {
    opts = parseRead(command, args);
    if (command === 'builds') {
      const query = new URLSearchParams({ limit: String(opts.limit) });
      for (const key of ['branch', 'commit', 'before'] as const)
        if (opts[key] !== undefined) query.set(key, String(opts[key]));
      const result = await json<{
        builds: ReadBuild[];
        nextBefore: number | null;
      }>(opts, `${ROOT}/builds?${query}`, version);
      if (!Array.isArray(result.builds) || result.builds.length > opts.limit)
        throw new Error('The read API returned an invalid build list.');
      result.builds.forEach(checkBuild);
      if (opts.json) console.log(JSON.stringify(result));
      else {
        if (!result.builds.length)
          console.log('No builds match these filters.');
        for (const build of result.builds)
          console.log(
            terminalText(
              `#${build.number}  ${build.status}  ${build.branch}  ${build.commitSha}`,
            ),
          );
        if (result.nextBefore !== null)
          console.log(
            `Next page: difora builds --before ${positive(String(result.nextBefore), 'Next cursor')}`,
          );
      }
      return;
    }
    const result = await inspectBuild(opts, version);
    const download = opts.download
      ? await downloadImages(opts, result, version)
      : undefined;
    if (opts.json)
      console.log(
        JSON.stringify({ ...result, ...(download ? { download } : {}) }),
      );
    else {
      console.log(
        terminalText(
          `#${result.build.number} · ${result.build.status} · ${result.build.branch}`,
        ),
      );
      console.log(terminalText(result.build.reviewUrl));
      if (result.build.expiredAt)
        console.log('Retained snapshot evidence has expired.');
      else if (['uploading', 'processing'].includes(result.build.status))
        console.log(
          'Comparison is still running; snapshot evidence is not yet available.',
        );
      else if (!result.snapshots.length)
        console.log('No snapshots match these filters.');
      for (const snapshot of result.snapshots)
        console.log(
          terminalText(
            `${snapshot.classification ?? 'pending'}  ${snapshot.status}  ${snapshot.name}`,
          ),
        );
      if (download)
        console.log(
          `Downloaded ${download.files.length} PNGs to ${terminalText(download.directory)}`,
        );
    }
  } catch (error) {
    const message = String(error instanceof Error ? error.message : error);
    const token = opts?.token || process.env['DIFORA_READ_TOKEN'];
    throw new Error(
      terminalText(token ? message.split(token).join('[redacted]') : message),
    );
  }
}
