const express = require('express');
const path = require('path');
const session = require('express-session');
const helmet = require('helmet');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
require('dotenv').config();

const authRoutes = require('./src/routes/auth.routes');
const expenseRoutes = require('./src/routes/expense.routes');
const fileRoutes = require('./src/routes/file.routes');
const adminRoutes = require('./src/routes/admin.routes');
const { requireAuth, requireAdmin } = require('./src/middlewares/auth.middleware');

const app = express();
const PORT = process.env.PORT || 3000;

app.set('trust proxy', 1);

app.use(helmet({
  contentSecurityPolicy: false,
}));
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const apiLimiter = rateLimit({
  windowMs: 1 * 60 * 1000,
  max: 600,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    error: 'คุณส่งคำขอถี่เกินไป กรุณารอ 1 นาทีก่อนลองใหม่อีกครั้ง (Rate limit exceeded)'
  }
});

app.use('/api/', apiLimiter);

app.use(session({
  name: 'expense_sid',
  secret: process.env.SESSION_SECRET || 'expense_secure_secret_2026',
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 8 * 60 * 60 * 1000
  }
}));

app.use('/api/auth', authRoutes);
app.use('/api/expenses', expenseRoutes);
app.use('/api/files', fileRoutes);
app.use('/api/admin', adminRoutes);

app.get('/admin', requireAdmin, (req, res) => {
  res.sendFile(path.join(__dirname, 'public/admin/acl-matrix.html'));
});
app.get('/admin/:page', requireAdmin, (req, res) => {
  const pageFile = path.join(__dirname, 'public/admin', `${req.params.page}.html`);
  res.sendFile(pageFile);
});

app.get('/app', requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, 'public/app/index.html'));
});
app.get('/app/:page', requireAuth, (req, res) => {
  const pageFile = path.join(__dirname, 'public/app', `${req.params.page}.html`);
  res.sendFile(pageFile);
});

app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (req, res) => {
  if (req.session && req.session.user) {
    return res.redirect('/app');
  }
  res.sendFile(path.join(__dirname, 'public/index.html'));
});

app.use((err, req, res, next) => {
  if (err instanceof SyntaxError && err.status === 400 && 'body' in err) {
    return res.status(400).json({
      success: false,
      error: 'รูปแบบข้อมูล JSON ที่ส่งมาไม่ถูกต้อง (Malformed JSON body)'
    });
  }

  console.error('Unhandled Error:', err);
  res.status(err.status || 500).json({
    success: false,
    error: err.message || 'เกิดข้อผิดพลาดภายในเซิร์ฟเวอร์'
  });
});

app.listen(PORT, () => {
  console.log(`=======================================================`);
  console.log(`🚀 Expense Reimbursement Server is running on port ${PORT}`);
  console.log(`👉 http://localhost:${PORT}`);
  console.log(`=======================================================`);
});
