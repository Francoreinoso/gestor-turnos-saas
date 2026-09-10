import { resolveCommission } from '../domain/resolveCommission.js';

export async function createPayment(db, appointment, repos) {
  const [service, user, account] = await Promise.all([
    repos.services.findById(db, appointment.service_id, appointment.account_id),
    appointment.assigned_user_id ? repos.users.findById(db, appointment.assigned_user_id) : null,
    repos.accounts.findById(db, appointment.account_id),
  ]);

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
