const express = require('express');
const router = express.Router();
const expenseController = require('../controllers/expense.controller');
const { requireAuth } = require('../middlewares/auth.middleware');
const { checkPermission } = require('../middlewares/acl.middleware');

router.use(requireAuth);

router.get('/', checkPermission(['expense.read_own', 'expense.read_all']), expenseController.getExpenses);
router.get('/:id', checkPermission(['expense.read_own', 'expense.read_all']), expenseController.getExpenseById);

router.post('/', checkPermission('expense.create'), expenseController.createExpense);

router.post('/:id/manager-action', checkPermission('expense.approve_manager'), expenseController.processManagerAction);

router.post('/:id/finance-payout', checkPermission('expense.process_finance'), expenseController.processFinancePayout);

router.put('/:id', checkPermission('expense.update_own'), expenseController.updateExpense);

router.get('/:id/logs', expenseController.getExpenseAuditLogs);

const { requireAdmin } = require('../middlewares/auth.middleware');
router.delete('/all/clear', requireAdmin, expenseController.deleteAllExpenses);
router.delete('/:id', checkPermission('expense.delete_own'), expenseController.deleteExpense);

module.exports = router;

