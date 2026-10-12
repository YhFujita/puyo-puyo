/**
 * ai.js - 本格派ぷよぷよ思考エンジン
 * 仮想連鎖シミュレータ (Full Chain Simulator)
 * 潜在連鎖ポテンシャル測定 (Potential Chain Search)
 * NEXTぷよ2手先読み (2-ply Search)
 * 階段積み・鍵積み・自滅回避・おじゃま相殺戦術
 */

class PuyoAI {
    constructor(board, difficulty = 'normal') {
        this.board = board;
        this.difficulty = difficulty; // 'easy', 'normal', 'hard'

        this.targetX = 2;
        this.targetRot = 0;
        this.isDecided = false;

        // 人間らしい操作リズム
        this.thinkDelay = 0;
        this.moveInterval = 0;
        this.moveCooldown = 0;
        this.dropWaitTimer = 0;
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

        // 難易度別の人間らしい操作ディレイ
        if (this.difficulty === 'easy') {
            this.thinkDelay = 18 + Math.floor(Math.random() * 12);
            this.moveInterval = 14;
            this.dropWaitTimer = 30;
        } else if (this.difficulty === 'normal') {
            this.thinkDelay = 10 + Math.floor(Math.random() * 8);
            this.moveInterval = 8;
            this.dropWaitTimer = 14;
        } else {
            // Hard
            this.thinkDelay = 4;
            this.moveInterval = 4;
            this.dropWaitTimer = 6;
        }

        const p1Color = activePair.pivot.puyo.colorKey;
        const p2Color = activePair.child.puyo.colorKey;

        // NEXTぷよの取得
        const nextPair = (this.board.nextQueue && this.board.nextQueue.length > 0) ? this.board.nextQueue[0] : null;

        let bestMove = null;

        if (this.difficulty === 'hard' && nextPair) {
            // ゲキムズ: NEXTを含む2手先読み (2-ply Search)
            bestMove = this.search2Ply(grid, cols, totalRows, deathCol, p1Color, p2Color, nextPair.pivotColor, nextPair.childColor);
        } else {
            // かんたん / ふつう: 1手先仮想連鎖シミュレーション
            bestMove = this.search1Ply(grid, cols, totalRows, deathCol, p1Color, p2Color);
        }

        if (bestMove) {
            this.targetX = bestMove.x;
            this.targetRot = bestMove.rot;
        } else {
            this.targetX = deathCol === 2 ? 0 : 1;
            this.targetRot = 0;
        }

        this.isDecided = true;
    }

    /**
     * 1手先探索 (全候補手の仮想連鎖シミュレーション)
     */
    search1Ply(grid, cols, totalRows, deathCol, p1Color, p2Color) {
        const candidateMoves = [];

        for (let rot = 0; rot < 4; rot++) {
            const offsets = [{ x: 0, y: -1 }, { x: 1, y: 0 }, { x: 0, y: 1 }, { x: -1, y: 0 }];
            const ox = offsets[rot].x;

            for (let x = 0; x < cols; x++) {
                const childX = x + ox;
                if (childX < 0 || childX >= cols) continue;

                // 仮想シミュレーション
                const sim = this.simulatePlacement(grid, cols, totalRows, x, childX, rot, p1Color, p2Color);
                if (!sim.valid) continue;

                const score = this.evaluateBoard(sim.grid, cols, totalRows, deathCol, sim.chains, sim.clearedPuyos);
                candidateMoves.push({ x, rot, score, chains: sim.chains });
            }
        }

        if (candidateMoves.length === 0) return { x: 0, rot: 0 };

        candidateMoves.sort((a, b) => b.score - a.score);

        if (this.difficulty === 'easy') {
            // かんたん: 安全な手の中から上位3手程度で選択（自滅しない）
            const safe = candidateMoves.filter(m => m.score > -1000);
            const pool = safe.length > 0 ? safe : candidateMoves;
            const idx = Math.min(pool.length - 1, Math.floor(Math.random() * 3));
            return pool[idx];
        } else if (this.difficulty === 'normal') {
            // ふつう: 上位1〜2手
            const idx = Math.min(candidateMoves.length - 1, Math.random() < 0.8 ? 0 : 1);
            return candidateMoves[idx];
        }

        return candidateMoves[0];
    }

    /**
     * 2手先探索 (現在の手 × NEXTの手 全通りシミュレーション)
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

                // 2手目 (NEXT) の最善手を探索
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
                        const score2 = this.evaluateBoard(sim2.grid, cols, totalRows, deathCol, totalChains, sim1.clearedPuyos + sim2.clearedPuyos);

                        if (score2 > bestNextScore) {
                            bestNextScore = score2;
                        }
                    }
                }

                // 2手合わせた総合スコア
                const combinedScore = (bestNextScore !== -Infinity) ? bestNextScore : this.evaluateBoard(sim1.grid, cols, totalRows, deathCol, sim1.chains, sim1.clearedPuyos);

                if (combinedScore > bestScore) {
                    bestScore = combinedScore;
                    bestMove = { x: x1, rot: rot1 };
                }
            }
        }

        return bestMove;
    }

    /**
     * 仮想盤面シミュレータ (落下の物理・ちぎり・連鎖・消去を完全再現)
     */
    simulatePlacement(originalGrid, cols, totalRows, pivotX, childX, rot, color1, color2) {
        // グリッドをコピー
        const simGrid = Array.from({ length: totalRows }, (_, y) =>
            Array.from({ length: cols }, (_, x) => originalGrid[y][x] ? originalGrid[y][x].colorKey : null)
        );

        // 接地点を計算
        const findGround = (col, startY) => {
            let y = startY;
            while (y + 1 < totalRows && simGrid[y + 1][col] === null) {
                y++;
            }
            return y;
        };

        let pivotY, childY;

        if (pivotX === childX) {
            // 縦向き
            const isPivotLower = (rot === 2); // 下向きなら軸が下
            const lowerColor = isPivotLower ? color1 : color2;
            const upperColor = isPivotLower ? color2 : color1;

            const lowerY = findGround(pivotX, 1);
            const upperY = lowerY - 1;

            if (upperY < 1) {
                return { valid: false }; // 溢れて窒息
            }

            simGrid[lowerY][pivotX] = lowerColor;
            simGrid[upperY][pivotX] = upperColor;
        } else {
            // 横向き
            pivotY = findGround(pivotX, 1);
            childY = findGround(childX, 1);

            if (pivotY < 1 || childY < 1) {
                return { valid: false };
            }

            simGrid[pivotY][pivotX] = color1;
            simGrid[childY][childX] = color2;
        }

        // 連鎖シミュレーションループ
        let chains = 0;
        let totalCleared = 0;

        while (true) {
            // 4個以上の連結を検出
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

            if (groupsToClear.length === 0) break; // 連鎖終了

            chains++;

            // 消去＆隣接おじゃま消去
            for (const grp of groupsToClear) {
                totalCleared += grp.length;
                for (const pos of grp) {
                    simGrid[pos.y][pos.x] = null;

                    const dirs = [{ dx: 0, dy: -1 }, { dx: 1, dy: 0 }, { dx: 0, dy: 1 }, { dx: -1, dy: 0 }];
                    for (const d of dirs) {
                        const nx = pos.x + d.dx;
                        const ny = pos.y + d.dy;
                        if (nx >= 0 && nx < cols && ny >= 1 && ny < totalRows) {
                            if (simGrid[ny][nx] === 'OJAMA') {
                                simGrid[ny][nx] = null;
                            }
                        }
                    }
                }
            }

            // 自由重力落下
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

        return {
            valid: true,
            grid: simGrid,
            chains,
            clearedPuyos: totalCleared
        };
    }

    /**
     * 盤面の総合評価関数 (潜在連鎖ポテンシャル測定 ＆ 定石評価)
     */
    evaluateBoard(simGrid, cols, totalRows, deathCol, chains, clearedPuyos) {
        let score = 0;

        // 各列の高さを取得
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

        // 1. 【窒息エリア (deathCol) の絶対防衛】
        const deathH = heights[deathCol];
        if (deathH >= totalRows - 4) score -= 800;
        if (deathH >= totalRows - 3) score -= 3000;
        if (deathH >= totalRows - 2) score -= 15000; // 絶対に自滅しない！

        // 窒息列を低く保つ「すり鉢型」ボーナス
        const avgH = heights.reduce((a, b) => a + b, 0) / cols;
        if (deathH <= avgH) {
            score += 150;
        }

        // 2. 【端積み (1列目・最外列) ボーナス】
        const edgeH = Math.max(heights[0], heights[cols - 1]);
        score += edgeH * 15;

        // 3. 【連結リーチ (2〜3個繋がり) の評価】
        // 4個で消えずに「3個繋がっている状態」は最強の連鎖のタネ
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

        score += connect2Count * 60;
        score += connect3Count * 180; // 3個リーチは超高評価！

        // 4. 【潜在連鎖ポテンシャル測定 (あと1個で何連鎖になるか？)】
        const potentialChains = this.measureChainPotential(simGrid, cols, totalRows);
        score += potentialChains * 400; // 潜在連鎖が1つ増えるごとに大ボーナス！

        // 5. 【発火と相殺の戦術判断】
        const hasPendingOjama = this.board.pendingOjama > 0;

        if (chains > 0) {
            if (hasPendingOjama) {
                // 相手からのおじゃまぷよを相殺・反撃できる発火は神の一手！
                score += 2000 + chains * 800;
            } else if (chains >= 3) {
                // 3連鎖以上の決定打！
                score += 1200 + chains * 600;
            } else {
                // 普段の単発消し (1連鎖) は連鎖のタネを潰すのでペナルティ！
                score -= 150;
            }
        }

        // 6. デコボコを均すペナルティ
        let roughness = 0;
        for (let x = 0; x < cols - 1; x++) {
            roughness += Math.abs(heights[x] - heights[x + 1]);
        }
        score -= roughness * 8;

        return score;
    }

    /**
     * 潜在連鎖ポテンシャル測定 (盤面に任意のぷよを1個足した時の最大連鎖数を逆算)
     */
    measureChainPotential(grid, cols, totalRows) {
        let maxChain = 0;
        const testColors = ['RED', 'GREEN', 'BLUE', 'YELLOW'];

        // 各列のトップに各色を1個仮想ドロップ
        for (let x = 0; x < cols; x++) {
            // 列の高さを確認
            let topY = totalRows - 1;
            while (topY >= 1 && grid[topY][x] !== null) {
                topY--;
            }
            if (topY < 1) continue; // 満杯

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
     * フレームごとの自然な操作実行
     */
    update() {
        if (!this.board.activePair || !this.isDecided) return;

        const p = this.board.activePair;

        // 思考ディレイ
        if (this.thinkDelay > 0) {
            this.thinkDelay--;
            return;
        }

        // 移動クールダウン
        this.moveCooldown--;
        if (this.moveCooldown > 0) return;
        this.moveCooldown = this.moveInterval;

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

        // 3. 落下速度
        if (this.difficulty === 'easy') {
            this.board.fastDrop = false; // かんたんはゆっくり自然落下
        } else if (this.difficulty === 'normal') {
            if (this.dropWaitTimer > 0) {
                this.dropWaitTimer--;
                this.board.fastDrop = false;
            } else {
                this.board.fastDrop = true; // マイルドな高速落下
            }
        } else {
            // Hard
            if (this.dropWaitTimer > 0) {
                this.dropWaitTimer--;
            } else {
                this.board.fastDrop = true;
            }
        }
    }
}

window.PuyoAI = PuyoAI;
