/*
 * firebase-config.js — オンライン版（親システム）の接続先。
 * Firebaseコンソール → プロジェクトの設定 → マイアプリ（ウェブ）に表示される firebaseConfig をそのまま貼り付ける。
 * null のままならオンライン機能は無効（従来どおりのローカル版として動く）。
 * ※ この値は秘密情報ではない（公開ページに載せてよい）。データの保護は firestore.rules で行う。
 */
window.FIREBASE_CONFIG = null;
