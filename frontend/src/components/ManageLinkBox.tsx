import CopyLinkBox from './CopyLinkBox';

// RF-20 / RF-28: el enlace de gestión es la única forma de cancelar o reprogramar.
export default function ManageLinkBox({ link }: { link: string }) {
  return (
    <CopyLinkBox
      link={link}
      label="Enlace para gestionar tu turno"
      notice={<><strong>Guarda este enlace.</strong> Es la única forma de cancelar o reprogramar tu turno: no te lo enviamos por otro medio.</>}
    />
  );
}
