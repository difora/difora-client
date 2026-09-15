import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import {
  downloadImages,
  inspectBuild,
  parseRead,
  readResponse,
  runReadCommand,
  terminalText,
  type ReadSnapshot,
} from './read-command';

const token = 'dfr_' + 'A'.repeat(43);
const env = {
  DIFORA_READ_TOKEN: token,
  DIFORA_API_URL: 'http://127.0.0.1:3400/api',
};
const build = {
  id: 100,
  number: 42,
  comparisonRevision: 3,
  status: 'unreviewed',
  branch: 'feature',
  commitSha: 'abcdef0',
  reviewUrl: 'https://app.difora.eu/projects/example/builds/100',
  expiredAt: null,
  snapshotsTotal: 2,
  snapshotsChanged: 1,
  snapshotsNew: 1,
  snapshotsRemoved: 0,
};
const route = (id: number, kind = 'current') =>
  `/read/v1/builds/100/snapshots/${id}/images/${kind}?revision=3`;
const snapshot = (id: number): ReadSnapshot => ({
  id,
  buildId: 100,
  name: '../../unsafe\u001b[31m/name',
  status: 'approved',
  classification: 'changed',
  images: { current: route(id), baseline: null, diff: null },
});
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
// An actual one-pixel PNG; downloads verify the original bytes, not re-encoded images.
const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLttAAAAABJRU5ErkJggg==',
  'base64',
);

describe('read command options', () => {
  it('distinguishes project build numbers and explicit IDs without upload configuration or Git', () => {
    expect(parseRead('inspect', ['42'], env)).toMatchObject({
      reference: 42,
      byId: false,
      token,
    });
    expect(parseRead('inspect', ['--build-id', '42'], env)).toMatchObject({
      reference: 42,
      byId: true,
    });
    expect(() =>
      parseRead('inspect', ['42', '--build-id', '100'], env),
    ).toThrow();
    expect(() =>
      parseRead('builds', [], { DIFORA_TOKEN: 'df_upload' }),
    ).toThrow('DIFORA_READ_TOKEN');
    expect(() => parseRead('builds', ['--token', token], env)).toThrow();
  });
  it('bounds pagination, rejects ambiguous arguments and limits API credentials to HTTPS or loopback', () => {
    for (const args of [
      ['--limit', '101'],
      ['--limit', '0'],
      ['--limit', '1.5'],
      ['--before', '9007199254740992'],
      ['--json', '--json'],
      ['--branch'],
    ])
      expect(() => parseRead('builds', args, env)).toThrow();
    for (const url of [
      'http://example.org/api',
      'https://user:secret@example.org/api',
      'https://example.org/api?token=secret',
      'https://example.org/api#x',
    ])
      expect(() => parseRead('builds', ['--api-url', url], env)).toThrow();
    expect(
      parseRead('builds', ['--api-url', 'https://example.org/api/'], env)
        .apiUrl,
    ).toBe('https://example.org/api');
  });
  it('removes human terminal controls without changing ordinary Unicode', () => {
    expect(terminalText('A\u001b[31m red\nline\u202e')).toBe('A red line ');
    expect(terminalText('Überprüfung ✓')).toBe('Überprüfung ✓');
  });
});

describe('read responses and consistent evidence', () => {
  let fetchMock: jest.SpyInstance;
  beforeEach(() => {
    fetchMock = jest.spyOn(globalThis, 'fetch');
  });
  afterEach(() => jest.restoreAllMocks());
  it('uses only GET with a separate read bearer and rejects redirects without following them', async () => {
    fetchMock.mockResolvedValue(
      new Response('', {
        status: 302,
        headers: { location: 'https://untrusted.example' },
      }),
    );
    await expect(
      readResponse(parseRead('builds', [], env), '/read/v1/project', 'test'),
    ).rejects.toThrow('redirected');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][1]).toMatchObject({
      method: 'GET',
      redirect: 'manual',
      headers: { authorization: 'Bearer ' + token },
    });
  });
  it('collects bounded pages at the same comparison revision and keeps approved changed images', async () => {
    fetchMock
      .mockResolvedValueOnce(json(build))
      .mockResolvedValueOnce(
        json({ comparisonRevision: 3, snapshots: [snapshot(1)], nextAfter: 1 }),
      )
      .mockResolvedValueOnce(
        json({
          comparisonRevision: 3,
          snapshots: [snapshot(2)],
          nextAfter: null,
        }),
      );
    const result = await inspectBuild(
      parseRead('inspect', ['42', '--changed-only'], env),
      'test',
    );
    expect(result.snapshots.map((s) => s.id)).toEqual([1, 2]);
    expect(fetchMock.mock.calls[0][0]).toContain('/builds/by-number/42');
    expect(fetchMock.mock.calls[2][0]).toContain(
      'revision=3&limit=100&changedOnly=true&after=1',
    );
  });
  it.each([
    { comparisonRevision: 4, snapshots: [snapshot(1)], nextAfter: null },
    {
      comparisonRevision: 3,
      snapshots: [snapshot(1), snapshot(1)],
      nextAfter: null,
    },
    { comparisonRevision: 3, snapshots: [snapshot(1)], nextAfter: 2 },
    {
      comparisonRevision: 3,
      snapshots: [{ ...snapshot(1), buildId: 99 }],
      nextAfter: null,
    },
  ])(
    'rejects mixed revisions, duplicate evidence, foreign parents and invalid cursors',
    async (page) => {
      fetchMock
        .mockResolvedValueOnce(json(build))
        .mockResolvedValueOnce(json(page));
      await expect(
        inspectBuild(parseRead('inspect', ['42'], env), 'test'),
      ).rejects.toThrow();
    },
  );
  it('returns an explicitly expired summary but refuses to label it a complete download', async () => {
    fetchMock.mockImplementation(async () =>
      json({ ...build, expiredAt: '2026-09-15T00:00:00Z' }),
    );
    expect(
      (await inspectBuild(parseRead('inspect', ['42'], env), 'test')).snapshots,
    ).toEqual([]);
    await expect(
      inspectBuild(
        parseRead('inspect', ['42', '--download', 'out'], env),
        'test',
      ),
    ).rejects.toThrow('retained comparison');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
  it('redacts credentials reflected in an error and keeps JSON output machine-readable', async () => {
    const previous = process.env['DIFORA_READ_TOKEN'];
    process.env['DIFORA_READ_TOKEN'] = token;
    const log = jest.spyOn(console, 'log').mockImplementation(() => undefined);
    try {
      fetchMock.mockResolvedValueOnce(
        json({ message: 'Reflected ' + token }, 401),
      );
      await expect(
        runReadCommand('builds', ['--json'], 'test'),
      ).rejects.toThrow('[redacted]');
      fetchMock.mockResolvedValueOnce(
        json({ builds: [build], nextBefore: null }),
      );
      await runReadCommand('builds', ['--json'], 'test');
      expect(log).toHaveBeenCalledTimes(1);
      expect(JSON.parse(log.mock.calls[0][0])).toEqual({
        builds: [build],
        nextBefore: null,
      });
    } finally {
      if (previous === undefined) delete process.env['DIFORA_READ_TOKEN'];
      else process.env['DIFORA_READ_TOKEN'] = previous;
    }
  });
});

describe('private PNG downloads', () => {
  let root: string;
  let fetchMock: jest.SpyInstance;
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'difora-read-test-'));
    fetchMock = jest.spyOn(globalThis, 'fetch');
  });
  afterEach(() => {
    jest.restoreAllMocks();
    fs.rmSync(root, { recursive: true, force: true });
  });
  const response = () =>
    new Response(png, {
      headers: {
        'content-type': 'image/png',
        'content-length': String(png.length),
      },
    });
  it('generates filenames independent of customer names and publishes byte hashes only after completion', async () => {
    fetchMock.mockImplementation(async () => response());
    const directory = path.join(root, 'result');
    const output = await downloadImages(
      parseRead('inspect', ['42', '--download', directory], env),
      { build, snapshots: [snapshot(1)] },
      'test',
    );
    expect(fs.readdirSync(directory).sort()).toEqual([
      '1-current.png',
      'manifest.json',
    ]);
    expect(fs.readFileSync(path.join(directory, '1-current.png'))).toEqual(png);
    const manifest = JSON.parse(
      fs.readFileSync(path.join(directory, 'manifest.json'), 'utf8'),
    );
    expect(manifest.complete).toBe(true);
    expect(manifest.files[0].sha256).toBe(
      createHash('sha256').update(png).digest('hex'),
    );
    expect(output.files[0].name).toBe(snapshot(1).name);
    expect(JSON.stringify(manifest)).not.toContain(token);
    if (process.platform !== 'win32')
      expect(
        fs.statSync(path.join(directory, '1-current.png')).mode & 0o777,
      ).toBe(0o600);
  });
  it('refuses existing directories and symlinks before any network request', async () => {
    const existing = path.join(root, 'existing');
    fs.mkdirSync(existing);
    for (const target of [existing, path.join(root, 'link')]) {
      if (target.endsWith('link')) fs.symlinkSync(existing, target, 'dir');
      await expect(
        downloadImages(
          parseRead('inspect', ['42', '--download', target], env),
          { build, snapshots: [snapshot(1)] },
          'test',
        ),
      ).rejects.toThrow();
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it.each([
    'https://untrusted.example/a.png',
    '/read/v1/builds/999/snapshots/1/images/current?revision=3',
    '/read/v1/../admin',
  ])(
    'never sends a credential to an unexpected image route %s',
    async (route) => {
      const s = snapshot(1);
      s.images.current = route;
      const directory = path.join(root, 'result');
      await expect(
        downloadImages(
          parseRead('inspect', ['42', '--download', directory], env),
          { build, snapshots: [s] },
          'test',
        ),
      ).rejects.toThrow('unexpected image route');
      expect(fetchMock).not.toHaveBeenCalled();
      expect(fs.existsSync(path.join(directory, 'manifest.json'))).toBe(false);
    },
  );
  it('leaves no completion manifest after invalid bytes or a later revoked-token response', async () => {
    for (const [name, failure] of [
      [
        'invalid',
        new Response('invalid!', { headers: { 'content-type': 'image/png' } }),
      ],
      ['revoked', json({ message: 'Invalid or expired read token.' }, 401)],
    ] as const) {
      fetchMock
        .mockResolvedValueOnce(response())
        .mockResolvedValueOnce(failure);
      const directory = path.join(root, name);
      await expect(
        downloadImages(
          parseRead('inspect', ['42', '--download', directory], env),
          { build, snapshots: [snapshot(1), snapshot(2)] },
          'test',
        ),
      ).rejects.toThrow('Download incomplete');
      expect(fs.existsSync(path.join(directory, 'manifest.json'))).toBe(false);
    }
  });
});
