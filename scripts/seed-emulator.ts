/**
 * Seed script for Firebase Local Emulator.
 *
 * Populates Auth emulator and Firestore emulator with the 4 default test users
 * (Full-timer, Trainee, Student, Community) and approved /users/{uid} documents.
 *
 * Usage:
 *   npx tsx scripts/seed-emulator.ts
 */

import { initializeApp, getApps, getApp } from 'firebase-admin';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';
import { DEFAULT_CREDENTIALS } from '../e2e/helpers/auth-defaults.js';

// Route firebase-admin to local emulators
process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';
process.env.FIREBASE_AUTH_EMULATOR_HOST = process.env.FIREBASE_AUTH_EMULATOR_HOST || '127.0.0.1:9099';

const projectId = process.env.FIREBASE_PROJECT_ID || process.env.VITE_FIREBASE_PROJECT_ID || 'sac-campus-hub';
const firestoreDatabaseId = process.env.FIRESTORE_DATABASE_ID || process.env.VITE_FIREBASE_FIRESTORE_DB_ID || 'qa-db';

if (getApps().length === 0) {
  initializeApp({ projectId });
}

const auth = getAuth();
const db = getFirestore(getApp());

const KEYS = ['fulltimer', 'trainee', 'trainee2', 'student', 'community'] as const;

export async function seedEmulator() {
  console.log('Seeding Firebase Emulator Auth & Firestore...');

  const uids: Partial<Record<(typeof KEYS)[number], string>> = {};

  for (const key of KEYS) {
    const { email, password, role, label } = DEFAULT_CREDENTIALS[key];

    let uid: string;
    try {
      const existingUser = await auth.getUserByEmail(email);
      uid = existingUser.uid;
    } catch {
      const newUser = await auth.createUser({
        email,
        password,
        displayName: label,
      });
      uid = newUser.uid;
    }

    // Seed approved /users/{uid} document
    await db.collection('users').doc(uid).set(
      {
        email,
        displayName: label,
        photoURL: '',
        role,
        approved: true,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );

    console.log(`  ✓ ${key.padEnd(10)} ${email.padEnd(24)} uid=${uid} role=${role}`);
    uids[key] = uid;
  }

  // Seed one direct conversation so the messages rail renders both sections
  // (Announcements vs Conversations) — sectioning only shows when both exist.
  await db.collection('chatRooms').doc('e2e-dm-check-in').set(
    {
      type: 'direct',
      memberIds: [uids.fulltimer, uids.trainee],
      createdById: uids.fulltimer,
      createdByName: DEFAULT_CREDENTIALS.fulltimer.label,
      createdAt: FieldValue.serverTimestamp(),
      lastMessage: {
        text: 'Welcome aboard! Reply here any time.',
        senderId: uids.fulltimer,
        senderName: DEFAULT_CREDENTIALS.fulltimer.label,
        timestamp: FieldValue.serverTimestamp(),
      },
    },
    { merge: true },
  );

  // Seed initial sample gathering so gathering/attendance tests have data
  const sampleGatheringRef = db.collection('gatherings').doc('e2e-sample-gathering');
  await sampleGatheringRef.set({
    title: 'E2E Campus Gathering',
    type: 'large_group',
    dateTime: new Date().toISOString(),
    location: 'Campus Center',
    createdAt: FieldValue.serverTimestamp(),
  }, { merge: true });

  // Seed default stages for The Journey board
  const defaultStages = [
    { label: 'First Contact', color: 'bg-primary-fixed-dim', order: 0 },
    { label: 'Second Contact', color: 'bg-primary', order: 1 },
    { label: 'Regular', color: 'bg-secondary', order: 2 },
  ];
  for (const s of defaultStages) {
    const stageDocRef = db.collection('stages').doc(`stage-${s.order}`);
    await stageDocRef.set(s, { merge: true });
  }

  // Seed sample contact for walking-together threads and team confidentiality tests
  let fulltimerUid = '';
  let traineeUid = '';
  try {
    fulltimerUid = (await auth.getUserByEmail(DEFAULT_CREDENTIALS.fulltimer.email)).uid;
    traineeUid = (await auth.getUserByEmail(DEFAULT_CREDENTIALS.trainee.email)).uid;
  } catch {
    // fallback
  }

  const sampleContactRef = db.collection('contacts').doc('e2e-contact-lila');
  await sampleContactRef.set({
    name: 'Lila Chen',
    initials: 'LC',
    role: 'Undergrad',
    stage: 'First Contact',
    tags: ['Freshman', 'Gospel'],
    notes: 'Met at campus orientation.',
    createdBy: fulltimerUid || 'fulltimer-uid',
    createdByName: 'Full-timer Test User',
    owner: fulltimerUid || 'fulltimer-uid',
    coCreators: traineeUid ? [traineeUid] : [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }, { merge: true });

  const sampleInteractionRef = sampleContactRef.collection('interactions').doc('e2e-int-1');
  await sampleInteractionRef.set({
    userId: traineeUid || 'trainee-uid',
    userName: 'Trainee Test User',
    content: 'Had a warm coffee conversation discussing campus faith life.',
    dateTime: new Date().toISOString(),
    type: 'coffee',
    createdAt: new Date().toISOString(),
  }, { merge: true });

  // General walking-together thread message on contact
  await sampleContactRef.collection('threads').doc('e2e-thread-1').set({
    interactionId: null,
    parentId: null,
    scope: null,
    from: fulltimerUid || 'fulltimer-uid',
    fromName: 'Full-timer Test User',
    kind: 'encouragement',
    body: 'Great first connection with Lila. Let us follow up this week.',
    at: new Date().toISOString(),
    reactions: [],
  }, { merge: true });

  // General thread message on interaction
  await sampleContactRef.collection('threads').doc('e2e-thread-2').set({
    interactionId: 'e2e-int-1',
    parentId: null,
    scope: null,
    from: traineeUid || 'trainee-uid',
    fromName: 'Trainee Test User',
    kind: 'question',
    body: 'Should we invite her to the small group dinner next Tuesday?',
    at: new Date().toISOString(),
    reactions: [],
  }, { merge: true });

  // Confidential full-timer only team discussion
  await sampleContactRef.collection('threads').doc('e2e-thread-confidential').set({
    interactionId: null,
    parentId: null,
    scope: 'team',
    from: fulltimerUid || 'fulltimer-uid',
    fromName: 'Full-timer Test User',
    kind: 'note',
    body: 'Confidential Staff Note: Lila mentioned some family challenges back home. Full-timers keep in prayer.',
    at: new Date().toISOString(),
    reactions: [],
  }, { merge: true });

  console.log('Emulator seeding complete.');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  seedEmulator()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('Emulator seed failed:', err);
      process.exit(1);
    });
}
