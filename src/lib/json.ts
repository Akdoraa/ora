/**
 * Deep-convert a value so it is safe to store in a jsonb column or send over
 * the wire: bigint -> string, undefined dropped, Dates -> ISO strings.
 */
export function toJsonb<T = Record<string, unknown>>(value: unknown): T {
  return JSON.parse(
    JSON.stringify(value, (_k, v) => {
      if (typeof v === "bigint") return v.toString();
      return v;
    }),
  ) as T;
}
