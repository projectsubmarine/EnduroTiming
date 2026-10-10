/*
 * online.js — オンライン版（親システム＝Firebase）とのやり取り。本部（index.html）と各ゴール端末（goal.html）で共用。
 * 画面には触れない。ブラウザでは window.Online。
 *
 * Firestore の構成（詳細は firestore.rules）:
 *   events/{eid}                { admins:[uid], roster:{event,settings,classes,riders,startOrder,startClassOrder,startPlan}, updatedAt }
 *   events/{eid}/private/pins   { pins:{ [sec]: 'PIN' } }        本部のみ読み書き
 *   events/{eid}/devices/{uid}  { sec, pin, label, createdAt }   ゴール端末の登録（PINが正しい場合のみ作成できる）
 *   events/{eid}/entries/{id}   入力記録（追記のみ）。runs は Core.runsFromEntries() で組み立てる
 *
 * SDK（vendor/firebase）は init() を呼んだときに初めて読み込む（ローカル版・file:// では読み込まない）。
 */
(function (root) {
  'use strict';
  const SDK = ['vendor/firebase/firebase-app-compat.js', 'vendor/firebase/firebase-auth-compat.js', 'vendor/firebase/firebase-firestore-compat.js'];
  const ENTRY_KEYS = ['rider', 'bib', 'sec', 'start', 'goal', 'status', 'note', 'fix', 'del', 'by', 'dev', 'clientAt'];
  let db = null, auth = null, loading = null;

  /** オンライン機能が使えない理由（使えるなら空文字列） */
  function unavailableReason() {
    if (!/^https?:$/.test(location.protocol)) return 'file';
    if (!root.FIREBASE_CONFIG) return 'config';
    return '';
  }
  function loadScript(src) {
    return new Promise((ok, ng) => {
      const s = document.createElement('script');
      s.src = src; s.onload = ok; s.onerror = () => ng(new Error('読み込めませんでした: ' + src));
      document.head.appendChild(s);
    });
  }
  /** SDKを読み込み、オフライン保存を有効にして、ログイン状態の復元を待つ */
  function init() {
    if (loading) return loading;
    loading = (async () => {
      for (const s of SDK) await loadScript(s);
      root.firebase.initializeApp(root.FIREBASE_CONFIG);
      db = root.firebase.firestore();
      const emu = root.FIREBASE_CONFIG.emulator; // 開発・テスト用：{ firestore:'127.0.0.1:8080', auth:'http://127.0.0.1:9099' }
      if (emu) { const [h, p] = emu.firestore.split(':'); db.useEmulator(h, +p); root.firebase.auth().useEmulator(emu.auth); }
      // 通信が切れても入力を端末内に保存し、つながったら自動で送る（他のタブとも共有）
      try { await db.enablePersistence({ synchronizeTabs: true }); }
      catch (e) { console.warn('オフライン保存を有効にできませんでした', e); }
      auth = root.firebase.auth();
      await new Promise(ok => { const un = auth.onAuthStateChanged(() => { un(); ok(); }); });
    })();
    return loading;
  }

  /** 電波が無いときでもページを開けるよう、画面のファイルを端末に保存する（sw.js） */
  function registerOffline() {
    if (unavailableReason() || !('serviceWorker' in navigator)) return;
    navigator.serviceWorker.register('sw.js').catch(e => console.warn('オフライン用の保存を有効にできませんでした', e));
  }

  const ts = () => root.firebase.firestore.FieldValue.serverTimestamp();
  const evRef = eid => db.collection('events').doc(eid);

  /* ---------- ログイン ---------- */
  const user = () => auth && auth.currentUser;
  const isAdminUser = () => !!user() && !user().isAnonymous;
  const signInGoogle = () => auth.signInWithPopup(new root.firebase.auth.GoogleAuthProvider());
  const signInAnon = async () => { if (!user()) await auth.signInAnonymously(); return user(); };
  const signOut = () => auth.signOut();
  const onAuth = cb => auth.onAuthStateChanged(cb);

  /* ---------- 大会（本部） ---------- */
  // 大会コード：紛らわしい文字（0/O, 1/I）を除いた6文字
  function newEventId() {
    const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    return Array.from(crypto.getRandomValues(new Uint8Array(6)), b => A[b % A.length]).join('');
  }
  function newPin() { return String(crypto.getRandomValues(new Uint32Array(1))[0] % 1000000).padStart(6, '0'); }

  async function createEvent(roster) {
    const eid = newEventId();
    await evRef(eid).set({ admins: [user().uid], roster, createdAt: ts(), updatedAt: ts() });
    await evRef(eid).collection('private').doc('pins').set({ pins: {} });
    return eid;
  }
  // 名簿（ライダー・クラス等。runs は含めない）を更新。通信が切れていても端末内に保存され、あとで送られる
  const pushRoster = (eid, roster) => evRef(eid).update({ roster, updatedAt: ts() });
  const watchEvent = (eid, cb, err) => evRef(eid).onSnapshot(d => cb(d.exists ? d.data() : null, d.metadata), err);
  const getPins = async eid => ((await evRef(eid).collection('private').doc('pins').get()).data() || {}).pins || {};
  const setPins = (eid, pins) => evRef(eid).collection('private').doc('pins').set({ pins });
  const watchDevices = (eid, cb, err) => evRef(eid).collection('devices').onSnapshot(
    q => cb(q.docs.map(d => ({ id: d.id, ...d.data() }))), err);
  const removeDevice = (eid, devUid) => evRef(eid).collection('devices').doc(devUid).delete();

  /* ---------- ゴール端末 ---------- */
  // PINが正しくなければ権限エラーで失敗する（通信が必要）
  const registerDevice = (eid, sec, pin, label) =>
    evRef(eid).collection('devices').doc(user().uid).set({ sec: String(sec), pin: String(pin), label: String(label || ''), createdAt: ts() });
  const getMyDevice = async eid => { const d = await evRef(eid).collection('devices').doc(user().uid).get(); return d.exists ? d.data() : null; };

  /* ---------- 入力記録 ---------- */
  /**
   * 入力記録を監視する。sec を指定するとそのセクションだけ（ゴール端末はこれ以外読めない）。
   * cb(entries, {fromCache, pending})  entries[].pending=true は未送信（端末内にのみある）
   */
  function watchEntries(eid, sec, cb, err) {
    let q = evRef(eid).collection('entries');
    if (sec != null) q = q.where('sec', '==', String(sec));
    return q.onSnapshot({ includeMetadataChanges: true }, s => {
      const list = s.docs.map(d => ({ id: d.id, ...d.data(), pending: d.metadata.hasPendingWrites }));
      cb(list, { fromCache: s.metadata.fromCache, pending: list.filter(e => e.pending).length });
    }, err);
  }
  const newEntryId = eid => evRef(eid).collection('entries').doc().id;
  /** 記録を追加する。id は newEntryId() で先に決めておける（端末内の控えと照合するため）。完了を待たなくてよい */
  function addEntry(eid, entry, id) {
    const data = {};
    for (const k of ENTRY_KEYS) if (entry[k] !== undefined) data[k] = entry[k]; // Firestoreはundefinedを保存できない
    data.by = user().uid;
    data.clientAt = entry.clientAt ?? Date.now();
    data.at = ts();
    return evRef(eid).collection('entries').doc(id || newEntryId(eid)).set(data);
  }

  root.Online = {
    unavailableReason, registerOffline, init, user, isAdminUser, signInGoogle, signInAnon, signOut, onAuth,
    newPin, createEvent, pushRoster, watchEvent, getPins, setPins, watchDevices, removeDevice,
    registerDevice, getMyDevice, watchEntries, newEntryId, addEntry,
  };
})(this);
