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

const firebaseConfig = {
  apiKey: "AIzaSyCTBt4C--X3O9XvweyNqQtvR3QcmSZA7c",
  authDomain: "chouxlab-ops.firebaseapp.com",
  projectId: "chouxlab-ops",
  storageBucket: "chouxlab-ops.firebasestorage.app",
  messagingSenderId: "317568827205",
  appId: "1:317568827205:web:bde602b3d7c3b18e4a882c",
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

let uid = null;
let sessionReady = null;

/* ================= AUTH SESSION ================= */

export async function initSession() {
  if (sessionReady) return sessionReady;

  sessionReady = new Promise((resolve, reject) => {
    const unsub = onAuthStateChanged(auth, async (user) => {
      try {
        if (!user) {
          await signInAnonymously(auth);
          return;
        }
        uid = user.uid;
        unsub();
        resolve(uid);
      } catch (e) {
        reject(e);
      }
    });
  });

  return sessionReady;
}

async function ensureAuthed() {
  if (!uid) await initSession();
  return auth.currentUser;
}

/* ================= PROFILE ================= */

export async function ensureUserProfile(extra = {}) {
  const user = await ensureAuthed();
  const ref = doc(db, "users", user.uid);

  const base = {
    uid: user.uid,
    email: user.email || null,
    displayName: user.displayName || null,
    photoURL: user.photoURL || null,
    phone: extra.phone || null,
    updatedAt: serverTimestamp(),
  };

  await setDoc(ref, { ...base, createdAt: serverTimestamp(), points: 0, totalOrders: 0 }, { merge: true });
  const snap = await getDoc(ref);
  return snap.data();
}

export async function getMyProfile() {
  const user = await ensureAuthed();
  const snap = await getDoc(doc(db, "users", user.uid));
  return snap.exists() ? snap.data() : null;
}

/* ================= CART (FIXED) ================= */

export async function getCart() {
  await ensureAuthed();
  const snap = await getDoc(doc(db, "carts", uid));
  return snap.exists() ? snap.data().items || {} : {};
}

/*
  FIX:
  - No merge:true
  - Remove zero qty keys
  - Delete doc if cart empty
*/
export async function setCart(itemsObj) {
  await ensureAuthed();
  const ref = doc(db, "carts", uid);

  const cleaned = {};
  for (const [k, v] of Object.entries(itemsObj || {})) {
    const qty = Number(v);
    if (Number.isFinite(qty) && qty > 0) cleaned[k] = qty;
  }

  if (Object.keys(cleaned).length === 0) {
    await deleteDoc(ref);
    return;
  }

  await setDoc(ref, { items: cleaned, updatedAt: serverTimestamp() });
}

export async function clearCart() {
  await ensureAuthed();
  await deleteDoc(doc(db, "carts", uid));
}

/* ================= SHIPPING DRAFT ================= */

export async function saveShippingDraftToDB(shippingData) {
  const user = await ensureAuthed();
  const ref = doc(db, "users", user.uid, "drafts", "shipping");
  await setDoc(ref, { ...shippingData, updatedAt: serverTimestamp() }, { merge: true });
}

export async function loadShippingDraftFromDB() {
  const user = await ensureAuthed();
  const snap = await getDoc(doc(db, "users", user.uid, "drafts", "shipping"));
  return snap.exists() ? snap.data() : null;
}

/* ================= ORDERS ================= */

export async function createOrder(orderPayload) {
  const user = await ensureAuthed();

  const ref = await addDoc(collection(db, "orders"), {
    uid: user.uid,
    status: "pending",
    createdAt: serverTimestamp(),
    ...orderPayload,
  });

  await deleteDoc(doc(db, "carts", user.uid)); // clear cart after order
  return ref.id;
}

export async function listMyOrders(max = 20) {
  const user = await ensureAuthed();
  const qy = query(collection(db, "orders"), where("uid", "==", user.uid), orderBy("createdAt", "desc"), limit(max));
  const snap = await getDocs(qy);
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

/* ================= AUTH METHODS ================= */

export async function loginWithGoogle() {
  const provider = new GoogleAuthProvider();
  const cred = await signInWithPopup(auth, provider);
  uid = cred.user.uid;
  await ensureUserProfile();
  return cred.user;
}

export async function registerWithEmail({ name, email, password, phone }) {
  const cred = await createUserWithEmailAndPassword(auth, email, password);
  if (name) await updateProfile(cred.user, { displayName: name });
  uid = cred.user.uid;
  await ensureUserProfile({ phone });
  return cred.user;
}

export async function loginWithEmail({ email, password }) {
  const cred = await signInWithEmailAndPassword(auth, email, password);
  uid = cred.user.uid;
  await ensureUserProfile();
  return cred.user;
}

export async function signOutUser() {
  await signOut(auth);
  uid = null;
}
