# Firebase JS SDK（compat版）

オンライン版（Firebase）で使う公式SDKをそのまま同梱したもの（CDNを使わないため）。

- バージョン：firebase 13.0.0（npm パッケージのルートにある `firebase-*-compat.js`。`sourceMappingURL` 行のみ削除）
- ライセンス：Apache License 2.0（https://github.com/firebase/firebase-js-sdk/blob/main/LICENSE）
- 更新方法：`npm pack firebase@<版>` → 展開して `firebase-app-compat.js` / `firebase-auth-compat.js` / `firebase-firestore-compat.js` を置き換える。
