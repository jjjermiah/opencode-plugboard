/** The one "settle or reject when aborted" helper that request-side code races host calls against. */

/**
 * Settles with `promise`, or rejects with `signal.reason` as soon as `signal` aborts. The promise
 * itself keeps running (it cannot be cancelled): it is always observed, so a late rejection after
 * the race was lost never becomes an unhandled rejection. A signal that is already aborted rejects
 * at once.
 */
export function raceAbort<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  promise.catch(() => {})
  if (signal.aborted) return Promise.reject(signal.reason)
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(signal.reason)
    signal.addEventListener("abort", onAbort, { once: true })
    promise.then(
      (value) => {
        signal.removeEventListener("abort", onAbort)
        resolve(value)
      },
      (error) => {
        signal.removeEventListener("abort", onAbort)
        reject(error)
      },
    )
  })
}
