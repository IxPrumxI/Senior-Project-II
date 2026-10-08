-- Smart System for Analyzing and Predicting Electricity Consumption
-- MySQL 8.x schema (derived from the ER diagram in the Senior Project I report).
-- Weekly records: the report's data-entry use case (UC-03) is weekly, so records
-- are keyed by the week start date (Monday).

CREATE DATABASE IF NOT EXISTS smart_electricity
  CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE smart_electricity;

CREATE TABLE IF NOT EXISTS users (
  user_id        INT UNSIGNED NOT NULL AUTO_INCREMENT,
  full_name      VARCHAR(100) NOT NULL,
  email          VARCHAR(255) NOT NULL,
  password_hash  VARCHAR(255) NOT NULL,
  price_per_kwh  DECIMAL(6,4) NOT NULL DEFAULT 0.1800, -- SAR/kWh, user-editable tariff
  tariff_mode    ENUM('tiered','flat_override') NOT NULL DEFAULT 'tiered',
  tier_limit_kwh DECIMAL(10,2) NOT NULL DEFAULT 6000.00,
  high_rate_per_kwh DECIMAL(6,4) NOT NULL DEFAULT 0.3000,
  created_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id),
  UNIQUE KEY uq_users_email (email)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS consumption_records (
  record_id       INT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id         INT UNSIGNED NOT NULL,
  week_start      DATE NOT NULL,                 -- Monday of the week
  units_consumed  DECIMAL(10,2) NOT NULL,        -- kWh
  bill_amount     DECIMAL(10,2) NULL,            -- optional, if the user knows it
  created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (record_id),
  UNIQUE KEY uq_user_week (user_id, week_start),
  CONSTRAINT fk_cons_user FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE,
  CONSTRAINT chk_units_nonneg CHECK (units_consumed >= 0)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS prediction_results (
  prediction_id     INT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id           INT UNSIGNED NOT NULL,
  prediction_month  DATE NOT NULL,               -- first day of the predicted month
  predicted_units   DECIMAL(10,2) NOT NULL,
  predicted_bill    DECIMAL(10,2) NOT NULL,
  generated_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (prediction_id),
  UNIQUE KEY uq_prediction_user_month (user_id, prediction_month),
  KEY idx_pred_user (user_id, generated_at),
  CONSTRAINT fk_pred_user FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS alerts (
  alert_id    INT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id     INT UNSIGNED NOT NULL,
  alert_type  VARCHAR(50) NOT NULL,              -- e.g. ABOVE_AVERAGE
  message     VARCHAR(500) NOT NULL,
  created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (alert_id),
  KEY idx_alert_user (user_id, created_at),
  CONSTRAINT fk_alert_user FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
) ENGINE=InnoDB;
