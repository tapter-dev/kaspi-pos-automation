const ALMATY_OFFSET_MS = 6 * 60 * 60 * 1000;

const daysInMonth = (year, month) => new Date(Date.UTC(year, month + 1, 0)).getUTCDate();

const localParts = (date) => {
  const local = new Date(date.getTime() + ALMATY_OFFSET_MS);
  return {
    year: local.getUTCFullYear(),
    month: local.getUTCMonth(),
    day: local.getUTCDate(),
    hour: local.getUTCHours(),
    minute: local.getUTCMinutes(),
  };
};

const fromLocalParts = ({ year, month, day, hour, minute }) =>
  new Date(Date.UTC(year, month, day, hour, minute) - ALMATY_OFFSET_MS);

export const nextRecurringAt = (current, period, billingDay, billingTime = '09:00') => {
  const parts = localParts(new Date(current));
  const [hour, minute] = billingTime.slice(0, 5).split(':').map(Number);
  const next = { ...parts, hour, minute };
  if (period === 'daily') next.day += 1;
  if (period === 'weekly') next.day += 7;
  if (period === 'biweekly') next.day += 14;
  if (['monthly', 'quarterly', 'yearly'].includes(period)) {
    next.month += period === 'monthly' ? 1 : period === 'quarterly' ? 3 : 12;
    next.year += Math.floor(next.month / 12);
    next.month %= 12;
    next.day = Math.min(billingDay || parts.day, daysInMonth(next.year, next.month));
  }
  return fromLocalParts(next);
};

export const defaultFirstRecurringAt = (billingTime = '09:00') => {
  const now = new Date();
  const parts = localParts(now);
  const [hour, minute] = billingTime.slice(0, 5).split(':').map(Number);
  const candidate = fromLocalParts({ ...parts, hour, minute });
  if (candidate <= now) candidate.setTime(candidate.getTime() + 24 * 60 * 60 * 1000);
  return candidate;
};
