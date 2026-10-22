import { useState } from 'react';

type CopyState = 'idle' | 'copied' | 'failed';

// RF-20 / RF-28: el enlace de gestión es la única forma de cancelar o reprogramar; se muestra completo
// y seleccionable aunque el navegador no tenga portapapeles.
export default function ManageLinkBox({ link }: { link: string }) {
  const [copy, setCopy] = useState<CopyState>('idle');

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(link);
      setCopy('copied');
    } catch {
      setCopy('failed');
    }
  }

  return (
    <div className="pub-link-box">
      <p className="pub-warning">
        <strong>Guarda este enlace.</strong> Es la única forma de cancelar o reprogramar tu turno: no te lo enviamos por otro medio.
      </p>
      <label>
        Enlace para gestionar tu turno
        <input readOnly value={link} onFocus={e => e.currentTarget.select()} />
      </label>
      <button type="button" onClick={handleCopy}>Copiar enlace</button>
      <p className="pub-note" role="status">
        {copy === 'copied' && '¡Enlace copiado!'}
        {copy === 'failed' && 'No pudimos copiar el enlace automáticamente. Seleccionalo y copialo a mano.'}
      </p>
    </div>
  );
}
