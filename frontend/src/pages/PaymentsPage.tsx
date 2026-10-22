import { useEffect, useState } from 'react';
import AppNav from '../components/AppNav';
import ErrorNote from '../components/ErrorNote';
import PaymentsTable from '../components/PaymentsTable';
import PeriodPicker from '../components/PeriodPicker';
import SummaryCards from '../components/SummaryCards';
import { useAuth } from '../context/AuthContext';
import { paymentsService } from '../services/payments';
import { staffService } from '../services/staff';
import { ApiError } from '../services/api';
import { localPeriod, type IsoRange } from '../domain/day';
import type { PaymentsPage as PaymentsData, PaymentsSummary, StaffMember } from '../domain/types';

const LIST_LIMIT = 500;

// spec 010 RF-20..RF-25 — resumen y detalle de pagos del período. Solo lectura: los pagos nacen y se borran con el
// ciclo del turno.
export default function PaymentsPage() {
  const { user } = useAuth();
  const role = user?.role ?? 'staff';

  const [range, setRange] = useState<IsoRange>(() => localPeriod('este_mes', new Date()));
  const [employeeId, setEmployeeId] = useState('');
  const [staff, setStaff] = useState<StaffMember[]>([]);
  // El resultado guarda la consulta a la que responde: si ya no coincide con la actual, se está cargando.
  const [result, setResult] = useState<{ key: string; summary: PaymentsSummary; list: PaymentsData } | { key: string; error: string } | null>(null);

  useEffect(() => {
    if (role !== 'owner') return;
    staffService.list().then(setStaff).catch(() => {});
  }, [role]);

  const filter = role === 'owner' ? employeeId : '';
  const key = `${range.from}|${range.to}|${filter}`;

  useEffect(() => {
    let alive = true;
    const query = { ...range, ...(filter ? { employeeId: filter } : {}) };
    Promise.all([paymentsService.summary(query), paymentsService.list(query)])
      .then(([summary, list]) => { if (alive) setResult({ key, summary, list }); })
      .catch(err => { if (alive) setResult({ key, error: err instanceof ApiError ? err.message : 'error_desconocido' }); });
    return () => { alive = false; };
  }, [range, filter, key]);

  const current = result && result.key === key ? result : null;
  const loading = current === null;
  const error = current && 'error' in current ? current.error : null;
  const data = current && 'summary' in current ? current : null;

  return (
    <>
      <AppNav />
      <main className="pub-page mgmt">
        <h1>Pagos</h1>

        <PeriodPicker onChange={setRange} />

        {role === 'owner' && (
          <label className="mgmt-filter">Profesional
            <select value={employeeId} onChange={e => setEmployeeId(e.target.value)}>
              <option value="">Todos</option>
              {staff.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </label>
        )}

        {loading && <p className="pub-note">Cargando…</p>}
        <ErrorNote code={error} />

        {data && (
          <>
            <SummaryCards summary={data.summary} role={role} />
            <section aria-labelledby="pay-detail">
              <h2 id="pay-detail">Detalle</h2>
              {data.list.payments.length === 0
                ? <p className="pub-note">No hay pagos en este período.</p>
                : <PaymentsTable payments={data.list.payments} role={role} />}
              {data.list.hasMore && (
                <p role="status" className="pub-warning">Se muestran los primeros {LIST_LIMIT} pagos: hay más en este período. Acota el período para verlos.</p>
              )}
            </section>
          </>
        )}
      </main>
    </>
  );
}
