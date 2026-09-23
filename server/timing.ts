export class StageTimer {
  readonly #startedAt = performance.now();
  readonly #stages: Record<string, number> = {};

  async measure<T>(name: string, operation: () => Promise<T>): Promise<T> {
    const start = performance.now();
    try {
      return await operation();
    } finally {
      this.#stages[name] = round(performance.now() - start);
    }
  }

  finish(): Record<string, number> {
    return { ...this.#stages, total: round(performance.now() - this.#startedAt) };
  }
}

function round(value: number): number {
  return Math.round(value * 10) / 10;
}
