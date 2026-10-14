import { MigrationInterface, QueryRunner } from "typeorm";

export class AddInvoiceCycle1770000002000 implements MigrationInterface {
  name = "AddInvoiceCycle1770000002000";

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query("ALTER TABLE users ADD COLUMN invoice_day TINYINT UNSIGNED NOT NULL DEFAULT 1");
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query("ALTER TABLE users DROP COLUMN invoice_day");
  }
}
