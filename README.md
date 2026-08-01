# 論文引き

テーマ、題名、著者、発表年からCrossrefの論文メタデータを探し、DOI、訂正情報の有無、引用用の短い書誌を確認する日本語Webサービスです。

## 主な機能

- テーマ・題名・著者・発表年の組み合わせ検索
- 関連度、新しい順、Crossref引用数順
- 日本語らしい題名の優先表示
- DOI、掲載誌、出版社、発表日、訂正・更新情報の有無を表示
- 引用用テキストのコピー
- 最大50件の「あとで読む束」をブラウザ内だけに保存

## 開発

```powershell
npm install
npx wrangler d1 migrations apply ronbun-hiki --local
npm run dev
```

品質確認は`npm run release:check`、`npm run check`、`npm test`、`npm run build`で行います。

## 公開先

- Product: https://ronbun-hiki.yhay81.com
- Source metadata: https://api.crossref.org/v1/works

MIT License. Crossref由来メタデータの権利と利用条件は[SOURCE.md](SOURCE.md)を参照してください。
