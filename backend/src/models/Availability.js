'use strict';

const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const Availability = sequelize.define('Availability', {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    user_id: { type: DataTypes.UUID, allowNull: false },
    day_of_week: { type: DataTypes.INTEGER, allowNull: false }, // 0=Sunday, 6=Saturday
    start_time: { type: DataTypes.TIME, allowNull: false },
    end_time: { type: DataTypes.TIME, allowNull: false },
  }, { tableName: 'availability', underscored: true });

  Availability.associate = (models) => {
    Availability.belongsTo(models.User, { foreignKey: 'user_id' });
  };

  return Availability;
};
