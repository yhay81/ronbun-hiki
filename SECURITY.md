# Security

- 検索APIと計測APIは同一生成元のJSON POSTだけを受け付ける。
- 検索入力は長さ、文字、年範囲、列挙値を正規化・検証する。
- Crossref URLは固定し、API応答を2MB以下、表示20件以下に制限する。
- DOIリンクは検証済みDOIから`https://doi.org/`だけを生成する。
- API由来文字列はDOMの`textContent`で表示し、HTMLとして解釈しない。
- Durable Objectで外部API呼び出しを直列化し、完了後1.1秒以上空ける。
- CSP、同一生成元ポリシー、権限ポリシー、MIME sniffing防止を設定する。
- 抄録、本文、検索語、著者名、DOIを計測データへ保存しない。

脆弱性は公開リポジトリのSecurity advisoryまたは管理者への非公開経路で報告してください。論文内容や書誌訂正はDOI先の出版社・登録機関へ確認してください。
