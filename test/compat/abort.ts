/**
 * Shared by the matrix clients (#101 cancellation): the server saw the client's abort.
 */
import type { Target } from "./clients.js"

/** The signal of the last model call fired, within a second. Fails the case otherwise. */
export async function serverSawAbort(target: Target): Promise<void> {
  const call = target.caller.calls.at(-1)!
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    await Promise.race([
      call.aborted,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("the server did not see the client's abort")), 1000)
      }),
    ])
  } finally {
    clearTimeout(timer)
  }
}
