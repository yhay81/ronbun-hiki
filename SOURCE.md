# Source and transformation

## Source

- Provider: [Crossref](https://www.crossref.org/)
- Interface: [Crossref REST API](https://www.crossref.org/documentation/retrieve-metadata/rest-api/)
- Endpoint: `https://api.crossref.org/v1/works`
- Access: public REST API; registration is not required
- Scope used here: `type:journal-article` with at most 40 upstream records per search

Crossref metadata is deposited by publishers and other members and may be supplemented by trusted sources. Crossref states that almost all metadata is reusable without restriction, while abstracts can remain subject to publisher or author copyright. 論文引きは抄録、本文、画像、参考文献本文を取得・表示しません。

## 加工内容

1. テーマ、題名、著者をCrossrefの対応するquery parametersへ渡す。
2. 指定された発表年を`from-pub-date`と`until-pub-date`へ変換する。
3. DOIと題名を持つ`journal-article`だけを採用する。
4. 題名、著者、発表日、掲載誌、出版社、DOI、Crossref引用数、更新情報件数を選択・整形する。
5. 任意で、ひらがな・カタカナを含む題名、次いで漢字を含む題名を上へ並べる。
6. 最大20件を表示し、DOIは`https://doi.org/`のHTTPS URLだけを生成する。

検索条件とCrossrefの応答はD1へ保存しません。同じ検索条件はCrossrefへの負荷を抑えるためDurable Objectの実行中メモリで20分再利用します。API呼び出しは直列化し、前回完了から1.1秒以上空けます。

## Accuracy boundary

- Crossref metadataは登録元が提供した内容で、すべての論文やすべての書誌項目を網羅するとは限りません。
- Crossref引用数はCrossref内の関係情報であり、学術的価値や他サービスの引用数と同一ではありません。
- 日本語優先は文字種による表示順の加工で、論文の言語を保証しません。
- 引用文は確認用の短い形で、投稿先・学会・学校が指定する引用スタイルを保証しません。
- 訂正・撤回を含む最新状態、本文利用条件、正式な著者表記、巻号、ページはDOI先で確認してください。

Bibliographic metadata supplied by Crossref. 論文引きはCrossrefが作成または承認した画面ではありません。
