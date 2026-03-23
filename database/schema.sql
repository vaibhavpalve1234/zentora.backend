-- ============================================================
--  Money Control Pro — MySQL Production Schema
--  Design: Normalized, indexed, constraint-complete
-- ============================================================

SET NAMES utf8mb4;
SET time_zone = '+00:00';

-- ────────────────────────────────────────────────
-- 1. USERS
-- ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS users (
    id            CHAR(36)     NOT NULL DEFAULT (UUID()),
    email         VARCHAR(255) NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    full_name     VARCHAR(100) NOT NULL,
    currency      CHAR(3)      NOT NULL DEFAULT 'INR',
    timezone      VARCHAR(50)  NOT NULL DEFAULT 'Asia/Kolkata',
    is_active     TINYINT(1)   NOT NULL DEFAULT 1,
    created_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    PRIMARY KEY (id),
    UNIQUE  KEY uq_users_email      (email),
    INDEX        idx_users_active   (is_active),
    INDEX        idx_users_created  (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ────────────────────────────────────────────────
-- 2. REFRESH TOKENS  (JWT rotation)
-- ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS refresh_tokens (
    id         CHAR(36)     NOT NULL DEFAULT (UUID()),
    user_id    CHAR(36)     NOT NULL,
    token_hash VARCHAR(255) NOT NULL,
    expires_at DATETIME     NOT NULL,
    revoked    TINYINT(1)   NOT NULL DEFAULT 0,
    created_at DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY (id),
    INDEX idx_rt_user       (user_id),
    INDEX idx_rt_hash       (token_hash),
    INDEX idx_rt_expires    (expires_at),
    CONSTRAINT fk_rt_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ────────────────────────────────────────────────
-- 3. CATEGORIES
-- ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS categories (
    id         CHAR(36)     NOT NULL DEFAULT (UUID()),
    user_id    CHAR(36)         NULL,           -- NULL = system default
    name       VARCHAR(100) NOT NULL,
    type       ENUM('income','expense','investment','loan') NOT NULL,
    icon       VARCHAR(50)      NULL,
    color      CHAR(7)          NULL,
    created_at DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY (id),
    INDEX idx_cat_user_type (user_id, type),
    CONSTRAINT fk_cat_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ────────────────────────────────────────────────
-- 4. TRANSACTIONS
-- ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS transactions (
    id             CHAR(36)       NOT NULL DEFAULT (UUID()),
    user_id        CHAR(36)       NOT NULL,
    category_id    CHAR(36)           NULL,
    type           ENUM('income','expense') NOT NULL,
    amount         DECIMAL(15,2)  NOT NULL,
    currency       CHAR(3)        NOT NULL DEFAULT 'INR',
    description    VARCHAR(500)       NULL,
    tags           JSON               NULL,     -- ["food","dining"]
    transaction_date DATE           NOT NULL,
    payment_method ENUM('cash','upi','card','bank_transfer','other') NOT NULL DEFAULT 'upi',
    is_recurring   TINYINT(1)     NOT NULL DEFAULT 0,
    recurrence_rule VARCHAR(100)       NULL,   -- RRULE string
    created_at     DATETIME       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at     DATETIME       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    PRIMARY KEY (id),
    INDEX idx_txn_user_date     (user_id, transaction_date),
    INDEX idx_txn_user_type     (user_id, type),
    INDEX idx_txn_category      (category_id),
    INDEX idx_txn_date_range    (user_id, transaction_date, type),
    -- Composite for monthly analytics query
    INDEX idx_txn_analytics     (user_id, YEAR(transaction_date), MONTH(transaction_date), type),
    CONSTRAINT fk_txn_user     FOREIGN KEY (user_id)     REFERENCES users(id)      ON DELETE CASCADE,
    CONSTRAINT fk_txn_category FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE SET NULL,
    CONSTRAINT chk_txn_amount  CHECK (amount > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ────────────────────────────────────────────────
-- 5. BUDGETS
-- ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS budgets (
    id          CHAR(36)      NOT NULL DEFAULT (UUID()),
    user_id     CHAR(36)      NOT NULL,
    category_id CHAR(36)          NULL,
    name        VARCHAR(100)  NOT NULL,
    amount      DECIMAL(15,2) NOT NULL,
    period      ENUM('daily','weekly','monthly','yearly') NOT NULL DEFAULT 'monthly',
    start_date  DATE          NOT NULL,
    end_date    DATE              NULL,
    alert_at    TINYINT       NOT NULL DEFAULT 80,   -- % threshold
    is_active   TINYINT(1)    NOT NULL DEFAULT 1,
    created_at  DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at  DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    PRIMARY KEY (id),
    INDEX idx_budget_user        (user_id, is_active),
    INDEX idx_budget_category    (category_id),
    CONSTRAINT fk_budget_user    FOREIGN KEY (user_id)     REFERENCES users(id)      ON DELETE CASCADE,
    CONSTRAINT fk_budget_cat     FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE SET NULL,
    CONSTRAINT chk_budget_amount CHECK (amount > 0),
    CONSTRAINT chk_budget_dates  CHECK (end_date IS NULL OR end_date >= start_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ────────────────────────────────────────────────
-- 6. INVESTMENTS
-- ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS investments (
    id                 CHAR(36)       NOT NULL DEFAULT (UUID()),
    user_id            CHAR(36)       NOT NULL,
    type               ENUM('sip','lump_sum','stocks','gold','fd','nps','ppf','crypto','other') NOT NULL,
    name               VARCHAR(200)   NOT NULL,
    symbol             VARCHAR(50)        NULL,   -- stock/fund ticker
    invested_amount    DECIMAL(15,2)  NOT NULL DEFAULT 0,
    current_value      DECIMAL(15,2)  NOT NULL DEFAULT 0,
    units              DECIMAL(20,6)      NULL,
    avg_buy_price      DECIMAL(15,4)      NULL,
    start_date         DATE           NOT NULL,
    maturity_date      DATE               NULL,
    sip_amount         DECIMAL(15,2)      NULL,   -- monthly SIP
    sip_frequency      ENUM('daily','weekly','monthly','quarterly') NULL,
    status             ENUM('active','paused','redeemed','matured') NOT NULL DEFAULT 'active',
    notes              TEXT               NULL,
    meta               JSON               NULL,   -- platform-specific data
    created_at         DATETIME       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at         DATETIME       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    PRIMARY KEY (id),
    INDEX idx_inv_user_type     (user_id, type, status),
    INDEX idx_inv_user_status   (user_id, status),
    CONSTRAINT fk_inv_user      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    CONSTRAINT chk_inv_invested CHECK (invested_amount >= 0),
    CONSTRAINT chk_inv_current  CHECK (current_value  >= 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ────────────────────────────────────────────────
-- 7. INVESTMENT TRANSACTIONS
-- ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS investment_transactions (
    id            CHAR(36)       NOT NULL DEFAULT (UUID()),
    investment_id CHAR(36)       NOT NULL,
    user_id       CHAR(36)       NOT NULL,
    action        ENUM('buy','sell','dividend','split') NOT NULL,
    amount        DECIMAL(15,2)  NOT NULL,
    units         DECIMAL(20,6)      NULL,
    price_per_unit DECIMAL(15,4)     NULL,
    nav           DECIMAL(10,4)      NULL,   -- for mutual funds
    txn_date      DATE           NOT NULL,
    notes         VARCHAR(500)       NULL,
    created_at    DATETIME       NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY (id),
    INDEX idx_itxn_investment (investment_id, txn_date),
    INDEX idx_itxn_user       (user_id, txn_date),
    CONSTRAINT fk_itxn_inv    FOREIGN KEY (investment_id) REFERENCES investments(id) ON DELETE CASCADE,
    CONSTRAINT fk_itxn_user   FOREIGN KEY (user_id)       REFERENCES users(id)       ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ────────────────────────────────────────────────
-- 8. LOANS
-- ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS loans (
    id               CHAR(36)       NOT NULL DEFAULT (UUID()),
    user_id          CHAR(36)       NOT NULL,
    direction        ENUM('borrowed','lent') NOT NULL,
    party_name       VARCHAR(200)   NOT NULL,  -- person/bank name
    party_contact    VARCHAR(20)        NULL,
    principal        DECIMAL(15,2)  NOT NULL,
    interest_rate    DECIMAL(5,2)   NOT NULL DEFAULT 0,
    interest_type    ENUM('simple','compound','none') NOT NULL DEFAULT 'none',
    outstanding      DECIMAL(15,2)  NOT NULL,
    start_date       DATE           NOT NULL,
    due_date         DATE               NULL,
    purpose          VARCHAR(500)       NULL,
    status           ENUM('active','partially_paid','paid','written_off') NOT NULL DEFAULT 'active',
    reminder_days    TINYINT            NULL,   -- days before due to remind
    notes            TEXT               NULL,
    created_at       DATETIME       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at       DATETIME       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    PRIMARY KEY (id),
    INDEX idx_loan_user_dir    (user_id, direction, status),
    INDEX idx_loan_due         (user_id, due_date),
    CONSTRAINT fk_loan_user    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    CONSTRAINT chk_loan_princ  CHECK (principal    > 0),
    CONSTRAINT chk_loan_out    CHECK (outstanding >= 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ────────────────────────────────────────────────
-- 9. LOAN PAYMENTS
-- ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS loan_payments (
    id           CHAR(36)       NOT NULL DEFAULT (UUID()),
    loan_id      CHAR(36)       NOT NULL,
    user_id      CHAR(36)       NOT NULL,
    amount       DECIMAL(15,2)  NOT NULL,
    payment_date DATE           NOT NULL,
    principal_component DECIMAL(15,2) NOT NULL DEFAULT 0,
    interest_component  DECIMAL(15,2) NOT NULL DEFAULT 0,
    notes        VARCHAR(500)       NULL,
    created_at   DATETIME       NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY (id),
    INDEX idx_lp_loan     (loan_id, payment_date),
    INDEX idx_lp_user     (user_id, payment_date),
    CONSTRAINT fk_lp_loan FOREIGN KEY (loan_id)  REFERENCES loans(id) ON DELETE CASCADE,
    CONSTRAINT fk_lp_user FOREIGN KEY (user_id)  REFERENCES users(id) ON DELETE CASCADE,
    CONSTRAINT chk_lp_amt CHECK (amount > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ────────────────────────────────────────────────
-- 10. AI INSIGHTS
-- ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ai_insights (
    id            CHAR(36)      NOT NULL DEFAULT (UUID()),
    user_id       CHAR(36)      NOT NULL,
    insight_type  ENUM('monthly_summary','spending_alert','investment_advice',
                       'loan_reminder','savings_tip','anomaly','custom') NOT NULL,
    title         VARCHAR(255)  NOT NULL,
    content       TEXT          NOT NULL,
    context_hash  CHAR(64)      NOT NULL,   -- SHA-256 of context used (dedup)
    prompt_tokens INT               NULL,
    model_used    VARCHAR(100)  NOT NULL DEFAULT 'gemini-2.5-flash',
    is_read       TINYINT(1)    NOT NULL DEFAULT 0,
    generated_at  DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
    expires_at    DATETIME          NULL,

    PRIMARY KEY (id),
    INDEX idx_ai_user_type    (user_id, insight_type),
    INDEX idx_ai_user_read    (user_id, is_read),
    INDEX idx_ai_context      (context_hash),
    CONSTRAINT fk_ai_user     FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ────────────────────────────────────────────────
-- 11. VECTOR EMBEDDINGS METADATA  (ChromaDB is the actual store)
-- ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS vector_metadata (
    id              CHAR(36)     NOT NULL DEFAULT (UUID()),
    user_id         CHAR(36)     NOT NULL,
    chroma_doc_id   VARCHAR(255) NOT NULL,   -- ID in ChromaDB collection
    source_type     ENUM('transaction','investment','loan','insight','manual') NOT NULL,
    source_id       CHAR(36)         NULL,
    content_preview VARCHAR(500)     NULL,
    embedded_at     DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY (id),
    UNIQUE  KEY uq_vm_chroma   (chroma_doc_id),
    INDEX idx_vm_user_source   (user_id, source_type),
    CONSTRAINT fk_vm_user      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ────────────────────────────────────────────────
-- SEED: System categories
-- ────────────────────────────────────────────────
INSERT IGNORE INTO categories (id, user_id, name, type, icon, color) VALUES
  (UUID(), NULL, 'Salary',         'income',     '💰', '#22c55e'),
  (UUID(), NULL, 'Freelance',      'income',     '💻', '#16a34a'),
  (UUID(), NULL, 'Business',       'income',     '🏢', '#15803d'),
  (UUID(), NULL, 'Food & Dining',  'expense',    '🍔', '#ef4444'),
  (UUID(), NULL, 'Transport',      'expense',    '🚗', '#f97316'),
  (UUID(), NULL, 'Rent',           'expense',    '🏠', '#eab308'),
  (UUID(), NULL, 'Healthcare',     'expense',    '🏥', '#ec4899'),
  (UUID(), NULL, 'Entertainment',  'expense',    '🎮', '#8b5cf6'),
  (UUID(), NULL, 'Shopping',       'expense',    '🛍️', '#06b6d4'),
  (UUID(), NULL, 'Utilities',      'expense',    '⚡', '#64748b'),
  (UUID(), NULL, 'Education',      'expense',    '📚', '#0ea5e9'),
  (UUID(), NULL, 'SIP / MF',       'investment', '📈', '#10b981'),
  (UUID(), NULL, 'Stocks',         'investment', '📊', '#3b82f6'),
  (UUID(), NULL, 'Gold',           'investment', '🥇', '#f59e0b'),
  (UUID(), NULL, 'FD / Bonds',     'investment', '🏦', '#6366f1'),
  (UUID(), NULL, 'Loan Taken',     'loan',       '📋', '#dc2626'),
  (UUID(), NULL, 'Loan Given',     'loan',       '🤝', '#2563eb');