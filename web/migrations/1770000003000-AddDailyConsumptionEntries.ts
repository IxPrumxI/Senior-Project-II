import { MigrationInterface, QueryRunner } from "typeorm";

export class AddDailyConsumptionEntries1770000003000 implements MigrationInterface {
  name = "AddDailyConsumptionEntries1770000003000";

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE TABLE daily_consumption_entries (
      entry_id INT UNSIGNED NOT NULL AUTO_INCREMENT,
      user_id INT UNSIGNED NOT NULL,
      entry_date DATE NOT NULL,
      units_consumed DECIMAL(10,2) NOT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (entry_id), UNIQUE KEY uq_daily_entry_user_date (user_id, entry_date),
      KEY idx_daily_entry_user_date (user_id, entry_date),
      CONSTRAINT fk_daily_entry_user FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE,
      CONSTRAINT chk_daily_entry_units_nonneg CHECK (units_consumed >= 0)
    ) ENGINE=InnoDB`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query("DROP TABLE daily_consumption_entries");
  }
}
