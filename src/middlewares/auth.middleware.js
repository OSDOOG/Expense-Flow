const { logAudit } = require('../utils/logger');

const requireAuth = (req, res, next) => {
  if (!req.session || !req.session.user) {
    if (req.originalUrl.startsWith('/api/')) {
      return res.status(401).json({
        success: false,
        error: 'กรุณาเข้าสู่ระบบก่อนทำรายการ (401 Unauthorized)'
      });
    }
    return res.redirect('/?error=unauthorized');
  }
  req.user = req.session.user;
  next();
};

const requireAdmin = async (req, res, next) => {
  if (!req.session || !req.session.user) {
    if (req.originalUrl.startsWith('/api/')) {
      return res.status(401).json({ success: false, error: 'กรุณาเข้าสู่ระบบ' });
    }
    return res.redirect('/');
  }

  const user = req.session.user;
  const isAdminRole = user.role_name && user.role_name.toLowerCase() === 'admin';

  const db = require('../config/db');
  const adminPermCheck = await db.query(`
    SELECT p.code FROM role_permissions rp
    JOIN permissions p ON rp.permission_id = p.id
    WHERE rp.role_id = $1 AND p.code IN ('acl.manage', 'user.read', 'log.read', 'role.manage', 'permission.manage')
    LIMIT 1
  `, [user.role_id]);

  const hasAdminPerm = adminPermCheck.rows.length > 0;

  if (!isAdminRole && !hasAdminPerm) {
    await logAudit({
      userId: user.id,
      username: user.username,
      action: 'ACCESS_DENIED',
      resource: 'ADMIN',
      details: `พยายามเข้าถึงส่วน Admin: ${req.originalUrl}`,
      ipAddress: req.ip || req.connection.remoteAddress,
      userAgent: req.get('user-agent'),
      status: 'FAILED'
    });

    if (req.originalUrl.startsWith('/api/')) {
      return res.status(403).json({
        success: false,
        error: 'ปฏิเสธการเข้าถึง: สำหรับผู้ดูแลระบบหรือผู้ได้รับสิทธิ์เท่านั้น (403 Forbidden)'
      });
    }
    return res.status(403).send(`
      <!DOCTYPE html>
      <html lang="th">
      <head><meta charset="UTF-8"><title>403 Forbidden</title>
      <style>
        body { font-family: 'Segoe UI', Tahoma, sans-serif; background: #0f172a; color: #f8fafc; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; }
        .box { background: #1e293b; padding: 2rem; border-radius: 12px; border: 1px solid #ef4444; text-align: center; max-width: 450px; }
        h1 { color: #ef4444; margin-top: 0; }
        a { color: #38bdf8; text-decoration: none; display: inline-block; margin-top: 1rem; }
      </style>
      </head>
      <body>
        <div class="box">
          <h1>403 Forbidden</h1>
          <p>คุณไม่มีสิทธิ์เข้าถึงส่วนงานผู้ดูแลระบบ (Admin) เหตุการณ์นี้ถูกบันทึกลงระบบแล้ว</p>
          <a href="/app/">← กลับสู่หน้าระบบงานของคุณ</a>
        </div>
      </body>
      </html>
    `);
  }

  req.user = user;
  next();
};

module.exports = {
  requireAuth,
  requireAdmin
};
