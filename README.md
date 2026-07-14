# バトルライン

ブラウザで2人対戦できる、バトルライン風のカードゲームMVPです。

## 構成

- Frontend: HTML / CSS / JavaScript
- Server: Node.js
- State: サーバーメモリ上の部屋管理
- Database: なし

## ローカル起動

```bash
npm start
```

起動後、ブラウザで以下を開きます。

```text
http://localhost:3000
```

## デプロイ

RenderなどのNode.js Web Serviceとしてデプロイできます。

- Build Command: `npm install`
- Start Command: `npm start`

サーバーは `process.env.PORT` を利用します。

## 注意

部屋情報はサーバーメモリ上に保存されます。サーバー再起動や一定時間アクセスがない場合、部屋は消えます。
