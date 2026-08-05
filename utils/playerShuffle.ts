type RandomSource = () => number;

export const shuffleIndices = (indices: number[], random: RandomSource = Math.random) => {
  const shuffled = [...indices];
  for (let index = shuffled.length - 1; index > 0; index--) {
    const randomIndex = Math.floor(random() * (index + 1));
    [shuffled[index], shuffled[randomIndex]] = [shuffled[randomIndex], shuffled[index]];
  }
  return shuffled;
};

export const createShuffleOrder = (
  trackCount: number,
  currentIndex: number,
  random: RandomSource = Math.random,
) => [
  currentIndex,
  ...shuffleIndices(
    Array.from({ length: trackCount }, (_, index) => index).filter(
      (index) => index !== currentIndex,
    ),
    random,
  ),
];

export const appendShuffleCycle = (
  order: number[],
  trackCount: number,
  random: RandomSource = Math.random,
) => {
  const cycle = shuffleIndices(
    Array.from({ length: trackCount }, (_, index) => index),
    random,
  );
  const lastIndex = order.at(-1);
  if (trackCount > 1 && cycle[0] === lastIndex) {
    const swapIndex = cycle.findIndex((index) => index !== lastIndex);
    [cycle[0], cycle[swapIndex]] = [cycle[swapIndex], cycle[0]];
  }
  return [...order, ...cycle];
};

export const ensureShuffleLookahead = (
  order: number[],
  position: number,
  trackCount: number,
  random: RandomSource = Math.random,
) => (order.length - position <= 1 ? appendShuffleCycle(order, trackCount, random) : order);
