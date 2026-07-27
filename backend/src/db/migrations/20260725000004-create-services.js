'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('services', {
      id: { type: Sequelize.UUID, defaultValue: Sequelize.UUIDV4, primaryKey: true },
      account_id: {
        type: Sequelize.UUID,
        allowNull: false,
        references: { model: 'accounts', key: 'id' },
        onDelete: 'CASCADE',
      },
      name: { type: Sequelize.STRING, allowNull: false },
      duration_minutes: { type: Sequelize.INTEGER, allowNull: false },
      price: { type: Sequelize.DECIMAL(10, 2), allowNull: false },
      active: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: true },
      created_at: { type: Sequelize.DATE, allowNull: false },
      updated_at: { type: Sequelize.DATE, allowNull: false },
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('services');
  },
};
