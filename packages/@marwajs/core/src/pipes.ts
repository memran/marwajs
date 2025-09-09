export type Pipe = (v:any, ...args:any[]) => any;
const pipes = new Map<string, Pipe>();

export function registerPipe(name: string, fn: Pipe){ pipes.set(name, fn); }
export function applyPipe(name: string, v:any, ...args:any[]){ return (pipes.get(name) ?? ((x)=>x))(v, ...args); }

/* Built-ins */
registerPipe('uppercase', (v)=> String(v ?? '').toUpperCase());
registerPipe('lowercase', (v)=> String(v ?? '').toLowerCase());
registerPipe('date', (v, locale='en-US', opts?:Intl.DateTimeFormatOptions)=> new Intl.DateTimeFormat(locale, opts).format(new Date(v)));
