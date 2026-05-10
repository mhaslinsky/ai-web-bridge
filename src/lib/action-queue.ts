type Task<T> = () => Promise<T>;

/** Serializes async tasks FIFO; a failing task does not block the next one. */
export class ActionQueue {
  private chain: Promise<unknown> = Promise.resolve();

  /** Enqueue `task`; resolves with its result (or rejects with its error) after all earlier tasks settle. */
  run<T>(task: Task<T>): Promise<T> {
    const next = this.chain.then(() => task(), () => task());
    this.chain = next.catch(() => undefined);
    return next;
  }
}
