import "reflect-metadata";
import { DataSource } from "typeorm";
import { config } from "./config";
import { User } from "./entities/User";

export const AppDataSource = new DataSource({
  type: "mysql",
  ...config.db,
  entities: [User],
  migrations: ["dist/migrations/*.js"],
  synchronize: false,
  migrationsTableName: "typeorm_migrations",
});
