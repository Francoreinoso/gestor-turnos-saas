export type Role = 'owner' | 'staff';

export type AppointmentStatus =
  | 'bloqueado'
  | 'agendado'
  | 'en_progreso'
  | 'completado'
  | 'no_llego'
  | 'cancelado';

export interface User {
  id: string;
  account_id: string;
  name: string;
  email: string;
  role: Role;
}

export interface Client {
  id: string;
  account_id: string;
  name: string;
  email: string | null;
  phone: string | null;
  notes: string | null;
}

export interface Service {
  id: string;
  account_id: string;
  name: string;
  duration_minutes: number;
  price: string;
  active: boolean;
}

export interface Appointment {
  id: string;
  account_id: string;
  client_id: string | null;
  service_id: string | null;
  assigned_user_id: string | null;
  scheduled_at: string;
  scheduled_until: string;
  status: AppointmentStatus;
  notes: string | null;
  client?: Pick<Client, 'id' | 'name' | 'email' | 'phone'>;
  service?: Pick<Service, 'id' | 'name' | 'duration_minutes' | 'price'>;
  assignedUser?: Pick<User, 'id' | 'name'>;
}

export interface AuthPayload {
  id: string;
  account_id: string;
  role: Role;
}
