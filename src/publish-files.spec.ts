import { existsSync, readFileSync, readdirSync } from 'fs';
import { join } from 'path';

/**
 * Everything under packages/cli/publish is shipped to the public npm registry. The source
 * repository is private — its URL (and the account handle in it) must never leak through the
 * package README, package.json or license text.
 */
describe('published CLI files', () => {
  const metadata = join(__dirname, '..', 'publish');
  const dir = existsSync(metadata) ? metadata : join(__dirname, '..');
  const files = readdirSync(dir)
    .filter((name) =>
      /^(README\.md|LICENSE|package\.json|.*\.d\.ts)$/.test(name),
    )
    .map((f) => [f, readFileSync(join(dir, f), 'utf8')] as const);

  it('contain no link to the private source repository', () => {
    for (const [name, content] of files) {
      const links = content.match(/https?:\/\/github\.com\/[^\s)"']+/gi) ?? [];
      for (const link of links) {
        const url = new URL(link);
        expect({
          name,
          allowed:
            url.protocol === 'https:' &&
            url.hostname === 'github.com' &&
            !url.username &&
            !url.password &&
            !url.port &&
            (url.pathname === '/difora/difora-client' ||
              url.pathname === '/difora/difora-client.git' ||
              url.pathname.startsWith('/difora/difora-client/')),
        }).toEqual({ name, allowed: true });
      }
    }
  });

  it('keep package.json version and the CLI VERSION constant in sync', () => {
    const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) as {
      version: string;
    };
    const main = readFileSync(join(__dirname, 'main.ts'), 'utf8');
    expect(main).toContain(`const VERSION = '${pkg.version}';`);
  });

  it('ships declarations and bundles for every export without runtime dependencies', () => {
    const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
    expect(pkg.dependencies ?? {}).toEqual({});
    expect(pkg.peerDependenciesMeta['@playwright/test'].optional).toBe(true);
    for (const entry of Object.values(pkg.exports) as {
      types: string;
      default: string;
    }[]) {
      expect(entry.types).toMatch(/\.d\.ts$/);
      expect(pkg.files).toContain(entry.types.slice(2));
      expect(pkg.files).toContain(entry.default.slice(2));
      expect(readFileSync(join(dir, entry.types), 'utf8')).not.toMatch(
        /from ['"](?:@playwright|playwright)/,
      );
    }
  });

  it('point to public documentation only', () => {
    const readme = readFileSync(join(dir, 'README.md'), 'utf8');
    expect(readme).toContain('https://difora.eu/docs/ci.html');
  });
});
