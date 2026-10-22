import { formatMoney, summaryCards } from '../domain/payments';
import type { PaymentsSummary, Role } from '../domain/types';

// spec 010 RF-21, RF-22 — tarjetas del resumen y, para el owner, el desglose por profesional.
export default function SummaryCards({ summary, role }: { summary: PaymentsSummary; role: Role }) {
  return (
    <>
      <dl className="pay-cards" aria-label="Resumen del período">
        {summaryCards(summary, role).map(c => (
          <div key={c.key} className="pay-card">
            <dt>{c.label}</dt>
            <dd>{c.value}</dd>
          </div>
        ))}
      </dl>
      {role === 'owner' && summary.byEmployee && summary.byEmployee.length > 0 && (
        <section aria-labelledby="by-employee">
          <h2 id="by-employee">Por profesional</h2>
          <ul className="pub-list">
            {summary.byEmployee.map(e => (
              <li key={e.employeeId} className="mgmt-row">
                <div className="mgmt-row-main">
                  <strong>{e.employeeName}</strong>
                  <span>Cobrado {formatMoney(e.totalAmount)} · Parte del profesional {formatMoney(e.employeeAmount)} · Parte del negocio {formatMoney(e.businessAmount)}</span>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}
