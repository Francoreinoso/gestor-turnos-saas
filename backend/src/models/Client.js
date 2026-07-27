'use strict';

const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const Client = sequelize.define('Client', {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    account_id: { type: DataTypes.UUID, allowNull: false },
    name: { type: DataTypes.STRING, allowNull: false },
    notes: { type: DataTypes.TEXT },
    email: { type: DataTypes.STRING },
    phone: { type: DataTypes.STRING },
  }, { tableName: 'clients', underscored: true });

  Client.associate = (models) => {
    Client.belongsTo(models.Account, { foreignKey: 'account_id' });
    Client.hasMany(models.Appointment, { foreignKey: 'client_id' });
  };

  return Client;
};
