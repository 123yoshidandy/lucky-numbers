/**
 * Lucky Numbers の起動
 */

import UI from './ui.js';
import NetplayClient from './netplay/netplay-client.mjs';

// 画面を拡大させない（ふつうは style.css の touch-action で止まる。古い iOS は2本指の操作を止める）
// touchmove は止めない（passive でない touchmove があると、スクロールの始まりが遅れるため）
document.addEventListener('gesturestart', event => event.preventDefault());

document.addEventListener('DOMContentLoaded', async () => {
    const ui = new UI();

    // 招待のURL（?room=部屋番号）で開いたら、その部屋に参加する
    const roomCode = NetplayClient.inviteRoomCode();
    if (roomCode) {
        await ui.openInvite(roomCode);
        return;
    }
    // 前回入っていた部屋があれば戻る。なければ開始画面
    ui.showSetup();
    await ui.resumeOnline();
});
