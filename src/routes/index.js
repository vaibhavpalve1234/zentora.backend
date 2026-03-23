'use strict';

const express = require('express');
const {
  AuthController,
  TransactionController,
  InvestmentController,
  LoanController,
  BudgetController,
  AIController,
} = require('../controllers');
const { authenticate, aiLimiter } = require('../middleware');
const {
  validate,
  authSchemas,
  transactionSchemas,
  investmentSchemas,
  loanSchemas,
  budgetSchemas,
  aiSchemas,
} = require('../validators/schemas');

const router = express.Router();

const authRouter = express.Router();
authRouter.post('/register', validate(authSchemas.register), AuthController.register);
authRouter.post('/login', validate(authSchemas.login), AuthController.login);
authRouter.post('/refresh', AuthController.refresh);
authRouter.post('/logout', AuthController.logout);

const transactionRouter = express.Router();
transactionRouter.use(authenticate);
transactionRouter.post('/', validate(transactionSchemas.create), TransactionController.create);
transactionRouter.get('/', validate(transactionSchemas.list, 'query'), TransactionController.list);
transactionRouter.get('/analytics', validate(transactionSchemas.analytics, 'query'), TransactionController.analytics);
transactionRouter.get('/:id', TransactionController.getById);
transactionRouter.patch('/:id', validate(transactionSchemas.update), TransactionController.update);
transactionRouter.delete('/:id', TransactionController.delete);

const investmentRouter = express.Router();
investmentRouter.use(authenticate);
investmentRouter.post('/', validate(investmentSchemas.create), InvestmentController.create);
investmentRouter.get('/', InvestmentController.list);
investmentRouter.get('/portfolio', InvestmentController.portfolio);
investmentRouter.get('/:id', InvestmentController.getById);
investmentRouter.patch('/:id', validate(investmentSchemas.update), InvestmentController.update);
investmentRouter.delete('/:id', InvestmentController.delete);

const loanRouter = express.Router();
loanRouter.use(authenticate);
loanRouter.post('/', validate(loanSchemas.create), LoanController.create);
loanRouter.get('/', LoanController.list);
loanRouter.get('/dashboard', LoanController.dashboard);
loanRouter.get('/:id', LoanController.getById);
loanRouter.patch('/:id', LoanController.update);
loanRouter.post('/:id/payments', validate(loanSchemas.payment), LoanController.recordPayment);

const budgetRouter = express.Router();
budgetRouter.use(authenticate);
budgetRouter.post('/', validate(budgetSchemas.create), BudgetController.create);
budgetRouter.get('/', BudgetController.list);
budgetRouter.patch('/:id', validate(budgetSchemas.update), BudgetController.update);
budgetRouter.delete('/:id', BudgetController.delete);

const aiRouter = express.Router();
aiRouter.use(authenticate, aiLimiter);
aiRouter.get('/summary', validate(aiSchemas.monthlySummary, 'query'), AIController.monthlySummary);
aiRouter.get('/anomalies', AIController.detectAnomalies);
aiRouter.get('/investments', AIController.investmentAdvice);
aiRouter.get('/savings', AIController.savingsTips);
aiRouter.get('/loans', AIController.loanAdvice);
aiRouter.post('/ask', validate(aiSchemas.customQuery), AIController.customQuery);
aiRouter.get('/history', AIController.history);
aiRouter.patch('/history/:id/read', AIController.markRead);

router.use('/auth', authRouter);
router.use('/transactions', transactionRouter);
router.use('/investments', investmentRouter);
router.use('/loans', loanRouter);
router.use('/budgets', budgetRouter);
router.use('/ai', aiRouter);

module.exports = router;
