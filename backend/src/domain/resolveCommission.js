export function resolveCommission(amountStr, userRate, accountRate) {
  const rate = userRate ?? accountRate ?? null;
  if (rate === null) return { rate: null, employeeAmount: null, businessAmount: null };
  // integer math to avoid floating-point drift
  const cents = Math.round(Number(amountStr) * 100);
  const empCents = Math.round(cents * Number(rate));
  return {
    rate,
    employeeAmount: (empCents / 100).toFixed(2),
    businessAmount: ((cents - empCents) / 100).toFixed(2),
  };
}
