export function membershipAnniversary(joinedAt, now = new Date()) {
  const joined = new Date(joinedAt);
  if (!joinedAt || !Number.isFinite(joined.getTime()) || !Number.isFinite(now.getTime())) {
    throw new Error("Cannot determine membership anniversary from an invalid date");
  }
  if (joined > now) return null;
  const year = now.getUTCFullYear();
  const joinedYear = joined.getUTCFullYear();
  const years = year - joinedYear;
  if (years < 1) return null;
  const month = joined.getUTCMonth();
  const day = Math.min(joined.getUTCDate(), new Date(Date.UTC(year, month + 1, 0)).getUTCDate());
  if (now.getUTCMonth() !== month || now.getUTCDate() !== day) return null;
  return {
    years,
    message: `Happy HALO anniversary! Thank you for being part of our music community for ${years} ${years === 1 ? "year" : "years"}.`
  };
}
