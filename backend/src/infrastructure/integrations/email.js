// Puerto de envío de email — spec 002, D-P5: sin proveedor real todavía (contenido/plantilla
// fuera de alcance de la spec); log estructurado como implementación inicial, swappeable
// por un proveedor real (SMTP, Resend, SES, ...) sin tocar los use cases que lo llaman.
export const emailService = {
  sendInvitation: async ({ to, link }) => {
    console.log(`[email] invitación de trabajador → ${to}: ${link}`);
  },
};
