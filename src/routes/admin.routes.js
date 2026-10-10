const express = require('express');
const router = express.Router();
const adminController = require('../controllers/admin.controller');
const { requireAuth, requireAdmin } = require('../middlewares/auth.middleware');

const { checkPermission } = require('../middlewares/acl.middleware');

router.use(requireAuth);
router.use(requireAdmin);

router.get('/roles', checkPermission('role.manage'), adminController.getRoles);
router.post('/roles', checkPermission('role.manage'), adminController.createRole);
router.delete('/roles/:id', checkPermission('role.manage'), adminController.deleteRole);

router.get('/permissions', checkPermission('permission.manage'), adminController.getPermissions);
router.post('/permissions', checkPermission('permission.manage'), adminController.createPermission);
router.delete('/permissions/:id', checkPermission('permission.manage'), adminController.deletePermission);

router.get('/acl-matrix', checkPermission('acl.manage'), adminController.getAclMatrix);
router.post('/acl-matrix/update', checkPermission('acl.manage'), adminController.updateAclPermission);

router.get('/users', checkPermission('user.read'), adminController.getUsers);
router.post('/users', checkPermission('user.create'), adminController.createUser);
router.put('/users/:id', checkPermission('user.update'), adminController.updateUser);
router.put('/users/:id/status', checkPermission('user.suspend'), adminController.toggleUserStatus);
router.delete('/users/:id', checkPermission('user.delete'), adminController.deleteUser);

router.get('/logs', checkPermission('log.read'), adminController.getAuditLogs);
router.get('/logs/export', checkPermission('log.read'), adminController.exportAuditLogsCsv);

module.exports = router;

