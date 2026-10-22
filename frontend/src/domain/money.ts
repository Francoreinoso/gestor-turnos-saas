// spec 009 RF-5, RF-6 — el precio se escribe en pesos chilenos, sin decimales ('8000' u '8.000'). R2: no se adivina.
export const PRICE_HINT = 'Escribe el precio en pesos, sin decimales (por ejemplo 8000 o 8.000).';

// Devuelve el decimal que espera la API ('8000') o lanza si el texto no es un monto en CLP sin decimales.
export function parsePrice(input: string): string {
  const text = input.trim().replace(/^\$\s*/, '');
  if (/^\d+$/.test(text)) return String(Number(text));
  if (/^\d{1,3}(\.\d{3})+$/.test(text)) return String(Number(text.replace(/\./g, '')));
  throw new Error('invalid_price');
}
