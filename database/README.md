# คู่มือการติดตั้งฐานข้อมูล (Database Setup Guide)
## โครงการ: ระบบบริหารจัดการเบิกจ่ายค่าใช้จ่ายและใบเสร็จ (Expense Reimbursement System)

ไฟล์ SQL ในโฟลเดอร์นี้ออกแบบตรงตามข้อกำหนดของโครงงาน 100%:
* [schema.sql](file:///e:/Coding/WebProjet/database/schema.sql) : สร้างตาราง, ข้อจำกัด (Constraints), Foreign Keys, Index และ Triggers ป้องกันความปลอดภัย
* [seed.sql](file:///e:/Coding/WebProjet/database/seed.sql) : ติดตั้งบทบาท (4 Roles), รายการสิทธิ์ (Permissions), ตารางความสัมพันธ์ ACL, บัญชีผู้ใช้ทดสอบ 5 บัญชี, คำขอตัวอย่างทุกสถานะ, ข้อมูลไฟล์แนบ และ Audit Log ตัวอย่าง

---

## 1. ข้อมูลบัญชีผู้ใช้ทดสอบ (Test Accounts)
> **รหัสผ่านสำหรับทุกบัญชีคือ:** `Password123!`  
> (เข้ารหัสแบบ Hash + Salt ด้วยอัลกอริทึม **bcrypt** Cost 10)

| ลำดับ | Username | รหัสผ่าน | บทบาท (Role) | แผนก | หน้าที่และความรับผิดชอบในระบบ |
| :---: | :--- | :--- | :--- | :--- | :--- |
| 1 | **`admin`** | `Password123!` | **Admin** | IT Administration | ผู้ดูแลระบบสูงสุด จัดการ Role, Permission, ACL Matrix, ผู้ใช้งาน และดู Audit Log ทั้งหมด |
| 2 | **`manager`** | `Password123!` | **Manager** | Sales & Marketing | หัวหน้าแผนก ตรวจสอบและอนุมัติ/ปฏิเสธคำขอเบิกเงิน |
| 3 | **`finance`** | `Password123!` | **Finance** | Accounting & Finance | เจ้าหน้าที่การเงิน ตรวจสอบเอกสาร บันทึกจ่ายเงิน และอัปโหลดสลิปโอนเงิน |
| 4 | **`employee`** | `Password123!` | **Employee** | Sales & Marketing | พนักงานทั่วไป ยื่นคำขอเบิกเงิน แนบรูปใบเสร็จ ติดตามและจัดการคำขอของตนเอง |
| 5 | **`employee2`**| `Password123!` | **Employee** | Human Resources | พนักงานทดสอบคนที่สอง (สำหรับทดสอบสิทธิ์ข้ามผู้ใช้/ข้ามแผนก) |

---

## 2. วิธีการนำเข้าข้อมูลสู่ PostgreSQL

### วิธีที่ 1: ติดตั้งผ่านโปรแกรม `psql` (Command Line)
1. เปิด Terminal หรือ PowerShell
2. เข้าใช้งาน PostgreSQL และสร้างฐานข้อมูล:
   ```bash
   createdb -U postgres expense_db
   ```
3. รันสคริปต์ `schema.sql` และ `seed.sql`:
   ```bash
   psql -U postgres -d expense_db -f database/schema.sql
   psql -U postgres -d expense_db -f database/seed.sql
   ```

### วิธีที่ 2: ติดตั้งผ่าน pgAdmin หรือ DBeaver
1. สร้าง Database ใหม่ชื่อ `expense_db`
2. เปิดเมนู **Query Tool**
3. คัดลอกเนื้อหาจากไฟล์ `database/schema.sql` แล้วกด **Execute (F5)**
4. คัดลอกเนื้อหาจากไฟล์ `database/seed.sql` แล้วกด **Execute (F5)**

---

## 3. ตาราง Access Matrix (ตรงตาม seed.sql และระบบจริง)

| ทรัพยากร / ฟังก์ชัน | Permission Code | Admin | Manager | Finance | Employee | เงื่อนไขเพิ่มเติม |
| :--- | :--- | :---: | :---: | :---: | :---: | :--- |
| **สร้างคำขอเบิก** | `expense.create` | ✔️ | ❌ | ❌ | ✔️ | พนักงานยื่นคำขอใหม่ |
| **ดูคำขอตนเอง** | `expense.read_own` | ✔️ | ✔️ | ✔️ | ✔️ | ดูเฉพาะรายการที่ `user_id = me` |
| **ดูคำขอทั้งหมด** | `expense.read_all` | ✔️ | ✔️ | ✔️ | ❌ | พนักงานทั่วไปเข้าถึงไม่ได้ |
| **แก้ไขคำขอตนเอง** | `expense.update_own` | ✔️ | ❌ | ❌ | ✔️ | แก้ไขได้เฉพาะสถานะ `PENDING_MANAGER` |
| **ยกเลิกคำขอตนเอง** | `expense.delete_own` | ✔️ | ❌ | ❌ | ✔️ | ยกเลิกได้เฉพาะคำขอที่ยังไม่อนุมัติ |
| **อนุมัติขั้นหัวหน้า** | `expense.approve_manager` | ✔️ | ✔️ | ❌ | ❌ | อนุมัติหรือปฏิเสธคำขอ |
| **ดำเนินการจ่ายเงิน** | `expense.process_finance` | ✔️ | ❌ | ✔️ | ❌ | ตรวจเอกสารและปิดยอด |
| **อัปโหลดใบเสร็จ** | `file.upload_receipt` | ✔️ | ❌ | ❌ | ✔️ | แนบหลักฐานค่าใช้จ่าย |
| **อัปโหลดสลิปเงิน** | `file.upload_slip` | ✔️ | ❌ | ✔️ | ❌ | แนบหลักฐานการโอนเงิน |
| **ดู/ดาวน์โหลดไฟล์** | `file.view` | ✔️ | ✔️ | ✔️ | ✔️ | **Protected Route:** ตรวจสิทธิ์ก่อนดาวน์โหลด |
| **จัดการบทบาท** | `role.manage` | ✔️ | ❌ | ❌ | ❌ | เพิ่ม/แก้ไข/ลบ Role ผ่านเว็บ |
| **จัดการตารางสิทธิ์**| `acl.manage` | ✔️ | ❌ | ❌ | ❌ | กำหนดตาราง Role x Permission |
| **จัดการผู้ใช้งาน** | `user.manage` | ✔️ | ❌ | ❌ | ❌ | เพิ่ม/แก้/เปลี่ยน Role ผู้ใช้ |
| **ดู Audit Log** | `log.read` | ✔️ | ❌ | ❌ | ❌ | ค้นหา กรอง และเรียกดูประวัติ |

---

## 4. กลไกความปลอดภัยในฐานข้อมูล (Security Constraints & Triggers)

1. **ป้องกันการลบ Role ที่ยังมีผู้ใช้งาน:**
   * ตาราง `users` ตั้งค่า `FOREIGN KEY (role_id) REFERENCES roles (id) ON DELETE RESTRICT`
   * หาก Role นั้นยังมี User ผูกอยู่ PostgreSQL จะปฏิเสธการลบทันที
2. **ป้องกันการเปลี่ยนแปลงที่ทำให้ไม่มี Admin เหลืออยู่:**
   * มี Trigger `trg_prevent_last_admin_removal` ทำงานก่อน UPDATE หรือ DELETE บนตาราง `users`
   * หากมีการเปลี่ยน Role ของ Admin คนสุดท้าย หรือปิดการใช้งาน (`is_active = FALSE`) ระบบจะ Raise Exception ทันที
3. **ป้องกันการลบ Role Admin:**
   * มี Trigger `trg_prevent_system_role_delete` บนตาราง `roles` ป้องกันการลบ Role ที่มี `is_system_role = TRUE`
4. **ความสมบูรณ์ของรหัสผ่าน:**
   * ตาราง `users` จัดเก็บเฉพาะฟิลด์ `password_hash` ขนาด 255 ตัวอักษร รองรับ bcrypt/argon2 โดยไม่มีการเก็บ Plaintext Password
