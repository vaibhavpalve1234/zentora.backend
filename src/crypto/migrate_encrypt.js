'use strict';

require('dotenv').config();

const { userRepository, transactionRepository, investmentRepository, loanRepository, budgetRepository, insightRepository } = require('../repositories');
const { keyManager, encryptEntity } = require('./index');
const { query } = require('../config/database');

async function run() {
  const users = await query('SELECT * FROM users', []);
  for (const user of users) {
    const keyRecord = await keyManager.getKeyRecord(user.id);
    if (!keyRecord) {
      console.warn(`Skipping ${user.email}: no user_encryption_keys record exists yet.`);
      continue;
    }

    const dek = await keyManager.loadDEKWithMasterKey(user.id);
    await userRepository.update(user.id, encryptEntity('users', { full_name: user.full_name }, dek, process.env.BLIND_INDEX_SECRET));

    const txns = await transactionRepository.find({ where: { user_id: user.id }, limit: 100000, offset: 0 });
    for (const row of txns) {
      await transactionRepository.update(row.id, encryptEntity('transactions', row, dek, process.env.BLIND_INDEX_SECRET));
    }

    const investments = await investmentRepository.find({ where: { user_id: user.id }, limit: 100000, offset: 0 });
    for (const row of investments) {
      await investmentRepository.update(row.id, encryptEntity('investments', row, dek, process.env.BLIND_INDEX_SECRET));
    }

    const loans = await loanRepository.find({ where: { user_id: user.id }, limit: 100000, offset: 0 });
    for (const row of loans) {
      await loanRepository.update(row.id, encryptEntity('loans', row, dek, process.env.BLIND_INDEX_SECRET));
    }

    const budgets = await budgetRepository.find({ where: { user_id: user.id }, limit: 100000, offset: 0 });
    for (const row of budgets) {
      await budgetRepository.update(row.id, encryptEntity('budgets', row, dek, process.env.BLIND_INDEX_SECRET));
    }

    const insights = await insightRepository.find({ where: { user_id: user.id }, limit: 100000, offset: 0 });
    for (const row of insights) {
      await insightRepository.update(row.id, encryptEntity('ai_insights', row, dek, process.env.BLIND_INDEX_SECRET));
    }
  }

  console.log('Encryption migration finished.');
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
