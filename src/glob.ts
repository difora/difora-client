/** Deliberately small, case-sensitive glob grammar. No regex backtracking or character classes. */
type Token =
  | { kind: 'literal'; value: string }
  | { kind: 'star' | 'deep' | 'directory' | 'one' };

export function compileGlob(pattern: string) {
  if (
    typeof pattern !== 'string' ||
    !pattern.length ||
    pattern.length > 600 ||
    Array.from(pattern).some(
      (char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127,
    )
  )
    throw new Error(
      'match must be a non-empty glob of at most 600 characters without control characters',
    );
  const chars = Array.from(pattern);
  const tokens: Token[] = [];
  for (let i = 0; i < chars.length; i++) {
    const char = chars[i];
    if (char === '\\') {
      const next = chars[++i];
      if (!next || !['*', '?', '\\'].includes(next))
        throw new Error('Only *, ? and \\ may be escaped in a glob');
      tokens.push({ kind: 'literal', value: next });
    } else if (char === '*') {
      let count = 1;
      while (chars[i + 1] === '*') {
        count++;
        i++;
      }
      if (count > 1 && chars[i + 1] === '/') {
        i++;
        tokens.push({ kind: 'directory' });
      } else tokens.push({ kind: count > 1 ? 'deep' : 'star' });
    } else if (char === '?') tokens.push({ kind: 'one' });
    else tokens.push({ kind: 'literal', value: char });
  }
  const literalCount = tokens.filter((t) => t.kind === 'literal').length;
  const wildcardCount = tokens.filter((t) => t.kind !== 'literal').length;
  const prefix = tokens
    .slice(
      0,
      tokens.findIndex((t) => t.kind !== 'literal') < 0
        ? tokens.length
        : tokens.findIndex((t) => t.kind !== 'literal'),
    )
    .map((t) => (t.kind === 'literal' ? t.value : ''))
    .join('');
  return {
    literalCount,
    wildcardCount,
    test(name: string): boolean {
      if (!wildcardCount) return name === prefix;
      if (!name.startsWith(prefix)) return false;
      const input = Array.from(name);
      // Dynamic programming bounds work by pattern × name, including hostile repeated stars.
      let previous = new Uint8Array(input.length + 1);
      previous[0] = 1;
      for (const token of tokens) {
        const next = new Uint8Array(input.length + 1);
        if (token.kind === 'literal' || token.kind === 'one') {
          for (let j = 1; j <= input.length; j++)
            next[j] =
              previous[j - 1] &&
              (token.kind === 'literal'
                ? input[j - 1] === token.value
                : input[j - 1] !== '/')
                ? 1
                : 0;
        } else {
          next[0] = previous[0];
          let seen = false;
          for (let j = 1; j <= input.length; j++) {
            seen ||= Boolean(previous[j - 1]);
            next[j] =
              previous[j] ||
              (token.kind === 'directory'
                ? seen && input[j - 1] === '/'
                : next[j - 1] &&
                  (token.kind === 'deep' || input[j - 1] !== '/'))
                ? 1
                : 0;
          }
        }
        previous = next;
      }
      return Boolean(previous[input.length]);
    },
  };
}

export function literalGlob(name: string): string {
  return name.replace(/[\\*?]/g, '\\$&');
}
