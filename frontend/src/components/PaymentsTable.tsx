import { Link } from 'react-router-dom';
import { formatDateTime } from '../domain/format';
import { NO_COMMISSION, paymentRow } from '../domain/payments';
import type { Payment, Role } from '../domain/types';

// spec 010 RF-23, RF-24 — detalle de pagos, solo lectura. En pantallas angostas cada fila se vuelve una tarjeta.
export default function PaymentsTable({ payments, role }: { payments: Payment[]; role: Role }) {
  return (
    <table className="pay-table">
      <caption className="pub-visually-hidden">Detalle de pagos del período</caption>
      <thead>
        <tr>
          <th scope="col">Fecha</th>
          <th scope="col">Cliente</th>
          <th scope="col">Servicio</th>
          {role === 'owner' && <th scope="col">Profesional</th>}
          <th scope="col">Monto</th>
          <th scope="col">Parte del profesional</th>
          <th scope="col">Parte del negocio</th>
        </tr>
      </thead>
      <tbody>
        {payments.map(p => {
          const row = paymentRow(p);
          return (
            <tr key={row.id}>
              <td data-label="Fecha">{formatDateTime(row.date)}</td>
              <td data-label="Cliente">{row.client}</td>
              <td data-label="Servicio">{row.service}</td>
              {role === 'owner' && <td data-label="Profesional">{row.employee}</td>}
              <td data-label="Monto">{row.amount}</td>
              <td data-label="Parte del profesional">
                {row.missingCommission
                  ? <>{NO_COMMISSION}{role === 'owner' && <> · <Link to="/owner/equipo">Definir en Equipo</Link></>}</>
                  : row.employeeAmount}
              </td>
              <td data-label="Parte del negocio">{row.businessAmount ?? '—'}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
