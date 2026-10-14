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
        this.onGameOver = options.onGameOver || null;
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

    /**
     * 窒息判定（ゲームオーバー判定）
     * 1. 窒息マス（×印: deathCol, deathRow=1）またはゴースト行（y=0）にぷよがあるか？
     * 2. 全列が最上段（y<=1）まで埋まっていてこれ以上配置できないか？
     */
    checkGameOver() {
        if (this.state === 'GAME_OVER') return true;

        if (this.grid[this.deathRow][this.deathCol] !== null || this.grid[0][this.deathCol] !== null) {
            this.gameOver();
            return true;
        }

        let allFilled = true;
        for (let x = 0; x < this.cols; x++) {
            if (this.grid[1][x] === null) {
                allFilled = false;
                break;
            }
        }
        if (allFilled) {
            this.gameOver();
            return true;
        }

        return false;
    }

    spawnPair() {
        if (this.checkGameOver()) return;

        const next = this.getNextPair();
        const pivotPuyo = next.pivotPuyo;
        const childPuyo = next.childPuyo;

        this.activePair = {
            pivot: { x: this.deathCol, y: 1, puyo: pivotPuyo },
            child: { x: this.deathCol, y: 0, puyo: childPuyo },
            rot: 0
        };

        this.updateActivePairConnections();

        if (this.checkGameOver()) return;

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

        // CPUが最上段で目標列へスライド移動している間は自然落下を保留（スタック時は落下を継続）
        if (this.isCPU && this.ai && p.pivot.y <= 1 && p.pivot.x !== this.ai.targetX && this.ai.stuckCounter < 2) {
            this.dropTimer = 0;
        }

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
            let y = Math.max(0, startY);
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

            if (lowerGroundY >= 0 && lowerGroundY < this.totalRows) {
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
            }

            if (upperGroundY >= 0 && upperGroundY < this.totalRows) {
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

            if (pivotGroundY >= 0 && pivotGroundY < this.totalRows) {
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
            }

            if (childGroundY >= 0 && childGroundY < this.totalRows) {
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

        // 連鎖終了時、窒息マス（×印）が埋まっていれば即座にゲームオーバー
        if (this.checkGameOver()) return;

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
        if (this.state === 'GAME_OVER') return;
        this.state = 'GAME_OVER';
        if (window.particleManager) {
            window.particleManager.addText(this.width * 0.5, this.height * 0.45, this.isCPU ? 'CPU LOSE' : 'GAME OVER', '#ef4444', 36);
        }
        if (this.onGameOver) {
            this.onGameOver(this);
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
 * 本家ぷよぷよ風 おじゃま予告トレイレンダラー
 * 彗星(720), 月(360), 星(180), 岩(30), 大(6), 小(1)
 */
class OjamaTrayRenderer {
    static getValues() {
        return [
            { type: 'comet', value: 720 },
            { type: 'moon',  value: 360 },
            { type: 'star',  value: 180 },
            { type: 'rock',  value: 30 },
            { type: 'big',   value: 6 },
            { type: 'small', value: 1 }
        ];
    }

    static getSvg(type) {
        switch (type) {
            case 'small':
                return `<svg class="ojama-icon ojama-small" viewBox="0 0 32 32" title="小ぷよ (1個)">
                    <circle cx="16" cy="16" r="13" fill="url(#grad-ojama-small)" stroke="#94a3b8" stroke-width="1.5" />
                    <ellipse cx="16" cy="16" rx="5.5" ry="5.5" fill="#ef4444" opacity="0.85" />
                    <circle cx="16" cy="16" r="2.5" fill="#1e293b" />
                    <circle cx="13" cy="12" r="2" fill="#ffffff" opacity="0.8" />
                </svg>`;
            case 'big':
                return `<svg class="ojama-icon ojama-big" viewBox="0 0 36 36" title="大ぷよ (6個)">
                    <circle cx="18" cy="18" r="15" fill="url(#grad-ojama-big)" stroke="#f43f5e" stroke-width="2" />
                    <ellipse cx="18" cy="18" rx="7.5" ry="7.5" fill="#e11d48" />
                    <circle cx="18" cy="18" r="3.2" fill="#450a0a" />
                    <circle cx="14" cy="13" r="2.8" fill="#ffffff" opacity="0.85" />
                </svg>`;
            case 'rock':
                return `<svg class="ojama-icon ojama-rock" viewBox="0 0 40 40" title="岩ぷよ (30個)">
                    <polygon points="12,4 28,4 38,15 35,35 8,36 2,20" fill="url(#grad-ojama-rock)" stroke="#cbd5e1" stroke-width="2" />
                    <polygon points="14,8 26,8 33,18 29,30 11,31 6,20" fill="#334155" opacity="0.4" />
                    <circle cx="14" cy="18" r="3.2" fill="#ef4444" />
                    <circle cx="26" cy="18" r="3.2" fill="#ef4444" />
                    <circle cx="13" cy="17" r="1.2" fill="#ffffff" />
                    <circle cx="25" cy="17" r="1.2" fill="#ffffff" />
                </svg>`;
            case 'star':
                return `<svg class="ojama-icon ojama-star" viewBox="0 0 40 40" title="星ぷよ (180個)">
                    <polygon points="20,2 25,14 38,15 28,24 32,37 20,29 8,37 12,24 2,15 15,14" fill="url(#grad-ojama-star)" stroke="#f59e0b" stroke-width="1.8" />
                    <circle cx="16" cy="20" r="2" fill="#78350f" />
                    <circle cx="24" cy="20" r="2" fill="#78350f" />
                </svg>`;
            case 'moon':
                return `<svg class="ojama-icon ojama-moon" viewBox="0 0 40 40" title="月ぷよ (360個)">
                    <path d="M 28 6 A 16 16 0 1 0 34 28 A 13 13 0 1 1 28 6 Z" fill="url(#grad-ojama-moon)" stroke="#0284c7" stroke-width="2" />
                    <circle cx="18" cy="22" r="2.5" fill="#0369a1" />
                </svg>`;
            case 'comet':
                return `<svg class="ojama-icon ojama-comet" viewBox="0 0 44 44" title="彗星ぷよ (720個)">
                    <polygon points="20,22 4,40 16,28" fill="#f472b6" opacity="0.75" />
                    <circle cx="26" cy="18" r="13" fill="url(#grad-ojama-comet)" stroke="#db2777" stroke-width="2" />
                    <circle cx="26" cy="18" r="5" fill="#fdf2f8" />
                    <circle cx="26" cy="18" r="2.5" fill="#9d174d" />
                </svg>`;
            default:
                return '';
        }
    }

    static calculateIcons(count) {
        if (count <= 0) return [];
        const icons = [];
        let rem = count;
        const values = OjamaTrayRenderer.getValues();

        for (const item of values) {
            while (rem >= item.value) {
                icons.push(item.type);
                rem -= item.value;
                if (icons.length >= 8) break;
            }
            if (icons.length >= 8) break;
        }
        return icons;
    }

    static update(pendingCount, wrapperEl, iconsEl, badgeEl, stateObj) {
        if (!wrapperEl || !iconsEl || !badgeEl) return;
        if (stateObj && stateObj.lastCount === pendingCount) return;
        if (stateObj) stateObj.lastCount = pendingCount;

        if (pendingCount <= 0) {
            wrapperEl.classList.remove('has-ojama', 'danger');
            badgeEl.style.display = 'none';
            badgeEl.classList.remove('badge-danger');
            iconsEl.innerHTML = '';
            return;
        }

        wrapperEl.classList.add('has-ojama');
        if (pendingCount >= 30) {
            wrapperEl.classList.add('danger');
            badgeEl.classList.add('badge-danger');
        } else {
            wrapperEl.classList.remove('danger');
            badgeEl.classList.remove('badge-danger');
        }

        // 予告おじゃま数を明確に表示
        badgeEl.textContent = `${pendingCount}`;
        badgeEl.style.display = 'inline-flex';

        // 本家風アイコン群の生成
        const icons = OjamaTrayRenderer.calculateIcons(pendingCount);
        let html = '';
        for (const type of icons) {
            html += OjamaTrayRenderer.getSvg(type);
        }
        iconsEl.innerHTML = html;
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

        // おじゃま予告トレイ状態
        this.p1TrayState = { lastCount: -1 };
        this.cpuTrayState = { lastCount: -1 };

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
        this.playerBoard = new PuyoBoard(pCanvas, pNext, {
            cols, rows, cellSize, isCPU: false,
            onGameOver: (b) => this.handleGameOver(b)
        });

        // VSモードの場合、CPUボードも初期化
        if (mode === 'vs') {
            const cpuCanvas = document.getElementById('cpu-canvas');
            const cpuNext = document.getElementById('cpu-next-canvas');
            this.cpuBoard = new PuyoBoard(cpuCanvas, cpuNext, {
                cols, rows, cellSize, isCPU: true, difficulty,
                onGameOver: (b) => this.handleGameOver(b)
            });

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
        const resModal = document.getElementById('result-modal');
        if (resModal) resModal.style.display = 'none';

        const cpuArea = document.getElementById('cpu-board-area');
        if (cpuArea) cpuArea.style.display = (mode === 'vs') ? 'flex' : 'none';

        const vsCenter = document.getElementById('vs-center-area');
        if (vsCenter) vsCenter.style.display = (mode === 'vs') ? 'flex' : 'none';

        // おじゃま予告トレイのリセット
        this.p1TrayState = { lastCount: -1 };
        this.cpuTrayState = { lastCount: -1 };
        this.updateStatsUI();

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
        const resModal = document.getElementById('result-modal');
        if (resModal) resModal.style.display = 'none';

        // おじゃま予告トレイの非表示
        const p1Wrap = document.getElementById('p1-ojama-wrapper');
        const cpuWrap = document.getElementById('cpu-ojama-wrapper');
        if (p1Wrap) p1Wrap.classList.remove('has-ojama', 'danger');
        if (cpuWrap) cpuWrap.classList.remove('has-ojama', 'danger');
        const p1Badge = document.getElementById('p1-ojama-badge');
        const cpuBadge = document.getElementById('cpu-ojama-badge');
        if (p1Badge) p1Badge.style.display = 'none';
        if (cpuBadge) cpuBadge.style.display = 'none';
    }

    /**
     * ゲーム終了（勝敗判定＆リザルト表示）
     */
    handleGameOver(loserBoard) {
        if (this.appState === 'GAME_OVER') return;
        this.appState = 'GAME_OVER';

        // BGM停止
        if (window.midiPlayer) window.midiPlayer.stop();

        const isSolo = (this.mode === 'solo');
        const isPlayerLoser = (loserBoard === this.playerBoard);

        if (isSolo) {
            if (window.soundEngine) window.soundEngine.playGameOver();
            this.showResultModal('GAME OVER', 'とことんプレイ終了！お疲れ様でした！', '#ef4444');
        } else {
            if (isPlayerLoser) {
                // プレイヤーの敗北
                if (window.soundEngine) window.soundEngine.playGameOver();
                this.showResultModal('YOU LOSE...', 'CPUに敗北してしまいました... リベンジしよう！', '#ef4444');
            } else {
                // CPUの敗北 ＝ プレイヤーの大勝利！！
                if (window.soundEngine) window.soundEngine.playVictory();
                if (this.playerBoard && window.particleManager) {
                    try {
                        window.particleManager.addText(this.playerBoard.width * 0.5, this.playerBoard.height * 0.35, 'YOU WIN!', '#f59e0b', 38);
                        for (let i = 0; i < 60; i++) {
                            const px = Math.random() * this.playerBoard.width;
                            const py = Math.random() * this.playerBoard.height * 0.6;
                            window.particleManager.addSparks(px, py, ['#ff3b5c', '#f59e0b', '#10b981', '#0ea5e9', '#a855f7'][i % 5], 10);
                        }
                    } catch (err) {
                        console.error('Particle effect error:', err);
                    }
                }
                this.showResultModal('🎉 YOU WIN! 🎉', 'お見事！見事にCPUを撃破しました！', '#f59e0b');
            }
        }
    }

    showResultModal(title, subtitle, color) {
        setTimeout(() => {
            const modal = document.getElementById('result-modal');
            const tEl = document.getElementById('result-title');
            const subEl = document.getElementById('result-subtitle');
            const scoreEl = document.getElementById('result-score');
            const chainEl = document.getElementById('result-chain');

            if (tEl) {
                tEl.textContent = title;
                tEl.style.color = color;
                tEl.style.textShadow = `0 0 24px ${color}`;
            }
            if (subEl) subEl.textContent = subtitle;
            if (scoreEl && this.playerBoard) scoreEl.textContent = this.playerBoard.score.toLocaleString();
            if (chainEl && this.playerBoard) chainEl.textContent = `${this.playerBoard.maxChain} 連鎖`;

            if (modal) modal.style.display = 'flex';
        }, 900);
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

            this.updateStatsUI();
        }

        // パーティクル更新（ゲームオーバー演出用にも動作）
        if (window.particleManager && !this.isPaused) {
            window.particleManager.update();
        }

        // 描画（PLAYING, PAUSED, GAME_OVERのいずれでも描画）
        if (this.appState === 'PLAYING' || this.appState === 'PAUSED' || this.appState === 'GAME_OVER') {
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

        const p1Ojama = this.playerBoard.pendingOjama;
        const cpuOjama = (this.cpuBoard) ? this.cpuBoard.pendingOjama : 0;

        if (ojama1El) ojama1El.textContent = p1Ojama;
        if (ojama2El && this.cpuBoard) ojama2El.textContent = cpuOjama;

        // 1P 本家おじゃま予告トレイ更新（アイコン群＆予告数バッジ）
        const p1Wrap = document.getElementById('p1-ojama-wrapper');
        const p1Icons = document.getElementById('p1-ojama-icons');
        const p1Badge = document.getElementById('p1-ojama-badge');
        OjamaTrayRenderer.update(p1Ojama, p1Wrap, p1Icons, p1Badge, this.p1TrayState);

        // CPU 本家おじゃま予告トレイ更新 (VSモード時)
        const cpuWrap = document.getElementById('cpu-ojama-wrapper');
        const cpuIcons = document.getElementById('cpu-ojama-icons');
        const cpuBadge = document.getElementById('cpu-ojama-badge');
        if (this.mode === 'vs') {
            if (cpuWrap) cpuWrap.style.display = 'flex';
            OjamaTrayRenderer.update(cpuOjama, cpuWrap, cpuIcons, cpuBadge, this.cpuTrayState);
        } else if (cpuWrap) {
            cpuWrap.style.display = 'none';
        }
    }
}

window.GameManager = GameManager;
