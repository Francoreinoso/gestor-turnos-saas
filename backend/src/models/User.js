'use strict';

const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const User = sequelize.define('User', {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    account_id: { type: DataTypes.UUID, allowNull: false },
    name: { type: DataTypes.STRING, allowNull: false },
    email: { type: DataTypes.STRING, allowNull: false, unique: true },
    password_hash: { type: DataTypes.STRING, allowNull: false },
    role: { type: DataTypes.ENUM('owner', 'staff'), allowNull: false },
  }, { tableName: 'users', underscored: true });

  User.associate = (models) => {
    User.belongsTo(models.Account, { foreignKey: 'account_id' });
    User.hasMany(models.Appointment, { foreignKey: 'assigned_user_id', as: 'assignments' });
    User.hasMany(models.Availability, { foreignKey: 'user_id' });
  };

  return User;
};
