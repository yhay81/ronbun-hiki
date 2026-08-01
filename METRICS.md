# Product metrics

D1にはランダム端末IDのSHA-256、許可済みイベント名、QAフラグ、時刻だけを35日保持します。

許可イベントは`visited`、`searched`、`no_result`、`doi_opened`、`citation_copied`、`saved`、`correction_seen`、`returned`です。

検索語、題名、著者、年、並び順、DOI、保存内容、IP、User-Agent、メールアドレスをイベント表へ保存しません。自動確認はQAとして分離し、実利用者へ数えません。

```powershell
npm run metrics
```
