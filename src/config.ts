import { existsSync, readFileSync, statSync } from 'fs';
import { join, resolve } from 'path';
import { validateConfig, type DiforaConfig } from './rule-config';

export function loadConfig(
  dir: string,
  explicit?: string,
  cwd = process.cwd(),
): DiforaConfig {
  const path = explicit
    ? resolve(cwd, explicit)
    : [
        join(resolve(cwd, dir), 'difora.config.json'),
        join(cwd, 'difora.config.json'),
      ].find(existsSync);
  if (!path) return { version: 1, rules: [] };
  if (statSync(path).size > 1_000_000)
    throw new Error('Difora config exceeds 1 MB');
  return validateConfig(JSON.parse(readFileSync(path, 'utf8')));
}
