import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { loadConfig } from './config';
import { validateConfig, validateRules } from './rule-config';

describe('repository rules', () => {
  it('loads explicit, screenshot-directory, then cwd config; absent config has no rules', () => {
    const dir = mkdtempSync(join(tmpdir(), 'difora-config-'));
    const shots = join(dir, 'shots');
    mkdirSync(shots);
    const config = (match: string) =>
      JSON.stringify({ version: 1, rules: [{ match }] });
    try {
      expect(loadConfig(shots, undefined, dir).rules).toEqual([]);
      writeFileSync(join(dir, 'difora.config.json'), config('cwd'));
      expect(loadConfig(shots, undefined, dir).rules[0].match).toBe('cwd');
      writeFileSync(join(shots, 'difora.config.json'), config('shots'));
      expect(loadConfig(shots, undefined, dir).rules[0].match).toBe('shots');
      writeFileSync(join(dir, 'custom.json'), config('explicit'));
      expect(loadConfig(shots, 'custom.json', dir).rules[0].match).toBe(
        'explicit',
      );
      expect(() => loadConfig(shots, 'missing.json', dir)).toThrow();
      writeFileSync(join(dir, 'custom.json'), '{invalid');
      expect(() => loadConfig(shots, 'custom.json', dir)).toThrow();
      writeFileSync(join(dir, 'custom.json'), ' '.repeat(1_000_001));
      expect(() => loadConfig(shots, 'custom.json', dir)).toThrow('1 MB');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
  it('accepts the versioned, zero-valued and bounded region contract', () => {
    const rule = {
      match: '**/home',
      threshold: 0,
      changeRatioThreshold: 1,
      ignore: [{ x: 0, y: 1, width: 2, height: 3 }],
    };
    expect(
      validateConfig({
        version: 1,
        rules: [rule],
        $schema: 'https://difora.eu/schema/difora-config-v1.json',
      }),
    ).toEqual({ version: 1, rules: [rule] });
  });
  it.each([
    null,
    {},
    { version: 2, rules: [] },
    { version: 1, rules: [], typo: true },
  ])('rejects invalid config %j', (value) =>
    expect(() => validateConfig(value)).toThrow(),
  );
  it.each(
    [
      null,
      [null],
      [{ match: '' }],
      [{ match: 'home', threshold: null }],
      [{ match: 'home', threshold: '0.1' }],
      [{ match: 'home', threshold: NaN }],
      [{ match: 'home', threshold: -0.1 }],
      [{ match: 'home', changeRatioThreshold: 1.1 }],
      [{ match: 'home', typo: 0.1 }],
      [{ match: 'home', ignore: {} }],
      [{ match: 'home', ignore: [{ x: -1, y: 0, width: 1, height: 1 }] }],
      [{ match: 'home', ignore: [{ x: 0, y: 0, width: 0.1, height: 1 }] }],
      [{ match: 'home', ignore: [{ x: 0, y: 0, width: 1 }] }],
      [
        {
          match: 'home',
          ignore: Array(51).fill({ x: 0, y: 0, width: 1, height: 1 }),
        },
      ],
      Array(201).fill({ match: '**' }),
    ].map((value) => [value]),
  )('rejects invalid rules %j', (value) =>
    expect(() => validateRules(value)).toThrow(),
  );
});
