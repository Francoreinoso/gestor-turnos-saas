'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('appointments', {
      id: { type: Sequelize.UUID, defaultValue: Sequelize.UUIDV4, primaryKey: true },
      // Denormalized intentionally — avoids extra joins on frequent availability/listing queries
      account_id: {
        type: Sequelize.UUID,
        allowNull: false,
        references: { model: 'accounts', key: 'id' },
        onDelete: 'CASCADE',
      },
      client_id: {
        type: Sequelize.UUID,
        references: { model: 'clients', key: 'id' },
        onDelete: 'SET NULL',
      },
      service_id: {
        type: Sequelize.UUID,
        references: { model: 'services', key: 'id' },
        onDelete: 'SET NULL',
      },
      // NULL means whole-business block when status='bloqueado'
      assigned_user_id: {
        type: Sequelize.UUID,
        references: { model: 'users', key: 'id' },
        onDelete: 'SET NULL',
      },
      scheduled_at: { type: Sequelize.DATE, allowNull: false },
      scheduled_until: { type: Sequelize.DATE, allowNull: false },
      status: {
        type: Sequelize.ENUM('bloqueado', 'agendado', 'en_progreso', 'completado', 'no_llego', 'cancelado'),
        allowNull: false,
      },
      notes: { type: Sequelize.TEXT },
      created_at: { type: Sequelize.DATE, allowNull: false },
      updated_at: { type: Sequelize.DATE, allowNull: false },
    });

    // Conditional nullability: bloqueado rows have no client/service; all others must have both + assigned user
    await queryInterface.sequelize.query(`
      ALTER TABLE appointments ADD CONSTRAINT appointments_nullable_fields_check CHECK (
        (status = 'bloqueado' AND client_id IS NULL AND service_id IS NULL)
        OR
        (status != 'bloqueado' AND client_id IS NOT NULL AND service_id IS NOT NULL AND assigned_user_id IS NOT NULL)
      )
    `);

    // Overlap prevention via trigger — EXCLUSION CONSTRAINT can't handle the OR logic needed
    // for business-wide blocks (NULL assigned_user_id conflicts with everything)
    await queryInterface.sequelize.query(`
      CREATE OR REPLACE FUNCTION check_appointment_overlap()
      RETURNS TRIGGER AS $$
      BEGIN
        IF EXISTS (
          SELECT 1 FROM appointments
          WHERE account_id = NEW.account_id
            AND status != 'cancelado'
            AND id != NEW.id
            AND (
              assigned_user_id = NEW.assigned_user_id
              OR assigned_user_id IS NULL
              OR NEW.assigned_user_id IS NULL
            )
            AND scheduled_at < NEW.scheduled_until
            AND NEW.scheduled_at < scheduled_until
        ) THEN
          RAISE EXCEPTION 'appointment_overlap';
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;
    `);

    await queryInterface.sequelize.query(`
      CREATE TRIGGER appointment_overlap_check
      BEFORE INSERT OR UPDATE ON appointments
      FOR EACH ROW EXECUTE FUNCTION check_appointment_overlap();
    `);
  },

  async down(queryInterface) {
    await queryInterface.sequelize.query('DROP TRIGGER IF EXISTS appointment_overlap_check ON appointments');
    await queryInterface.sequelize.query('DROP FUNCTION IF EXISTS check_appointment_overlap');
    await queryInterface.dropTable('appointments');
    await queryInterface.sequelize.query('DROP TYPE IF EXISTS "enum_appointments_status"');
  },
};
