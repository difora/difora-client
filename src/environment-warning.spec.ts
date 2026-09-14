import { environmentWarning } from './environment-warning';

describe('environment warning', () => {
  it('keeps old servers and unknown-only builds quiet', () => {
    for (const value of [undefined, null, 0, -1, 1.5, '2', Infinity, NaN])
      expect(environmentWarning({ environmentDifferent: value })).toBeNull();
    expect(environmentWarning({})).toBeNull();
  });
  it('uses fixed labels in deterministic order and never prints supplied metadata or control characters', () => {
    expect(
      environmentWarning({
        environmentDifferent: 2,
        environmentFields: [
          'os.name',
          'browser.version',
          'os.name',
          '\u001b[31msecret',
          '__proto__',
        ],
      }),
    ).toBe(
      'WARNING: Environment differs for 2 snapshots (Browser version, Operating system). Review the recorded values in Capture details. Comparison and exit status are unchanged.',
    );
    expect(
      environmentWarning({ environmentDifferent: 1, environmentFields: null }),
    ).toContain('1 snapshot');
  });
  it('names native renderer differences without exposing declared device values', () => {
    expect(
      environmentWarning({
        environmentDifferent: 1,
        environmentFields: [
          'platform',
          'renderer.version',
          'device.model',
          'document.dpi',
        ],
      }),
    ).toContain('(Platform, Renderer version, Device model, Document DPI)');
  });
});
