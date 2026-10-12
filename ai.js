/**
 * ai.js - 最強・無自滅ぷよぷよAI思考エンジン
 * 1. 最上段クイックスライド移動（壁スタック自滅の完全防止）
 * 2. 窒息列 (deathCol) 絶対不可侵の原則（すり鉢型・端積み特化）
 * 3. 仮想連鎖シミュレータ ＆ 潜在連鎖ポテンシャル測定
 * 4. NEXT2手先読み (2-ply Search)
 */

class PuyoAI {
    constructor(board, difficulty = 'normal') {
        this.board = board;
        this.difficulty = difficulty;

        this.targetX = 0;
        this.targetRot = 0;
        this.isDecided = false;

        this.moveCooldown = 0;
        this.stuckCounter = 0;
    }

    setDifficulty(diff) {
        this.difficulty = diff;
    }

    /**
     * 新しい組ぷよが出現した時に思考開始
     */
    think(activePair, grid, cols, totalRows, deathCol) {
        if (!activePair) return;

        this.isDecided = false;
        this.stuckCounter = 0;

        const p1Color = activePair.pivot.puyo.colorKey;
        const p2Color = activePair.child.puyo.colorKey;

        const nextPair = (this.board.nextQueue && this.board.nextQueue.length > 0) ? this.board.nextQueue[0] : null;

        let bestMove = null;

        if (this.difficulty === 'hard' && nextPair) {
            // ゲキムズ: NEXTを含む2手先全探索
            bestMove = this.search2Ply(grid, cols, totalRows, deathCol, p1Color, p2Color, nextPair.pivotColor, nextPair.childColor);
        } else {
            // かんたん / ふつう: 1手先仮想連鎖シミュレーション
            bestMove = this.search1Ply(grid, cols, totalRows, deathCol, p1Color, p2Color);
        }

        if (bestMove) {
            this.targetX = bestMove.x;
            this.targetRot = bestMove.rot;
        } else {
            // 安全なデフォルト (一番端)
            this.targetX = 0;
            this.targetRot = 0;
        }

        this.isDecided = true;
    }

    /**
     * 1手先探索
     */
    search1Ply(grid, cols, totalRows, deathCol, p1Color, p2Color) {
        const candidateMoves = [];

        for (let rot = 0; rot < 4; rot++) {
            const offsets = [{ x: 0, y: -1 }, { x: 1, y: 0 }, { x: 0, y: 1 }, { x: -1, y: 0 }];
            const ox = offsets[rot].x;

            for (let x = 0; x < cols; x++) {
                const childX = x + ox;
                if (childX < 0 || childX >= cols) continue;

                const sim = this.simulatePlacement(grid, cols, totalRows, x, childX, rot, p1Color, p2Color);
                if (!sim.valid) continue;

                const score = this.evaluateBoard(sim.grid, cols, totalRows, deathCol, sim.chains, x, childX);
                candidateMoves.push({ x, rot, score });
            }
        }

        if (candidateMoves.length === 0) return { x: 0, rot: 0 };

        candidateMoves.sort((a, b) => b.score - a.score);

        if (this.difficulty === 'easy') {
            // かんたん: 上位3手の安全な手から選択
            const safe = candidateMoves.filter(m => m.score > -2000);
            const pool = safe.length > 0 ? safe : candidateMoves;
            const idx = Math.min(pool.length - 1, Math.floor(Math.random() * 3));
            return pool[idx];
        } else if (this.difficulty === 'normal') {
            const idx = Math.min(candidateMoves.length - 1, Math.random() < 0.8 ? 0 : 1);
            return candidateMoves[idx];
        }

        return candidateMoves[0];
    }

    /**
     * ゲキムズ 2手先探索
     */
    search2Ply(grid, cols, totalRows, deathCol, p1Color, p2Color, n1Color, n2Color) {
        let bestScore = -Infinity;
        let bestMove = { x: 0, rot: 0 };

        for (let rot1 = 0; rot1 < 4; rot1++) {
            const offsets1 = [{ x: 0, y: -1 }, { x: 1, y: 0 }, { x: 0, y: 1 }, { x: -1, y: 0 }];
            const ox1 = offsets1[rot1].x;

            for (let x1 = 0; x1 < cols; x1++) {
                const childX1 = x1 + ox1;
                if (childX1 < 0 || childX1 >= cols) continue;

                const sim1 = this.simulatePlacement(grid, cols, totalRows, x1, childX1, rot1, p1Color, p2Color);
                if (!sim1.valid) continue;

                // 1手目自体の安全性スコア
                const score1 = this.evaluateBoard(sim1.grid, cols, totalRows, deathCol, sim1.chains, x1, childX1);
                // 1手目で窒息列に危険な手を打った場合は枝刈り（即除外）
                if (score1 < -3000) continue;

                let bestNextScore = -Infinity;

                for (let rot2 = 0; rot2 < 4; rot2++) {
                    const offsets2 = [{ x: 0, y: -1 }, { x: 1, y: 0 }, { x: 0, y: 1 }, { x: -1, y: 0 }];
                    const ox2 = offsets2[rot2].x;

                    for (let x2 = 0; x2 < cols; x2++) {
                        const childX2 = x2 + ox2;
                        if (childX2 < 0 || childX2 >= cols) continue;

                        const sim2 = this.simulatePlacement(sim1.grid, cols, totalRows, x2, childX2, rot2, n1Color, n2Color);
                        if (!sim2.valid) continue;

                        const totalChains = sim1.chains + sim2.chains;
                        const score2 = this.evaluateBoard(sim2.grid, cols, totalRows, deathCol, totalChains, x2, childX2);

                        if (score2 > bestNextScore) {
                            bestNextScore = score2;
                        }
                    }
                }

                const combined = (bestNextScore !== -Infinity) ? (score1 * 0.4 + bestNextScore * 0.6) : score1;

                if (combined > bestScore) {
                    bestScore = combined;
                    bestMove = { x: x1, rot: rot1 };
                }
            }
        }

        return bestMove;
    }

    /**
     * 仮想盤面シミュレータ
     */
    simulatePlacement(originalGrid, cols, totalRows, pivotX, childX, rot, color1, color2) {
        const simGrid = Array.from({ length: totalRows }, (_, y) =>
            Array.from({ length: cols }, (_, x) => originalGrid[y][x] ? originalGrid[y][x].colorKey : null)
        );

        const findGround = (col, startY) => {
            let y = startY;
            while (y + 1 < totalRows && simGrid[y + 1][col] === null) {
                y++;
            }
            return y;
        };

        if (pivotX === childX) {
            const isPivotLower = (rot === 2);
            const lowerColor = isPivotLower ? color1 : color2;
            const upperColor = isPivotLower ? color2 : color1;

            const lowerY = findGround(pivotX, 1);
            const upperY = lowerY - 1;

            if (upperY < 1) return { valid: false };

            simGrid[lowerY][pivotX] = lowerColor;
            simGrid[upperY][pivotX] = upperColor;
        } else {
            const pivotY = findGround(pivotX, 1);
            const childY = findGround(childX, 1);

            if (pivotY < 1 || childY < 1) return { valid: false };

            simGrid[pivotY][pivotX] = color1;
            simGrid[childY][childX] = color2;
        }

        // 連鎖判定ループ
        let chains = 0;
        let totalCleared = 0;

        while (true) {
            const visited = Array.from({ length: totalRows }, () => new Array(cols).fill(false));
            const groupsToClear = [];

            for (let y = 1; y < totalRows; y++) {
                for (let x = 0; x < cols; x++) {
                    const colKey = simGrid[y][x];
                    if (!colKey || colKey === 'OJAMA' || visited[y][x]) continue;

                    const group = [];
                    const queue = [{ x, y }];
                    visited[y][x] = true;

                    while (queue.length > 0) {
                        const cur = queue.shift();
                        group.push(cur);

                        const dirs = [{ dx: 0, dy: -1 }, { dx: 1, dy: 0 }, { dx: 0, dy: 1 }, { dx: -1, dy: 0 }];
                        for (const d of dirs) {
                            const nx = cur.x + d.dx;
                            const ny = cur.y + d.dy;
                            if (nx >= 0 && nx < cols && ny >= 1 && ny < totalRows) {
                                if (!visited[ny][nx] && simGrid[ny][nx] === colKey) {
                                    visited[ny][nx] = true;
                                    queue.push({ x: nx, y: ny });
                                }
                            }
                        }
                    }

                    if (group.length >= 4) {
                        groupsToClear.push(group);
                    }
                }
            }

            if (groupsToClear.length === 0) break;

            chains++;

            for (const grp of groupsToClear) {
                totalCleared += grp.length;
                for (const pos of grp) {
                    simGrid[pos.y][pos.x] = null;
                    const dirs = [{ dx: 0, dy: -1 }, { dx: 1, dy: 0 }, { dx: 0, dy: 1 }, { dx: -1, dy: 0 }];
                    for (const d of dirs) {
                        const nx = pos.x + d.dx;
                        const ny = pos.y + d.dy;
                        if (nx >= 0 && nx < cols && ny >= 1 && ny < totalRows) {
                            if (simGrid[ny][nx] === 'OJAMA') simGrid[ny][nx] = null;
                        }
                    }
                }
            }

            // 自由落下
            for (let x = 0; x < cols; x++) {
                let writeY = totalRows - 1;
                for (let y = totalRows - 1; y >= 1; y--) {
                    if (simGrid[y][x] !== null) {
                        if (y !== writeY) {
                            simGrid[writeY][x] = simGrid[y][x];
                            simGrid[y][x] = null;
                        }
                        writeY--;
                    }
                }
            }
        }

        return { valid: true, grid: simGrid, chains, clearedPuyos: totalCleared };
    }

    /**
     * 盤面の総合評価関数
     * ★窒息列(deathCol)の絶対防衛 ＆ 端積み・すり鉢型連鎖構築★
     */
    evaluateBoard(simGrid, cols, totalRows, deathCol, chains, placedX1, placedX2) {
        let score = 0;

        const heights = [];
        for (let x = 0; x < cols; x++) {
            let h = 0;
            for (let y = 1; y < totalRows; y++) {
                if (simGrid[y][x] !== null) {
                    h = totalRows - y;
                    break;
                }
            }
            heights.push(h);
        }

        const deathH = heights[deathCol];

        // ==========================================
        // 【最優先絶対ルール】窒息列 (deathCol) の防衛
        // ==========================================
        // 窒息列にぷよを置いた場合、原則として超巨大ペナルティ！
        if (placedX1 === deathCol || placedX2 === deathCol) {
            score -= 2500;
        }

        // 窒息列の高さによる致死ペナルティ
        if (deathH >= 3) score -= 1500;
        if (deathH >= 5) score -= 5000;
        if (deathH >= totalRows - 4) score -= 20000;
        if (deathH >= totalRows - 2) score -= 100000; // 絶対に自滅しない！

        // 窒息列が周囲より低ければ大ボーナス (谷底すり鉢型)
        const leftH = (deathCol > 0) ? heights[deathCol - 1] : 99;
        const rightH = (deathCol < cols - 1) ? heights[deathCol + 1] : 99;
        if (deathH < leftH && deathH < rightH) {
            score += 800; // 美しい谷底！
        }

        // ==========================================
        // 【定石】端から積む (1列目・最外列優先)
        // ==========================================
        // 端の列 (0列目 または cols-1列目) に置く手は安全＆連鎖の起点
        if (placedX1 === 0 || placedX1 === cols - 1 || placedX2 === 0 || placedX2 === cols - 1) {
            score += 350;
        }

        // 窒息列から離れているほど高評価
        const dist1 = Math.abs(placedX1 - deathCol);
        const dist2 = Math.abs(placedX2 - deathCol);
        score += (dist1 + dist2) * 60;

        // ==========================================
        // 【連鎖】タテ連結（柱）＆ リーチ状態（3個繋がり）
        // ==========================================
        let connect2Count = 0;
        let connect3Count = 0;
        const visited = Array.from({ length: totalRows }, () => new Array(cols).fill(false));

        for (let y = 1; y < totalRows; y++) {
            for (let x = 0; x < cols; x++) {
                const color = simGrid[y][x];
                if (!color || color === 'OJAMA' || visited[y][x]) continue;

                let count = 0;
                const q = [{ x, y }];
                visited[y][x] = true;

                while (q.length > 0) {
                    const c = q.shift();
                    count++;
                    const dirs = [{ dx: 0, dy: -1 }, { dx: 1, dy: 0 }, { dx: 0, dy: 1 }, { dx: -1, dy: 0 }];
                    for (const d of dirs) {
                        const nx = c.x + d.dx;
                        const ny = c.y + d.dy;
                        if (nx >= 0 && nx < cols && ny >= 1 && ny < totalRows) {
                            if (!visited[ny][nx] && simGrid[ny][nx] === color) {
                                visited[ny][nx] = true;
                                q.push({ x: nx, y: ny });
                            }
                        }
                    }
                }

                if (count === 2) connect2Count++;
                if (count === 3) connect3Count++;
            }
        }

        // 2個・3個の連結（階段積みの土台）を高評価
        score += connect2Count * 80;
        score += connect3Count * 250;

        // 潜在連鎖ポテンシャル測定
        const potential = this.measureChainPotential(simGrid, cols, totalRows);
        score += potential * 600;

        // ==========================================
        // 【発火・相殺判定】
        // ==========================================
        const hasPendingOjama = this.board.pendingOjama > 0;

        if (chains > 0) {
            if (hasPendingOjama) {
                // ピンチの時の相殺発火は神手！
                score += 5000 + chains * 1500;
            } else if (chains >= 3) {
                // 3連鎖以上の本攻撃！
                score += 2500 + chains * 1000;
            } else {
                // 普段の単発消し (1連鎖) は連鎖を崩すので禁止！
                score -= 600;
            }
        }

        return score;
    }

    /**
     * 潜在連鎖ポテンシャル測定
     */
    measureChainPotential(grid, cols, totalRows) {
        let maxChain = 0;
        const testColors = ['RED', 'GREEN', 'BLUE', 'YELLOW'];

        for (let x = 0; x < cols; x++) {
            let topY = totalRows - 1;
            while (topY >= 1 && grid[topY][x] !== null) topY--;
            if (topY < 1) continue;

            for (const col of testColors) {
                const sim = this.simulatePlacement(grid, cols, totalRows, x, x, 0, col, col);
                if (sim.valid && sim.chains > maxChain) {
                    maxChain = sim.chains;
                }
            }
        }

        return maxChain;
    }

    /**
     * 人間風操作実行
     * ★最上段スライド（壁に挟まれる前に最上段で一気に目的列へ移動）★
     */
    update() {
        if (!this.board.activePair || !this.isDecided) return;

        const p = this.board.activePair;

        // 1. まず回転を即座に合わせる
        if (p.rot !== this.targetRot) {
            this.board.rotatePair(1);
            return;
        }

        // 2. 最上段（y <= 2）にいる間に、目的列まで確実にスライド移動！
        // 下に落ちてから動かそうとすると両脇の壁に阻まれて自滅するため、
        // まだ天井近くにいる間に最優先で目的列へ移動させます。
        if (p.pivot.x < this.targetX) {
            const oldX = p.pivot.x;
            this.board.movePair(1);
            if (p.pivot.x === oldX) {
                // 壁に阻まれて動けない！緊急回避
                this.stuckCounter++;
                if (this.stuckCounter > 2) {
                    this.targetX = p.pivot.x; // 現在の列に目標変更
                }
            }
            return;
        } else if (p.pivot.x > this.targetX) {
            const oldX = p.pivot.x;
            this.board.movePair(-1);
            if (p.pivot.x === oldX) {
                this.stuckCounter++;
                if (this.stuckCounter > 2) {
                    this.targetX = p.pivot.x;
                }
            }
            return;
        }

        // 3. 目的列に到達した！落下制御
        if (this.difficulty === 'easy') {
            this.board.fastDrop = false; // ゆっくり自然落下
        } else if (this.difficulty === 'normal') {
            this.board.fastDrop = true;  // マイルド落下
        } else {
            // Hard: ハードドロップまたは高速落下
            this.board.fastDrop = true;
        }
    }
}

window.PuyoAI = PuyoAI;
