export class Analyzer {
  static summarizeBundle(stats: { modules: Array<{ id: string; size: number }> }) {
    const total = stats.modules.reduce((a, m) => a + m.size, 0);
    const top = [...stats.modules].sort((a,b)=>b.size-a.size).slice(0,10);
    return { total, top };
  }
}