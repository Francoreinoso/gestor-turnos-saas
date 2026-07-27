'use strict';

const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const Service = sequelize.define('Service', {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    account_id: { type: DataTypes.UUID, allowNull: false },
    name: { type: DataTypes.STRING, allowNull: false },
    duration_minutes: { type: DataTypes.INTEGER, allowNull: false },
    price: { type: DataTypes.DECIMAL(10, 2), allowNull: false },
    active: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
  }, { tableName: 'services', underscored: true });

  Service.associate = (models) => {
    Service.belongsTo(models.Account, { foreignKey: 'account_id' });
    Service.hasMany(models.Appointment, { foreignKey: 'service_id' });
    Service.hasMany(models.ServicePriceHistory, { foreignKey: 'service_id' });
  };

  return Service;
};
