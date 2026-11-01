export interface Orderable {
  name: string;
  dependsOn?: readonly string[];
}

/** Topological sort by name + dependsOn. Dependencies first; ties keep input order. */
export function orderPlugins<T extends Orderable>(plugins: readonly T[]): T[] {
  const byName = new Map<string, T>();
  for (const p of plugins) byName.set(p.name, p);
  for (const p of plugins) {
    for (const d of p.dependsOn ?? []) {
      if (!byName.has(d)) throw new Error(`Plugin "${p.name}" depends on unknown plugin "${d}"`);
    }
  }
  const out: T[] = [];
  const done = new Set<string>();
  const stack: string[] = [];
  const visit = (p: T): void => {
    if (done.has(p.name)) return;
    const at = stack.indexOf(p.name);
    if (at >= 0) {
      throw new Error(`Plugin dependency cycle: ${[...stack.slice(at), p.name].join(' -> ')}`);
    }
    stack.push(p.name);
    for (const d of p.dependsOn ?? []) visit(byName.get(d) as T);
    stack.pop();
    done.add(p.name);
    out.push(p);
  };
  for (const p of plugins) visit(p);
  return out;
}
