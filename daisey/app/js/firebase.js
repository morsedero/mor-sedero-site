// Firebase init, sign-in/out, Firestore handles. Loaded straight from
// Google's CDN as ES modules — no bundler, so the version is pinned here and
// nowhere else.
const V = "11.10.0";
const { initializeApp } = await import(`https://www.gstatic.com/firebasejs/${V}/firebase-app.js`);
const auth = await import(`https://www.gstatic.com/firebasejs/${V}/firebase-auth.js`);
const fs = await import(`https://www.gstatic.com/firebasejs/${V}/firebase-firestore.js`);

import { firebaseConfig } from "./config.js";

const app = initializeApp(firebaseConfig);
const a = auth.getAuth(app);
// Offline cache in IndexedDB, shared across tabs: reload shows last-known
// data instantly, and writes made offline go out on reconnect.
export const db = fs.initializeFirestore(app, {
  localCache: fs.persistentLocalCache({ tabManager: fs.persistentMultipleTabManager() }),
});

export function onUser(cb){ return auth.onAuthStateChanged(a, cb); }

// Popup, not redirect: redirect sign-in breaks in Safari (and soon Chrome)
// when the page and authDomain (*.firebaseapp.com) are different sites,
// because the result is stored in partitioned third-party storage.
export async function signIn(){
  const p = new auth.GoogleAuthProvider();
  p.setCustomParameters({ prompt: "select_account" });
  await auth.signInWithPopup(a, p);
}

export function signOut(){ return auth.signOut(a); }

export const { doc, setDoc, onSnapshot, serverTimestamp } = fs;
