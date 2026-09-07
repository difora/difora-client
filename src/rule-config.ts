import { compileGlob } from './glob';

export interface IgnoreRegion {
  x: number;
  y: number;
  width: number;
  height: number;
}
export interface SnapshotRuleConfig {
  match: string;
  threshold?: number;
  changeRatioThreshold?: number;
  ignore?: IgnoreRegion[];
}
export interface DiforaConfig {
  version: 1;
  rules: SnapshotRuleConfig[];
}

function object(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}
function keys(
  value: Record<string, unknown>,
  allowed: string[],
  label: string,
) {
  if (Object.keys(value).some((key) => !allowed.includes(key)))
    throw new Error(`${label} contains an unknown field`);
}

/** Same strict validation in the uploader and API; return a canonical serializable value. */
export function validateRules(value: unknown): SnapshotRuleConfig[] {
  if (!Array.isArray(value) || value.length > 200)
    throw new Error('rules must be an array of at most 200 rules');
  return value.map((rule, index) => {
    if (!object(rule)) throw new Error(`Rule ${index + 1} must be an object`);
    keys(
      rule,
      ['match', 'threshold', 'changeRatioThreshold', 'ignore'],
      `Rule ${index + 1}`,
    );
    if (typeof rule['match'] !== 'string')
      throw new Error('match must be a glob string');
    compileGlob(rule['match']);
    const out: SnapshotRuleConfig = { match: rule['match'] };
    for (const name of ['threshold', 'changeRatioThreshold'] as const) {
      const number = rule[name];
      if (number === undefined) continue;
      if (
        typeof number !== 'number' ||
        !Number.isFinite(number) ||
        number < 0 ||
        number > 1
      )
        throw new Error(`${name} must be a number from 0 to 1`);
      out[name] = number;
    }
    if (rule['ignore'] !== undefined) {
      if (!Array.isArray(rule['ignore']) || rule['ignore'].length > 50)
        throw new Error('ignore must contain at most 50 regions');
      out.ignore = rule['ignore'].map((region) => {
        if (!object(region))
          throw new Error('Each ignore region must be an object');
        keys(region, ['x', 'y', 'width', 'height'], 'Ignore region');
        for (const name of ['x', 'y', 'width', 'height']) {
          const number = region[name];
          if (
            typeof number !== 'number' ||
            !Number.isSafeInteger(number) ||
            number < 0 ||
            number > 30_000_000
          )
            throw new Error(
              'Region coordinates must be integers from 0 to 30000000',
            );
        }
        return {
          x: region['x'] as number,
          y: region['y'] as number,
          width: region['width'] as number,
          height: region['height'] as number,
        };
      });
    }
    return out;
  });
}

export function validateConfig(value: unknown): DiforaConfig {
  if (!object(value) || value['version'] !== 1)
    throw new Error('Config version must be 1');
  keys(value, ['version', 'rules', '$schema'], 'Config');
  if (value['$schema'] !== undefined && typeof value['$schema'] !== 'string')
    throw new Error('$schema must be a string');
  return { version: 1, rules: validateRules(value['rules']) };
}
