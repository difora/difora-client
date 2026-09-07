import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export function checkRelease(pkg, env) {
  assert.match(env.RELEASE_TAG ?? '', /^v\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?$/);
  assert.equal(
    env.RELEASE_TAG,
    `v${pkg.version}`,
    'Tag must match package version',
  );
  assert.equal(
    env.GITHUB_REPOSITORY,
    'difora/difora-client',
    'Publish only from the public CLI repository',
  );
  assert.equal(pkg.name, 'difora');
  assert.equal(pkg.repository.url, 'https://github.com/difora/difora-client');
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  checkRelease(JSON.parse(readFileSync('package.json', 'utf8')), process.env);
  console.log('Release tag and repository verified');
}
