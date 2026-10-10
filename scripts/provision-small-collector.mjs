import { randomUUID, randomBytes, scryptSync } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';

const databasePath = process.argv[2];
const password = process.argv[3];
if (!databasePath || !password) throw new Error('database path and temporary password are required');
const salt=randomBytes(16); const derived=scryptSync(password,salt,64,{N:32768,r:8,p:1,maxmem:64*1024*1024});
const passwordHash=['scrypt','32768','8','1',salt.toString('base64url'),derived.toString('base64url')].join('$');
const db=new DatabaseSync(databasePath,{timeout:5000}); db.exec('PRAGMA foreign_keys=ON; BEGIN IMMEDIATE');
try {
  const now=new Date().toISOString();
  let row=db.prepare("SELECT id FROM users WHERE username='alsaghir'").get();
  if(!row){
    const id=randomUUID();
    db.prepare(`INSERT INTO users(id,username,display_name,password_hash,role,is_active,version,organization_id,home_branch_id,password_login_enabled,must_change_password,created_at,updated_at)
      VALUES(?,'alsaghir','الصغير',?,'employee',1,1,'org-default','branch-main',1,1,?,?)`).run(id,passwordHash,now,now); row={id};
  }
  db.prepare("UPDATE users SET display_name='الصغير',is_active=1,updated_at=? WHERE id=?").run(now,row.id);
  for(const permission of ['collections.read','collections.write']) db.prepare(`INSERT INTO user_permissions(user_id,permission,allowed,updated_at) VALUES(?,?,1,?)
    ON CONFLICT(user_id,permission) DO UPDATE SET allowed=1,updated_at=excluded.updated_at`).run(row.id,permission,now);
  db.exec('COMMIT'); console.log(String(row.id));
} catch(error){db.exec('ROLLBACK');throw error} finally{db.close()}
