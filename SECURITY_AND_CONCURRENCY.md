# สถาปัตยกรรมความปลอดภัยและการรองรับการใช้งานพร้อมกัน
## โครงการ: ระบบบริหารจัดการเบิกจ่ายค่าใช้จ่ายและใบเสร็จ (Expense Reimbursement System)

เอกสารฉบับนี้จัดทำขึ้นเพื่อวางมาตรการด้าน **ความปลอดภัยของข้อมูล (Data Security)** และ **การรองรับผู้ใช้งานจำนวนมากพร้อมกัน (High Concurrency & Multi-user Isolation)** ให้เป็นไปตามเกณฑ์ข้อกำหนดโครงงานใน PDF อย่างเคร่งครัด

---

## 1. ภัยคุกคามและการป้องกันความปลอดภัยของข้อมูล (Data Security Architecture)

```
        [ Client / Browser ]
                 │
                 ▼ (HTTPS / TLS)
      ┌─────────────────────────┐
      │ 1. Rate Limiting        │ (ป้องกัน Brute-Force / DoS)
      │ 2. Security Headers     │ (Helmet: HSTS, X-Content-Type-Options, CSP)
      │ 3. CORS & CSRF Defense  │ (SameSite Cookie, CSRF Token)
      └──────────┬──────────────┘
                 ▼
      ┌─────────────────────────┐
      │ 4. Authentication       │ (Session ใน HttpOnly, Secure, SameSite=Lax Cookie)
      │ 5. Dynamic ACL Checker  │ (Role × Permission จาก DB + Object-Level Security)
      └──────────┬──────────────┘
                 ▼
      ┌─────────────────────────┐
      │ 6. Input Sanitization   │ (Express-Validator, Parameterized SQL $1, $2)
      │ 7. File Security Guard  │ (Magic Bytes Check, UUID Filename, Protected Stream)
      └──────────┬──────────────┘
                 ▼
      ┌─────────────────────────┐
      │ 8. PostgreSQL Layer     │ (Row-Level Constraints, Triggers, ACID Transactions)
      │ 9. Audit Logging        │ (บันทึกผู้กระทำ, ห้ามมี Password/Token ใน Log)
      └─────────────────────────┘
```

### 1.1 การป้องกันการยืนยันตัวตนและข้อมูลระบุตัวตน (Authentication & Credential Security)
* **การจัดเก็บรหัสผ่าน (Password Hashing):**
  * ใช้ `bcryptjs` ทำงานร่วมกับ Salt โดยใช้ Round = 10 (ป้องกันการโจมตีแบบ Rainbow Table และ Dictionary Attack)
  * **Zero Plaintext:** ไม่ส่ง Password Hash กลับไปที่ฝั่ง Frontend และไม่บันทึก Password ลงในตาราง `audit_logs` เด็ดขาด
* **การจัดการ Session อย่างปลอดภัย:**
  * เก็บ Session Data ลงใน PostgreSQL หรือ Memorystore มีการทำ Session Regeneration เมื่อเข้าสู่ระบบสำเร็จ (ป้องกัน Session Fixation)
  * ตั้งค่า Cookie Flag อย่างเข้มงวด:
    * `httpOnly: true` (ป้องกันการขโมย Cookie ผ่าน XSS)
    * `secure: process.env.NODE_ENV === 'production'` (ส่งผ่าน HTTPS เท่านั้น)
    * `sameSite: 'lax'` (ป้องกัน Cross-Site Request Forgery - CSRF)
    * `maxAge: 8 * 60 * 60 * 1000` (หมดอายุใน 8 ชั่วโมง และล้าง Session ทันทีเมื่อ Logout)

### 1.2 การป้องกันการโจมตีเว็บยอดนิยม (OWASP Top 10 Defenses)
1. **SQL Injection:**
   * ใช้ **Parameterized Queries (`$1`, `$2`, ...)** ผ่าน `pg.Pool` ทุกจุด 100% ห้ามใช้การต่อ String (`"SELECT ... " + input`) เด็ดขาด
2. **Cross-Site Scripting (XSS):**
   * ใช้ `helmet` เพื่อตั้งค่า Security Headers เช่น `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`
   * ทำ HTML Escaping บน Frontend และ Validate Input ด้วย `express-validator` ทุก Endpoint
3. **Broken Access Control & IDOR (Insecure Direct Object References):**
   * บังคับใช้ **Object-Level Authorization (เจ้าของข้อมูล):**
     * แม้ผู้ใช้จะมีสิทธิ์ `expense.read_own` หรือ `expense.update_own` ระบบฝั่ง Server จะต้องตรวจสอบเงื่อนไขเสมอ:
       ```javascript
       // ตัวอย่าง: ตรวจสอบความเป็นเจ้าของก่อนให้สิทธิ์เข้าถึง
       const item = await db.query('SELECT user_id, status FROM expense_requests WHERE id = $1', [requestId]);
       if (item.rows[0].user_id !== req.user.id && req.user.role_name !== 'Admin') {
           await logAuditEvent(req.user, 'ACCESS_DENIED', 'EXPENSE', requestId, 'Unauthorized access to expense');
           return res.status(403).json({ error: 'ปฏิเสธการเข้าถึง: ท่านไม่ใช่เจ้าของรายการนี้' });
       }
       ```
4. **Brute Force & Denial of Service (DoS):**
   * ใช้ `express-rate-limit` จำกัดการพยายาม Login เช่น ล็อกไม่ให้พยายามเกิน 5 ครั้ง ภายใน 15 นาที ต่อ 1 IP Address

### 1.3 ความปลอดภัยในการอัปโหลดและดาวน์โหลดไฟล์ (File Upload & Storage Security)
* **ป้องกัน Path Traversal:**
  * ไฟล์ที่อัปโหลดจะถูกเปลี่ยนชื่อเป็นสุ่มแบบ **UUID v4** เสมอ (เช่น `a4b9c1d2-....pdf`) โดยตัดอักขระพิเศษและนามสกุลเดิมทิ้ง ป้องกันการตั้งชื่อเช่น `../../etc/passwd`
* **ตรวจสอบประเภทและขนาดไฟล์จริงฝั่ง Server (Server-Side Validation):**
  * จำกัดขนาดไฟล์สูงสุดไม่เกิน **5 MB**
  * ตรวจสอบ MIME type และ File Signature (Magic Bytes) อนุญาตเฉพาะ:
    * `image/jpeg` (`FF D8 FF`)
    * `image/png` (`89 50 4E 47`)
    * `application/pdf` (`25 50 44 46`)
* **Protected File Stream (ห้ามเปิด Static URL สาธารณะ):**
  * โฟลเดอร์ `uploads/` จะไม่อยู่ใน `express.static()`
  * การเข้าถึงไฟล์ต้องผ่าน Route: `GET /api/files/:attachmentId`
  * Server จะตรวจสอบ Role และความเป็นเจ้าของรายการก่อน หากผ่านจึงส่งไฟล์ด้วย `res.sendFile()` หากไม่ผ่านจะบันทึกลง `audit_logs` เป็น `ACCESS_DENIED` และตอบกลับ `403 Forbidden`

---

## 2. การรองรับผู้ใช้งานหลายคนพร้อมกัน (Concurrency & Scalability)

เมื่อมีผู้ใช้หลายคน (เช่น Employee ยื่นเบิกเงินพร้อมกันหลายคน หรือ Manager กำลังกดอนุมัติในเวลาเดียวกัน) ระบบถูกออกแบบให้รักษาความถูกต้องของข้อมูล (Data Consistency) และไม่มีข้อผิดพลาด Race Condition ดังนี้:

### 2.1 การจัดการ Database Connection Pool
* ใช้ **`pg.Pool`** ในการจัดการ Pool Connections:
  ```javascript
  const pool = new Pool({
      max: 20,                  // จำนวน Connection สูงสุดใน Pool
      idleTimeoutMillis: 30000, // ปิด Connection ที่ไม่ถูกใช้งานใน 30 วินาที
      connectionTimeoutMillis: 5000, // Timeout หากหา Connection ว่างไม่ได้ใน 5 วินาที
  });
  ```
* ใช้ Client จาก Pool ผ่านคำสั่งย่อย และคืน Connection กลับสู่ Pool ทันทีเมื่อทำงานเสร็จ (`finally { client.release(); }`) เพื่อป้องกัน Connection Leak

### 2.2 การป้องกัน Race Condition ด้วย ACID Transactions & Row Locking
ในขั้นตอนการอนุมัติ, การจ่ายเงิน, หรือการเปลี่ยนสถานะคำขอ จะใช้ **PostgreSQL Transaction** ร่วมกับ **`FOR UPDATE` (Pessimistic Locking)**:

```sql
-- ตัวอย่างการทำธุรกรรมอนุมัติคำขอป้องกันการกดซ้ำพร้อมกัน (Concurrent Approval)
BEGIN;

-- ล็อกแถวข้อมูลนี้ไว้จนกว่า Transaction จะเสร็จสิ้น
SELECT id, status, total_amount 
FROM expense_requests 
WHERE id = $1 
FOR UPDATE;

-- ตรวจสอบว่าสถานะยังเป็น 'PENDING_MANAGER' หรือไม่
-- หากมีผู้จัดการอีกคนกดไปแล้ว Transaction นี้จะเห็นสถานะเปลี่ยนไปแล้วและปฏิเสธคำขอซ้ำ
UPDATE expense_requests 
SET status = 'APPROVED_MANAGER', manager_id = $2, manager_action_at = NOW()
WHERE id = $1 AND status = 'PENDING_MANAGER';

-- บันทึก Audit Log ภายใต้ Transaction เดียวกัน
INSERT INTO audit_logs (user_id, username, action, resource, resource_id, status)
VALUES ($2, $3, 'UPDATE', 'EXPENSE', $1, 'SUCCESS');

COMMIT;
```

### 2.3 การป้องกัน Double Submission ฝั่ง Frontend & API
* **Frontend:** ปิดปุ่ม Submit ทันที (`button.disabled = true`) พร้อมแสดง Loading Spinner เมื่อผู้ใช้กดส่งคำขอ
* **Backend:** ใช้รหัส `request_no` ที่เป็น `UNIQUE` (เช่น `EXP-2026-XXXXX`) สร้างขึ้นโดยใช้ Database Sequence หรือ UUID ป้องกันการเกิดข้อมูลคำขอซ้ำซ้อน

### 2.4 การป้องกันการลบหรือแก้ไขสิทธิ์ชนกัน (Admin Concurrency & Dynamic Cache Invalidation)
* เมื่อ Admin มีการเปลี่ยนสิทธิ์ในตาราง `role_permissions`:
  * การตรวจสอบสิทธิ์ของ Middleware จะ Query ตรวจสอบความสัมพันธ์จากตารางใน PostgreSQL แบบ Real-time หรือใช้ Cache ที่มี TTL สั้น (เช่น 1-2 วินาที)
  * เมื่อ Admin บันทึกตาราง ACL Matrix ผู้ใช้คนอื่นที่กำลังใช้งานอยู่ในระบบจะได้รับผลลัพธ์ของสิทธิ์ใหม่ในการเรียก API ครั้งถัดไปทันที โดยไม่ต้อง Sign-out หรือเริ่ม Server ใหม่

---

## 3. สรุปความปลอดภัยและกลไก Concurrency ที่ตอบโจทย์ข้อกำหนดใน PDF

| หัวข้อเกณฑ์ใน PDF | กลไกความปลอดภัย / Concurrency ที่วางไว้ |
| :--- | :--- |
| **4.1 Authentication** | Bcrypt Cost 10 + Salt, Session ใน HttpOnly Cookie, อัตรา Rate-limiting ป้องกัน Brute-force, ห้ามบันทึก Password ลง Log |
| **4.2 Role Management** | Trigger ป้องกันการลบ Admin คนสุดท้าย (`trg_prevent_last_admin_removal`), Database Constraint `ON DELETE RESTRICT` ป้องกันลบ Role ที่มีผู้ใช้ |
| **4.3 Dynamic ACL** | ตรวจสอบสิทธิ์แบบ Real-time ทุก Route, เปลี่ยนแปลงสิทธิ์ผ่านเว็บแล้วมีผลทันทีโดยไม่ต้อง Restart Server |
| **5.1 Logical Separation** | แยกกลุ่ม Route `/admin` และ `/api/admin` ชัดเจน ตรวจสอบสิทธิ์ที่ Server ทุกครั้ง ห้ามพึ่งพาแค่การซ่อนปุ่มบน UI |
| **6. Audit Logging** | บันทึกเหตุการณ์และสถานะ (SUCCESS / ACCESS_DENIED) ลง PostgreSQL จัดเก็บถาวรแม้ Restart Server, ค้นหาและกรองได้ |
| **9. File Upload** | ตรวจสอบ Magic Bytes และขนาดไฟล์จริงฝั่ง Server, ชื่อไฟล์แบบสุ่ม UUID ป้องกัน Path Traversal, Protected File Download Stream |
| **Multi-user Concurrency** | PostgreSQL Connection Pooling (`pg.Pool`), Pessimistic Locking (`SELECT ... FOR UPDATE`), Database Transactions (ACID) ป้องกันข้อมูลชนกัน |
