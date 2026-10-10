const db = require('../config/db');
const bcrypt = require('bcryptjs');
const { logAudit } = require('../utils/logger');

exports.getRoles = async (req, res) => {
  try {
    const query = `
      SELECT r.*,
             (SELECT COUNT(*) FROM users u WHERE u.role_id = r.id) AS user_count,
             (SELECT COUNT(*) FROM role_permissions rp WHERE rp.role_id = r.id) AS permission_count
      FROM roles r
      ORDER BY r.id ASC
    `;
    const result = await db.query(query);
    res.json({ success: true, data: result.rows });
  } catch (err) {
    res.status(500).json({ success: false, error: 'ไม่สามารถดึงข้อมูลบทบาทได้' });
  }
};

exports.createRole = async (req, res) => {
  const { name, description } = req.body;
  if (!name) return res.status(400).json({ success: false, error: 'กรุณากรอกชื่อบทบาท' });

  try {
    const query = `INSERT INTO roles (name, description) VALUES ($1, $2) RETURNING *`;
    const result = await db.query(query, [name.trim(), description || null]);
    const created = result.rows[0];

    await logAudit({
      userId: req.user.id,
      username: req.user.username,
      action: 'CREATE',
      resource: 'ROLE',
      resourceId: created.id,
      details: `สร้างบทบาทใหม่: ${name}`,
      status: 'SUCCESS'
    });

    res.status(201).json({ success: true, message: 'สร้างบทบาทสำเร็จ', data: created });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message.includes('unique') ? 'ชื่อบทบาทนี้มีอยู่แล้ว' : 'ไม่สามารถสร้างบทบาทได้' });
  }
};

exports.deleteRole = async (req, res) => {
  const { id } = req.params;
  try {
    const roleRes = await db.query('SELECT * FROM roles WHERE id = $1', [id]);
    if (roleRes.rows.length === 0) return res.status(404).json({ success: false, error: 'ไม่พบบทบาทนี้' });

    const role = roleRes.rows[0];
    if (role.is_system_role || role.name.toLowerCase() === 'admin') {
      return res.status(400).json({ success: false, error: 'ไม่สามารถลบบทบาทของระบบ (Admin) ได้' });
    }

    const countCheck = await db.query('SELECT COUNT(*) FROM users WHERE role_id = $1', [id]);
    if (parseInt(countCheck.rows[0].count, 10) > 0) {
      return res.status(400).json({
        success: false,
        error: `ไม่สามารถลบได้ เนื่องจากยังมีผู้ใช้จำนวน ${countCheck.rows[0].count} คนผูกกับบทบาทนี้อยู่`
      });
    }

    await db.query('DELETE FROM roles WHERE id = $1', [id]);

    await logAudit({
      userId: req.user.id,
      username: req.user.username,
      action: 'DELETE',
      resource: 'ROLE',
      resourceId: id,
      details: `ลบบทบาท: ${role.name}`,
      status: 'SUCCESS'
    });

    res.json({ success: true, message: 'ลบบทบาทสำเร็จ' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

exports.getPermissions = async (req, res) => {
  try {
    const result = await db.query('SELECT * FROM permissions ORDER BY module, id ASC');
    res.json({ success: true, data: result.rows });
  } catch (err) {
    res.status(500).json({ success: false, error: 'ไม่สามารถดึงข้อมูลสิทธิ์ได้' });
  }
};

exports.createPermission = async (req, res) => {
  const { code, name, module, description } = req.body;
  if (!code || !name || !module) {
    return res.status(400).json({ success: false, error: 'กรุณากรอกรหัสสิทธิ์ ชื่อสิทธิ์ และหมวดหมู่' });
  }

  try {
    const query = `
      INSERT INTO permissions (code, name, module, description)
      VALUES ($1, $2, $3, $4) RETURNING *
    `;
    const result = await db.query(query, [code.trim(), name.trim(), module.trim().toUpperCase(), description || null]);
    const created = result.rows[0];

    const adminRole = await db.query("SELECT id FROM roles WHERE LOWER(name) = 'admin' LIMIT 1");
    if (adminRole.rows.length > 0) {
      await db.query(
        'INSERT INTO role_permissions (role_id, permission_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
        [adminRole.rows[0].id, created.id]
      );
    }

    await logAudit({
      userId: req.user.id,
      username: req.user.username,
      action: 'CREATE',
      resource: 'PERMISSION',
      resourceId: created.id,
      details: `สร้าง Permission ใหม่: ${code} (${name})`,
      status: 'SUCCESS'
    });

    res.status(201).json({ success: true, message: 'สร้างสิทธิ์เรียบร้อย', data: created });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message.includes('unique') ? 'รหัสสิทธิ์นี้มีอยู่แล้ว' : 'ไม่สามารถสร้างสิทธิ์ได้' });
  }
};

exports.deletePermission = async (req, res) => {
  const { id } = req.params;

  try {
    const permRes = await db.query('SELECT * FROM permissions WHERE id = $1', [id]);
    if (permRes.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'ไม่พบสิทธิ์ที่ต้องการลบ' });
    }
    const perm = permRes.rows[0];

    const systemPermCodes = [
      'expense.create', 'expense.read_own', 'expense.read_all', 'expense.update_own', 'expense.delete_own',
      'expense.approve_manager', 'expense.process_finance', 'file.upload_receipt', 'file.upload_slip',
      'file.view', 'file.delete', 'role.manage', 'permission.manage', 'acl.manage',
      'user.create', 'user.read', 'user.update', 'user.delete', 'user.suspend', 'log.read'
    ];

    if (perm.id <= 19 || systemPermCodes.includes(perm.code)) {
      return res.status(400).json({ success: false, error: 'ไม่สามารถลบสิทธิ์หลักตั้งต้นของระบบได้' });
    }

    await db.query('DELETE FROM permissions WHERE id = $1', [id]);

    const actorDisplay = `${req.user.name || req.user.username} (@${req.user.username})`;
    await logAudit({
      userId: req.user.id,
      username: req.user.username,
      action: 'DELETE',
      resource: 'PERMISSION',
      resourceId: id,
      details: `ลบ Permission: ${perm.code} (${perm.name}) โดย ${actorDisplay}`,
      status: 'SUCCESS'
    });

    res.json({ success: true, message: `ลบสิทธิ์ "${perm.code}" เรียบร้อยแล้ว` });
  } catch (err) {
    res.status(500).json({ success: false, error: 'ไม่สามารถลบสิทธิ์ได้: ' + err.message });
  }
};

exports.getAclMatrix = async (req, res) => {
  try {
    const rolesRes = await db.query('SELECT id, name, description, is_system_role FROM roles ORDER BY id ASC');
    const permsRes = await db.query('SELECT id, code, name, module FROM permissions ORDER BY module, id ASC');
    const relationsRes = await db.query('SELECT role_id, permission_id FROM role_permissions');

    res.json({
      success: true,
      data: {
        roles: rolesRes.rows,
        permissions: permsRes.rows,
        matrix: relationsRes.rows
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: 'ไม่สามารถดึงข้อมูล ACL Matrix ได้' });
  }
};

exports.updateAclPermission = async (req, res) => {
  const { role_id, permission_id, granted } = req.body;
  if (!role_id || !permission_id || typeof granted !== 'boolean') {
    return res.status(400).json({ success: false, error: 'ข้อมูลไม่ถูกต้อง' });
  }

  try {
    if (granted) {
      await db.query(`
        INSERT INTO role_permissions (role_id, permission_id)
        VALUES ($1, $2)
        ON CONFLICT DO NOTHING
      `, [role_id, permission_id]);
    } else {
      const roleCheck = await db.query('SELECT name FROM roles WHERE id = $1', [role_id]);
      const permCheck = await db.query('SELECT code FROM permissions WHERE id = $1', [permission_id]);

      if (roleCheck.rows[0]?.name.toLowerCase() === 'admin' && ['acl.manage', 'role.manage'].includes(permCheck.rows[0]?.code)) {
        return res.status(400).json({ success: false, error: 'ไม่สามารถยกเลิกสิทธิ์จัดการระบบของ Admin ได้' });
      }

      await db.query(`
        DELETE FROM role_permissions
        WHERE role_id = $1 AND permission_id = $2
      `, [role_id, permission_id]);
    }

    await logAudit({
      userId: req.user.id,
      username: req.user.username,
      action: 'ACL_UPDATE',
      resource: 'ACL',
      details: `${granted ? 'กำหนดสิทธิ์' : 'ยกเลิกสิทธิ์'} ให้กับ Role ID #${role_id} (Permission #${permission_id})`,
      status: 'SUCCESS'
    });

    res.json({ success: true, message: 'บันทึกการปรับปรุงสิทธิ์เรียบร้อย มีผลทันที' });
  } catch (err) {
    res.status(500).json({ success: false, error: 'เกิดข้อผิดพลาดในการปรับสิทธิ์' });
  }
};

exports.getUsers = async (req, res) => {
  try {
    const query = `
      SELECT u.id, u.username, u.full_name, u.email, u.department, u.role_id, u.is_active, u.created_at,
             r.name AS role_name
      FROM users u
      JOIN roles r ON u.role_id = r.id
      ORDER BY u.id ASC
    `;
    const result = await db.query(query);
    res.json({ success: true, data: result.rows });
  } catch (err) {
    res.status(500).json({ success: false, error: 'ไม่สามารถดึงรายชื่อผู้ใช้ได้' });
  }
};

exports.createUser = async (req, res) => {
  const { username, password, full_name, email, department, role_id } = req.body;

  if (!username || !password || !full_name || !email || !role_id) {
    return res.status(400).json({ success: false, error: 'กรุณากรอกข้อมูลสำคัญให้ครบถ้วน (ชื่อผู้ใช้, รหัสผ่าน, ชื่อ-นามสกุล, อีเมล, บทบาท)' });
  }

  try {
    const salt = await bcrypt.genSalt(10);
    const password_hash = await bcrypt.hash(password, salt);

    const query = `
      INSERT INTO users (username, password_hash, full_name, email, department, role_id, is_active)
      VALUES ($1, $2, $3, $4, $5, $6, TRUE)
      RETURNING id, username, full_name, email, department, role_id, is_active, created_at
    `;
    const result = await db.query(query, [
      username.trim(),
      password_hash,
      full_name.trim(),
      email.trim(),
      department ? department.trim() : 'General',
      parseInt(role_id, 10)
    ]);

    const created = result.rows[0];

    const actorDisplayName = `${req.user.full_name} (@${req.user.username})`;
    await logAudit({
      userId: req.user.id,
      username: req.user.username,
      action: 'CREATE',
      resource: 'USER',
      resourceId: created.id,
      details: `[${actorDisplayName}] สร้างบัญชีผู้ใช้ใหม่: ${created.username} (${created.full_name}, บทบาท ID #${created.role_id})`,
      ipAddress: req.ip,
      status: 'SUCCESS'
    });

    res.status(201).json({
      success: true,
      message: 'สร้างบัญชีผู้ใช้งานใหม่สำเร็จ',
      data: created
    });

  } catch (err) {
    console.error('createUser error:', err);
    if (err.message.includes('unique constraint') || err.message.includes('duplicate key')) {
      if (err.message.includes('username')) return res.status(400).json({ success: false, error: 'ชื่อผู้ใช้งาน (Username) นี้มีอยู่ในระบบแล้ว' });
      if (err.message.includes('email')) return res.status(400).json({ success: false, error: 'อีเมล (Email) นี้มีอยู่ในระบบแล้ว' });
    }
    res.status(500).json({ success: false, error: 'ไม่สามารถสร้างผู้ใช้งานได้: ' + err.message });
  }
};

exports.updateUser = async (req, res) => {

  const { id } = req.params;
  const { role_id, is_active, full_name, department } = req.body;

  try {
    const updateQuery = `
      UPDATE users
      SET role_id = COALESCE($1, role_id),
          is_active = COALESCE($2, is_active),
          full_name = COALESCE($3, full_name),
          department = COALESCE($4, department),
          updated_at = NOW()
      WHERE id = $5
      RETURNING *
    `;
    const result = await db.query(updateQuery, [role_id, is_active, full_name, department, id]);

    if (result.rows.length === 0) return res.status(404).json({ success: false, error: 'ไม่พบผู้ใช้' });

    await logAudit({
      userId: req.user.id,
      username: req.user.username,
      action: 'UPDATE',
      resource: 'USER',
      resourceId: id,
      details: `แก้ไขข้อมูลผู้ใช้/เปลี่ยนบทบาท User ID #${id}`,
      status: 'SUCCESS'
    });

    res.json({ success: true, message: 'ปรับปรุงข้อมูลผู้ใช้สำเร็จ', data: result.rows[0] });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
};

exports.deleteUser = async (req, res) => {
  const { id } = req.params;
  const targetId = parseInt(id, 10);

  if (isNaN(targetId)) {
    return res.status(400).json({ success: false, error: 'รหัสผู้ใช้งานไม่ถูกต้อง' });
  }

  if (req.user.id === targetId) {
    return res.status(400).json({ success: false, error: 'คุณไม่สามารถลบบัญชีผู้ใช้งานของตนเองได้' });
  }

  try {
    const userRes = await db.query('SELECT u.*, r.name as role_name FROM users u JOIN roles r ON u.role_id = r.id WHERE u.id = $1', [targetId]);
    if (userRes.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'ไม่พบผู้ใช้ที่ต้องการลบ' });
    }
    const targetUser = userRes.rows[0];

    if (targetUser.role_name.toLowerCase() === 'admin') {
      const adminCountRes = await db.query(`
        SELECT COUNT(*) as count
        FROM users u
        JOIN roles r ON u.role_id = r.id
        WHERE LOWER(r.name) = 'admin' AND u.is_active = TRUE
      `);
      if (parseInt(adminCountRes.rows[0].count, 10) <= 1) {
        return res.status(400).json({ success: false, error: 'ไม่สามารถลบผู้ดูแลระบบ (Admin) คนสุดท้ายของระบบได้' });
      }
    }

    const expenseCheck = await db.query('SELECT COUNT(*) as count FROM expense_requests WHERE user_id = $1', [targetId]);
    const hasExpenses = parseInt(expenseCheck.rows[0].count, 10) > 0;

    const attachmentCheck = await db.query('SELECT COUNT(*) as count FROM expense_attachments WHERE uploaded_by = $1', [targetId]);
    const hasAttachments = parseInt(attachmentCheck.rows[0].count, 10) > 0;

    if (hasExpenses || hasAttachments) {
      await db.query(`
        UPDATE users
        SET is_active = FALSE,
            full_name = full_name || ' (ถูกระงับ/ลบ)',
            updated_at = NOW()
        WHERE id = $1
      `, [targetId]);
    } else {
      await db.query('DELETE FROM users WHERE id = $1', [targetId]);
    }

    const actorDisplay = `${req.user.name || req.user.username} (@${req.user.username})`;
    await logAudit({
      userId: req.user.id,
      username: req.user.username,
      action: 'DELETE',
      resource: 'USER',
      resourceId: targetId,
      details: `ลบบัญชีผู้ใช้: ${targetUser.username} (${targetUser.full_name}, ${targetUser.role_name}) โดย ${actorDisplay}`,
      status: 'SUCCESS'
    });

    res.json({
      success: true,
      message: hasExpenses
        ? `ผู้ใช้ "${targetUser.username}" มีประวัติคำขอเบิกจ่ายในระบบ จึงทำการระงับบัญชีและลบการเข้าถึงให้เรียบร้อยแล้ว`
        : `ลบผู้ใช้ "${targetUser.username}" ออกจากระบบเรียบร้อยแล้ว`
    });

  } catch (err) {
    console.error('deleteUser error:', err);
    res.status(500).json({ success: false, error: 'ไม่สามารถลบผู้ใช้งานได้: ' + err.message });
  }
};

exports.toggleUserStatus = async (req, res) => {
  const { id } = req.params;
  const targetId = parseInt(id, 10);

  if (isNaN(targetId)) {
    return res.status(400).json({ success: false, error: 'รหัสผู้ใช้งานไม่ถูกต้อง' });
  }

  if (req.user.id === targetId) {
    return res.status(400).json({ success: false, error: 'คุณไม่สามารถระงับการใช้งานบัญชีของตนเองได้' });
  }

  try {
    const userRes = await db.query(
      'SELECT u.*, r.name as role_name FROM users u JOIN roles r ON u.role_id = r.id WHERE u.id = $1',
      [targetId]
    );

    if (userRes.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'ไม่พบผู้ใช้ที่ระบุ' });
    }

    const targetUser = userRes.rows[0];
    const newStatus = !targetUser.is_active;

    if (!newStatus && targetUser.role_name.toLowerCase() === 'admin') {
      const adminCountRes = await db.query(`
        SELECT COUNT(*) as count
        FROM users u
        JOIN roles r ON u.role_id = r.id
        WHERE LOWER(r.name) = 'admin' AND u.is_active = TRUE
      `);
      if (parseInt(adminCountRes.rows[0].count, 10) <= 1) {
        return res.status(400).json({ success: false, error: 'ไม่สามารถระงับผู้ดูแลระบบ (Admin) ที่เปิดใช้งานคนสุดท้ายของระบบได้' });
      }
    }

    const updateRes = await db.query(`
      UPDATE users
      SET is_active = $1, updated_at = NOW()
      WHERE id = $2
      RETURNING id, username, full_name, role_id, is_active
    `, [newStatus, targetId]);

    const updatedUser = updateRes.rows[0];
    const actionText = newStatus ? 'ปลดระงับการใช้งาน' : 'ระงับการใช้งาน';
    const actorDisplay = `${req.user.full_name || req.user.username} (@${req.user.username})`;

    await logAudit({
      userId: req.user.id,
      username: req.user.username,
      action: newStatus ? 'ACTIVATE' : 'SUSPEND',
      resource: 'USER',
      resourceId: targetId,
      details: `${actionText}บัญชีผู้ใช้: ${targetUser.username} (${targetUser.full_name}) โดย ${actorDisplay}`,
      status: 'SUCCESS'
    });

    res.json({
      success: true,
      message: `${actionText}ผู้ใช้ "${targetUser.username}" เรียบร้อยแล้ว`,
      data: updatedUser
    });
  } catch (err) {
    console.error('toggleUserStatus error:', err);
    res.status(500).json({ success: false, error: 'ไม่สามารถเปลี่ยนสถานะผู้ใช้ได้: ' + err.message });
  }
};

exports.getAuditLogs = async (req, res) => {
  const { action, resource, search, startDate, endDate, startTime, endTime, page = 1, limit = 50 } = req.query;

  try {
    let baseWhere = ' WHERE 1=1';
    const params = [];

    if (action) {
      params.push(action);
      baseWhere += ` AND l.action = $${params.length}`;
    }

    if (resource) {
      params.push(resource);
      baseWhere += ` AND l.resource = $${params.length}`;
    }

    if (search) {
      params.push(`%${search}%`);
      baseWhere += ` AND (l.username ILIKE $${params.length} OR u.full_name ILIKE $${params.length} OR l.details ILIKE $${params.length})`;
    }

    const normalizeDate = (dStr) => {
      if (!dStr) return '';
      const parts = dStr.trim().split('-');
      if (parts.length === 3) {
        let year = parseInt(parts[0], 10);
        if (year > 2400) year -= 543;
        return `${year}-${parts[1]}-${parts[2]}`;
      }
      return dStr.trim();
    };

    const cleanStartDate = normalizeDate(startDate);
    const cleanEndDate = normalizeDate(endDate);

    if (cleanStartDate) {
      const timePart = startTime ? `${startTime}:00` : '00:00:00';
      params.push(`${cleanStartDate} ${timePart}`);
      baseWhere += ` AND l.created_at >= $${params.length}`;
    }

    if (cleanEndDate) {
      const timePart = endTime ? `${endTime}:59.999` : '23:59:59.999';
      params.push(`${cleanEndDate} ${timePart}`);
      baseWhere += ` AND l.created_at <= $${params.length}`;
    }

    const countQuery = `
      SELECT COUNT(*) as total
      FROM audit_logs l
      LEFT JOIN users u ON l.user_id = u.id
      ${baseWhere}
    `;
    const countRes = await db.query(countQuery, params);
    const totalRecords = parseInt(countRes.rows[0].total, 10);

    const currentPage = Math.max(1, parseInt(page, 10) || 1);
    const pageSize = Math.min(100, Math.max(1, parseInt(limit, 10) || 50));
    const offset = (currentPage - 1) * pageSize;
    const totalPages = Math.ceil(totalRecords / pageSize) || 1;

    let dataQuery = `
      SELECT l.*, u.full_name
      FROM audit_logs l
      LEFT JOIN users u ON l.user_id = u.id
      ${baseWhere}
      ORDER BY l.created_at DESC, l.id DESC
      LIMIT $${params.length + 1} OFFSET $${params.length + 2}
    `;

    const dataParams = [...params, pageSize, offset];
    const result = await db.query(dataQuery, dataParams);

    res.json({
      success: true,
      pagination: {
        page: currentPage,
        limit: pageSize,
        totalRecords,
        totalPages
      },
      count: result.rows.length,
      data: result.rows
    });
  } catch (err) {
    console.error('getAuditLogs error:', err);
    res.status(500).json({ success: false, error: 'ไม่สามารถดึงข้อมูล Audit Log ได้: ' + err.message });
  }
};

exports.exportAuditLogsCsv = async (req, res) => {
  const { action, resource, search, startDate, endDate, startTime, endTime } = req.query;

  try {
    let query = `
      SELECT l.*, u.full_name
      FROM audit_logs l
      LEFT JOIN users u ON l.user_id = u.id
      WHERE 1=1
    `;
    const params = [];

    if (action) {
      params.push(action);
      query += ` AND l.action = $${params.length}`;
    }

    if (resource) {
      params.push(resource);
      query += ` AND l.resource = $${params.length}`;
    }

    if (search) {
      params.push(`%${search}%`);
      query += ` AND (l.username ILIKE $${params.length} OR u.full_name ILIKE $${params.length} OR l.details ILIKE $${params.length})`;
    }

    const normalizeDate = (dStr) => {
      if (!dStr) return '';
      const parts = dStr.trim().split('-');
      if (parts.length === 3) {
        let year = parseInt(parts[0], 10);
        if (year > 2400) year -= 543;
        return `${year}-${parts[1]}-${parts[2]}`;
      }
      return dStr.trim();
    };

    const cleanStartDate = normalizeDate(startDate);
    const cleanEndDate = normalizeDate(endDate);

    if (cleanStartDate) {
      const timePart = startTime ? `${startTime}:00` : '00:00:00';
      params.push(`${cleanStartDate} ${timePart}`);
      query += ` AND l.created_at >= $${params.length}`;
    }

    if (cleanEndDate) {
      const timePart = endTime ? `${endTime}:59.999` : '23:59:59.999';
      params.push(`${cleanEndDate} ${timePart}`);
      query += ` AND l.created_at <= $${params.length}`;
    }

    query += ` ORDER BY l.created_at DESC`;

    const result = await db.query(query, params);

    const headers = ['ID', 'Timestamp', 'User ID', 'Username', 'Full Name', 'Action', 'Resource', 'Resource ID', 'Details', 'IP Address', 'User Agent', 'Status'];
    const rows = result.rows.map(r => [
      r.id,
      `"${new Date(r.created_at).toISOString()}"`,
      r.user_id || '',
      `"${(r.username || '').replace(/"/g, '""')}"`,
      `"${(r.full_name || '').replace(/"/g, '""')}"`,
      `"${r.action}"`,
      `"${r.resource}"`,
      r.resource_id ? `"${r.resource_id}"` : '',
      `"${(r.details || '').replace(/"/g, '""')}"`,
      `"${r.ip_address || ''}"`,
      `"${(r.user_agent || '').replace(/"/g, '""')}"`,
      `"${r.status}"`
    ]);

    const csvContent = '\uFEFF' + [headers.join(','), ...rows.map(e => e.join(','))].join('\r\n');

    const filename = `audit_logs_${new Date().toISOString().slice(0, 10)}.csv`;
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(csvContent);

    await logAudit({
      userId: req.user.id,
      username: req.user.username,
      action: 'EXPORT',
      resource: 'LOG',
      details: `ส่งออกไฟล์ Audit Log (จำนวน ${result.rows.length} รายการ)`,
      ipAddress: req.ip,
      status: 'SUCCESS'
    });

  } catch (err) {
    console.error('exportAuditLogsCsv error:', err);
    res.status(500).json({ success: false, error: 'เกิดข้อผิดพลาดในการส่งออกไฟล์ Log' });
  }
};

