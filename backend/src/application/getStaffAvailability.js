import { formatTime } from '../domain/availabilityWindows.js';
import { findScopedStaff } from './findScopedStaff.js';

export const toApiWindow = ({ day_of_week, start_time, end_time }) => ({
  day_of_week,
  start_time: formatTime(start_time),
  end_time: formatTime(end_time),
});

// spec 004 — consultar el horario semanal de un trabajador: RF-1, RF-2, RF-13..RF-15.
export const getStaffAvailability = async (db, { id, accountId, actor }, repos) => {
  await findScopedStaff(db, { id, accountId, actor }, repos);
  const windows = await repos.availability.findByUser(db, id);
  return windows.map(toApiWindow);
};
