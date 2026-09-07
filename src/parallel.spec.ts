import { detectCi, parallelOptions, parseShard } from './ci-env';
describe('parallel upload options', () => {
  it.each(['0/2', '3/2', '-1/2', '1/257', '1.5/2', '1', '1/2/3'])(
    'rejects invalid shard %s',
    (value) => {
      expect(() => parseShard(value)).toThrow();
    },
  );
  it('normalizes one-based CLI indices and rejects missing indices', () => {
    expect(parseShard('2/4')).toEqual({ shardIndex: 1, shardTotal: 4 });
    expect(() =>
      parallelOptions(detectCi({}), { shardTotal: 4 }, 'run', ''),
    ).toThrow();
  });
  it('uses the provider run identity, retaining run attempt separately', () => {
    const ci = detectCi({
      GITHUB_ACTIONS: 'true',
      GITHUB_RUN_ID: '12',
      GITHUB_RUN_ATTEMPT: '2',
    });
    expect(parallelOptions(ci, parseShard('1/2'), '', 'aaaa111')).toEqual({
      parallelId: 'github-12',
      shardIndex: 0,
      shardTotal: 2,
      runAttempt: 2,
    });
  });
  it('prefers explicit identity and warns on commit fallback', () => {
    const ci = detectCi({ DIFORA_PARALLEL_ID: 'env' });
    expect(parallelOptions(ci, parseShard('1/2'), 'flag', '').parallelId).toBe(
      'flag',
    );
    expect(parallelOptions(ci, parseShard('1/2'), '', '').parallelId).toBe(
      'env',
    );
    expect(
      parallelOptions(detectCi({}), parseShard('1/2'), '', 'aaaa111'),
    ).toMatchObject({
      parallelId: 'commit-aaaa111',
      warning: expect.any(String),
    });
    expect(() =>
      parallelOptions(detectCi({}), parseShard('1/2'), '', ''),
    ).toThrow();
  });
});
