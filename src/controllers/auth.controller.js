const bcrypt = require('bcryptjs');
const db = require('../config/db');
const { logAudit } = require('../utils/logger');

exports.login = async (req, res) => {
  const { username, password } = req.body;
  const ipAddress = req.ip || req.connection.remoteAddress;
  const userAgent = req.get('user-agent');

  if (!username || !password) {
    return res.status(400).json({ success: false, error: 'กรุณากรอกชื่อผู้ใช้และรหัสผ่าน' });
  }

  try {
    const query = `
      SELECT u.id, u.username, u.password_hash, u.full_name, u.email, u.department, u.role_id, u.is_active,
             r.name AS role_name
      FROM users u
      JOIN roles r ON u.role_id = r.id
      WHERE u.username = $1
    `;
    const result = await db.query(query, [username.trim()]);

    if (result.rows.length === 0) {
      await logAudit({
        username,
        action: 'LOGIN_FAILED',
        resource: 'AUTH',
        details: 'พยายามเข้าสู่ระบบด้วยชื่อผู้ใช้ที่ไม่พบในระบบ',
        ipAddress,
        userAgent,
        status: 'FAILED'
      });
      return res.status(401).json({ success: false, error: 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง' });
    }

    const user = result.rows[0];

    if (!user.is_active) {
      await logAudit({
        userId: user.id,
        username: user.username,
        action: 'LOGIN_FAILED',
        resource: 'AUTH',
        details: 'บัญชีถูกระงับการใช้งาน',
        ipAddress,
        userAgent,
        status: 'FAILED'
      });
      return res.status(403).json({ success: false, error: 'บัญชีผู้ใช้นี้ถูกระงับการใช้งาน กรุณาติดต่อผู้ดูแลระบบ' });
    }

    const isMatch = await bcrypt.compare(password, user.password_hash);
    if (!isMatch) {
      await logAudit({
        userId: user.id,
        username: user.username,
        action: 'LOGIN_FAILED',
        resource: 'AUTH',
        details: 'รหัสผ่านไม่ถูกต้อง',
        ipAddress,
        userAgent,
        status: 'FAILED'
      });
      return res.status(401).json({ success: false, error: 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง' });
    }

    req.session.user = {
      id: user.id,
      username: user.username,
      full_name: user.full_name,
      email: user.email,
      department: user.department,
      role_id: user.role_id,
      role_name: user.role_name
    };

    await logAudit({
      userId: user.id,
      username: user.username,
      action: 'LOGIN_SUCCESS',
      resource: 'AUTH',
      details: `เข้าสู่ระบบสำเร็จในฐานะ [${user.role_name}]`,
      ipAddress,
      userAgent,
      status: 'SUCCESS'
    });

    res.json({
      success: true,
      message: 'เข้าสู่ระบบสำเร็จ',
      user: req.session.user
    });

  } catch (err) {
    console.error('Login Error:', err);
    res.status(500).json({ success: false, error: 'เกิดข้อผิดพลาดในการตรวจสอบข้อมูล' });
  }
};

exports.logout = async (req, res) => {
  const user = req.session ? req.session.user : null;
  const ipAddress = req.ip || req.connection.remoteAddress;

  if (user) {
    await logAudit({
      userId: user.id,
      username: user.username,
      action: 'LOGOUT',
      resource: 'AUTH',
      details: 'ออกจากระบบเรียบร้อย',
      ipAddress,
      status: 'SUCCESS'
    });
  }

  req.session.destroy((err) => {
    if (err) {
      return res.status(500).json({ success: false, error: 'ไม่สามารถออกจากระบบได้' });
    }
    res.clearCookie('connect.sid');
    res.json({ success: true, message: 'ออกจากระบบสำเร็จ' });
  });
};

exports.getMe = async (req, res) => {
  if (!req.session || !req.session.user) {
    return res.status(401).json({ success: false, error: 'ยังไม่ได้เข้าสู่ระบบ' });
  }

  try {
    const permQuery = `
      SELECT p.code
      FROM role_permissions rp
      JOIN permissions p ON rp.permission_id = p.id
      WHERE rp.role_id = $1
    `;
    const permRes = await db.query(permQuery, [req.session.user.role_id]);
    const permissions = permRes.rows.map(r => r.code);

    res.json({
      success: true,
      user: {
        ...req.session.user,
        permissions
      }
    });
  } catch (err) {
    res.json({ success: true, user: req.session.user, permissions: [] });
  }
};
