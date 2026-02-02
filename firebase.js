// firebase.js (ES Module)
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import {
  getAuth,
  onAuthStateChanged,
  signInAnonymously
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
  getDocs
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyCTBt4C--X3oO9XvweyNqQtvR3QcmSZA7c",
  authDomain: "chouxlab-ops.firebaseapp.com",
  projectId: "chouxlab-ops",
  storageBucket: "chouxlab-ops.appspot.com",
  messagingSenderId: "317568827205",
  appId: "1:317568827205:web:bde602b3d7c3b18e4a882c"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

let uid = null;

/* ---------------- AUTH SESSION ---------------- */
export async function initSession() {
  if (uid) return uid;

  return new Promise((resolve, reject) => {
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
        console.error("initSession error:", e);
        reject(e);
      }
    });
  });
}

/* ---------------- CART ---------------- */
export async function getCart() {
  if (!uid) await initSession();
  const ref = doc(db, "carts", uid);
  const snap = await getDoc(ref);
  return snap.exists() ? snap.data().items || {} : {};
}

export async function setCart(itemsObj) {
  if (!uid) await initSession();
  const ref = doc(db, "carts", uid);

  // remove zero/invalid items
  const cleaned = {};
  for (const [k, v] of Object.entries(itemsObj || {})) {
    const qty = Number(v);
    if (qty > 0) cleaned[k] = qty;
  }

  // if empty → delete cart
  if (Object.keys(cleaned).length === 0) {
    await deleteDoc(ref);
    return;
  }

  // overwrite doc (NOT merge) so removed items disappear
  await setDoc(ref, { items: cleaned, updatedAt: serverTimestamp() });
}

export async function clearCart() {
  if (!uid) await initSession();
  await deleteDoc(doc(db, "carts", uid));
}

/* ---------------- ORDERS ---------------- */
export async function createOrder(orderPayload) {
  if (!uid) await initSession();
  const ref = await addDoc(collection(db, "user_orders"), {
    uid,
    status: "pending",
    createdAt: serverTimestamp(),
    ...orderPayload,
  });
  return ref.id;
}

export async function listMyOrders(max = 20) {
  if (!uid) await initSession();
  const q = query(
    collection(db, "user_orders"),
    where("uid", "==", uid),
    orderBy("createdAt", "desc"),
    limit(max)
  );
  const snap = await getDocs(q);
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

/* ---------------- SHIPPING DRAFT ---------------- */
export async function saveShippingDraftToDB(shippingData) {
  if (!uid) await initSession();
  const ref = doc(db, "users", uid, "drafts", "shipping");
  await setDoc(ref, { ...shippingData, updatedAt: serverTimestamp() }, { merge: true });
}

export async function loadShippingDraftFromDB() {
  if (!uid) await initSession();
  const ref = doc(db, "users", uid, "drafts", "shipping");
  const snap = await getDoc(ref);
  return snap.exists() ? snap.data() : null;
}
export function getCurrentUser() {
  return auth.currentUser;
}
