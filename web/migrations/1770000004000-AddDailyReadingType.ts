import { MigrationInterface, QueryRunner } from "typeorm";

export class AddDailyReadingType1770000004000 implements MigrationInterface {
  name = "AddDailyReadingType1770000004000";

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query("ALTER TABLE daily_consumption_entries ADD COLUMN reading_type ENUM('daily_use','meter_total') NOT NULL DEFAULT 'daily_use' AFTER units_consumed");
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query("ALTER TABLE daily_consumption_entries DROP COLUMN reading_type");
  }
}
