'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('appointment_access_tokens', {
      id: { type: Sequelize.UUID, defaultValue: Sequelize.UUIDV4, primaryKey: true },
      appointment_id: {
        type: Sequelize.UUID,
        allowNull: false,
        references: { model: 'appointments', key: 'id' },
        onDelete: 'CASCADE',
      },
      // SHA-256 of the actual token — raw token never stored
      token_hash: { type: Sequelize.STRING(64), allowNull: false },
      expires_at: { type: Sequelize.DATE, allowNull: false },
      created_at: { type: Sequelize.DATE, allowNull: false },
      updated_at: { type: Sequelize.DATE, allowNull: false },
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('appointment_access_tokens');
  },
};
