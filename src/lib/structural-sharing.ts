/**
 * Returns `next`, but reuses every sub-tree of `prev` that is deeply equal to the matching
 * sub-tree of `next`. Keeps object identity stable so selector-based subscribers only re-render
 * when the data they read actually changed.
 */
export function replaceEqualDeep<T>(prev: T, next: T): T {
  if (Object.is(prev, next)) return prev;
  const prevArray = Array.isArray(prev);
  const nextArray = Array.isArray(next);
  if (prevArray && nextArray) {
    const p = prev as unknown[];
    const n = next as unknown[];
    let equal = p.length === n.length;
    const out = n.map((item, i) => {
      const shared = replaceEqualDeep(p[i], item);
      if (shared !== p[i]) equal = false;
      return shared;
    });
    return (equal ? prev : out) as T;
  }
  if (isPlainObject(prev) && isPlainObject(next)) {
    const p = prev as Record<string, unknown>;
    const n = next as Record<string, unknown>;
    const nextKeys = Object.keys(n);
    let equal = nextKeys.length === Object.keys(p).length;
    const out: Record<string, unknown> = {};
    for (const key of nextKeys) {
      const shared = replaceEqualDeep(p[key], n[key]);
      if (shared !== p[key] || !(key in p)) equal = false;
      out[key] = shared;
    }
    return (equal ? prev : out) as T;
  }
  return next;
}

function isPlainObject(value: unknown): value is object {
  if (typeof value !== "object" || value === null) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/** Recursively freezes a value so consumers cannot mutate provider state. */
export function deepFreeze<T>(value: T): T {
  if (typeof value === "object" && value !== null && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

/** Lists leaf paths (up to `maxDepth`) whose values differ between two snapshots. */
export function changedPaths(prev: unknown, next: unknown, maxDepth = 3, prefix = ""): string[] {
  if (Object.is(prev, next)) return [];
  const bothObjects =
    typeof prev === "object" && prev !== null && typeof next === "object" && next !== null;
  if (!bothObjects || maxDepth === 0 || Array.isArray(prev) || Array.isArray(next)) {
    return [prefix || "$"];
  }
  const keys = new Set([...Object.keys(prev), ...Object.keys(next)]);
  const out: string[] = [];
  for (const key of keys) {
    const path = prefix ? `${prefix}.${key}` : key;
    out.push(
      ...changedPaths(
        (prev as Record<string, unknown>)[key],
        (next as Record<string, unknown>)[key],
        maxDepth - 1,
        path,
      ),
    );
  }
  return out;
}
