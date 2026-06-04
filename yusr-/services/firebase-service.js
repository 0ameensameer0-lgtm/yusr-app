import { firebaseConfig, firebaseCollections } from "../firebase-config.js";

export class FirebaseService {
  constructor() {
    this.enabled = !firebaseConfig.apiKey.includes("ضع-");
    this.app = null;
    this.db = null;
    this.auth = null;
    this.storage = null;
  }

  async init() {
    if (!this.enabled || this.app) return this.enabled;
    const [{ initializeApp }, { getFirestore }, { getAuth }, { getStorage }] = await Promise.all([
      import("https://www.gstatic.com/firebasejs/10.12.4/firebase-app.js"),
      import("https://www.gstatic.com/firebasejs/10.12.4/firebase-firestore.js"),
      import("https://www.gstatic.com/firebasejs/10.12.4/firebase-auth.js"),
      import("https://www.gstatic.com/firebasejs/10.12.4/firebase-storage.js")
    ]);
    this.app = initializeApp(firebaseConfig);
    this.db = getFirestore(this.app);
    this.auth = getAuth(this.app);
    this.storage = getStorage(this.app);
    return true;
  }

  async saveDocument(collectionName, id, data) {
    if (!(await this.init())) return false;
    const { doc, setDoc, serverTimestamp } = await import("https://www.gstatic.com/firebasejs/10.12.4/firebase-firestore.js");
    await setDoc(doc(this.db, firebaseCollections[collectionName] || collectionName, id), { ...data, updatedAt: serverTimestamp() }, { merge: true });
    return true;
  }
}
