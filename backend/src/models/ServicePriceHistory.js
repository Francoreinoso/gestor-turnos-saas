'use strict';

const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const ServicePriceHistory = sequelize.define('ServicePriceHistory', {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    service_id: { type: DataTypes.UUID, allowNull: false },
    price: { type: DataTypes.DECIMAL(10, 2), allowNull: false },
    changed_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
  }, { tableName: 'service_price_histories', underscored: true, timestamps: false });

  ServicePriceHistory.associate = (models) => {
    ServicePriceHistory.belongsTo(models.Service, { foreignKey: 'service_id' });
  };

  return ServicePriceHistory;
};
