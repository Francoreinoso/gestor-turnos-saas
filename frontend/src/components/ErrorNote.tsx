import { managementErrorMessage } from '../domain/errors';

// spec 009 RF-8 — muestra el mensaje en español de un código de la API (o un texto propio) y se anuncia a lectores de pantalla.
export default function ErrorNote({ code, message }: { code?: string | null; message?: string | null }) {
  const text = message ?? (code ? managementErrorMessage(code) : null);
  if (!text) return null;
  return <p role="alert" className="pub-error">{text}</p>;
}
