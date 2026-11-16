export const SIGNAL_WEIGHTS = Object.freeze({ votes: 5, listens: 8, opens: 3 });

export function chartSignalScore({ votes = 0, recentListens = 0, recentOpens = 0 } = {}) {
  const count = value => {
    if (Number.isSafeInteger(value) && value >= 0) return value;
    console.warn("Chart signal ignored an invalid activity count.");
    return 0;
  };
  return count(votes) * SIGNAL_WEIGHTS.votes
    + count(recentListens) * SIGNAL_WEIGHTS.listens
    + count(recentOpens) * SIGNAL_WEIGHTS.opens;
}
