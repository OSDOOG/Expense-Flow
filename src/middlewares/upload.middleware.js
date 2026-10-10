const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');

const receiptsDir = path.join(__dirname, '../../uploads/receipts');
const slipsDir = path.join(__dirname, '../../uploads/slips');
if (!fs.existsSync(receiptsDir)) fs.mkdirSync(receiptsDir, { recursive: true });
if (!fs.existsSync(slipsDir)) fs.mkdirSync(slipsDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const fileType = req.body.file_type || 'RECEIPT';
    const targetDir = fileType === 'PAYMENT_SLIP' ? slipsDir : receiptsDir;
    cb(null, targetDir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const prefix = req.body.file_type === 'PAYMENT_SLIP' ? 'slip_' : 'receipt_';
    const uniqueName = `${prefix}${Date.now()}_${Math.random().toString(36).substring(2, 9)}${ext}`;
    cb(null, uniqueName);
  }
});

const fileFilter = (req, file, cb) => {
  const allowedMimeTypes = ['image/jpeg', 'image/png', 'application/pdf'];
  const allowedExtensions = ['.jpg', '.jpeg', '.png', '.pdf'];
  const ext = path.extname(file.originalname).toLowerCase();

  if (allowedMimeTypes.includes(file.mimetype) && allowedExtensions.includes(ext)) {
    cb(null, true);
  } else {
    cb(new Error('ชนิดไฟล์ไม่ถูกต้อง อนุญาตเฉพาะ JPG, PNG และ PDF เท่านั้น'), false);
  }
};

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter
});

module.exports = upload;
