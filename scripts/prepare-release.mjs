import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { checkRelease } from './check-release.mjs';

export function releaseNotes(changelog, version) {
  const sections = changelog.split(/^## /m).slice(1);
  const matching = sections.filter(
    (section) => section.split('\n')[0].trim() === version,
  );
  assert.equal(
    matching.length,
    1,
    'Changelog must contain exactly one section for this version',
  );
  const notes = matching[0].split('\n').slice(1).join('\n').trim();
  assert.ok(notes, 'Release notes must not be empty');
  return `${notes}\n\n### Install from this release\n\nDownload \`difora-${version}.tgz\` and \`SHA256SUMS\` into the same directory.\nVerify with \`shasum -a 256 -c SHA256SUMS\` (macOS) or \`sha256sum -c SHA256SUMS\` (Linux), then install:\n\n\`\`\`sh\nnpm install --save-dev ./difora-${version}.tgz\nnpx difora --version\n\`\`\`\n\nRequires Node 20 or newer. GitHub releases and npm publication are separate.\nSource: https://github.com/difora/difora-client\n`;
}

export function writeAssets(tarball, notes, outputDir) {
  const bytes = readFileSync(tarball);
  const filename = basename(tarball);
  const checksum = createHash('sha256').update(bytes).digest('hex');
  mkdirSync(outputDir, { recursive: true });
  copyFileSync(tarball, join(outputDir, filename));
  writeFileSync(join(outputDir, 'SHA256SUMS'), `${checksum}  ${filename}\n`);
  writeFileSync(join(outputDir, 'release-notes.md'), notes);
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
  checkRelease(pkg, process.env);
  assert.ok(process.argv[2], 'Pass an output directory outside the checkout');
  const outputDir = resolve(process.argv[2]);
  assert.ok(
    relative(process.cwd(), outputDir).startsWith('../'),
    'Keep release artifacts outside the checkout',
  );
  const notes = releaseNotes(readFileSync('CHANGELOG.md', 'utf8'), pkg.version);
  const packs = JSON.parse(
    execFileSync('npm', ['pack', '--json'], { encoding: 'utf8' }),
  );
  assert.equal(packs.length, 1);
  assert.equal(packs[0].name, pkg.name);
  assert.equal(packs[0].version, pkg.version);
  assert.equal(packs[0].filename, `difora-${pkg.version}.tgz`);
  writeAssets(packs[0].filename, notes, outputDir);
  console.log(`Release assets prepared for v${pkg.version}`);
}
