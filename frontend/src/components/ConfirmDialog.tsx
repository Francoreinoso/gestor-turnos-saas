import { useEffect, useId, useRef } from 'react';
import type { ReactNode } from 'react';

interface Props {
  title: string;
  children: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
}

// spec 009 RF-7, RF-14, RF-19 — confirmación modal. Foco inicial en "Cancelar" (la opción segura), Escape cancela
// y Tab no sale del diálogo.
export default function ConfirmDialog({ title, children, confirmLabel = 'Confirmar', cancelLabel = 'Cancelar', onConfirm, onCancel }: Props) {
  const titleId = useId();
  const bodyId = useId();
  const cancelRef = useRef<HTMLButtonElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    cancelRef.current?.focus();
    return () => previous?.focus?.();
  }, []);

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Escape') {
      e.stopPropagation();
      onCancel();
    } else if (e.key === 'Tab') {
      const first = cancelRef.current;
      const last = confirmRef.current;
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last?.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus(); }
    }
  }

  return (
    <div className="mgmt-overlay">
      <div role="alertdialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={bodyId} className="mgmt-dialog" onKeyDown={handleKeyDown}>
        <h2 id={titleId}>{title}</h2>
        <div id={bodyId}>{children}</div>
        <div className="pub-actions">
          <button type="button" ref={cancelRef} className="pub-secondary" onClick={onCancel}>{cancelLabel}</button>
          <button type="button" ref={confirmRef} className="pub-danger" onClick={onConfirm}>{confirmLabel}</button>
        </div>
      </div>
    </div>
  );
}
