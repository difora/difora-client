import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
assert.match(
  process.env.RELEASE_TAG ?? '',
  /^v\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?$/,
);
assert.equal(
  process.env.RELEASE_TAG,
  `v${pkg.version}`,
  'Tag must match package version',
);
assert.equal(
  process.env.GITHUB_REPOSITORY,
  'difora/difora-client',
  'Publish only from the public CLI repository',
);
assert.equal(pkg.repository.url, 'https://github.com/difora/difora-client');
console.log('Release tag and repository verified');
