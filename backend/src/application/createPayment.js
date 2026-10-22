import { resolveCommission } from '../domain/resolveCommission.js';

export async function createPayment(db, appointment, repos) {
  // spec 008 RF-20: lecturas en secuencia. Esta función corre sobre el cliente de una transacción y pg no admite
  // consultas simultáneas sobre un mismo cliente (hoy advierte; en pg@9 dejará de funcionar).
  const service = await repos.services.findById(db, appointment.service_id, appointment.account_id);
  const user = appointment.assigned_user_id ? await repos.users.findById(db, appointment.assigned_user_id) : null;
  const account = await repos.accounts.findById(db, appointment.account_id);

  const { rate, employeeAmount, businessAmount } = resolveCommission(
    service.price,
    user?.commission_rate,
    account.commission_rate,
  );

  return repos.payments.create(db, {
    appointment_id: appointment.id,
    account_id: appointment.account_id,
    assigned_user_id: appointment.assigned_user_id,
    amount: service.price,
    commission_rate_applied: rate,
    employee_amount: employeeAmount,
    business_amount: businessAmount,
  });
}
