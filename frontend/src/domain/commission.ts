// spec 009 RF-10, RF-12 — la comisión se escribe en % (0–100) y viaja como fracción 0–1 (Q2). Vacío = la de la cuenta (null).

// '25' → 0.25 · '12,5' → 0.125 · '' → null. Lanza si no es un número entre 0 y 100 con hasta dos decimales.
export function percentToFraction(input: string): number | null {
  const text = input.trim().replace(',', '.');
  if (text === '') return null;
  if (!/^\d+(\.\d{1,2})?$/.test(text)) throw new Error('invalid_commission');
  const percent = Number(text);
  if (percent > 100) throw new Error('invalid_commission');
  return Number((percent / 100).toFixed(4));
}

// '0.2500' → '25' · null → ''
export function fractionToPercent(rate: string | number | null | undefined): string {
  if (rate === null || rate === undefined || rate === '') return '';
  return String(Number((Number(rate) * 100).toFixed(2)));
}
