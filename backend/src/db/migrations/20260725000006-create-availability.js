'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('availability', {
      id: { type: Sequelize.UUID, defaultValue: Sequelize.UUIDV4, primaryKey: true },
      user_id: {
        type: Sequelize.UUID,
        allowNull: false,
        references: { model: 'users', key: 'id' },
        onDelete: 'CASCADE',
      },
      // ponytail: weekly recurrence only — exception dates (holidays, vacation) are a future feature
      day_of_week: { type: Sequelize.INTEGER, allowNull: false }, // 0=Sunday, 6=Saturday
      start_time: { type: Sequelize.TIME, allowNull: false },
      end_time: { type: Sequelize.TIME, allowNull: false },
      created_at: { type: Sequelize.DATE, allowNull: false },
      updated_at: { type: Sequelize.DATE, allowNull: false },
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('availability');
  },
};
