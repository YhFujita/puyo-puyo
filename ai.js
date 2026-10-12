/**
 * ai.js - 人間らしい思考テンポと賢い連鎖構築を備えたぷよぷよAI
 * 難易度別 (Easy / Normal / Hard) の自然な落下速度・すり鉢型配置・自滅回避
 */

class PuyoAI {
    constructor(board, difficulty = 'normal') {
        this.board = board;
        this.difficulty = difficulty;

        this.targetX = 2;
        this.targetRot = 0;
        this.isDecided = false;

        // 人間らしいリズム・ディレイ管理
        this.thinkDelay = 0;       // 組ぷよ出現時の思考間隔
        this.moveInterval = 0;     // 移動操作の1手あたりのウェイト
        this.moveCooldown = 0;
        this.reachedTarget = false; // 目標位置に到達したか
        this.dropWaitTimer = 0;    // 目標到達後の落下開始待ち
    }

    setDifficulty(diff) {
        this.difficulty = diff;
    }

    /**
     * 新しい組ぷよが出現した時に最適な配置を決定
     */
    think(activePair, grid, cols, totalRows, deathCol) {
        if (!activePair) return;

        this.isDecided = false;
        this.reachedTarget = false;

        // 難易度に応じた「思考ディレイ」と「操作速度」
        if (this.difficulty === 'easy') {
            this.thinkDelay = 20 + Math.floor(Math.random() * 15); // 約0.3〜0.6秒考えてから動く
            this.moveInterval = 14; // ゆっくり1手ずつ動かす
            this.dropWaitTimer = 30; // 急降下せず自然落下
        } else if (this.difficulty === 'normal') {
            this.thinkDelay = 10 + Math.floor(Math.random() * 10);
            this.moveInterval = 8;
            this.dropWaitTimer = 16;
        } else {
            // Hard
            this.thinkDelay = 4;
            this.moveInterval = 4;
            this.dropWaitTimer = 6;
        }

        const p1Color = activePair.pivot.puyo.colorKey;
        const p2Color = activePair.child.puyo.colorKey;

        const candidateMoves = [];

        // 全ての回転・列をシミュレーション評価
        for (let rot = 0; rot < 4; rot++) {
            const offsets = [
                { x: 0, y: -1 }, // 上
                { x: 1, y: 0 },  // 右
                { x: 0, y: 1 },  // 下
                { x: -1, y: 0 }  // 左
            ];
            const ox = offsets[rot].x;

            for (let x = 0; x < cols; x++) {
                const childX = x + ox;
                if (childX < 0 || childX >= cols) continue;

                const score = this.evaluatePlacement(x, childX, rot, p1Color, p2Color, grid, cols, totalRows, deathCol);
                candidateMoves.push({ x, rot, score });
            }
        }

        // スコア順に降順ソート
        candidateMoves.sort((a, b) => b.score - a.score);

        // 難易度による手の選択
        if (this.difficulty === 'easy') {
            // かんたん: 危険な手（窒息手）は絶対避けつつ、上位3〜5手の中から選ぶ（自滅しない！）
            const safeMoves = candidateMoves.filter(m => m.score > -500);
            const pool = safeMoves.length > 0 ? safeMoves : candidateMoves;
            const idx = Math.min(pool.length - 1, Math.floor(Math.random() * 4));
            const choice = pool[idx];
            this.targetX = choice ? choice.x : candidateMoves[0].x;
            this.targetRot = choice ? choice.rot : candidateMoves[0].rot;
        } else if (this.difficulty === 'normal') {
            // ふつう: 上位1〜2手の中から選ぶ
            const idx = Math.min(candidateMoves.length - 1, Math.random() < 0.75 ? 0 : 1);
            const choice = candidateMoves[idx];
            this.targetX = choice ? choice.x : candidateMoves[0].x;
            this.targetRot = choice ? choice.rot : candidateMoves[0].rot;
        } else {
            // ゲキムズ (Hard): 常に最善手
            this.targetX = candidateMoves[0].x;
            this.targetRot = candidateMoves[0].rot;
        }

        this.isDecided = true;
    }

    /**
     * 盤面配置の評価関数（自滅回避・端積み優先・すり鉢型連鎖構築）
     */
    evaluatePlacement(pivotX, childX, rot, p1Color, p2Color, grid, cols, totalRows, deathCol) {
        let score = 0;

        const getColumnHeight = (c) => {
            for (let y = 1; y < totalRows; y++) {
                if (grid[y][c] !== null) return totalRows - y;
            }
            return 0;
        };

        const pivotH = getColumnHeight(pivotX);
        const childH = getColumnHeight(childX);

        // 新しい高さの計算
        const newPivotH = pivotH + (pivotX === childX ? (rot === 2 ? 1 : 2) : 1);
        const newChildH = childH + (pivotX === childX ? (rot === 0 ? 1 : 2) : 1);
        const maxNewH = Math.max(newPivotH, newChildH);

        // ==========================================
        // 1. 【最重要】窒息地点 (deathCol) の絶対防衛！
        // ==========================================
        const deathColH = (pivotX === deathCol) ? newPivotH : ((childX === deathCol) ? newChildH : getColumnHeight(deathCol));

        // 窒息列に置くこと自体に基礎ペナルティ（真ん中を空ける）
        if (pivotX === deathCol || childX === deathCol) {
            score -= 120;
        }

        // 窒息列が高くなると激甚ペナルティ（絶対に自滅しない！）
        if (deathColH >= totalRows - 5) score -= 400;
        if (deathColH >= totalRows - 3) score -= 1500;
        if (deathColH >= totalRows - 2) score -= 6000; // 即死危機！絶対回避

        // 他の列でも天井近すぎるとペナルティ
        if (maxNewH >= totalRows - 2) score -= 800;

        // ==========================================
        // 2. 【定石】端から積む＆すり鉢型ボーナス
        // ==========================================
        // 端の列 (0列目 または cols-1列目) を優先的に使う
        const isEdge = (pivotX === 0 || pivotX === cols - 1 || childX === 0 || childX === cols - 1);
        if (isEdge) {
            score += 45;
        }

        // 窒息列から離れるほど安全ボーナス
        const distFromDeath1 = Math.abs(pivotX - deathCol);
        const distFromDeath2 = Math.abs(childX - deathCol);
        score += (distFromDeath1 + distFromDeath2) * 15;

        // ==========================================
        // 3. 【連鎖】同色ぷよの隣接ボーナス (2〜3個のタネ)
        // ==========================================
        const targetPivotY = totalRows - 1 - pivotH;
        const targetChildY = (pivotX === childX) ? targetPivotY - 1 : (totalRows - 1 - childH);

        const checkMatches = (col, y, color) => {
            let count = 0;
            const dirs = [{ dx: 0, dy: 1 }, { dx: -1, dy: 0 }, { dx: 1, dy: 0 }];
            for (const d of dirs) {
                const nx = col + d.dx;
                const ny = y + d.dy;
                if (nx >= 0 && nx < cols && ny >= 1 && ny < totalRows) {
                    const neighbor = grid[ny][nx];
                    if (neighbor && neighbor.colorKey === color) {
                        count++;
                    }
                }
            }
            return count;
        };

        const pivotMatches = checkMatches(pivotX, targetPivotY, p1Color);
        const childMatches = checkMatches(childX, targetChildY, p2Color);

        // 同色2個〜3個の連結（連鎖の種作り）を高評価！
        score += pivotMatches * 55;
        score += childMatches * 55;

        // 同色ペア自体の縦並びボーナス
        if (p1Color === p2Color && pivotX === childX) {
            score += 40;
        }

        // ==========================================
        // 4. 【おじゃま危機対応 / 発火判定】
        // ==========================================
        const hasPendingOjama = this.board.pendingOjama > 0;
        const causesClear = (pivotMatches >= 3 || childMatches >= 3);

        if (causesClear) {
            if (hasPendingOjama) {
                // おじゃまぷよが迫っている時は相殺のために緊急発火！（大ボーナス）
                score += 500;
            } else if (this.difficulty === 'hard') {
                // Hardは連鎖の種が十分あれば発火
                score += 150;
            } else {
                // 通常時は単発消しよりも、まず2〜3個繋げる方を重視
                score += 60;
            }
        }

        // わずかなランダムノイズ（同じ手ばかり繰り返さないように）
        score += Math.random() * 5;

        return score;
    }

    /**
     * フレームごとの自然な人間風操作エミュレーション
     */
    update() {
        if (!this.board.activePair || !this.isDecided) return;

        const p = this.board.activePair;

        // 1. 思考ディレイ（出現直後は少し考える）
        if (this.thinkDelay > 0) {
            this.thinkDelay--;
            return;
        }

        // 2. 移動クールダウン
        this.moveCooldown--;
        if (this.moveCooldown > 0) return;
        this.moveCooldown = this.moveInterval;

        // 3. 回転を合わせる
        if (p.rot !== this.targetRot) {
            this.board.rotatePair(1);
            return;
        }

        // 4. 横位置を合わせる
        if (p.pivot.x < this.targetX) {
            this.board.movePair(1);
            return;
        } else if (p.pivot.x > this.targetX) {
            this.board.movePair(-1);
            return;
        }

        // 5. 目標位置（回転・横位置）に完全到達！
        this.reachedTarget = true;

        // 6. 落下速度の人間らしい制御
        if (this.difficulty === 'easy') {
            // かんたん: 急降下（fastDrop）は一切使わず、自然な落下速度でポトポト落とす！
            this.board.fastDrop = false;
        } else if (this.difficulty === 'normal') {
            // ふつう: 目標到達後、少し余裕を持ってからマイルドに落とす
            if (this.dropWaitTimer > 0) {
                this.dropWaitTimer--;
                this.board.fastDrop = false;
            } else {
                this.board.fastDrop = true; // マイルドな高速落下
            }
        } else {
            // ゲキムズ (Hard): 目標到達後、素早く落とす
            if (this.dropWaitTimer > 0) {
                this.dropWaitTimer--;
            } else {
                this.board.fastDrop = true;
            }
        }
    }
}

window.PuyoAI = PuyoAI;
