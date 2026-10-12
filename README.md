# lucky-numbers

ボードゲーム「ラッキーナンバー」をブラウザで遊べるようにしたものです。CPU との対戦と、友人とのオンライン対戦ができます。

**遊ぶ:** https://123yoshidandy.github.io/lucky-numbers/

## ルール

- 1〜20 の数字タイルを人数分使う。各自 4×4 の庭を持つ
- 最初に4枚引き、小さい順に左上から右下への斜めに置く
- 手番では「山札から1枚引く」か「場（表向き）から1枚取る」
  - 引いたタイルは庭に置くか、場に出す。場から取ったタイルは必ず庭に置く
  - 空いたマスに置くか、置いてあるタイルと入れ替える（入れ替えたタイルは場に出る）
  - 庭の各行は左から右へ、各列は上から下へ、数字が大きくなるように置く（斜めは関係ない）
- 庭の16マスを最初に埋めた人の勝ち。山札がなくなったら、庭のタイルが一番多い人の勝ち

## 遊び方

### CPU 対戦
1. 開始画面で人数（2〜4人）・名前・CPUかどうかを選び、「ゲーム開始」を押す（同じ端末で人間どうしが交代で遊ぶこともできる）

### オンライン対戦
1. 開始画面で「オンラインで遊ぶ」を押し、名前を入れて「部屋を作る」を押す
2. 「招待URLを共有」で友人にURLを送る（友人は開いて名前を入れ、「参加する」を押す。部屋番号（数字5桁）でも参加できる）
3. 部屋を作った人が、必要ならCPUを追加して「ゲーム開始」を押す
4. ゲームが終わったら、部屋を作った人が「部屋に戻る」で同じメンバーと続けて遊べる

接続が切れても、同じ端末で開き直せば同じ席に戻れます。

## 開発

必要なもの：Node.js 22 以上、Python 3（画面を手元で配信するため）

```bash
npm install

# 画面を手元で配信して http://localhost:8080 を開く
python3 -m http.server -d public 8080

# テスト
npm test
```

### オンライン対戦を手元で試す

AWS を使わずに、同じ処理のテスト用サーバーを手元で動かせます。画面を `localhost` で開くと、自動でこのサーバーにつながります。

```bash
npm run dev:server   # ws://localhost:8787（PORT=8788 などで変えられる）
```

URLに `?server=wss://...` を付けると、接続先のサーバーを変えられます。

## 構成

```
index.html         public/ へ移動するだけのページ（GitHub Pages ではリポジトリのルートが公開されるため）
public/            画面（GitHub Pages でそのまま公開する）
  js/
    game.js          ゲームの進行（DOMに依存しない。サーバーでも使う）
    cpu-player.js    CPUの戦略
    game-view.js     プレイヤーごとに見える状態（山札の並びは含まない）
    random.js        シード付きの乱数（同じ操作の記録から同じゲームを再現する）
    game-controller.js   ローカル対戦のコントローラー
    online-controller.js オンライン対戦のコントローラー
    online-config.js     オンライン対戦のサーバーの URL
    ui.js            画面の描画と操作
server/            オンライン対戦のサーバー
  src/room-service.js  部屋の処理（作成・参加・操作の受け付け・CPUの進行）
  src/handler.js       Lambda の入口
  src/dynamo-store.js  DynamoDB への保存
  dev-server.js        手元で試すためのテスト用サーバー
  template.yaml        AWS SAM のテンプレート
test/              テスト（Vitest）
```

### オンライン対戦のしくみ

- サーバーがゲームを進め、各プレイヤーにはその人から見える状態だけを送る（山札の並びは送らない）
- 部屋には参加者・乱数のシード・操作の記録だけを保存し、操作を受けるたびに記録からゲームを再現する
- CPU はサーバーで動かし、1手ずつ届ける

## サーバー（AWS）

API Gateway（WebSocket）・Lambda・DynamoDB を AWS SAM で作ります（東京リージョン、スタック名 `lucky-numbers-online`）。

- 部屋は最後の操作から2日、ログは7日で自動的に消える
- 想定外のアクセスに備えて、受け付けるリクエストの数に上限を設けている
- 料金の通知（AWS Budgets）を任意で作れる。アカウント全体の今月の料金が上限（既定は1ドル）を超えたとき・超えそうなときにメールで知らせる（同じアカウントに別の通知があれば不要）

### デプロイ

AWS SAM CLI と AWS CLI が必要です。プロフィールは環境変数で渡します。変更内容を表示し、確認してから反映します。

```bash
AWS_PROFILE=<プロフィール名> npm run deploy:server
# 料金の通知も作るとき
AWS_PROFILE=<プロフィール名> npm run deploy:server -- --parameter-overrides "BudgetEmail=<通知先>"
```

デプロイ後に出力される `WebSocketUrl` を、`public/js/online-config.js` の `DEPLOYED_SERVER_URL` に書きます。

画面（`public/`）は main ブランチに push すると GitHub Pages に反映されます。
