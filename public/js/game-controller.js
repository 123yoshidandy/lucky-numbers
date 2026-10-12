/**
 * ローカル対戦（同じ端末で、人間とCPUが交代で遊ぶ）のゲームコントローラー
 * 画面には getView() でビューを渡し、操作は send() で受け取る（オンライン対戦のコントローラーと同じ形）
 */

import Game from './game.js';
import { createGameView, hydrateGameView } from './game-view.js';
import { runCpuStep } from './cpu-player.js';

const CPU_STEP_DELAY_MS = 600; // CPUの手は1手ずつ間を置いて見せる

export default class LocalGameController {
    // players: [{ name, isCPU }] / listeners: onUpdate() / onError(message)
    constructor(players, listeners = {}) {
        this.listeners = listeners;
        this.game = new Game(players);
        this.cpuTimer = null;
        this.scheduleCpu();
    }

    // 手番の人間から見たビュー。CPUの番は、最後に操作した人間（いなければ観戦）から見る
    getView() {
        const current = this.game.getCurrentPlayer();
        if (!current.isCPU) this.lastHumanId = current.id;
        const humans = this.game.players.filter(player => !player.isCPU);
        const viewerId = this.lastHumanId ?? humans[0]?.id ?? null;
        return hydrateGameView(createGameView(this.game, viewerId));
    }

    send(command) {
        const current = this.game.getCurrentPlayer();
        if (current.isCPU) return false;
        if (!this.game.applyCommand(current.id, command)) {
            this.listeners.onError?.(this.game.lastError);
            return false;
        }
        this.listeners.onUpdate?.();
        this.scheduleCpu();
        return true;
    }

    scheduleCpu() {
        clearTimeout(this.cpuTimer);
        if (this.game.phase !== 'play' || !this.game.getCurrentPlayer().isCPU) return;
        this.cpuTimer = setTimeout(() => {
            runCpuStep(this.game);
            this.listeners.onUpdate?.();
            this.scheduleCpu();
        }, CPU_STEP_DELAY_MS);
    }

    stop() {
        clearTimeout(this.cpuTimer);
    }
}
