# Changelog

## 0.8.0

First public source release of the standalone Difora CLI and capture helpers.

- Upload PNG suites, detect nine CI providers, retry transient failures and report build results.
- Capture with Playwright and Storybook helpers, with structural TypeScript declarations.
- Aggregate parallel shards and support attempt-aware reruns.
- Resolve merge-base comparisons with explicit fallback warnings.
- Validate snapshot rules, thresholds and intrinsic ignore regions from difora.config.json.
- Detect PR/MR numbers for optional summary comments and provide doctor diagnostics.
- Build and test independently on Node 20, 22 and 24; zero runtime dependencies.

The hosted service and customer data are separate. npm registry publication is pending;
see README.md for building and installing the client from this public source repository.
