type Task<T> = () => Promise<T>;

export class ActionQueue {
  private chain: Promise<unknown> = Promise.resolve();

  run<T>(task: Task<T>): Promise<T> {
    const next = this.chain.then(() => task(), () => task());
    this.chain = next.catch(() => undefined);
    return next;
  }
}
