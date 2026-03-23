-- Supplemental encryption migration for existing deployments.
-- For greenfield installs, database/schema.sql already contains these changes.

ALTER TABLE users MODIFY full_name TEXT NOT NULL;
ALTER TABLE transactions MODIFY description TEXT NULL, MODIFY tags TEXT NULL, MODIFY payment_method TEXT NULL, MODIFY recurrence_rule TEXT NULL;
ALTER TABLE budgets MODIFY name TEXT NOT NULL;
ALTER TABLE investments MODIFY name TEXT NOT NULL, MODIFY symbol TEXT NULL, MODIFY meta TEXT NULL;
ALTER TABLE loans MODIFY party_name TEXT NOT NULL, ADD COLUMN IF NOT EXISTS party_name_bi CHAR(64) NULL AFTER party_name, MODIFY party_contact TEXT NULL, MODIFY purpose TEXT NULL;
ALTER TABLE ai_insights MODIFY title TEXT NOT NULL, MODIFY content LONGTEXT NOT NULL;

CREATE TABLE IF NOT EXISTS user_encryption_keys (
  id CHAR(36) NOT NULL DEFAULT (UUID()),
  user_id CHAR(36) NOT NULL,
  password_salt CHAR(32) NOT NULL,
  dek_wrapped_by_password TEXT NULL,
  dek_wrapped_by_master TEXT NULL,
  client_public_key TEXT NULL,
  client_wrapped_dek TEXT NULL,
  public_key_fingerprint CHAR(64) NULL,
  key_encryption_algorithm VARCHAR(50) NULL,
  key_version INT NOT NULL DEFAULT 1,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_uek_user (user_id),
  CONSTRAINT fk_uek_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
