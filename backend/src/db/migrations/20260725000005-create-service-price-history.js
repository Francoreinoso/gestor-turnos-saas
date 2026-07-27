'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('service_price_histories', {
      id: { type: Sequelize.UUID, defaultValue: Sequelize.UUIDV4, primaryKey: true },
      service_id: {
        type: Sequelize.UUID,
        allowNull: false,
        references: { model: 'services', key: 'id' },
        onDelete: 'CASCADE',
      },
      price: { type: Sequelize.DECIMAL(10, 2), allowNull: false },
      changed_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') },
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('service_price_histories');
  },
};
