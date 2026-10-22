// RF-35: fechas y horas en es-AR, en la zona horaria del navegador.
const LOCALE = 'es-AR';

export const formatTime = (iso: string) =>
  new Date(iso).toLocaleTimeString(LOCALE, { hour: '2-digit', minute: '2-digit', hour12: false });

export const formatDayShort = (date: Date) =>
  date.toLocaleDateString(LOCALE, { weekday: 'short', day: 'numeric', month: 'short' });

export const formatDayLong = (iso: string) =>
  new Date(iso).toLocaleDateString(LOCALE, { weekday: 'long', day: 'numeric', month: 'long' });

export const formatDateTime = (iso: string) => `${formatDayLong(iso)}, ${formatTime(iso)}`;

export const formatPrice = (price: string) =>
  Number(price).toLocaleString(LOCALE, { style: 'currency', currency: 'ARS', maximumFractionDigits: 2 });

const STATUS: Record<string, string> = {
  agendado: 'Agendado',
  en_progreso: 'En curso',
  completado: 'Completado',
  no_llego: 'No llegó',
  cancelado: 'Cancelado',
  bloqueado: 'No disponible',
};

export const statusLabel = (status: string) => STATUS[status] ?? 'Estado desconocido';
