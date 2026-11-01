export interface ServiceKey<T> {
  readonly name: string;
  /** Phantom field carrying the service type; never set at runtime. */
  readonly __type?: T;
}

export function createServiceKey<T>(name: string): ServiceKey<T> {
  return { name };
}

export interface Services {
  provide<T>(key: ServiceKey<T>, value: T): void;
  get<T>(key: ServiceKey<T>): T;
  has<T>(key: ServiceKey<T>): boolean;
}

export function createServices(): Services {
  const map = new Map<ServiceKey<unknown>, unknown>();
  return {
    provide(key, value) {
      if (map.has(key)) throw new Error(`Service "${key.name}" is already provided`);
      map.set(key, value);
    },
    get(key) {
      if (!map.has(key)) {
        const names = [...map.keys()].map((k) => k.name).join(', ') || '(none)';
        throw new Error(`Service "${key.name}" is not provided. Provided: ${names}`);
      }
      return map.get(key) as never;
    },
    has(key) {
      return map.has(key);
    },
  };
}
