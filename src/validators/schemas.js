'use strict';

/**
 * Validators — Joi schemas
 *
 * All incoming request bodies are validated here BEFORE reaching services.
 * This enforces the principle: "validate at the boundary, trust inside."
 */

const Joi = require('joi');

// ─── Common reusables ──────────────────────────────────────────────────────────
const uuid       = Joi.string().uuid({ version: 'uuidv4' });
const amount     = Joi.number().positive().precision(2).max(99_999_999);
const dateStr    = Joi.string().pattern(/^\d{4}-\d{2}-\d{2}$/);
const paginationSchema = {
  limit:  Joi.number().integer().min(1).max(200).default(50),
  offset: Joi.number().integer().min(0).default(0),
};

// ─── Auth ──────────────────────────────────────────────────────────────────────
const authSchemas = {
  register: Joi.object({
    email:     Joi.string().email().max(255).lowercase().required(),
    password:  Joi.string().min(8).max(72).required(),
    full_name: Joi.string().min(2).max(100).required(),
    currency:  Joi.string().length(3).uppercase().default('INR'),
    timezone:  Joi.string().max(50).default('Asia/Kolkata'),
  }),

  login: Joi.object({
    email:    Joi.string().email().required(),
    password: Joi.string().required(),
  }),
};

// ─── Transactions ──────────────────────────────────────────────────────────────
const transactionSchemas = {
  create: Joi.object({
    type:             Joi.string().valid('income', 'expense').required(),
    amount:           amount.required(),
    currency:         Joi.string().length(3).uppercase().default('INR'),
    category_id:      uuid.allow(null),
    description:      Joi.string().max(500).allow('', null),
    tags:             Joi.array().items(Joi.string().max(50)).max(10).default([]),
    transaction_date: dateStr.required(),
    payment_method:   Joi.string().valid('cash', 'upi', 'card', 'bank_transfer', 'other').default('upi'),
    is_recurring:     Joi.boolean().default(false),
    recurrence_rule:  Joi.string().max(100).allow(null),
  }),

  update: Joi.object({
    amount:           amount,
    description:      Joi.string().max(500).allow('', null),
    tags:             Joi.array().items(Joi.string().max(50)).max(10),
    transaction_date: dateStr,
    payment_method:   Joi.string().valid('cash', 'upi', 'card', 'bank_transfer', 'other'),
    category_id:      uuid.allow(null),
  }).min(1),

  list: Joi.object({
    type:       Joi.string().valid('income', 'expense'),
    categoryId: uuid,
    startDate:  dateStr,
    endDate:    dateStr,
    ...paginationSchema,
  }),

  analytics: Joi.object({
    year:      Joi.number().integer().min(2000).max(2099),
    month:     Joi.number().integer().min(1).max(12),
    startDate: dateStr,
    endDate:   dateStr,
  }),
};

// ─── Investments ───────────────────────────────────────────────────────────────
const investmentSchemas = {
  create: Joi.object({
    type:          Joi.string().valid('sip','lump_sum','stocks','gold','fd','nps','ppf','crypto','other').required(),
    name:          Joi.string().max(200).required(),
    symbol:        Joi.string().max(50).allow(null),
    invested_amount: amount.required(),
    current_value: amount.allow(null),
    units:         Joi.number().positive().precision(6).allow(null),
    avg_buy_price: Joi.number().positive().precision(4).allow(null),
    start_date:    dateStr.required(),
    maturity_date: dateStr.allow(null),
    sip_amount:    amount.allow(null),
    sip_frequency: Joi.string().valid('daily','weekly','monthly','quarterly').allow(null),
    status:        Joi.string().valid('active','paused','redeemed','matured').default('active'),
    notes:         Joi.string().max(1000).allow(null),
    meta:          Joi.object().allow(null),
  }),

  update: Joi.object({
    name:          Joi.string().max(200),
    current_value: amount,
    units:         Joi.number().positive().precision(6).allow(null),
    avg_buy_price: Joi.number().positive().precision(4).allow(null),
    sip_amount:    amount.allow(null),
    status:        Joi.string().valid('active','paused','redeemed','matured'),
    notes:         Joi.string().max(1000).allow(null),
  }).min(1),
};

// ─── Loans ─────────────────────────────────────────────────────────────────────
const loanSchemas = {
  create: Joi.object({
    direction:     Joi.string().valid('borrowed', 'lent').required(),
    party_name:    Joi.string().max(200).required(),
    party_contact: Joi.string().max(20).allow(null),
    principal:     amount.required(),
    interest_rate: Joi.number().min(0).max(100).default(0),
    interest_type: Joi.string().valid('simple','compound','none').default('none'),
    start_date:    dateStr.required(),
    due_date:      dateStr.allow(null),
    purpose:       Joi.string().max(500).allow(null),
    reminder_days: Joi.number().integer().min(1).max(90).allow(null),
    notes:         Joi.string().max(2000).allow(null),
  }),

  payment: Joi.object({
    amount:               amount.required(),
    payment_date:         dateStr.required(),
    principal_component:  amount.allow(null),
    interest_component:   amount.allow(null),
    notes:                Joi.string().max(500).allow(null),
  }),
};

// ─── Budgets ───────────────────────────────────────────────────────────────────
const budgetSchemas = {
  create: Joi.object({
    name:        Joi.string().max(100).required(),
    amount:      amount.required(),
    period:      Joi.string().valid('daily','weekly','monthly','yearly').default('monthly'),
    category_id: uuid.allow(null),
    start_date:  dateStr.required(),
    end_date:    dateStr.allow(null),
    alert_at:    Joi.number().integer().min(1).max(100).default(80),
  }),

  update: Joi.object({
    name:      Joi.string().max(100),
    amount:    amount,
    period:    Joi.string().valid('daily','weekly','monthly','yearly'),
    alert_at:  Joi.number().integer().min(1).max(100),
    end_date:  dateStr.allow(null),
    is_active: Joi.boolean(),
  }).min(1),
};

// ─── AI ────────────────────────────────────────────────────────────────────────
const aiSchemas = {
  monthlySummary: Joi.object({
    year:  Joi.number().integer().min(2000).max(2099),
    month: Joi.number().integer().min(1).max(12),
  }),

  customQuery: Joi.object({
    question: Joi.string().min(5).max(1000).required(),
  }),
};

/**
 * Validation middleware factory.
 * Usage: router.post('/...', validate(transactionSchemas.create), controller)
 *
 * @param {Joi.Schema} schema
 * @param {'body'|'query'|'params'} source
 */
function validate(schema, source = 'body') {
  return (req, res, next) => {
    const { error, value } = schema.validate(req[source], {
      abortEarly:   false,
      stripUnknown: true,
      convert:      true,
    });

    if (error) {
      return res.status(422).json({
        success: false,
        error: {
          code:    'VALIDATION_ERROR',
          message: 'Input validation failed',
          details: error.details.map(d => ({
            field:   d.path.join('.'),
            message: d.message,
          })),
        },
      });
    }

    req[source] = value;  // Replace with cleaned/defaults-applied value
    next();
  };
}

module.exports = {
  validate,
  authSchemas,
  transactionSchemas,
  investmentSchemas,
  loanSchemas,
  budgetSchemas,
  aiSchemas,
};