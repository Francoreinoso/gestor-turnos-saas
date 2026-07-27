'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('clients', {
      id: { type: Sequelize.UUID, defaultValue: Sequelize.UUIDV4, primaryKey: true },
      account_id: {
        type: Sequelize.UUID,
        allowNull: false,
        references: { model: 'accounts', key: 'id' },
        onDelete: 'CASCADE',
      },
      name: { type: Sequelize.STRING, allowNull: false },
      notes: { type: Sequelize.TEXT },
      email: { type: Sequelize.STRING },
      phone: { type: Sequelize.STRING },
      created_at: { type: Sequelize.DATE, allowNull: false },
      updated_at: { type: Sequelize.DATE, allowNull: false },
    });

    // Email unique on lower() — requires a functional index, not a simple unique constraint
    await queryInterface.sequelize.query(
      'CREATE UNIQUE INDEX clients_email_unique ON clients (lower(email)) WHERE email IS NOT NULL'
    );
    await queryInterface.sequelize.query(
      'CREATE UNIQUE INDEX clients_phone_unique ON clients (phone) WHERE phone IS NOT NULL'
    );
    await queryInterface.sequelize.query(
      'ALTER TABLE clients ADD CONSTRAINT clients_contact_check CHECK (email IS NOT NULL OR phone IS NOT NULL)'
    );
  },

  async down(queryInterface) {
    await queryInterface.dropTable('clients');
  },
};
