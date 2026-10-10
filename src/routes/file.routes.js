const express = require('express');
const router = express.Router();
const fileController = require('../controllers/file.controller');
const upload = require('../middlewares/upload.middleware');
const { requireAuth } = require('../middlewares/auth.middleware');
const { checkPermission } = require('../middlewares/acl.middleware');

router.use(requireAuth);

router.post('/upload', upload.single('file'), fileController.uploadFile);

router.get('/:id', fileController.downloadFile);

router.delete('/:id', checkPermission('file.delete'), fileController.deleteFile);

module.exports = router;

