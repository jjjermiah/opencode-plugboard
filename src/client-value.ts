/**
 * A client-supplied value, rendered for an error message: primitives as they are, objects as `object`.
 *
 * `String()` of an object calls its `toString`, and that throws when `toString` is not callable (a null
 * prototype, or a client's `{ toString: null }`). A decoder that built a 400 with `String(client.type)` then
 * ended as an unhandled error. Client values never go through `String()` directly; this is the one place
 * that renders them (#130 property test, #390 review).
 */
export const show = (value: unknown): string => ((typeof value === "object" && value !== null) || typeof value === "function" ? "object" : String(value))
