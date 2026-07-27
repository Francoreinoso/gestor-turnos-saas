'use strict';

const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const Account = sequelize.define('Account', {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    business_name: { type: DataTypes.STRING, allowNull: false },
  }, { tableName: 'accounts', underscored: true });

  Account.associate = (models) => {
    Account.hasMany(models.User, { foreignKey: 'account_id' });
    Account.hasMany(models.Client, { foreignKey: 'account_id' });
    Account.hasMany(models.Service, { foreignKey: 'account_id' });
    Account.hasMany(models.Appointment, { foreignKey: 'account_id' });
  };

  return Account;
};
