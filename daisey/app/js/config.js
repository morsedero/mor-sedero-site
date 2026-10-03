// Firebase web config for the `daisey` project (console → Project settings →
// Your apps → daisey-web). Not a secret: it identifies the project, it does not
// grant access. Access is decided by daisey/firestore.rules.
export const firebaseConfig = {
  apiKey: "AIzaSyBBCdQayBlnbcD04u6WjjAvZIGKxdQm98w",
  authDomain: "daisey-3bd45.firebaseapp.com",
  projectId: "daisey-3bd45",
  storageBucket: "daisey-3bd45.firebasestorage.app",
  messagingSenderId: "725728060148",
  appId: "1:725728060148:web:8b491ccd6494a2b8fbf4a1"
};

export const configured = !Object.values(firebaseConfig).includes("PASTE_ME");