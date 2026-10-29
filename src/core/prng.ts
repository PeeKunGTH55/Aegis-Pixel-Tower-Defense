export function nextRng(state: number): { readonly value: number; readonly nextState: number } {
  const nextState = (state + 0x6d2b79f5) | 0;
  let t = Math.imul(nextState ^ (nextState >>> 15), 1 | nextState);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  const unsigned = ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  return {
    value: unsigned,
    nextState: nextState >>> 0,
  };
}

export function rngInt(
  state: number,
  minInclusive: number,
  maxInclusive: number
): { readonly result: number; readonly nextState: number } {
  const step = nextRng(state);
  const span = maxInclusive - minInclusive + 1;
  return {
    result: minInclusive + Math.floor(step.value * span),
    nextState: step.nextState,
  };
}
