import { useState } from 'react';
import type { ReactNode } from 'react';

type CopyState = 'idle' | 'copied' | 'failed';

interface Props {
  link: string;
  // Etiqueta accesible del campo que muestra el enlace.
  label: string;
  // Aviso que acompaña al enlace (qué es y por qué hay que guardarlo o entregarlo).
  notice: ReactNode;
  className?: string;
}

// Muestra un enlace completo y seleccionable aunque el navegador no tenga portapapeles, con botón "Copiar".
// Lo usan el enlace de gestión del cliente (spec 005 RF-20) y el de activación del trabajador (spec 009 RF-11).
export default function CopyLinkBox({ link, label, notice, className = 'pub-link-box' }: Props) {
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
    <div className={className}>
      <p className="pub-warning">{notice}</p>
      <label>
        {label}
        <input readOnly value={link} onFocus={e => e.currentTarget.select()} />
      </label>
      <button type="button" onClick={handleCopy}>Copiar enlace</button>
      <p className="pub-note" role="status">
        {copy === 'copied' && '¡Enlace copiado!'}
        {copy === 'failed' && 'No pudimos copiar el enlace automáticamente. Selecciónalo y cópialo a mano.'}
      </p>
    </div>
  );
}
