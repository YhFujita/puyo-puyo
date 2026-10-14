/**
 * ai.js - 究極・無自滅ぷよぷよAI思考エンジン
 * 
 * 1. 【絶対到達可能性判定 (Reachability)】: 途中の列が壁になっていないか確認し、移動不能な手を完全排除
 * 2. 【窒息列 (deathCol) 絶対不可侵の原則】: 3列目には絶対に積まない（-1,000,000ペナルティ）
 * 3. 【端積み・すり鉢型連鎖構築】: 1列目・6列目を起点とした美しい階段積み・カギ積み
 * 4. 【着実移動＆落下制御】: 目的列に到達するまで絶対に早落とししない（途中引っ掛かり自滅の根絶）
 * 5. 【2手先読み (2-Ply Search) & 潜在連鎖測定】: NEXTぷよを踏まえた大連鎖シミュレーション
 */

class PuyoAI {
    constructor(board, difficulty = 'normal') {
        this.board = board;
        this.difficulty = difficulty;

        this.targetX = 0;
        this.targetRot = 0;
        this.isDecided = false;

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
            // かんたん / ふつう: 1手先探索
            bestMove = this.search1Ply(grid, cols, totalRows, deathCol, p1Color, p2Color);
        }

        if (bestMove) {
            this.targetX = bestMove.x;
            this.targetRot = bestMove.rot;
        } else {
            // 安全なデフォルト (窒息列から最も離れた端の列)
            this.targetX = (deathCol <= Math.floor(cols / 2)) ? cols - 1 : 0;
            this.targetRot = 0;
        }

        this.isDecided = true;
    }

    /**
     * スポーン位置 (deathCol) から targetX へぷよを運べるか？
     * 最上段（y <= 2）に壁があると移動不能になるため、経路上の高さをチェック！
     */
    isReachable(grid, totalRows, deathCol, targetX, targetRot) {
        const offsets = [{ x: 0, y: -1 }, { x: 1, y: 0 }, { x: 0, y: 1 }, { x: -1, y: 0 }];
        const childTargetX = targetX + offsets[targetRot].x;

        const minCol = Math.min(deathCol, targetX, childTargetX);
        const maxCol = Math.max(deathCol, targetX, childTargetX);

        // スポーン列から目的列までの経路上に、天井（y <= 2）まで積み上がっている列があれば到達不能
        for (let x = minCol; x <= maxCol; x++) {
            // スポーン地点そのものは通過可能と仮定し、他列の壁を検査
            if (x !== deathCol) {
                if (grid[1][x] !== null || grid[2][x] !== null) {
                    return false;
                }
            }
        }
        return true;
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

                // 経路が塞がれていて辿り着けない手は最初から除外！
                if (!this.isReachable(grid, totalRows, deathCol, x, rot)) continue;

                const sim = this.simulatePlacement(grid, cols, totalRows, x, childX, rot, p1Color, p2Color);
                if (!sim.valid) continue;

                const score = this.evaluateBoard(sim.grid, cols, totalRows, deathCol, sim.chains, x, childX, rot);
                candidateMoves.push({ x, rot, score });
            }
        }

        if (candidateMoves.length === 0) {
            // 万が一候補がない場合、最も低い列を探す
            return this.findFallbackMove(grid, cols, totalRows, deathCol);
        }

        candidateMoves.sort((a, b) => b.score - a.score);

        if (this.difficulty === 'easy') {
            // かんたん: 窒息列を避けた安全な手の中からランダム選択
            const safe = candidateMoves.filter(m => m.score > -100000);
            const pool = safe.length > 0 ? safe : candidateMoves;
            const idx = Math.min(pool.length - 1, Math.floor(Math.random() * Math.min(4, pool.length)));
            return pool[idx];
        } else if (this.difficulty === 'normal') {
            const safe = candidateMoves.filter(m => m.score > -100000);
            const pool = safe.length > 0 ? safe : candidateMoves;
            const idx = (Math.random() < 0.85 || pool.length === 1) ? 0 : 1;
            return pool[idx];
        }

        return candidateMoves[0];
    }

    /**
     * ゲキムズ 2手先探索
     */
    search2Ply(grid, cols, totalRows, deathCol, p1Color, p2Color, n1Color, n2Color) {
        let bestScore = -Infinity;
        let bestMove = null;

        for (let rot1 = 0; rot1 < 4; rot1++) {
            const offsets1 = [{ x: 0, y: -1 }, { x: 1, y: 0 }, { x: 0, y: 1 }, { x: -1, y: 0 }];
            const ox1 = offsets1[rot1].x;

            for (let x1 = 0; x1 < cols; x1++) {
                const childX1 = x1 + ox1;
                if (childX1 < 0 || childX1 >= cols) continue;

                // 到達不能チェック
                if (!this.isReachable(grid, totalRows, deathCol, x1, rot1)) continue;

                const sim1 = this.simulatePlacement(grid, cols, totalRows, x1, childX1, rot1, p1Color, p2Color);
                if (!sim1.valid) continue;

                const score1 = this.evaluateBoard(sim1.grid, cols, totalRows, deathCol, sim1.chains, x1, childX1, rot1);
                // 1手目で窒息手（自滅手）は即枝刈り
                if (score1 <= -500000) continue;

                let bestNextScore = -Infinity;

                for (let rot2 = 0; rot2 < 4; rot2++) {
                    const offsets2 = [{ x: 0, y: -1 }, { x: 1, y: 0 }, { x: 0, y: 1 }, { x: -1, y: 0 }];
                    const ox2 = offsets2[rot2].x;

                    for (let x2 = 0; x2 < cols; x2++) {
                        const childX2 = x2 + ox2;
                        if (childX2 < 0 || childX2 >= cols) continue;

                        if (!this.isReachable(sim1.grid, totalRows, deathCol, x2, rot2)) continue;

                        const sim2 = this.simulatePlacement(sim1.grid, cols, totalRows, x2, childX2, rot2, n1Color, n2Color);
                        if (!sim2.valid) continue;

                        const totalChains = sim1.chains + sim2.chains;
                        const score2 = this.evaluateBoard(sim2.grid, cols, totalRows, deathCol, totalChains, x2, childX2, rot2);

                        if (score2 > bestNextScore) {
                            bestNextScore = score2;
                        }
                    }
                }

                const combined = (bestNextScore !== -Infinity) ? (score1 * 0.35 + bestNextScore * 0.65) : score1;

                if (combined > bestScore) {
                    bestScore = combined;
                    bestMove = { x: x1, rot: rot1 };
                }
            }
        }

        if (!bestMove) {
            return this.findFallbackMove(grid, cols, totalRows, deathCol);
        }

        return bestMove;
    }

    /**
     * 緊急時のフォールバック手 (最も低く、窒息列でない列へ)
     */
    findFallbackMove(grid, cols, totalRows, deathCol) {
        let bestX = 0;
        let lowestHeight = 999;

        for (let x = 0; x < cols; x++) {
            if (x === deathCol) continue; // 窒息列は絶対除外
            let h = 0;
            for (let y = 1; y < totalRows; y++) {
                if (grid[y][x] !== null) {
                    h = totalRows - y;
                    break;
                }
            }
            if (h < lowestHeight) {
                lowestHeight = h;
                bestX = x;
            }
        }

        return { x: bestX, rot: 0 };
    }

    /**
     * 仮想盤面シミュレータ
     */
    simulatePlacement(originalGrid, cols, totalRows, pivotX, childX, rot, color1, color2) {
        const simGrid = Array.from({ length: totalRows }, (_, y) =>
            Array.from({ length: cols }, (_, x) => originalGrid[y][x] ? (originalGrid[y][x].colorKey || originalGrid[y][x]) : null)
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
    evaluateBoard(simGrid, cols, totalRows, deathCol, chains, placedX1, placedX2, rot) {
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
        // 【最優先鉄壁ルール】窒息列 (deathCol) への配置禁止！
        // ==========================================
        const touchesDeath = (placedX1 === deathCol || placedX2 === deathCol);
        if (touchesDeath) {
            // 窒息列に置く手には致命的ペナルティを与え、他列がある限り絶対に選ばせない！
            score -= 1000000;
        }

        // 窒息列の高さペナルティ（空いていれば空いているほど安全）
        if (deathH >= 2) score -= 50000;
        if (deathH >= 4) score -= 200000;
        if (deathH >= totalRows - 4) score -= 800000;
        if (deathH >= totalRows - 2) score -= 2000000; // 完全即死手

        // 窒息列が両隣より低い「美しいすり鉢型 (谷底)」に特大ボーナス
        const leftH = (deathCol > 0) ? heights[deathCol - 1] : 99;
        const rightH = (deathCol < cols - 1) ? heights[deathCol + 1] : 99;
        if (deathH < leftH && deathH < rightH) {
            score += 1500;
        }

        // ==========================================
        // 【定石】端から積む（最外列・端寄り優先）
        // ==========================================
        if (placedX1 === 0 || placedX1 === cols - 1 || placedX2 === 0 || placedX2 === cols - 1) {
            score += 600; // 両端の壁沿い優先
        } else if (placedX1 === 1 || placedX1 === cols - 2) {
            score += 250;
        }

        // 窒息列から離れるほど安全＆連鎖スペース確保
        const dist1 = Math.abs(placedX1 - deathCol);
        const dist2 = Math.abs(placedX2 - deathCol);
        score += (dist1 + dist2) * 120;

        // 全体の高さのばらつき抑制（平ら〜なだらかな階段）
        let heightDiffSum = 0;
        for (let x = 0; x < cols - 1; x++) {
            heightDiffSum += Math.abs(heights[x] - heights[x + 1]);
        }
        score -= heightDiffSum * 30;

        // ==========================================
        // 【連鎖の土台構築】タテ2個・3個連結ボーナス
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

        score += connect2Count * 120;
        score += connect3Count * 450; // 3個連結（リーチ）は超高評価！

        // 潜在連鎖ポテンシャル測定
        const potential = this.measureChainPotential(simGrid, cols, totalRows);
        score += potential * 800;

        // ==========================================
        // 【攻撃・発火・相殺ロジック】
        // ==========================================
        const hasPendingOjama = this.board.pendingOjama > 0;

        if (chains > 0) {
            if (hasPendingOjama) {
                // おじゃまぷよが予告されている緊急時のカウンター発火は大正解！
                score += 10000 + chains * 3000;
            } else if (chains >= 3) {
                // 3連鎖以上の本格攻撃発火！
                score += 6000 + chains * 2000;
            } else if (chains === 2 && heights.some(h => h >= totalRows - 5)) {
                // 盤面が高くなってきた時の2連鎖掃除
                score += 3000;
            } else {
                // 序盤の無意味な1連鎖暴発は、連鎖のタネを消してしまうので大減点！
                score -= 1200;
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
     * 操作実行：
     * ★確実移動＆途中着地自滅の完全防止★
     */
    update() {
        if (!this.board.activePair || !this.isDecided) return;

        const p = this.board.activePair;

        // 目的列に到達するまでは絶対に高速落下（fastDrop）させない！
        this.board.fastDrop = false;

        // 1. まず回転を合わせる
        if (p.rot !== this.targetRot) {
            this.board.rotatePair(1);
            return;
        }

        // 2. 左右移動（スポーン直後の最上段で一気に目的列へ移動）
        if (p.pivot.x < this.targetX) {
            const oldX = p.pivot.x;
            this.board.movePair(1);
            if (p.pivot.x === oldX) {
                // 移動が阻まれた場合の安全緊急回避
                this.stuckCounter++;
                if (this.stuckCounter > 1) {
                    // 窒息列でなければその場で妥協、窒息列なら反対側へ
                    if (p.pivot.x !== this.board.deathCol) {
                        this.targetX = p.pivot.x;
                    } else {
                        this.targetX = (p.pivot.x > 0) ? p.pivot.x - 1 : p.pivot.x + 1;
                    }
                }
            }
            return;
        } else if (p.pivot.x > this.targetX) {
            const oldX = p.pivot.x;
            this.board.movePair(-1);
            if (p.pivot.x === oldX) {
                this.stuckCounter++;
                if (this.stuckCounter > 1) {
                    if (p.pivot.x !== this.board.deathCol) {
                        this.targetX = p.pivot.x;
                    } else {
                        this.targetX = (p.pivot.x < this.board.cols - 1) ? p.pivot.x + 1 : p.pivot.x - 1;
                    }
                }
            }
            return;
        }

        // 3. 目的列に【完全に到達した】ので、ここから安全に落下開始！
        if (this.difficulty === 'easy') {
            this.board.fastDrop = false; // ゆっくり自然落下
        } else if (this.difficulty === 'normal') {
            this.board.fastDrop = true;  // ソフトドロップ
        } else {
            // Hard (ゲキムズ): 目標位置で即座に急降下 / ハードドロップ
            this.board.hardDrop();
        }
    }
}

window.PuyoAI = PuyoAI;
