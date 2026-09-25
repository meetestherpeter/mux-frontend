import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = join(__dirname, '..');

function readRepoFile(relativePath: string): string {
  return readFileSync(join(repoRoot, relativePath), 'utf8');
}

describe('CI workflow', () => {
  it('runs the test suite on pull requests', () => {
    const workflow = readRepoFile('.github/workflows/ci.yml');
    expect(workflow).toMatch(/pull_request/);
    expect(workflow).toMatch(/npm (run )?test/);
  });
});

describe('source maps production policy', () => {
  it('disables browser source maps in production builds', () => {
    const nextConfig = readRepoFile('next.config.ts');
    expect(nextConfig).toMatch(/productionBrowserSourceMaps\s*:\s*false/);
  });

  it('does not enable productionBrowserSourceMaps anywhere in the config', () => {
    const nextConfig = readRepoFile('next.config.ts');
    expect(nextConfig).not.toMatch(/productionBrowserSourceMaps\s*:\s*true/);
  });
});
