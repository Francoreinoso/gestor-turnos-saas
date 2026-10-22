import type { AppointmentStatus } from './types';

// Formas de las respuestas de la API pública (spec 005). Solo lo que el backend expone por lista blanca.
export interface PublicService {
  id: string;
  name: string;
  duration_minutes: number;
  price: string;
}

export interface PublicProfessional {
  id: string;
  name: string;
}

export interface PublicAccount {
  id: string;
  business_name: string;
  services: PublicService[];
  professionals: PublicProfessional[];
}

export interface Slot {
  employee_id: string;
  starts_at: string;
  ends_at: string;
}

export interface PublicAppointment {
  id: string;
  account_id: string;
  status: AppointmentStatus;
  scheduled_at: string;
  scheduled_until: string;
  service: PublicService | null;
  professional: PublicProfessional | null;
  business_name: string | null;
}

// Respuesta de POST /public/bookings y de PATCH .../reschedule.
export interface BookingResult {
  appointment: {
    id: string;
    status: AppointmentStatus;
    scheduled_at: string;
    scheduled_until: string;
    assigned_user_id: string | null;
    service_id: string | null;
  };
  access_token: string;
}
