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

// spec 009 RF-1: vista de usuario que sale por HTTP (sin password_hash).
export type StaffStatus = 'pendiente' | 'activo' | 'inactivo';

export interface StaffMember extends User {
  status: StaffStatus;
  commission_rate: string | null;
}

// spec 009 RF-21: invitar o reenviar devuelve además el enlace de activación (solo al owner).
export interface InvitationResult {
  user: StaffMember;
  invitation_link: string;
  action?: 'create' | 'reactivate' | 'resend';
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

// spec 010 RF-20..RF-24 — pagos. El resumen trae números; el detalle, montos decimales como texto.
export interface EmployeeSummary {
  employeeId: string;
  employeeName: string;
  totalAmount: number;
  employeeAmount: number;
  businessAmount: number;
}

export interface PaymentsSummary {
  totalAmount: number;
  employeeAmount: number;
  businessAmount: number;
  paymentCount: number;
  byEmployee?: EmployeeSummary[]; // solo para el owner
}

export interface Payment {
  id: string;
  appointmentId: string;
  scheduledAt: string;
  employeeId: string | null;
  employeeName: string | null;
  clientName: string | null;
  serviceName: string | null;
  amount: string;
  employeeAmount: string | null; // null = sin comisión definida
  businessAmount: string | null;
}

export interface PaymentsPage {
  payments: Payment[];
  hasMore: boolean;
}
