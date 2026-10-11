/**
 * game.js - ぷよぷよゲームエンジン
 * 盤面管理、組ぷよ操作、回転キック、ちぎり落下物理、
 * 4個消去、連鎖ループ判定、公式スコア計算、全消し判定
 */

// 定数定義
const COLS = 6;
const ROWS = 12;      // 表示される段数
const GHOST_ROWS = 1;  // 最上段の隠し段 (y = 0)
const TOTAL_ROWS = ROWS + GHOST_ROWS; // 13段
const CELL_SIZE = 48; // セルピクセルサイズ

// 窒息判定地点 (左から3列目、0-indexedで2、表示最上段のy = 1)
const DEATH_COL = 2;
const DEATH_ROW = 1;

// ぷよ通連鎖ボーナス倍率テーブル
const CHAIN_BONUS_TABLE = [
    0,   0,   8,  16,  32,  64,  96, 128, 160, 192,
    224, 256, 288, 320, 352, 384, 416, 448, 480, 512
];

// 連結数ボーナス (4連結=0, 5連結=2, 6連結=3, 7連結=4, 8連結=5, 9連結=6, 10連結=7, 11以上=10)
const CONNECT_BONUS_TABLE = [0, 0, 0, 0, 0, 2, 3, 4, 5, 6, 7, 10];

// 色数ボーナス (1色=0, 2色=3, 3色=6, 4色=12, 5色=24)
const COLOR_BONUS_TABLE = [0, 0, 3, 6, 12, 24];

class PuyoGame {
    constructor(canvas, nextCanvas) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');
        this.nextCanvas = nextCanvas;
        this.nextCtx = nextCanvas.getContext('2d');

        // キャンバスサイズ設定
        this.width = COLS * CELL_SIZE;
        this.height = ROWS * CELL_SIZE;
        this.canvas.width = this.width;
        this.canvas.height = this.height;

        this.nextCanvas.width = CELL_SIZE * 2 + 16;
        this.nextCanvas.height = CELL_SIZE * 5 + 24;

        // グリッド初期化 (TOTAL_ROWS x COLS)
        this.grid = [];
        for (let y = 0; y < TOTAL_ROWS; y++) {
            this.grid[y] = new Array(COLS).fill(null);
        }

        // ペアキュー (NEXT, NEXT2)
        this.nextQueue = [];
        this.initNextQueue();

        // 操作中ペア
        this.activePair = null;

        // 状態遷移:
        // 'SPAWN', 'CONTROLLING', 'CHIGIRI_FALL', 'CHECK_CLEAR', 'CLEAR_ANIM', 'CHAIN_FALL', 'GAME_OVER'
        this.state = 'SPAWN';
        this.stateTimer = 0;

        // ちぎり・自由落下中のぷよリスト
        // { puyo, col, currentY, targetY, vy }
        this.fallingPuyos = [];

        // 消去対象ぷよリスト
        this.clearingGroups = [];
        this.clearingTimer = 0;

        // 連鎖・スコア管理
        this.chainCount = 0;
        this.score = 0;
        this.maxChain = 0;
        this.totalPopped = 0;
        this.isAllClear = false;
        this.allClearBonusPending = false;

        // 操作パラメータ
        this.dropInterval = 45; // 通常落下速度（フレーム）
        this.dropTimer = 0;
        this.fastDrop = false;

        // キー入力状態
        this.keys = {
            left: false,
            right: false,
            down: false,
            rotateLeft: false,
            rotateRight: false
        };
        this.keyRepeatTimer = {
            left: 0,
            right: 0
        };

        // アニメーションループ管理
        this.animFrameId = null;

        this.setupEventListeners();
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

    start() {
        this.reset();
        this.loop();
    }

    reset() {
        for (let y = 0; y < TOTAL_ROWS; y++) {
            this.grid[y] = new Array(COLS).fill(null);
        }
        this.nextQueue = [];
        this.initNextQueue();
        this.activePair = null;
        this.fallingPuyos = [];
        this.clearingGroups = [];
        this.chainCount = 0;
        this.score = 0;
        this.totalPopped = 0;
        this.isAllClear = false;
        this.allClearBonusPending = false;
        this.state = 'SPAWN';
        this.stateTimer = 0;
        this.dropTimer = 0;
        if (window.particleManager) {
            window.particleManager.clear();
        }
        this.updateUI();
    }

    setupEventListeners() {
        window.addEventListener('keydown', (e) => {
            if (window.soundEngine) window.soundEngine.resume();
            if (this.state === 'GAME_OVER') {
                if (e.code === 'Space' || e.code === 'Enter') {
                    this.reset();
                }
                return;
            }

            switch (e.code) {
                case 'ArrowLeft':
                case 'KeyA':
                    if (!this.keys.left) {
                        this.movePair(-1);
                        this.keyRepeatTimer.left = 12;
                    }
                    this.keys.left = true;
                    break;
                case 'ArrowRight':
                case 'KeyD':
                    if (!this.keys.right) {
                        this.movePair(1);
                        this.keyRepeatTimer.right = 12;
                    }
                    this.keys.right = true;
                    break;
                case 'ArrowDown':
                case 'KeyS':
                    this.fastDrop = true;
                    break;
                case 'ArrowUp':
                case 'KeyW':
                case 'KeyX':
                    this.rotatePair(1); // 右回転
                    break;
                case 'KeyZ':
                case 'ControlLeft':
                    this.rotatePair(-1); // 左回転
                    break;
                case 'Space':
                    this.hardDrop();
                    break;
            }
        });

        window.addEventListener('keyup', (e) => {
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
                    this.fastDrop = false;
                    break;
            }
        });
    }

    /**
     * 新しい組ぷよの出現 (SPAWN)
     */
    spawnPair() {
        // ゲームオーバー判定: 窒息地点にぷよがあるかチェック
        if (this.grid[DEATH_ROW][DEATH_COL] !== null) {
            this.gameOver();
            return;
        }

        const next = this.getNextPair();
        const pivotPuyo = next.pivotPuyo;
        const childPuyo = next.childPuyo;

        // 軸ぷよ: x=2, y=1 (画面最上段)
        // 子ぷよ: x=2, y=0 (ゴースト段)
        this.activePair = {
            pivot: { x: DEATH_COL, y: 1, puyo: pivotPuyo },
            child: { x: DEATH_COL, y: 0, puyo: childPuyo },
            rot: 0 // 0: 上, 1: 右, 2: 下, 3: 左
        };

        this.updateActivePairConnections();

        if (this.grid[1][DEATH_COL] !== null) {
            this.gameOver();
            return;
        }

        this.state = 'CONTROLLING';
        this.dropTimer = 0;
    }

    /**
     * 操作中ペアが同色の場合の結合状態を更新
     */
    updateActivePairConnections() {
        if (!this.activePair) return;
        const p = this.activePair;
        const isSameColor = (p.pivot.puyo.colorKey === p.child.puyo.colorKey);

        if (!isSameColor) {
            p.pivot.puyo.setConnections(false, false, false, false);
            p.child.puyo.setConnections(false, false, false, false);
            return;
        }

        // 軸ぷよに対する子ぷよの向き (rot: 0:上, 1:右, 2:下, 3:左)
        switch (p.rot) {
            case 0: // 子ぷよは上
                p.pivot.puyo.setConnections(true, false, false, false);
                p.child.puyo.setConnections(false, false, true, false);
                break;
            case 1: // 子ぷよは右
                p.pivot.puyo.setConnections(false, true, false, false);
                p.child.puyo.setConnections(false, false, false, true);
                break;
            case 2: // 子ぷよは下
                p.pivot.puyo.setConnections(false, false, true, false);
                p.child.puyo.setConnections(true, false, false, false);
                break;
            case 3: // 子ぷよは左
                p.pivot.puyo.setConnections(false, false, false, true);
                p.child.puyo.setConnections(false, true, false, false);
                break;
        }
    }

    /**
     * 組ぷよの横移動
     */
    movePair(dx) {
        if (this.state !== 'CONTROLLING' || !this.activePair) return;

        const p = this.activePair;
        const newPivotX = p.pivot.x + dx;
        const newChildX = p.child.x + dx;

        if (newPivotX < 0 || newPivotX >= COLS || newChildX < 0 || newChildX >= COLS) return;
        if (this.isOccupied(newPivotX, p.pivot.y) || this.isOccupied(newChildX, p.child.y)) return;

        p.pivot.x = newPivotX;
        p.child.x = newChildX;

        // 視線を移動方向に向ける
        p.pivot.puyo.setLookDirection(dx, 0);
        p.child.puyo.setLookDirection(dx, 0);

        if (window.soundEngine) window.soundEngine.playMove();
    }

    /**
     * 組ぷよの回転 (dir: 1 = 右回転, -1 = 左回転)
     */
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

        // 通常回転可能か
        if (this.canPlaceChild(targetChildX, targetChildY)) {
            p.child.x = targetChildX;
            p.child.y = targetChildY;
            p.rot = newRot;
            this.updateActivePairConnections();
            if (window.soundEngine) window.soundEngine.playRotate();
            return;
        }

        // 壁蹴り (Wall Kick) / 床蹴り (Floor Kick)
        let kickX = 0;
        let kickY = 0;

        if (offsets[newRot].x > 0 && (targetChildX >= COLS || this.isOccupied(targetChildX, targetChildY))) {
            kickX = -1;
        } else if (offsets[newRot].x < 0 && (targetChildX < 0 || this.isOccupied(targetChildX, targetChildY))) {
            kickX = 1;
        } else if (offsets[newRot].y > 0 && (targetChildY >= TOTAL_ROWS || this.isOccupied(targetChildX, targetChildY))) {
            kickY = -1;
        }

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
            if (window.soundEngine) window.soundEngine.playRotate();
            return;
        }

        // 180度反転 (クイックターン)
        const oppositeRot = (p.rot + 2) % 4;
        const oppOffset = offsets[oppositeRot];
        const oppChildX = p.pivot.x + oppOffset.x;
        const oppChildY = p.pivot.y + oppOffset.y;

        if (this.canPlaceChild(oppChildX, oppChildY)) {
            p.child.x = oppChildX;
            p.child.y = oppChildY;
            p.rot = oppositeRot;
            this.updateActivePairConnections();
            if (window.soundEngine) window.soundEngine.playRotate();
        }
    }

    canPlacePivot(x, y) {
        if (x < 0 || x >= COLS || y < 0 || y >= TOTAL_ROWS) return false;
        return !this.isOccupied(x, y);
    }

    canPlaceChild(x, y) {
        if (x < 0 || x >= COLS || y < 0 || y >= TOTAL_ROWS) return false;
        return !this.isOccupied(x, y);
    }

    isOccupied(x, y) {
        if (x < 0 || x >= COLS || y < 0 || y >= TOTAL_ROWS) return true;
        return this.grid[y][x] !== null;
    }

    /**
     * ハードドロップ（即時落下設置）
     */
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

        if (nextPivotY >= TOTAL_ROWS || this.isOccupied(p.pivot.x, nextPivotY)) return false;
        if (nextChildY >= TOTAL_ROWS || this.isOccupied(p.child.x, nextChildY)) return false;
        return true;
    }

    /**
     * 操作ループ更新
     */
    updateControlling() {
        const p = this.activePair;
        if (!p) return;

        // キーリピート
        if (this.keys.left) {
            this.keyRepeatTimer.left--;
            if (this.keyRepeatTimer.left <= 0) {
                this.movePair(-1);
                this.keyRepeatTimer.left = 4;
            }
        }
        if (this.keys.right) {
            this.keyRepeatTimer.right--;
            if (this.keyRepeatTimer.right <= 0) {
                this.movePair(1);
                this.keyRepeatTimer.right = 4;
            }
        }

        // 高速落下時は下を凝視
        if (this.fastDrop) {
            p.pivot.puyo.setLookDirection(0, 0.95);
            p.child.puyo.setLookDirection(0, 0.95);
        }

        const currentDropSpeed = this.fastDrop ? 2 : this.dropInterval;
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
     * 接地ロック＆「ちぎり」判定
     */
    lockPair() {
        const p = this.activePair;
        this.activePair = null;

        const findGroundY = (x, startY) => {
            let y = startY;
            while (y + 1 < TOTAL_ROWS && this.grid[y + 1][x] === null) {
                y++;
            }
            return y;
        };

        let chigiriOccurred = false;

        // ペアが同じ列（縦向き）にあるか、異なる列（横向き）にあるかで分岐
        if (p.pivot.x === p.child.x) {
            // === 縦向きペアの場合 ===
            const col = p.pivot.x;
            const isPivotLower = p.pivot.y > p.child.y;
            const lower = isPivotLower ? p.pivot : p.child;
            const upper = isPivotLower ? p.child : p.pivot;

            // 下のぷよの接地先
            const lowerGroundY = findGroundY(col, lower.y);
            // 上のぷよは必ず下のぷよの1マス上！
            const upperGroundY = lowerGroundY - 1;

            // 下のぷよの処理
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

            // 上のぷよの処理
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
                if (window.soundEngine) window.soundEngine.playChigiri();
            } else {
                if (window.soundEngine) window.soundEngine.playLand();
            }
        } else {
            // === 横向きペアの場合（列が異なる） ===
            const pivotGroundY = findGroundY(p.pivot.x, p.pivot.y);
            const childGroundY = findGroundY(p.child.x, p.child.y);

            // 軸ぷよの接地またはちぎり
            if (pivotGroundY === p.pivot.y) {
                this.grid[p.pivot.y][p.pivot.x] = p.pivot.puyo;
                p.pivot.puyo.triggerSquash(0.45);
                if (window.soundEngine) window.soundEngine.playLand();
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

            // 子ぷよの接地またはちぎり
            if (childGroundY === p.child.y) {
                this.grid[p.child.y][p.child.x] = p.child.puyo;
                p.child.puyo.triggerSquash(0.45);
                if (window.soundEngine && !chigiriOccurred) window.soundEngine.playLand();
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
                if (window.soundEngine) window.soundEngine.playChigiri();
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

    /**
     * ちぎれ落下・自由落下の物理更新
     */
    updateFallingPuyos() {
        if (this.fallingPuyos.length === 0) {
            this.updateAllConnections();
            return true;
        }

        const gravity = 0.05;
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
                if (window.soundEngine) window.soundEngine.playLand();
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

    /**
     * 盤面上の全ぷよの接続（上下左右の同色判定）を再計算
     */
    updateAllConnections() {
        for (let y = 0; y < TOTAL_ROWS; y++) {
            for (let x = 0; x < COLS; x++) {
                const p = this.grid[y][x];
                if (!p) continue;

                const isSameColor = (ox, oy) => {
                    const nx = x + ox;
                    const ny = y + oy;
                    if (nx < 0 || nx >= COLS || ny < 0 || ny >= TOTAL_ROWS) return false;
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

    /**
     * 4つ以上の連結グループをBFS探索
     */
    findClearableGroups() {
        const visited = Array.from({ length: TOTAL_ROWS }, () => new Array(COLS).fill(false));
        const groups = [];

        for (let y = 0; y < TOTAL_ROWS; y++) {
            for (let x = 0; x < COLS; x++) {
                const startPuyo = this.grid[y][x];
                if (!startPuyo || visited[y][x]) continue;

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
                        if (nx >= 0 && nx < COLS && ny >= 0 && ny < TOTAL_ROWS) {
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

    /**
     * 消去前アニメーション開始
     */
    triggerClearAnimation(groups) {
        this.clearingGroups = groups;
        this.state = 'CLEAR_ANIM';
        this.clearingTimer = 36;

        for (const grp of groups) {
            for (const item of grp) {
                item.puyo.startClear();
            }
        }
    }

    /**
     * ぷよ消去の実行と得点計算
     */
    executeClear() {
        this.chainCount++;
        if (this.chainCount > this.maxChain) {
            this.maxChain = this.chainCount;
        }

        let totalPuyosInChain = 0;
        const colorSet = new Set();
        let totalConnectBonus = 0;

        for (const grp of this.clearingGroups) {
            totalPuyosInChain += grp.length;
            colorSet.add(grp[0].puyo.colorKey);

            const connIdx = Math.min(grp.length, CONNECT_BONUS_TABLE.length - 1);
            totalConnectBonus += CONNECT_BONUS_TABLE[connIdx];

            for (const item of grp) {
                const px = item.x * CELL_SIZE + CELL_SIZE * 0.5;
                const py = (item.y - GHOST_ROWS) * CELL_SIZE + CELL_SIZE * 0.5;
                if (window.particleManager) {
                    window.particleManager.createPopEffect(px, py, item.puyo.colorData);
                }
                this.grid[item.y][item.x] = null;
            }
        }

        this.totalPopped += totalPuyosInChain;

        if (window.soundEngine) {
            window.soundEngine.playPop(this.chainCount);
            window.soundEngine.playChain(this.chainCount);
        }

        const chainText = `${this.chainCount} 連鎖！`;
        const textColors = ['#fbbf24', '#f87171', '#60a5fa', '#34d399', '#c084fc', '#f43f5e'];
        const color = textColors[(this.chainCount - 1) % textColors.length];
        if (window.particleManager) {
            window.particleManager.addText(this.width * 0.5, this.height * 0.35, chainText, color, 34 + Math.min(this.chainCount * 3, 20));
        }

        // ぷよ通公式スコア計算
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
        this.updateUI();

        this.clearingGroups = [];
        this.setupChainFall();
    }

    /**
     * 空中に残されたぷよの自由落下準備
     */
    setupChainFall() {
        this.fallingPuyos = [];

        for (let x = 0; x < COLS; x++) {
            let writeY = TOTAL_ROWS - 1;
            for (let y = TOTAL_ROWS - 1; y >= 0; y--) {
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

    /**
     * 連鎖終了または全消し判定
     */
    checkChainEndOrAllClear() {
        let hasAnyPuyo = false;
        for (let y = 0; y < TOTAL_ROWS; y++) {
            for (let x = 0; x < COLS; x++) {
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
            if (window.soundEngine) window.soundEngine.playAllClear();
            if (window.particleManager) {
                window.particleManager.addText(this.width * 0.5, this.height * 0.45, '★ ALL CLEAR! ★', '#fbbf24', 36);
            }
        }

        this.chainCount = 0;
        this.state = 'SPAWN';
    }

    /**
     * ゲームオーバー処理
     */
    gameOver() {
        this.state = 'GAME_OVER';
        if (window.soundEngine) window.soundEngine.playGameOver();
        if (window.particleManager) {
            window.particleManager.addText(this.width * 0.5, this.height * 0.45, 'GAME OVER', '#ef4444', 38);
        }
    }

    /**
     * メインループ
     */
    loop() {
        this.update();
        this.draw();
        this.animFrameId = requestAnimationFrame(() => this.loop());
    }

    update() {
        if (window.particleManager) window.particleManager.update();

        switch (this.state) {
            case 'SPAWN':
                this.spawnPair();
                break;

            case 'CONTROLLING':
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

            case 'GAME_OVER':
                break;
        }
    }

    /**
     * 描画
     */
    draw() {
        this.ctx.clearRect(0, 0, this.width, this.height);

        // 1. 背景グリッド
        this.drawBoardGrid();

        // 2. 着地予測ゴースト（半透明プレビュー）
        if (this.state === 'CONTROLLING' && this.activePair) {
            this.drawGhostPair();
        }

        // 3. 盤面上の確定ぷよ
        for (let y = GHOST_ROWS; y < TOTAL_ROWS; y++) {
            for (let x = 0; x < COLS; x++) {
                const puyo = this.grid[y][x];
                if (puyo) {
                    const cx = x * CELL_SIZE + CELL_SIZE * 0.5;
                    const cy = (y - GHOST_ROWS) * CELL_SIZE + CELL_SIZE * 0.5;
                    puyo.draw(this.ctx, cx, cy, CELL_SIZE);
                }
            }
        }

        // 4. ちぎり・自由落下中のぷよ
        for (const item of this.fallingPuyos) {
            if (item.currentY >= GHOST_ROWS - 0.5) {
                const cx = item.col * CELL_SIZE + CELL_SIZE * 0.5;
                const cy = (item.currentY - GHOST_ROWS) * CELL_SIZE + CELL_SIZE * 0.5;
                item.puyo.draw(this.ctx, cx, cy, CELL_SIZE);
            }
        }

        // 5. 操作中の組ぷよ
        if (this.state === 'CONTROLLING' && this.activePair) {
            this.drawActivePair();
        }

        // 6. 窒息地点の赤い×印
        this.drawDeathMarker();

        // 7. パーティクル・テキスト
        if (window.particleManager) {
            window.particleManager.draw(this.ctx);
        }

        // 8. ネクストぷよ描画
        this.drawNextPuyos();
    }

    drawBoardGrid() {
        this.ctx.save();
        this.ctx.strokeStyle = 'rgba(255, 255, 255, 0.05)';
        this.ctx.lineWidth = 1;

        for (let x = 0; x <= COLS; x++) {
            this.ctx.beginPath();
            this.ctx.moveTo(x * CELL_SIZE, 0);
            this.ctx.lineTo(x * CELL_SIZE, this.height);
            this.ctx.stroke();
        }
        for (let y = 0; y <= ROWS; y++) {
            this.ctx.beginPath();
            this.ctx.moveTo(0, y * CELL_SIZE);
            this.ctx.lineTo(this.width, y * CELL_SIZE);
            this.ctx.stroke();
        }
        this.ctx.restore();
    }

    /**
     * 着地予測ゴースト（半透明のガイド枠）の描画
     */
    drawGhostPair() {
        const p = this.activePair;
        if (!p) return;

        // ペアがそのまま落ちたときの深さ
        let dropDistance = 0;
        while (true) {
            const nextPivotY = p.pivot.y + dropDistance + 1;
            const nextChildY = p.child.y + dropDistance + 1;
            if (nextPivotY >= TOTAL_ROWS || this.isOccupied(p.pivot.x, nextPivotY) ||
                nextChildY >= TOTAL_ROWS || this.isOccupied(p.child.x, nextChildY)) {
                break;
            }
            dropDistance++;
        }

        if (dropDistance === 0) return;

        const drawGhostAt = (col, row, colorData) => {
            const displayY = row - GHOST_ROWS;
            if (displayY < 0) return;
            const cx = col * CELL_SIZE + CELL_SIZE * 0.5;
            const cy = displayY * CELL_SIZE + CELL_SIZE * 0.5;
            const r = CELL_SIZE * 0.4;

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
        const cx = DEATH_COL * CELL_SIZE + CELL_SIZE * 0.5;
        const cy = (DEATH_ROW - GHOST_ROWS) * CELL_SIZE + CELL_SIZE * 0.5;

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
            if (item.y >= GHOST_ROWS - 0.5) {
                const cx = item.x * CELL_SIZE + CELL_SIZE * 0.5;
                const cy = (item.y - GHOST_ROWS) * CELL_SIZE + CELL_SIZE * 0.5;
                item.puyo.draw(this.ctx, cx, cy, CELL_SIZE);
            }
        };

        drawSingle(p.pivot);
        drawSingle(p.child);
    }

    drawNextPuyos() {
        this.nextCtx.clearRect(0, 0, this.nextCanvas.width, this.nextCanvas.height);

        const drawPairAt = (pair, startY, isSmall = false) => {
            const scale = isSmall ? 0.75 : 0.95;
            const size = CELL_SIZE * scale;
            const cx = this.nextCanvas.width * 0.5;

            // 子ぷよ (上)
            pair.childPuyo.draw(this.nextCtx, cx, startY, size);
            // 軸ぷよ (下)
            pair.pivotPuyo.draw(this.nextCtx, cx, startY + size * 0.9, size);
        };

        // NEXT表示
        if (this.nextQueue.length > 0) {
            this.nextCtx.save();
            this.nextCtx.fillStyle = '#94a3b8';
            this.nextCtx.font = 'bold 12px sans-serif';
            this.nextCtx.textAlign = 'center';
            this.nextCtx.fillText('NEXT', this.nextCanvas.width * 0.5, 18);
            drawPairAt(this.nextQueue[0], 48, false);
            this.nextCtx.restore();
        }

        // NEXT2表示
        if (this.nextQueue.length > 1) {
            this.nextCtx.save();
            this.nextCtx.fillStyle = '#64748b';
            this.nextCtx.font = 'bold 10px sans-serif';
            this.nextCtx.textAlign = 'center';
            this.nextCtx.fillText('NEXT 2', this.nextCanvas.width * 0.5, 142);
            drawPairAt(this.nextQueue[1], 168, true);
            this.nextCtx.restore();
        }
    }

    updateUI() {
        const scoreEl = document.getElementById('score-val');
        const chainEl = document.getElementById('chain-val');
        const poppedEl = document.getElementById('popped-val');

        if (scoreEl) scoreEl.textContent = this.score.toLocaleString();
        if (chainEl) chainEl.textContent = this.maxChain;
        if (poppedEl) poppedEl.textContent = this.totalPopped;
    }
}

window.PuyoGame = PuyoGame;
