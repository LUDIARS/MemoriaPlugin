/** Serialize transitions and requests; a failed call does not poison the next operation. */
export class SerialOperation {
  private tail: Promise<unknown> = Promise.resolve();
  run<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.tail.then(operation);
    // The caller receives the original rejection; only the internal queue absorbs it.
    this.tail = result.then(() => undefined, () => undefined);
    return result;
  }
}
