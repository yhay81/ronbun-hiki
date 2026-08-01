# Privacy

## Search

検索条件は検索実行時だけCloudflare Workerを経由してCrossref REST APIへ送られます。製品URL、D1、利用イベントへ保存しません。同条件の応答は負荷軽減のため実行中メモリで20分再利用します。

## Local saving

「あとで読む束」は公開書誌情報を最大50件、このブラウザの`localStorage`へ保存します。利用者はいつでも個別に外すか、束全体を空にできます。

## Anonymous measurement

ブラウザで作ったランダムIDをサーバーでSHA-256へ変換し、許可済みイベント名、QAフラグ、時刻とともに35日保持します。Cookie、広告、外部解析、アカウントを使いません。

Crossref側のアクセス記録はCrossrefの方針が適用されます。
