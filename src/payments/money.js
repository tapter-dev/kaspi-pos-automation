export const toMinorUnits = (amount) => {
  if (!Number.isFinite(amount)) return null;
  const scaled = amount * 100;
  const rounded = Math.round(scaled);
  return Math.abs(scaled - rounded) <= 1e-8 ? rounded : null;
};
