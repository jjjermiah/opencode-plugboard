/**
 * Type helpers for checking plugboard's wire output against the official SDK types (#132).
 *
 * Two checks per golden (see `wire.ts`):
 *   - `satisfies Wire<T>`: every field plugboard sends exists in the SDK type with a compatible
 *     value (an object literal's excess property check catches renamed or invented fields). Fields
 *     may be absent, and `null` stands in for an absent optional field, as these APIs send it.
 *   - `exact<T>(golden)`: the golden is assignable to the SDK type itself, so required fields that
 *     plugboard omits show up. Known gaps carry a `@ts-expect-error` naming them; when plugboard (or
 *     the SDK) closes a gap, the now-unused directive fails the type check and must be removed.
 */

/** What the wire may hold for an SDK type: any subset of its fields, recursively; `null` for absent. String enums become their values. */
export type Wire<T> = T extends string
  ? `${T}`
  : T extends ReadonlyArray<infer U>
    ? Array<Wire<U>>
    : T extends (...args: never[]) => unknown
      ? never
      : T extends object
        ? { [K in keyof T]?: Wire<T[K]> | null }
        : T

/** The SDK type with string enums as their values and nothing else changed (the Gemini SDK types wire strings as TS enums). */
export type Unenum<T> = T extends string
  ? `${T}`
  : T extends ReadonlyArray<infer U>
    ? Array<Unenum<U>>
    : T extends (...args: never[]) => unknown
      ? T
      : T extends object
        ? { [K in keyof T]: Unenum<T[K]> }
        : T

/** Assignability to the SDK type itself (no excess property check: the value is not a literal here). */
export const exact = <T>(value: T): T => value
