/**
 * オンライン対戦のサーバーの URL
 * AWS にデプロイしたら、出力された WebSocketUrl を DEPLOYED_SERVER_URL に書く
 */

const DEPLOYED_SERVER_URL = 'wss://rqxgz8ki10.execute-api.ap-northeast-1.amazonaws.com/prod';
const LOCAL_SERVER_URL = 'ws://localhost:8787'; // npm run dev:server で起動するテスト用サーバー

// ?server=wss://... で接続先を変えられる。手元（localhost）で開いたときはテスト用サーバーにつなぐ
export function getServerUrl() {
    const override = new URLSearchParams(location.search).get('server');
    if (override) return override;
    if (['localhost', '127.0.0.1'].includes(location.hostname) || location.protocol === 'file:') {
        return LOCAL_SERVER_URL;
    }
    return DEPLOYED_SERVER_URL;
}
