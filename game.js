/**
 * game.js - ぷよぷよ統合ゲームエンジン
 * 1Pソロ / CPU対戦、クラシック(6x12) / ワイド(8x14)フィールド、
 * おじゃまぷよ相殺システム、ポーズ機能(Esc)、タイトル画面連携
 */

// ぷよ通連鎖ボーナス倍率テーブル
const CHAIN_BONUS_TABLE = [
    0,   0,   8,  16,  32,  64,  96, 128, 160, 192,
    224, 256, 288, 320, 352, 384, 416, 448, 480, 512
];
const CONNECT_BONUS_TABLE = [0, 0, 0, 0, 0, 2, 3, 4, 5, 6, 7, 10];
const COLOR_BONUS_TABLE = [0, 0, 3, 6, 12, 24];

class PuyoBoard {
    constructor(canvas, nextCanvas, options = {}) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');
        this.nextCanvas = nextCanvas;
        this.nextCtx = nextCanvas.getContext('2d');

        this.isCPU = options.isCPU || false;
        this.difficulty = options.difficulty || 'normal';
        this.cols = options.cols || 6;
        this.rows = options.rows || 12;
        this.ghostRows = 1;
        this.totalRows = this.rows + this.ghostRows;

        this.deathCol = Math.floor(this.cols / 2) - 1; // 6列なら2, 8列なら3
        this.deathRow = 1;

        // セルサイズ（ワイド時は少し調整）
        this.cellSize = options.cellSize || (this.cols === 8 ? 40 : 44);

        this.width = this.cols * this.cellSize;
        this.height = this.rows * this.cellSize;
        this.canvas.width = this.width;
        this.canvas.height = this.height;

        this.nextCanvas.width = this.cellSize * 2 + 16;
        this.nextCanvas.height = this.cellSize * 5 + 20;

        // グリッド初期化
        this.grid = [];
        this.initGrid();

        // NEXTキュー
        this.nextQueue = [];
        this.initNextQueue();

        this.activePair = null;
        this.fallingPuyos = [];
        this.clearingGroups = [];

        // 状態: 'SPAWN', 'CONTROLLING', 'CHIGIRI_FALL', 'CHECK_CLEAR', 'CLEAR_ANIM', 'CHAIN_FALL', 'DROP_OJAMA', 'GAME_OVER'
        this.state = 'SPAWN';
        this.stateTimer = 0;
        this.clearingTimer = 0;

        // 連鎖・スコア
        this.chainCount = 0;
        this.score = 0;
        this.maxChain = 0;
        this.totalPopped = 0;
        this.allClearBonusPending = false;

        // おじゃまぷよシステム
        this.pendingOjama = 0; // 相手から送られて保留中のおじゃまぷよ数
        this.opponent = null;  // 対戦相手のPuyoBoard

        // 操作設定
        if (this.isCPU) {
            this.dropInterval = (this.difficulty === 'easy') ? 52 : ((this.difficulty === 'normal') ? 42 : 30);
        } else {
            this.dropInterval = 45;
        }
        this.dropTimer = 0;
        this.fastDrop = false;

        // AI
        this.ai = this.isCPU ? new PuyoAI(this, this.difficulty) : null;
    }

    initGrid() {
        this.grid = [];
        for (let y = 0; y < this.totalRows; y++) {
            this.grid[y] = new Array(this.cols).fill(null);
        }
    }

    initNextQueue() {
        while (this.nextQueue.length < 3) {
            const c1 = COLOR_KEYS[Math.floor(Math.random() * COLOR_KEYS.length)];
            const c2 = COLOR_KEYS[Math.floor(Math.random() * COLOR_KEYS.length)];
            this.nextQueue.push({
                pivotColor: c1,
                childColor: c2,
                pivotPuyo: new Puyo(c1),
                childPuyo: new Puyo(c2)
            });
        }
    }

    getNextPair() {
        const next = this.nextQueue.shift();
        this.initNextQueue();
        return next;
    }

    reset() {
        this.initGrid();
        this.nextQueue = [];
        this.initNextQueue();
        this.activePair = null;
        this.fallingPuyos = [];
        this.clearingGroups = [];
        this.chainCount = 0;
        this.score = 0;
        this.totalPopped = 0;
        this.pendingOjama = 0;
        this.allClearBonusPending = false;
        this.state = 'SPAWN';
        this.stateTimer = 0;
        this.dropTimer = 0;
        this.fastDrop = false;
    }

    setOpponent(opponentBoard) {
        this.opponent = opponentBoard;
    }

    spawnPair() {
        if (this.grid[this.deathRow][this.deathCol] !== null) {
            this.gameOver();
            return;
        }

        const next = this.getNextPair();
        const pivotPuyo = next.pivotPuyo;
        const childPuyo = next.childPuyo;

        this.activePair = {
            pivot: { x: this.deathCol, y: 1, puyo: pivotPuyo },
            child: { x: this.deathCol, y: 0, puyo: childPuyo },
            rot: 0
        };

        this.updateActivePairConnections();

        if (this.grid[1][this.deathCol] !== null) {
            this.gameOver();
            return;
        }

        this.state = 'CONTROLLING';
        this.dropTimer = 0;

        // CPU思考
        if (this.isCPU && this.ai) {
            this.ai.think(this.activePair, this.grid, this.cols, this.totalRows, this.deathCol);
        }
    }

    updateActivePairConnections() {
        if (!this.activePair) return;
        const p = this.activePair;
        const isSameColor = (p.pivot.puyo.colorKey === p.child.puyo.colorKey);

        if (!isSameColor) {
            p.pivot.puyo.setConnections(false, false, false, false);
            p.child.puyo.setConnections(false, false, false, false);
            return;
        }

        switch (p.rot) {
            case 0:
                p.pivot.puyo.setConnections(true, false, false, false);
                p.child.puyo.setConnections(false, false, true, false);
                break;
            case 1:
                p.pivot.puyo.setConnections(false, true, false, false);
                p.child.puyo.setConnections(false, false, false, true);
                break;
            case 2:
                p.pivot.puyo.setConnections(false, false, true, false);
                p.child.puyo.setConnections(true, false, false, false);
                break;
            case 3:
                p.pivot.puyo.setConnections(false, false, false, true);
                p.child.puyo.setConnections(false, true, false, false);
                break;
        }
    }

    movePair(dx) {
        if (this.state !== 'CONTROLLING' || !this.activePair) return;

        const p = this.activePair;
        const newPivotX = p.pivot.x + dx;
        const newChildX = p.child.x + dx;

        if (newPivotX < 0 || newPivotX >= this.cols || newChildX < 0 || newChildX >= this.cols) return;
        if (this.isOccupied(newPivotX, p.pivot.y) || this.isOccupied(newChildX, p.child.y)) return;

        p.pivot.x = newPivotX;
        p.child.x = newChildX;

        p.pivot.puyo.setLookDirection(dx, 0);
        p.child.puyo.setLookDirection(dx, 0);

        if (!this.isCPU && window.soundEngine) window.soundEngine.playMove();
    }

    rotatePair(dir) {
        if (this.state !== 'CONTROLLING' || !this.activePair) return;

        const p = this.activePair;
        const newRot = (p.rot + dir + 4) % 4;

        const offsets = [
            { x: 0, y: -1 },
            { x: 1, y: 0 },
            { x: 0, y: 1 },
            { x: -1, y: 0 }
        ];

        let targetChildX = p.pivot.x + offsets[newRot].x;
        let targetChildY = p.pivot.y + offsets[newRot].y;

        if (this.canPlaceChild(targetChildX, targetChildY)) {
            p.child.x = targetChildX;
            p.child.y = targetChildY;
            p.rot = newRot;
            this.updateActivePairConnections();
            if (!this.isCPU && window.soundEngine) window.soundEngine.playRotate();
            return;
        }

        // 壁蹴り・床蹴り
        let kickX = 0;
        let kickY = 0;

        if (offsets[newRot].x > 0 && (targetChildX >= this.cols || this.isOccupied(targetChildX, targetChildY))) kickX = -1;
        else if (offsets[newRot].x < 0 && (targetChildX < 0 || this.isOccupied(targetChildX, targetChildY))) kickX = 1;
        else if (offsets[newRot].y > 0 && (targetChildY >= this.totalRows || this.isOccupied(targetChildX, targetChildY))) kickY = -1;

        const kickedPivotX = p.pivot.x + kickX;
        const kickedPivotY = p.pivot.y + kickY;
        const kickedChildX = kickedPivotX + offsets[newRot].x;
        const kickedChildY = kickedPivotY + offsets[newRot].y;

        if (this.canPlacePivot(kickedPivotX, kickedPivotY) && this.canPlaceChild(kickedChildX, kickedChildY)) {
            p.pivot.x = kickedPivotX;
            p.pivot.y = kickedPivotY;
            p.child.x = kickedChildX;
            p.child.y = kickedChildY;
            p.rot = newRot;
            this.updateActivePairConnections();
            if (!this.isCPU && window.soundEngine) window.soundEngine.playRotate();
            return;
        }

        // クイックターン
        const oppRot = (p.rot + 2) % 4;
        const oppChildX = p.pivot.x + offsets[oppRot].x;
        const oppChildY = p.pivot.y + offsets[oppRot].y;

        if (this.canPlaceChild(oppChildX, oppChildY)) {
            p.child.x = oppChildX;
            p.child.y = oppChildY;
            p.rot = oppRot;
            this.updateActivePairConnections();
            if (!this.isCPU && window.soundEngine) window.soundEngine.playRotate();
        }
    }

    canPlacePivot(x, y) {
        if (x < 0 || x >= this.cols || y < 0 || y >= this.totalRows) return false;
        return !this.isOccupied(x, y);
    }

    canPlaceChild(x, y) {
        if (x < 0 || x >= this.cols || y < 0 || y >= this.totalRows) return false;
        return !this.isOccupied(x, y);
    }

    isOccupied(x, y) {
        if (x < 0 || x >= this.cols || y < 0 || y >= this.totalRows) return true;
        return this.grid[y][x] !== null;
    }

    hardDrop() {
        if (this.state !== 'CONTROLLING' || !this.activePair) return;
        while (this.canPairFall()) {
            this.activePair.pivot.y++;
            this.activePair.child.y++;
        }
        this.lockPair();
    }

    canPairFall() {
        const p = this.activePair;
        const nextPivotY = p.pivot.y + 1;
        const nextChildY = p.child.y + 1;

        if (nextPivotY >= this.totalRows || this.isOccupied(p.pivot.x, nextPivotY)) return false;
        if (nextChildY >= this.totalRows || this.isOccupied(p.child.x, nextChildY)) return false;
        return true;
    }

    updateControlling() {
        const p = this.activePair;
        if (!p) return;

        if (this.fastDrop) {
            p.pivot.puyo.setLookDirection(0, 0.95);
            p.child.puyo.setLookDirection(0, 0.95);
        }

        let currentDropSpeed;
        if (this.fastDrop) {
            if (this.isCPU) {
                currentDropSpeed = (this.difficulty === 'hard') ? 3 : 8;
            } else {
                currentDropSpeed = 3;
            }
        } else {
            currentDropSpeed = this.dropInterval;
        }
        this.dropTimer++;

        if (this.dropTimer >= currentDropSpeed) {
            this.dropTimer = 0;
            if (this.canPairFall()) {
                p.pivot.y++;
                p.child.y++;
            } else {
                this.lockPair();
            }
        }
    }

    /**
     * 接地ロック＆ちぎり判定
     */
    lockPair() {
        const p = this.activePair;
        this.activePair = null;

        const findGroundY = (x, startY) => {
            let y = startY;
            while (y + 1 < this.totalRows && this.grid[y + 1][x] === null) {
                y++;
            }
            return y;
        };

        let chigiriOccurred = false;

        if (p.pivot.x === p.child.x) {
            // 縦向き
            const col = p.pivot.x;
            const isPivotLower = p.pivot.y > p.child.y;
            const lower = isPivotLower ? p.pivot : p.child;
            const upper = isPivotLower ? p.child : p.pivot;

            const lowerGroundY = findGroundY(col, lower.y);
            const upperGroundY = lowerGroundY - 1;

            if (lowerGroundY === lower.y) {
                this.grid[lower.y][col] = lower.puyo;
                lower.puyo.triggerSquash(0.45);
            } else {
                chigiriOccurred = true;
                lower.puyo.isFalling = true;
                lower.puyo.setLookDirection(0, 1.0);
                lower.puyo.triggerStretch(0.3);
                this.fallingPuyos.push({
                    puyo: lower.puyo,
                    col: col,
                    currentY: lower.y,
                    targetY: lowerGroundY,
                    vy: 0.15
                });
            }

            if (upperGroundY === upper.y) {
                this.grid[upper.y][col] = upper.puyo;
                upper.puyo.triggerSquash(0.45);
            } else {
                chigiriOccurred = true;
                upper.puyo.isFalling = true;
                upper.puyo.setLookDirection(0, 1.0);
                upper.puyo.triggerStretch(0.3);
                this.fallingPuyos.push({
                    puyo: upper.puyo,
                    col: col,
                    currentY: upper.y,
                    targetY: upperGroundY,
                    vy: 0.15
                });
            }

            if (chigiriOccurred) {
                if (!this.isCPU && window.soundEngine) window.soundEngine.playChigiri();
            } else {
                if (!this.isCPU && window.soundEngine) window.soundEngine.playLand();
            }
        } else {
            // 横向き
            const pivotGroundY = findGroundY(p.pivot.x, p.pivot.y);
            const childGroundY = findGroundY(p.child.x, p.child.y);

            if (pivotGroundY === p.pivot.y) {
                this.grid[p.pivot.y][p.pivot.x] = p.pivot.puyo;
                p.pivot.puyo.triggerSquash(0.45);
                if (!this.isCPU && window.soundEngine) window.soundEngine.playLand();
            } else {
                chigiriOccurred = true;
                p.pivot.puyo.isFalling = true;
                p.pivot.puyo.setLookDirection(0, 1.0);
                p.pivot.puyo.triggerStretch(0.3);
                this.fallingPuyos.push({
                    puyo: p.pivot.puyo,
                    col: p.pivot.x,
                    currentY: p.pivot.y,
                    targetY: pivotGroundY,
                    vy: 0.15
                });
            }

            if (childGroundY === p.child.y) {
                this.grid[p.child.y][p.child.x] = p.child.puyo;
                p.child.puyo.triggerSquash(0.45);
                if (!this.isCPU && window.soundEngine && !chigiriOccurred) window.soundEngine.playLand();
            } else {
                chigiriOccurred = true;
                p.child.puyo.isFalling = true;
                p.child.puyo.setLookDirection(0, 1.0);
                p.child.puyo.triggerStretch(0.3);
                this.fallingPuyos.push({
                    puyo: p.child.puyo,
                    col: p.child.x,
                    currentY: p.child.y,
                    targetY: childGroundY,
                    vy: 0.15
                });
            }

            if (chigiriOccurred) {
                if (!this.isCPU && window.soundEngine) window.soundEngine.playChigiri();
            }
        }

        if (chigiriOccurred) {
            this.state = 'CHIGIRI_FALL';
        } else {
            this.updateAllConnections();
            this.state = 'CHECK_CLEAR';
            this.stateTimer = 8;
        }
    }

    updateFallingPuyos() {
        if (this.fallingPuyos.length === 0) {
            this.updateAllConnections();
            return true;
        }

        const gravity = 0.055;
        let allLanded = true;

        for (let i = 0; i < this.fallingPuyos.length; i++) {
            const item = this.fallingPuyos[i];
            item.vy += gravity;
            item.currentY += item.vy;

            if (item.currentY >= item.targetY) {
                item.currentY = item.targetY;
                item.puyo.isFalling = false;
                item.puyo.triggerSquash(0.5);
                this.grid[item.targetY][item.col] = item.puyo;
                if (!this.isCPU && window.soundEngine) window.soundEngine.playLand();
            } else {
                allLanded = false;
            }
        }

        if (allLanded) {
            this.fallingPuyos = [];
            this.updateAllConnections();
            return true;
        }

        return false;
    }

    updateAllConnections() {
        for (let y = 0; y < this.totalRows; y++) {
            for (let x = 0; x < this.cols; x++) {
                const p = this.grid[y][x];
                if (!p) continue;

                // おじゃまぷよは連結しない
                if (p.colorKey === 'OJAMA') {
                    p.setConnections(false, false, false, false);
                    continue;
                }

                const isSameColor = (ox, oy) => {
                    const nx = x + ox;
                    const ny = y + oy;
                    if (nx < 0 || nx >= this.cols || ny < 0 || ny >= this.totalRows) return false;
                    const neighbor = this.grid[ny][nx];
                    return neighbor && neighbor.colorKey === p.colorKey;
                };

                p.setConnections(
                    isSameColor(0, -1),
                    isSameColor(1, 0),
                    isSameColor(0, 1),
                    isSameColor(-1, 0)
                );
            }
        }
    }

    findClearableGroups() {
        const visited = Array.from({ length: this.totalRows }, () => new Array(this.cols).fill(false));
        const groups = [];

        for (let y = 0; y < this.totalRows; y++) {
            for (let x = 0; x < this.cols; x++) {
                const startPuyo = this.grid[y][x];
                if (!startPuyo || startPuyo.colorKey === 'OJAMA' || visited[y][x]) continue;

                const group = [];
                const queue = [{ x, y }];
                visited[y][x] = true;
                const color = startPuyo.colorKey;

                while (queue.length > 0) {
                    const cur = queue.shift();
                    group.push({ x: cur.x, y: cur.y, puyo: this.grid[cur.y][cur.x] });

                    const dirs = [
                        { dx: 0, dy: -1 },
                        { dx: 1, dy: 0 },
                        { dx: 0, dy: 1 },
                        { dx: -1, dy: 0 }
                    ];

                    for (const d of dirs) {
                        const nx = cur.x + d.dx;
                        const ny = cur.y + d.dy;
                        if (nx >= 0 && nx < this.cols && ny >= 0 && ny < this.totalRows) {
                            if (!visited[ny][nx] && this.grid[ny][nx] && this.grid[ny][nx].colorKey === color) {
                                visited[ny][nx] = true;
                                queue.push({ x: nx, y: ny });
                            }
                        }
                    }
                }

                if (group.length >= 4) {
                    groups.push(group);
                }
            }
        }

        return groups;
    }

    triggerClearAnimation(groups) {
        this.clearingGroups = groups;
        this.state = 'CLEAR_ANIM';
        this.clearingTimer = 34;

        // 隣接するおじゃまぷよも巻き込み消去に含める
        const ojamaToClear = new Set();
        for (const grp of groups) {
            for (const item of grp) {
                item.puyo.startClear();

                const dirs = [{ dx: 0, dy: -1 }, { dx: 1, dy: 0 }, { dx: 0, dy: 1 }, { dx: -1, dy: 0 }];
                for (const d of dirs) {
                    const nx = item.x + d.dx;
                    const ny = item.y + d.dy;
                    if (nx >= 0 && nx < this.cols && ny >= 0 && ny < this.totalRows) {
                        const neighbor = this.grid[ny][nx];
                        if (neighbor && neighbor.colorKey === 'OJAMA') {
                            ojamaToClear.add({ x: nx, y: ny, puyo: neighbor });
                        }
                    }
                }
            }
        }

        // おじゃまぷよの巻き込みアニメーション
        for (const oj of ojamaToClear) {
            oj.puyo.startClear();
            this.clearingGroups.push([oj]);
        }
    }

    executeClear() {
        this.chainCount++;
        if (this.chainCount > this.maxChain) {
            this.maxChain = this.chainCount;
        }

        let totalPuyosInChain = 0;
        const colorSet = new Set();
        let totalConnectBonus = 0;

        for (const grp of this.clearingGroups) {
            for (const item of grp) {
                if (item.puyo.colorKey !== 'OJAMA') {
                    totalPuyosInChain++;
                    colorSet.add(item.puyo.colorKey);
                }

                const px = item.x * this.cellSize + this.cellSize * 0.5;
                const py = (item.y - this.ghostRows) * this.cellSize + this.cellSize * 0.5;
                if (window.particleManager) {
                    window.particleManager.createPopEffect(px, py, item.puyo.colorData);
                }
                this.grid[item.y][item.x] = null;
            }

            if (grp[0].puyo.colorKey !== 'OJAMA') {
                const connIdx = Math.min(grp.length, CONNECT_BONUS_TABLE.length - 1);
                totalConnectBonus += CONNECT_BONUS_TABLE[connIdx];
            }
        }

        this.totalPopped += totalPuyosInChain;

        if (!this.isCPU && window.soundEngine) {
            window.soundEngine.playPop(this.chainCount);
            window.soundEngine.playChain(this.chainCount);
        }

        const chainText = `${this.chainCount} 連鎖！`;
        const textColors = ['#fbbf24', '#f87171', '#60a5fa', '#34d399', '#c084fc', '#f43f5e'];
        const color = textColors[(this.chainCount - 1) % textColors.length];
        if (window.particleManager) {
            window.particleManager.addText(this.width * 0.5, this.height * 0.35, chainText, color, 30 + Math.min(this.chainCount * 3, 18));
        }

        // スコア計算
        const chainIdx = Math.min(this.chainCount, CHAIN_BONUS_TABLE.length - 1);
        const chainBonus = CHAIN_BONUS_TABLE[chainIdx];
        const colorIdx = Math.min(colorSet.size, COLOR_BONUS_TABLE.length - 1);
        const colorBonus = COLOR_BONUS_TABLE[colorIdx];

        let totalMultiplier = chainBonus + totalConnectBonus + colorBonus;
        if (totalMultiplier === 0) totalMultiplier = 1;
        if (totalMultiplier > 999) totalMultiplier = 999;

        let points = totalPuyosInChain * 10 * totalMultiplier;
        if (this.allClearBonusPending) {
            points += 2100;
            this.allClearBonusPending = false;
        }

        this.score += points;

        // 対戦時: おじゃまぷよの発生＆相殺システム！
        if (this.opponent) {
            const ojamaGenerated = Math.floor(points / 70);
            if (ojamaGenerated > 0) {
                this.handleOjamaAttack(ojamaGenerated);
            }
        }

        this.clearingGroups = [];
        this.setupChainFall();
    }

    /**
     * おじゃまぷよの攻撃＆相殺処理
     */
    handleOjamaAttack(amount) {
        // 1. まず自分に送られているおじゃまぷよ（pendingOjama）を相殺！
        if (this.pendingOjama > 0) {
            if (amount >= this.pendingOjama) {
                // 完全相殺＆余りを相手へ送る！
                const surplus = amount - this.pendingOjama;
                this.pendingOjama = 0;
                if (surplus > 0 && this.opponent) {
                    this.opponent.receiveOjama(surplus);
                }
            } else {
                // 一部相殺
                this.pendingOjama -= amount;
            }
        } else {
            // 相殺なし、そのまま相手へ送信
            if (this.opponent) {
                this.opponent.receiveOjama(amount);
            }
        }
    }

    receiveOjama(amount) {
        this.pendingOjama += amount;
    }

    setupChainFall() {
        this.fallingPuyos = [];

        for (let x = 0; x < this.cols; x++) {
            let writeY = this.totalRows - 1;
            for (let y = this.totalRows - 1; y >= 0; y--) {
                const p = this.grid[y][x];
                if (p !== null) {
                    if (y !== writeY) {
                        this.grid[y][x] = null;
                        p.isFalling = true;
                        p.setLookDirection(0, 1.0);
                        p.triggerStretch(0.25);
                        this.fallingPuyos.push({
                            puyo: p,
                            col: x,
                            currentY: y,
                            targetY: writeY,
                            vy: 0.1
                        });
                    }
                    writeY--;
                }
            }
        }

        if (this.fallingPuyos.length > 0) {
            this.state = 'CHAIN_FALL';
        } else {
            this.checkChainEndOrAllClear();
        }
    }

    checkChainEndOrAllClear() {
        let hasAnyPuyo = false;
        for (let y = 0; y < this.totalRows; y++) {
            for (let x = 0; x < this.cols; x++) {
                if (this.grid[y][x] !== null) {
                    hasAnyPuyo = true;
                    break;
                }
            }
            if (hasAnyPuyo) break;
        }

        if (!hasAnyPuyo && this.chainCount > 0) {
            this.isAllClear = true;
            this.allClearBonusPending = true;
            if (!this.isCPU && window.soundEngine) window.soundEngine.playAllClear();
            if (window.particleManager) {
                window.particleManager.addText(this.width * 0.5, this.height * 0.45, '★ ALL CLEAR! ★', '#fbbf24', 36);
            }
        }

        this.chainCount = 0;

        // 連鎖終了後、おじゃまぷよが保留されていれば上から降らせる！
        if (this.pendingOjama > 0) {
            this.state = 'DROP_OJAMA';
            this.stateTimer = 10;
        } else {
            this.state = 'SPAWN';
        }
    }

    /**
     * 保留中のおじゃまぷよを降らせる
     */
    dropOjama() {
        const dropCount = Math.min(this.pendingOjama, this.cols * 5); // 1回につき最大5段
        this.pendingOjama -= dropCount;

        // 列ごとに均等に落とす
        const colsToDrop = [];
        for (let i = 0; i < dropCount; i++) {
            colsToDrop.push(i % this.cols);
        }

        this.fallingPuyos = [];

        for (const col of colsToDrop) {
            let targetY = this.totalRows - 1;
            while (targetY >= 0 && this.grid[targetY][col] !== null) {
                targetY--;
            }
            if (targetY >= 0) {
                const ojamaPuyo = new Puyo('OJAMA');
                ojamaPuyo.isFalling = true;
                this.fallingPuyos.push({
                    puyo: ojamaPuyo,
                    col: col,
                    currentY: 0,
                    targetY: targetY,
                    vy: 0.15
                });
            }
        }

        if (this.fallingPuyos.length > 0) {
            this.state = 'CHIGIRI_FALL';
        } else {
            this.state = 'SPAWN';
        }
    }

    gameOver() {
        this.state = 'GAME_OVER';
        if (!this.isCPU && window.soundEngine) window.soundEngine.playGameOver();
        if (window.particleManager) {
            window.particleManager.addText(this.width * 0.5, this.height * 0.45, this.isCPU ? 'CPU LOSE' : 'GAME OVER', '#ef4444', 36);
        }
    }

    update() {
        switch (this.state) {
            case 'SPAWN':
                this.spawnPair();
                break;

            case 'CONTROLLING':
                if (this.isCPU && this.ai) {
                    this.ai.update();
                }
                this.updateControlling();
                break;

            case 'CHIGIRI_FALL':
                if (this.updateFallingPuyos()) {
                    this.state = 'CHECK_CLEAR';
                    this.stateTimer = 10;
                }
                break;

            case 'CHECK_CLEAR':
                this.stateTimer--;
                if (this.stateTimer <= 0) {
                    const groups = this.findClearableGroups();
                    if (groups.length > 0) {
                        this.triggerClearAnimation(groups);
                    } else {
                        this.checkChainEndOrAllClear();
                    }
                }
                break;

            case 'CLEAR_ANIM':
                this.clearingTimer--;
                if (this.clearingTimer <= 0) {
                    this.executeClear();
                }
                break;

            case 'CHAIN_FALL':
                if (this.updateFallingPuyos()) {
                    this.state = 'CHECK_CLEAR';
                    this.stateTimer = 12;
                }
                break;

            case 'DROP_OJAMA':
                this.stateTimer--;
                if (this.stateTimer <= 0) {
                    this.dropOjama();
                }
                break;

            case 'GAME_OVER':
                break;
        }
    }

    draw() {
        this.ctx.clearRect(0, 0, this.width, this.height);

        // 背景グリッド
        this.drawBoardGrid();

        // 着地予測ゴースト
        if (this.state === 'CONTROLLING' && this.activePair) {
            this.drawGhostPair();
        }

        // 盤面上の確定ぷよ
        for (let y = this.ghostRows; y < this.totalRows; y++) {
            for (let x = 0; x < this.cols; x++) {
                const puyo = this.grid[y][x];
                if (puyo) {
                    const cx = x * this.cellSize + this.cellSize * 0.5;
                    const cy = (y - this.ghostRows) * this.cellSize + this.cellSize * 0.5;
                    puyo.draw(this.ctx, cx, cy, this.cellSize);
                }
            }
        }

        // 落下中ぷよ
        for (const item of this.fallingPuyos) {
            if (item.currentY >= this.ghostRows - 0.5) {
                const cx = item.col * this.cellSize + this.cellSize * 0.5;
                const cy = (item.currentY - this.ghostRows) * this.cellSize + this.cellSize * 0.5;
                item.puyo.draw(this.ctx, cx, cy, this.cellSize);
            }
        }

        // 操作中ペア
        if (this.state === 'CONTROLLING' && this.activePair) {
            this.drawActivePair();
        }

        // 窒息地点の赤い×印
        this.drawDeathMarker();

        // ネクストぷよ
        this.drawNextPuyos();
    }

    drawBoardGrid() {
        this.ctx.save();
        this.ctx.strokeStyle = 'rgba(255, 255, 255, 0.05)';
        this.ctx.lineWidth = 1;

        for (let x = 0; x <= this.cols; x++) {
            this.ctx.beginPath();
            this.ctx.moveTo(x * this.cellSize, 0);
            this.ctx.lineTo(x * this.cellSize, this.height);
            this.ctx.stroke();
        }
        for (let y = 0; y <= this.rows; y++) {
            this.ctx.beginPath();
            this.ctx.moveTo(0, y * this.cellSize);
            this.ctx.lineTo(this.width, y * this.cellSize);
            this.ctx.stroke();
        }
        this.ctx.restore();
    }

    drawGhostPair() {
        const p = this.activePair;
        if (!p) return;

        let dropDistance = 0;
        while (true) {
            const nextPivotY = p.pivot.y + dropDistance + 1;
            const nextChildY = p.child.y + dropDistance + 1;
            if (nextPivotY >= this.totalRows || this.isOccupied(p.pivot.x, nextPivotY) ||
                nextChildY >= this.totalRows || this.isOccupied(p.child.x, nextChildY)) {
                break;
            }
            dropDistance++;
        }

        if (dropDistance === 0) return;

        const drawGhostAt = (col, row, colorData) => {
            const displayY = row - this.ghostRows;
            if (displayY < 0) return;
            const cx = col * this.cellSize + this.cellSize * 0.5;
            const cy = displayY * this.cellSize + this.cellSize * 0.5;
            const r = this.cellSize * 0.4;

            this.ctx.save();
            this.ctx.globalAlpha = 0.25;
            this.ctx.strokeStyle = colorData.light;
            this.ctx.lineWidth = 2.5;
            this.ctx.setLineDash([4, 4]);
            this.ctx.beginPath();
            this.ctx.arc(cx, cy, r, 0, Math.PI * 2);
            this.ctx.stroke();
            this.ctx.restore();
        };

        drawGhostAt(p.pivot.x, p.pivot.y + dropDistance, p.pivot.puyo.colorData);
        drawGhostAt(p.child.x, p.child.y + dropDistance, p.child.puyo.colorData);
    }

    drawDeathMarker() {
        const cx = this.deathCol * this.cellSize + this.cellSize * 0.5;
        const cy = (this.deathRow - this.ghostRows) * this.cellSize + this.cellSize * 0.5;

        this.ctx.save();
        this.ctx.strokeStyle = 'rgba(239, 68, 68, 0.45)';
        this.ctx.lineWidth = 3;
        this.ctx.beginPath();
        const s = 10;
        this.ctx.moveTo(cx - s, cy - s);
        this.ctx.lineTo(cx + s, cy + s);
        this.ctx.moveTo(cx + s, cy - s);
        this.ctx.lineTo(cx - s, cy + s);
        this.ctx.stroke();
        this.ctx.restore();
    }

    drawActivePair() {
        const p = this.activePair;
        const drawSingle = (item) => {
            if (item.y >= this.ghostRows - 0.5) {
                const cx = item.x * this.cellSize + this.cellSize * 0.5;
                const cy = (item.y - this.ghostRows) * this.cellSize + this.cellSize * 0.5;
                item.puyo.draw(this.ctx, cx, cy, this.cellSize);
            }
        };

        drawSingle(p.pivot);
        drawSingle(p.child);
    }

    drawNextPuyos() {
        this.nextCtx.clearRect(0, 0, this.nextCanvas.width, this.nextCanvas.height);

        const drawPairAt = (pair, startY, isSmall = false) => {
            const scale = isSmall ? 0.72 : 0.9;
            const size = this.cellSize * scale;
            const cx = this.nextCanvas.width * 0.5;

            pair.childPuyo.draw(this.nextCtx, cx, startY, size);
            pair.pivotPuyo.draw(this.nextCtx, cx, startY + size * 0.9, size);
        };

        if (this.nextQueue.length > 0) {
            this.nextCtx.save();
            this.nextCtx.fillStyle = '#94a3b8';
            this.nextCtx.font = 'bold 11px sans-serif';
            this.nextCtx.textAlign = 'center';
            this.nextCtx.fillText('NEXT', this.nextCanvas.width * 0.5, 16);
            drawPairAt(this.nextQueue[0], 44, false);
            this.nextCtx.restore();
        }

        if (this.nextQueue.length > 1) {
            this.nextCtx.save();
            this.nextCtx.fillStyle = '#64748b';
            this.nextCtx.font = 'bold 9px sans-serif';
            this.nextCtx.textAlign = 'center';
            this.nextCtx.fillText('NEXT 2', this.nextCanvas.width * 0.5, 136);
            drawPairAt(this.nextQueue[1], 160, true);
            this.nextCtx.restore();
        }
    }
}

/**
 * ゲーム全体の管理クラス (GameManager)
 */
class GameManager {
    constructor() {
        this.mode = 'solo'; // 'solo' or 'vs'
        this.boardSize = 'classic'; // 'classic' (6x12) or 'wide' (8x14)
        this.difficulty = 'normal'; // 'easy', 'normal', 'hard'

        this.appState = 'TITLE'; // 'TITLE', 'PLAYING', 'PAUSED'
        this.isPaused = false;

        this.playerBoard = null;
        this.cpuBoard = null;

        // キー入力管理
        this.keys = { left: false, right: false, down: false };
        this.keyRepeatTimer = { left: 0, right: 0 };

        this.animFrameId = null;

        this.setupKeyboardListeners();
    }

    setupKeyboardListeners() {
        window.addEventListener('keydown', (e) => {
            if (window.soundEngine) window.soundEngine.resume();
            if (window.midiPlayer) window.midiPlayer.ensureAudioContext();

            // Escキーでポーズ切り替え
            if (e.code === 'Escape') {
                if (this.appState === 'PLAYING') {
                    this.togglePause();
                } else if (this.appState === 'PAUSED') {
                    this.togglePause();
                }
                return;
            }

            if (this.appState !== 'PLAYING' || this.isPaused) return;

            const b = this.playerBoard;
            if (!b) return;

            switch (e.code) {
                case 'ArrowLeft':
                case 'KeyA':
                    if (!this.keys.left) {
                        b.movePair(-1);
                        this.keyRepeatTimer.left = 12;
                    }
                    this.keys.left = true;
                    break;
                case 'ArrowRight':
                case 'KeyD':
                    if (!this.keys.right) {
                        b.movePair(1);
                        this.keyRepeatTimer.right = 12;
                    }
                    this.keys.right = true;
                    break;
                case 'ArrowDown':
                case 'KeyS':
                    b.fastDrop = true;
                    break;
                case 'ArrowUp':
                case 'KeyW':
                case 'KeyX':
                    b.rotatePair(1);
                    break;
                case 'KeyZ':
                case 'ControlLeft':
                    b.rotatePair(-1);
                    break;
                case 'Space':
                    b.hardDrop();
                    break;
            }
        });

        window.addEventListener('keyup', (e) => {
            if (!this.playerBoard) return;
            switch (e.code) {
                case 'ArrowLeft':
                case 'KeyA':
                    this.keys.left = false;
                    this.keyRepeatTimer.left = 0;
                    break;
                case 'ArrowRight':
                case 'KeyD':
                    this.keys.right = false;
                    this.keyRepeatTimer.right = 0;
                    break;
                case 'ArrowDown':
                case 'KeyS':
                    this.playerBoard.fastDrop = false;
                    break;
            }
        });
    }

    startGame(mode, boardSize, difficulty) {
        this.mode = mode;
        this.boardSize = boardSize;
        this.difficulty = difficulty;
        this.appState = 'PLAYING';
        this.isPaused = false;

        const cols = (boardSize === 'wide') ? 8 : 6;
        const rows = (boardSize === 'wide') ? 14 : 12;
        const cellSize = (boardSize === 'wide') ? 40 : 44;

        // 1Pボード初期化
        const pCanvas = document.getElementById('game-canvas');
        const pNext = document.getElementById('next-canvas');
        this.playerBoard = new PuyoBoard(pCanvas, pNext, { cols, rows, cellSize, isCPU: false });

        // VSモードの場合、CPUボードも初期化
        if (mode === 'vs') {
            const cpuCanvas = document.getElementById('cpu-canvas');
            const cpuNext = document.getElementById('cpu-next-canvas');
            this.cpuBoard = new PuyoBoard(cpuCanvas, cpuNext, { cols, rows, cellSize, isCPU: true, difficulty });

            this.playerBoard.setOpponent(this.cpuBoard);
            this.cpuBoard.setOpponent(this.playerBoard);
        } else {
            this.cpuBoard = null;
        }

        // BGM再生
        if (window.midiPlayer) {
            window.midiPlayer.stop();
            window.midiPlayer.play();
        }

        // UI切り替え
        document.getElementById('title-screen').style.display = 'none';
        document.getElementById('game-screen').style.display = 'flex';
        document.getElementById('pause-modal').style.display = 'none';

        const cpuArea = document.getElementById('cpu-board-area');
        if (cpuArea) cpuArea.style.display = (mode === 'vs') ? 'flex' : 'none';

        const vsCenter = document.getElementById('vs-center-area');
        if (vsCenter) vsCenter.style.display = (mode === 'vs') ? 'flex' : 'none';

        if (!this.animFrameId) {
            this.loop();
        }
    }

    togglePause() {
        if (this.appState !== 'PLAYING' && this.appState !== 'PAUSED') return;

        this.isPaused = !this.isPaused;
        this.appState = this.isPaused ? 'PAUSED' : 'PLAYING';

        const modal = document.getElementById('pause-modal');
        if (modal) modal.style.display = this.isPaused ? 'flex' : 'none';

        if (window.midiPlayer) {
            if (this.isPaused) window.midiPlayer.pause();
            else window.midiPlayer.play();
        }
    }

    returnToTitle() {
        this.appState = 'TITLE';
        this.isPaused = false;
        if (window.midiPlayer) window.midiPlayer.stop();

        document.getElementById('title-screen').style.display = 'flex';
        document.getElementById('game-screen').style.display = 'none';
        document.getElementById('pause-modal').style.display = 'none';
    }

    loop() {
        if (this.appState === 'PLAYING' && !this.isPaused) {
            // キーリピート
            if (this.playerBoard && this.playerBoard.state === 'CONTROLLING') {
                if (this.keys.left) {
                    this.keyRepeatTimer.left--;
                    if (this.keyRepeatTimer.left <= 0) {
                        this.playerBoard.movePair(-1);
                        this.keyRepeatTimer.left = 4;
                    }
                }
                if (this.keys.right) {
                    this.keyRepeatTimer.right--;
                    if (this.keyRepeatTimer.right <= 0) {
                        this.playerBoard.movePair(1);
                        this.keyRepeatTimer.right = 4;
                    }
                }
            }

            // ボード更新
            if (this.playerBoard) this.playerBoard.update();
            if (this.cpuBoard) this.cpuBoard.update();

            // パーティクル更新
            if (window.particleManager) window.particleManager.update();

            this.updateStatsUI();
        }

        // 描画
        if (this.appState === 'PLAYING' || this.appState === 'PAUSED') {
            if (this.playerBoard) this.playerBoard.draw();
            if (this.cpuBoard) this.cpuBoard.draw();

            // 1Pボード上にパーティクル描画
            if (this.playerBoard && window.particleManager) {
                window.particleManager.draw(this.playerBoard.ctx);
            }
        }

        this.animFrameId = requestAnimationFrame(() => this.loop());
    }

    updateStatsUI() {
        if (!this.playerBoard) return;
        const sEl = document.getElementById('score-val');
        const cEl = document.getElementById('chain-val');
        const pEl = document.getElementById('popped-val');
        const ojama1El = document.getElementById('p1-ojama-val');
        const ojama2El = document.getElementById('p2-ojama-val');

        if (sEl) sEl.textContent = this.playerBoard.score.toLocaleString();
        if (cEl) cEl.textContent = this.playerBoard.maxChain;
        if (pEl) pEl.textContent = this.playerBoard.totalPopped;

        if (ojama1El) ojama1El.textContent = this.playerBoard.pendingOjama;
        if (ojama2El && this.cpuBoard) ojama2El.textContent = this.cpuBoard.pendingOjama;
    }
}

window.GameManager = GameManager;
