# Contributing to the Difora CLI

This repository contains the MIT-licensed client. The hosted Difora service is proprietary.
The client source is maintained with the service and exported here for each release.
Public pull requests are reviewed, incorporated into the maintained source and re-exported.

Use Node 20 or newer and npm:

```sh
npm ci
npm run build
npm test
```

Keep runtime dependencies at zero. Add tests for behavior changes and update the capture
declarations when their public API changes. Never include access tokens, customer images
or private repository details in issues, commits or test fixtures.

Each released CLI version gets an annotated `vX.Y.Z` tag matching package.json and a
CHANGELOG.md entry. Pushing the tag runs builds and tests on Node 20, 22 and 24, then
publishes a GitHub release with the npm tarball, SHA-256 checksum and changelog notes.
The workflow prepares a draft first; published assets must not be overwritten. Correct
a published package by releasing a new version.

npm publication is a separate maintainer action. After configuring the npm trusted
publisher for `release.yml`, dispatch that workflow **on the version tag**, for example:

```sh
gh workflow run release.yml --repo difora/difora-client --ref v0.8.0
```

The workflow validates the repository and package version before publishing with provenance.
Pushing a tag alone does not publish to npm.

Maintained source exports use `Difora <325679448+difora@users.noreply.github.com>` as both Git author and committer,
with no automated-tool attribution or co-author trailers. Keep release notes and repository
documentation focused on the client and its users.
