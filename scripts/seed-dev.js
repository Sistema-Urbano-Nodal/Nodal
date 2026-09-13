import { randomUUID } from 'node:crypto';
import { createDatabase, createUser, getUserByEmail, updateUserProfile, addFollowDb, recordInteractionDb } from '../server/db.js';
import { hashPassword } from '../server/auth.js';
import { seedData } from '../server/store.js';

if (process.env.NODE_ENV === 'production') {
  throw new Error('seed:dev is for development only; refusing to modify a production database');
}

const db = createDatabase();

const adminEmail = process.env.SEED_ADMIN_EMAIL || 'admin@nodal.local';
const adminPassword = process.env.SEED_ADMIN_PASSWORD;

if (adminPassword && !getUserByEmail(db, adminEmail)) {
  const admin = createUser(db, {
    fullName: process.env.SEED_ADMIN_NAME || 'NODAL Admin',
    email: adminEmail,
    passwordHash: await hashPassword(adminPassword),
    role: 'admin',
    title: 'NODAL Admin',
    city: 'Lima',
  });
  updateUserProfile(db, admin.id, {
    interests: ['community engagement', 'public policy'],
    active: ['am', 'pm'],
    topics: [{ name: 'Governance & participation', level: 3, validatedAt: 0, endorsedAt: 0 }],
    assessed: true,
  });
  console.log(`created admin: ${adminEmail}`);
} else if (!adminPassword) {
  console.log('skipped admin: set SEED_ADMIN_PASSWORD to create one');
}

const seed = seedData();
const idMap = new Map();
for (const persona of seed.users.filter((u) => u.id !== 'you')) {
  const email = `${persona.id}@seed.nodal.local`;
  let row = getUserByEmail(db, email);
  if (!row) {
    row = createUser(db, {
      fullName: persona.name,
      email,
      passwordHash: await hashPassword(`seed-${randomUUID()}`),
      title: persona.role,
      city: persona.city,
    });
    updateUserProfile(db, row.id, {
      interests: persona.interests,
      active: persona.active,
      linkedin: persona.linkedin || '',
      topics: persona.interests.slice(0, 4).map((name, i) => ({ name, level: i === 0 ? 3 : 2, validatedAt: 0, endorsedAt: 0 })),
      partC: { linkedin: persona.linkedin || '', bio: '', portfolio: '', references: '', availability: '', consent: true },
      assessed: true,
    });
  }
  idMap.set(persona.id, row.id);
}

for (const [from, targets] of Object.entries(seed.follows)) {
  if (!idMap.has(from)) continue;
  for (const target of targets) if (idMap.has(target)) addFollowDb(db, idMap.get(from), idMap.get(target));
}
for (const interaction of seed.interactions) {
  if (idMap.has(interaction.from) && idMap.has(interaction.to)) {
    recordInteractionDb(db, idMap.get(interaction.from), idMap.get(interaction.to), interaction.type);
  }
}

db.close();
console.log('dev seed complete');
