/** Unix seconds. Injected so tests can freeze time instead of sleeping. */
export interface Clock {
  now(): number;
}

export const systemClock: Clock = {
  now: () => Math.floor(Date.now() / 1000),
};

export function frozenClock(at: number): Clock & { set(to: number): void } {
  let current = at;

  return {
    now: () => current,
    set: (to: number) => {
      current = to;
    },
  };
}
