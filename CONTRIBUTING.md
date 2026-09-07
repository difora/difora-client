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

Maintainers publish version tags through the trusted-publishing release workflow. The tag
must match package.json. This requires a configured npm trusted-publisher relationship.

Maintained source exports use `Difora <325679448+difora@users.noreply.github.com>` as both Git author and committer,
with no automated-tool attribution or co-author trailers. Keep release notes and repository
documentation focused on the client and its users.
