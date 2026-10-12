/**
 * ai.js - コンピュータ対戦用ぷよぷよAI思考エンジン
 * 難易度別（Easy / Normal / Hard）の盤面評価と操作シミュレーション
 */

class PuyoAI {
    constructor(board, difficulty = 'normal') {
        this.board = board; // 対象のPuyoBoardインスタンス
        this.difficulty = difficulty; // 'easy', 'normal', 'hard'
        this.targetX = 2;
        this.targetRot = 0;
        this.isDecided = false;
        this.moveCooldown = 0;
    }

    setDifficulty(diff) {
        this.difficulty = diff;
    }

    /**
     * 新しい組ぷよが出現した時に最適な配置を決定
     */
    think(activePair, grid, cols, totalRows, deathCol) {
        if (!activePair) return;

        const p1Color = activePair.pivot.puyo.colorKey;
        const p2Color = activePair.child.puyo.colorKey;

        let bestScore = -Infinity;
        let bestX = 2;
        let bestRot = 0;

        const candidateMoves = [];

        // 難易度 Easy の場合はたまにランダム選択
        if (this.difficulty === 'easy' && Math.random() < 0.35) {
            this.targetX = Math.floor(Math.random() * cols);
            this.targetRot = Math.floor(Math.random() * 4);
            this.isDecided = true;
            return;
        }

        // 全ての列と回転をシミュレーション
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

                // その位置に落とした時のスコアを評価
                const score = this.evaluatePlacement(x, childX, rot, p1Color, p2Color, grid, cols, totalRows, deathCol);
                candidateMoves.push({ x, rot, score });

                if (score > bestScore) {
                    bestScore = score;
                    bestX = x;
                    bestRot = rot;
                }
            }
        }

        // 難易度に応じたノイズ
        if (this.difficulty === 'easy') {
            // 上位候補の中からランダムに選ぶ
            candidateMoves.sort((a, b) => b.score - a.score);
            const choice = candidateMoves[Math.min(candidateMoves.length - 1, Math.floor(Math.random() * 5))];
            this.targetX = choice ? choice.x : bestX;
            this.targetRot = choice ? choice.rot : bestRot;
        } else if (this.difficulty === 'normal') {
            candidateMoves.sort((a, b) => b.score - a.score);
            const choice = candidateMoves[Math.min(candidateMoves.length - 1, Math.floor(Math.random() * 2))];
            this.targetX = choice ? choice.x : bestX;
            this.targetRot = choice ? choice.rot : bestRot;
        } else {
            // Hard: 最善手
            this.targetX = bestX;
            this.targetRot = bestRot;
        }

        this.isDecided = true;
    }

    /**
     * 配置の評価関数
     */
    evaluatePlacement(pivotX, childX, rot, p1Color, p2Color, grid, cols, totalRows, deathCol) {
        let score = 0;

        // 床の高さを計算
        const getColumnHeight = (c) => {
            for (let y = 1; y < totalRows; y++) {
                if (grid[y][c] !== null) return totalRows - y;
            }
            return 0;
        };

        const pivotH = getColumnHeight(pivotX);
        const childH = getColumnHeight(childX);

        // 1. 窒息地点（deathCol）の危険度ペナルティ
        if (pivotX === deathCol && pivotH >= totalRows - 3) score -= 300;
        if (childX === deathCol && childH >= totalRows - 3) score -= 300;

        // 2. 高すぎる列へのペナルティ（山になりすぎるのを防ぐ）
        const newPivotH = pivotH + (pivotX === childX ? 2 : 1);
        if (newPivotH >= totalRows - 2) score -= 200;

        // 3. 隣接同色ボーナス（連結しやすい配置）
        const checkNeighbors = (targetCol, targetY, color) => {
            let matches = 0;
            const dirs = [{ dx: 0, dy: 1 }, { dx: -1, dy: 0 }, { dx: 1, dy: 0 }];
            for (const d of dirs) {
                const nx = targetCol + d.dx;
                const ny = targetY + d.dy;
                if (nx >= 0 && nx < cols && ny >= 1 && ny < totalRows) {
                    if (grid[ny][nx] && grid[ny][nx].colorKey === color) {
                        matches++;
                    }
                }
            }
            return matches;
        };

        const targetPivotY = totalRows - 1 - pivotH;
        const targetChildY = (pivotX === childX) ? targetPivotY - 1 : (totalRows - 1 - childH);

        const pivotMatches = checkNeighbors(pivotX, targetPivotY, p1Color);
        const childMatches = checkNeighbors(childX, targetChildY, p2Color);

        // 2〜3個繋がる手は高評価
        score += pivotMatches * 35;
        score += childMatches * 35;

        // 4. 平坦度（デコボコが少ないほど連鎖が作りやすい）
        const heights = [];
        for (let c = 0; c < cols; c++) heights.push(getColumnHeight(c));
        const avgH = heights.reduce((a, b) => a + b, 0) / cols;
        const diffFromAvg = Math.abs(newPivotH - avgH);
        score -= diffFromAvg * 5;

        // 5. 連鎖消去ボーナス
        if (pivotMatches >= 3 || childMatches >= 3) {
            score += 80;
        }

        // 6. わずかなランダムジッター
        score += Math.random() * 4;

        return score;
    }

    /**
     * フレームごとの操作入力エミュレーション
     */
    update() {
        if (!this.board.activePair || !this.isDecided) return;

        const p = this.board.activePair;
        this.moveCooldown--;
        if (this.moveCooldown > 0) return;

        // 難易度に応じた操作スピード
        const speed = (this.difficulty === 'hard') ? 3 : (this.difficulty === 'normal' ? 6 : 10);
        this.moveCooldown = speed;

        // 1. 回転を合わせる
        if (p.rot !== this.targetRot) {
            this.board.rotatePair(1);
            return;
        }

        // 2. 横位置を合わせる
        if (p.pivot.x < this.targetX) {
            this.board.movePair(1);
            return;
        } else if (p.pivot.x > this.targetX) {
            this.board.movePair(-1);
            return;
        }

        // 3. 目標位置に達したら高速落下
        if (this.difficulty === 'hard') {
            this.board.hardDrop();
        } else {
            this.board.fastDrop = true;
        }
    }
}

window.PuyoAI = PuyoAI;
