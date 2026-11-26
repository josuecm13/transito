/** Anything a Scope can own: an object with dispose(), or a plain cleanup function. */
export type Disposable = { dispose(): void } | (() => void);

export interface Scope {
  /** Registers `x` for disposal and returns it. Owning on an already-disposed scope disposes `x` at once. */
  own<T extends Disposable>(x: T): T;
  /** Runs every owned disposer in reverse order, once. Keeps going if one throws, then throws an AggregateError of all failures. */
  dispose(): void;
  /** Items owned and not yet disposed (for tests and the teardown log). */
  readonly live: number;
}

const run = (d: Disposable): void => (typeof d === 'function' ? d() : d.dispose());

export function createScope(): Scope {
  let items: Disposable[] = [];
  let disposed = false;
  return {
    own<T extends Disposable>(x: T): T {
      if (disposed) run(x);
      else items.push(x);
      return x;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      const todo = items;
      items = [];
      const errors: unknown[] = [];
      for (let i = todo.length - 1; i >= 0; i--) {
        try {
          run(todo[i] as Disposable);
        } catch (err) {
          errors.push(err);
        }
      }
      if (errors.length > 0) throw new AggregateError(errors, `${errors.length} disposer(s) failed`);
    },
    get live() {
      return items.length;
    },
  };
}

/** One Scope per plugin; `disposeAll` tears them down in reverse registration order. */
export interface PluginScopes {
  forPlugin(name: string): Scope;
  readonly live: number;
  /** Disposes every plugin scope (reverse registration order); errors from all are aggregated. */
  disposeAll(): void;
}

export function createPluginScopes(): PluginScopes {
  const scopes: Scope[] = [];
  return {
    forPlugin(_name: string): Scope {
      const s = createScope();
      scopes.push(s);
      return s;
    },
    get live() {
      return scopes.reduce((n, s) => n + s.live, 0);
    },
    disposeAll() {
      const errors: unknown[] = [];
      for (let i = scopes.length - 1; i >= 0; i--) {
        try {
          (scopes[i] as Scope).dispose();
        } catch (err) {
          errors.push(...(err instanceof AggregateError ? err.errors : [err]));
        }
      }
      if (errors.length > 0) throw new AggregateError(errors, `${errors.length} disposer(s) failed`);
    },
  };
}
