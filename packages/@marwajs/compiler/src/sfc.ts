import fs from 'node:fs';

export function readSFC(file: string): string {
  return fs.readFileSync(file, 'utf8');
}

export function parseSFC(src: string) {
  const get = (tag: string) => {
    const m = src.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`));
    return m?.[1]?.trim() ?? '';
  };
  return {
    template: get('template'),
    script: get('script'),
    style:  get('style'),
    route:  get('route') || undefined
  };
}
