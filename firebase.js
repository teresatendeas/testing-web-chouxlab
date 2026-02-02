// firebase.js (ES Module)
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";

import {
  getAuth,
  onAuthStateChanged,
  signInAnonymously,
  signOut,
  GoogleAuthProvider,
  signInWithPopup,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  updateProfile,
  setPersistence,
  browserLocalPersistence,
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";

import {
  getFirestore,
  doc,
  getDoc,
  setDoc,
  deleteDoc,
  addDoc,
  collection,
  serverTimestamp,
  query,
  where,
  orderBy,
  limit,
  getDocs,
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";

// Paste from Firebase Console > Project settings > Web app
const firebaseConfig = {
  apiKey: "AIzaSyCTBt4C--X3oO9XvweyNqQtvR3QcmSZA7c",
  authDomain: "chouxlab-ops.firebaseapp.com",
  projectId: "chouxlab-ops",
  storageBucket: "chouxlab-ops.firebasestorage.app",
  messagingSenderId: "317568827205",
  appId: "1:317568827205:web:bde602b3d7c3b18e4a882c"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

let uid = null;
let initPromise = null;

// Keep session across refreshes (important on GitHub Pages)
setPersistence(auth, browserLocalPersistence).catch((e) => {
  console.warn("Auth persistence failed:", e);
});

export async function initSession() {
  if (initPromise) return initPromise;

  initPromise = new Promise((resolve, reject) => {
    const unsub = onAuthStateChanged(auth, async (user) => {
      try {
        // If not signed in yet, sign in anonymously
        if (!user) {
          await signInAnonymously(auth);
          return; // onAuthStateChanged will fire again with the user
        }

        uid = user.uid;
        unsub();
        resolve(uid);
      } catch (e) {
        console.error("initSession failed:", e);
        reject(e);
      }
    });
  });

  return initPromise;
}

async function ensureAuthed() {
  if (!auth.currentUser || !uid) {
    await initSession();
  }
  if (!auth.currentUser) {
    throw new Error("Auth not ready. Anonymous sign-in may be blocked.");
  }
  uid = auth.currentUser.uid;
  return auth.currentUser;
}

export function getCurrentUser() {
  return auth.currentUser;
}

export function onUserChanged(cb) {
  return onAuthStateChanged(auth, (user) => {
    uid = user ? user.uid : null;
    cb(user);
  });
}

export async function signOutUser() {
  await signOut(auth);
  uid = null;
  initPromise = null; // allow re-init
}

/**
 * Profile document: users/{uid}
 */
export async function ensureUserProfile(extra = {}) {
  const user = await ensureAuthed();
  const ref = doc(db, "users", user.uid);
  const snap = await getDoc(ref);

  const base = {
    uid: user.uid,
    email: user.email || null,
    displayName: user.displayName || null,
    photoURL: user.photoURL || null,
    phone: extra.phone || null,
    updatedAt: serverTimestamp(),
  };

  if (!snap.exists()) {
    await setDoc(
      ref,
      { ...base, createdAt: serverTimestamp(), points: 0, totalOrders: 0 },
      { merge: true }
    );
  } else {
    await setDoc(ref, base, { merge: true });
  }

  const updated = await getDoc(ref);
  return updated.exists() ? updated.data() : null;
}

export async function getMyProfile() {
  const user = await ensureAuthed();
  const ref = doc(db, "users", user.uid);
  const snap = await getDoc(ref);
  return snap.exists() ? snap.data() : null;
}

/**
 * Cart stored at carts/{uid}
 * doc format: { items: { vanilla: 1, chocolate: 2 }, updatedAt }
 */
export async function getCart() {
  await ensureAuthed();
  const ref = doc(db, "carts", uid);
  const snap = await getDoc(ref);
  if (!snap.exists()) return {};
  return snap.data()?.items || {};
}

/**
 * IMPORTANT:
 * - overwrite cart doc (no merge)
 * - delete doc when empty
 */
export async function setCart(itemsObj) {
  await ensureAuthed();
  const ref = doc(db, "carts", uid);

  const safeItems = itemsObj && typeof itemsObj === "object" ? itemsObj : {};
  const cleaned = {};

  for (const [k, v] of Object.entries(safeItems)) {
    const qty = Number(v);
    if (Number.isFinite(qty) && qty > 0) cleaned[k] = qty;
  }

  if (Object.keys(cleaned).length === 0) {
    await deleteDoc(ref);
    return;
  }

  // overwrite (no merge) so removed keys disappear
  await setDoc(ref, { items: cleaned, updatedAt: serverTimestamp() });
}

export async function clearCart() {
  await ensureAuthed();
  await deleteDoc(doc(db, "carts", uid));
}

/**
 * Shipping draft stored at users/{uid}/drafts/shipping
 */
export async function saveShippingDraftToDB(shippingData) {
  const user = await ensureAuthed();
  const ref = doc(db, "users", user.uid, "drafts", "shipping");
  await setDoc(ref, { ...shippingData, updatedAt: serverTimestamp() }, { merge: true });
}

export async function loadShippingDraftFromDB() {
  const user = await ensureAuthed();
  const ref = doc(db, "users", user.uid, "drafts", "shipping");
  const snap = await getDoc(ref);
  return snap.exists() ? snap.data() : null;
}

/**
 * Orders stored at orders
 */
export async function createOrder(orderPayload) {
  const user = await ensureAuthed();

  const ref = await addDoc(collection(db, "orders"), {
    uid: user.uid,
    status: "pending",
    createdAt: serverTimestamp(),
    ...orderPayload,
  });

  // optional counter update
  try {
    const profileRef = doc(db, "users", user.uid);
    const profSnap = await getDoc(profileRef);
    const prev = profSnap.exists() ? profSnap.data() : {};
    const totalOrders = (prev.totalOrders || 0) + 1;
    await setDoc(profileRef, { totalOrders, updatedAt: serverTimestamp() }, { merge: true });
  } catch {}

  // optional: clear cart after order
  try {
    await deleteDoc(doc(db, "carts", user.uid));
  } catch {}

  return ref.id;
}

export async function listMyOrders(max = 20) {
  const user = await ensureAuthed();
  const qy = query(
    collection(db, "orders"),
    where("uid", "==", user.uid),
    orderBy("createdAt", "desc"),
    limit(max)
  );
  const snap = await getDocs(qy);
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

/**
 * === AUTH (Email/Password + Google) ===
 */
async function migrateAnonDataIfNeeded(anonUid, newUid) {
  if (!anonUid || !newUid || anonUid === newUid) return;

  // migrate cart
  try {
    const anonCartRef = doc(db, "carts", anonUid);
    const anonCartSnap = await getDoc(anonCartRef);

    if (anonCartSnap.exists()) {
      const anonItems = anonCartSnap.data()?.items || {};
      const newCartRef = doc(db, "carts", newUid);
      const newCartSnap = await getDoc(newCartRef);

      if (!newCartSnap.exists()) {
        await setDoc(newCartRef, {
          items: anonItems,
          migratedFrom: anonUid,
          updatedAt: serverTimestamp(),
        });
      }

      await deleteDoc(anonCartRef);
    }
  } catch {}

  // migrate shipping draft
  try {
    const anonDraftRef = doc(db, "users", anonUid, "drafts", "shipping");
    const anonDraftSnap = await getDoc(anonDraftRef);

    if (anonDraftSnap.exists()) {
      const newDraftRef = doc(db, "users", newUid, "drafts", "shipping");
      const newDraftSnap = await getDoc(newDraftRef);

      if (!newDraftSnap.exists()) {
        await setDoc(
          newDraftRef,
          { ...anonDraftSnap.data(), migratedFrom: anonUid, updatedAt: serverTimestamp() },
          { merge: true }
        );
      }

      await deleteDoc(anonDraftRef);
    }
  } catch {}
}

export async function loginWithGoogle() {
  const before = auth.currentUser;
  const anonUid = before?.isAnonymous ? before.uid : null;

  const provider = new GoogleAuthProvider();
  const cred = await signInWithPopup(auth, provider);

  uid = cred.user.uid;

  await migrateAnonDataIfNeeded(anonUid, uid);
  await ensureUserProfile();

  return cred.user;
}

export async function registerWithEmail({ name, email, password, phone }) {
  const before = auth.currentUser;
  const anonUid = before?.isAnonymous ? before.uid : null;

  const cred = await createUserWithEmailAndPassword(auth, email, password);

  if (name) {
    await updateProfile(cred.user, { displayName: name });
  }

  uid = cred.user.uid;

  await migrateAnonDataIfNeeded(anonUid, uid);
  await ensureUserProfile({ phone });

  return cred.user;
}

export async function loginWithEmail({ email, password }) {
  const before = auth.currentUser;
  const anonUid = before?.isAnonymous ? before.uid : null;

  const cred = await signInWithEmailAndPassword(auth, email, password);

  uid = cred.user.uid;

  await migrateAnonDataIfNeeded(anonUid, uid);
  await ensureUserProfile();

  return cred.user;
}
