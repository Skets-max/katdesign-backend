const sqlite3 = require('sqlite3').verbose();
const bcrypt  = require('bcryptjs');
const path    = require('path');
const fs      = require('fs');

const DB_PATH = path.join(__dirname, '../../data/katdesign.db');
const dataDir = path.dirname(DB_PATH);
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

const db = new sqlite3.Database(DB_PATH, (err) => {
  if (err) { console.error('Could not open database:', err.message); process.exit(1); }
});

// Promisify helpers
db.runAsync = (sql, params = []) =>
  new Promise((resolve, reject) =>
    db.run(sql, params, function(err) { err ? reject(err) : resolve(this); })
  );
db.getAsync = (sql, params = []) =>
  new Promise((resolve, reject) =>
    db.get(sql, params, (err, row) => err ? reject(err) : resolve(row))
  );
db.allAsync = (sql, params = []) =>
  new Promise((resolve, reject) =>
    db.all(sql, params, (err, rows) => err ? reject(err) : resolve(rows))
  );

async function init() {
  await db.runAsync('PRAGMA journal_mode = WAL');
  await db.runAsync('PRAGMA foreign_keys = ON');

  await db.runAsync(`CREATE TABLE IF NOT EXISTS admins (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE,
    password TEXT NOT NULL,
    full_name TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  await db.runAsync(`CREATE TABLE IF NOT EXISTS students (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    first_name TEXT NOT NULL, last_name TEXT NOT NULL,
    omang TEXT NOT NULL UNIQUE, phone TEXT NOT NULL, email TEXT NOT NULL,
    institution TEXT NOT NULL, programme TEXT NOT NULL,
    year_of_study TEXT NOT NULL, sponsoring_body TEXT NOT NULL,
    sponsorship_ref TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  await db.runAsync(`CREATE TABLE IF NOT EXISTS loans (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    reference TEXT NOT NULL UNIQUE,
    student_id INTEGER NOT NULL REFERENCES students(id),
    amount REAL NOT NULL, repayable REAL NOT NULL, interest REAL NOT NULL,
    purpose TEXT, status TEXT NOT NULL DEFAULT 'pending',
    bank_name TEXT NOT NULL, account_holder TEXT NOT NULL,
    account_number TEXT NOT NULL, branch_code TEXT NOT NULL,
    account_type TEXT NOT NULL,
    applied_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    approved_at DATETIME, disbursed_at DATETIME,
    due_date DATETIME, collected_at DATETIME, notes TEXT
  )`);

  await db.runAsync(`CREATE TABLE IF NOT EXISTS activity_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    loan_id INTEGER REFERENCES loans(id),
    action TEXT NOT NULL, actor TEXT NOT NULL DEFAULT 'system',
    note TEXT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  // Seed admin
  const existingAdmin = await db.getAsync('SELECT id FROM admins WHERE username = ?', ['admin']);
  if (!existingAdmin) {
    const hash = bcrypt.hashSync('admin123', 10);
    await db.runAsync('INSERT INTO admins (username,password,full_name) VALUES (?,?,?)',
      ['admin', hash, 'KatDesign Admin']);
    console.log('✓ Default admin created  →  username: admin  |  password: admin123');
  }

  // Seed students + loans
  const row = await db.getAsync('SELECT COUNT(*) as count FROM students');
  if (row.count === 0) {
    const students = [
      ['Keabetswe','Moagi',   '123456789','71000001','keabetswe@email.com','University of Botswana (UB)',                 'BSc Computer Science',   '2nd Year','DPSM','DPSM-001'],
      ['Tshepiso', 'Kgosi',   '987654321','71000002','tshepiso@email.com', 'Botswana Accountancy College (BAC)',           'BCom Accounting',        '1st Year','HRDC','HRDC-002'],
      ['Lesedi',   'Mmolawa', '654987321','71000003','lesedi@email.com',   'GIBS Botswana',                                'BA Business Management', '3rd Year','BOTA','BOTA-003'],
      ['Neo',      'Selato',  '456789123','71000004','neo@email.com',      'Limkokwing University of Creative Technology', 'BA Graphic Design',      '3rd Year','DPSM','DPSM-004'],
      ['Mpho',     'Ditsele', '321654987','71000005','mpho@email.com',     'Gaborone University College (GUC)',            'BBA Business Admin',     '1st Year','HRDC','HRDC-005'],
      ['Onalenna', 'Tau',     '741852963','71000006','onalenna@email.com', 'GIBS Botswana',                                'BSc Information Systems','2nd Year','DPSM','DPSM-006'],
      ['Baruti',   'Sento',   '963741852','71000007','baruti@email.com',   'University of Botswana (UB)',                  'LLB Law',                '4th Year','BOTA','BOTA-007'],
      ['Boitumelo','Gaone',   '159357486','71000008','boitumelo@email.com','University of Botswana (UB)',                  'BSc Mathematics',        '1st Year','HRDC','HRDC-008'],
      ['Dineo',    'Kgatlhe', '852963741','71000009','dineo@email.com',    'Botswana Accountancy College (BAC)',            'BCom Finance',           '2nd Year','HRDC','HRDC-009'],
    ];
    for (const s of students) {
      await db.runAsync(`INSERT INTO students (first_name,last_name,omang,phone,email,institution,programme,year_of_study,sponsoring_body,sponsorship_ref) VALUES (?,?,?,?,?,?,?,?,?,?)`, s);
    }

    const now     = new Date().toISOString();
    const yd      = new Date(Date.now()-86400000).toISOString();
    const m7      = new Date(Date.now()-7*86400000).toISOString();
    const m37     = new Date(Date.now()-37*86400000).toISOString();
    const p23     = new Date(Date.now()+23*86400000).toISOString();
    const m4      = new Date(Date.now()-4*86400000).toISOString();

    const loans = [
      ['KDH-2026-001',1,1200,'pending',  now, null,null,null,null, 'FNB',    'Keabetswe Moagi', '62001001','282672','Savings'],
      ['KDH-2026-002',2, 800,'pending',  yd,  null,null,null,null, 'Stanbic','Tshepiso Kgosi',  '62001002','060144','Current'],
      ['KDH-2026-003',3,1500,'pending',  yd,  null,null,null,null, 'ABSA',   'Lesedi Mmolawa',  '62001003','430000','Savings'],
      ['KDH-2026-004',4, 500,'approved', m7,  yd,  null,null,null, 'FNB',    'Neo Selato',      '62001004','282672','Savings'],
      ['KDH-2026-005',5,1500,'disbursed',m7,  m7,  m7,  p23, null, 'Stanbic','Mpho Ditsele',    '62001005','060144','Current'],
      ['KDH-2026-006',6,1000,'overdue',  m37, m37, m37, m4,  null, 'ABSA',   'Onalenna Tau',    '62001006','430000','Savings'],
      ['KDH-2026-007',7,1000,'collected',m37, m37, m37, yd,  now,  'Stanbic','Baruti Sento',    '62001007','060144','Savings'],
      ['KDH-2026-008',8, 900,'rejected', m7,  null,null,null,null, 'BancABC','Boitumelo Gaone', '62001008','431010','Savings'],
      ['KDH-2026-009',9, 700,'overdue',  m37, m37, m37, m7,  null, 'BancABC','Dineo Kgatlhe',   '62001009','431010','Current'],
    ];
    for (const l of loans) {
      const [ref,sIdx,amount,status,applied,approved,disbursed,due,collected,bank,holder,acct,branch,type] = l;
      const repayable = parseFloat((amount*1.3).toFixed(2));
      const interest  = parseFloat((amount*0.3).toFixed(2));
      await db.runAsync(
        `INSERT INTO loans (reference,student_id,amount,repayable,interest,purpose,status,bank_name,account_holder,account_number,branch_code,account_type,applied_at,approved_at,disbursed_at,due_date,collected_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [ref,sIdx,amount,repayable,interest,'Student expenses',status,bank,holder,acct,branch,type,applied,approved,disbursed,due,collected]
      );
    }
    console.log('✓ Sample data seeded — 9 students, 9 loans');
  }
}

const dbReady = init().catch(err => {
  console.error('Database init failed:', err.message);
  process.exit(1);
});

module.exports = db;
module.exports.ready = dbReady;
