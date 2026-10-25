// Puerto de envío del código del asistente — spec 011 RF-1. Igual que el de email (spec 002 D-P5): sin proveedor
// real todavía; en desarrollo el código se lee en el log del backend. Se reemplaza por un proveedor (Twilio,
// WhatsApp, ...) sin tocar los casos de uso que lo llaman.
export const smsService = {
  sendVerificationCode: async ({ to, code, businessName }) => {
    console.log(`[sms] código del asistente de ${businessName} → ${to}: ${code}`);
  },
};
