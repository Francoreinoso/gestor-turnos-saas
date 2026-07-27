'use strict';

const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const Appointment = sequelize.define('Appointment', {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    account_id: { type: DataTypes.UUID, allowNull: false },
    client_id: { type: DataTypes.UUID },
    service_id: { type: DataTypes.UUID },
    assigned_user_id: { type: DataTypes.UUID },
    scheduled_at: { type: DataTypes.DATE, allowNull: false },
    scheduled_until: { type: DataTypes.DATE, allowNull: false },
    status: {
      type: DataTypes.ENUM('bloqueado', 'agendado', 'en_progreso', 'completado', 'no_llego', 'cancelado'),
      allowNull: false,
    },
    notes: { type: DataTypes.TEXT },
  }, { tableName: 'appointments', underscored: true });

  Appointment.associate = (models) => {
    Appointment.belongsTo(models.Account, { foreignKey: 'account_id' });
    Appointment.belongsTo(models.Client, { foreignKey: 'client_id' });
    Appointment.belongsTo(models.Service, { foreignKey: 'service_id' });
    Appointment.belongsTo(models.User, { foreignKey: 'assigned_user_id', as: 'assignedUser' });
    Appointment.hasMany(models.AppointmentAccessToken, { foreignKey: 'appointment_id' });
  };

  return Appointment;
};
