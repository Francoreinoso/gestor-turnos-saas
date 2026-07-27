'use strict';

const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const AppointmentAccessToken = sequelize.define('AppointmentAccessToken', {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    appointment_id: { type: DataTypes.UUID, allowNull: false },
    token_hash: { type: DataTypes.STRING(64), allowNull: false },
    expires_at: { type: DataTypes.DATE, allowNull: false },
  }, { tableName: 'appointment_access_tokens', underscored: true });

  AppointmentAccessToken.associate = (models) => {
    AppointmentAccessToken.belongsTo(models.Appointment, { foreignKey: 'appointment_id' });
  };

  return AppointmentAccessToken;
};
