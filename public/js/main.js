/**
 * Lucky Numbers の起動
 */

import UI from './ui.js';

document.addEventListener('DOMContentLoaded', async () => {
    const ui = new UI();

    // 招待のURL（?room=部屋番号）で開いたら、その部屋に参加する
    const roomCode = new URLSearchParams(location.search).get('room');
    if (roomCode) {
        await ui.openInvite(roomCode);
        return;
    }
    // 前回入っていた部屋があれば戻る。なければ開始画面
    ui.showSetup();
    await ui.resumeOnline();
});
