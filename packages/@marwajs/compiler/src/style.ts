import crypto from 'node:crypto';

export function scopeId(inputPath: string) {
  return (
    's-' +
    crypto.createHash('md5').update(inputPath).digest('hex').slice(0, 8)
  );
}

export function scopeCss(css: string, scope: string) {
  if (!css.trim()) return css;
  // naive scoper: prefix each selector with [data-<scope>]
  return css.replace(/(^|\})([^@}][^{]+)\{/g, (_, close: string, sel: string) => {
    const scoped = sel
      .split(',')
      .map((s: string) => `[data-${scope}] ${s.trim()}`)
      .join(', ');
    return `${close}${scoped}{`;
  });
}
