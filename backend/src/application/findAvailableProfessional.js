// ponytail: O(n) over professionals — acceptable for typical business size (< 20 staff)
export const findAvailableProfessional = async (db, { accountId, scheduledAt, scheduledUntil }, repos) => {
  const dayOfWeek = scheduledAt.getDay();
  const startTime = scheduledAt.toTimeString().slice(0, 8); // HH:MM:SS
  const endTime = scheduledUntil.toTimeString().slice(0, 8);

  // Business-wide block takes precedence — if one exists, nobody is available
  const businessBlock = await repos.appointments.findBusinessBlock(db, accountId, scheduledAt, scheduledUntil);
  if (businessBlock) return null;

  const candidates = await repos.users.findWithAvailability(db, accountId);

  for (const user of candidates) {
    const available = user.availability?.some(a =>
      a.day_of_week === dayOfWeek &&
      a.start_time <= startTime &&
      a.end_time >= endTime
    );
    if (!available) continue;

    const conflict = await repos.appointments.findUserConflict(db, accountId, user.id, scheduledAt, scheduledUntil);
    if (!conflict) return user;
  }

  return null;
};
