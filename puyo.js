/**
 * puyo.js - ぷよのプロシージャル描画、スライム質感、連結ブリッジ、
 * 弾性変形(Squash & Stretch)、視線AI・表情システム
 */

const PUYO_COLORS = {
    RED: {
        name: 'red',
        main: '#ff3b5c',
        light: '#ff8da5',
        dark: '#b91c3d',
        highlight: '#ffffff',
        glow: 'rgba(255, 59, 92, 0.4)'
    },
    GREEN: {
        name: 'green',
        main: '#10b981',
        light: '#6ee7b7',
        dark: '#047857',
        highlight: '#ffffff',
        glow: 'rgba(16, 185, 129, 0.4)'
    },
    BLUE: {
        name: 'blue',
        main: '#0ea5e9',
        light: '#7dd3fc',
        dark: '#0369a1',
        highlight: '#ffffff',
        glow: 'rgba(14, 165, 233, 0.4)'
    },
    YELLOW: {
        name: 'yellow',
        main: '#f59e0b',
        light: '#fde68a',
        dark: '#b45309',
        highlight: '#ffffff',
        glow: 'rgba(245, 158, 11, 0.4)'
    },
    PURPLE: {
        name: 'purple',
        main: '#a855f7',
        light: '#d8b4fe',
        dark: '#7e22ce',
        highlight: '#ffffff',
        glow: 'rgba(168, 85, 247, 0.4)'
    }
};

const COLOR_KEYS = Object.keys(PUYO_COLORS);

class Puyo {
    constructor(colorKey) {
        this.colorKey = colorKey;
        this.colorData = PUYO_COLORS[colorKey];

        // 接続状態 (上下左右に同色ぷよがあるか)
        this.connections = {
            top: false,
            right: false,
            bottom: false,
            left: false
        };

        // 接続アニメーション度合い (0.0 -> 1.0)
        this.connProgress = {
            top: 0,
            right: 0,
            bottom: 0,
            left: 0
        };

        // 物理・弾性変形（Squash & Stretch）
        this.scaleX = 1.0;
        this.scaleY = 1.0;
        this.targetScaleX = 1.0;
        this.targetScaleY = 1.0;
        this.scaleVx = 0;
        this.scaleVy = 0;

        // アイドル時のプルプル呼吸揺れ
        this.idlePhase = Math.random() * Math.PI * 2;
        this.idleSpeed = 0.05 + Math.random() * 0.02;

        // 目と視線・表情
        this.lookX = 0; // -1.0 (左) ~ +1.0 (右)
        this.lookY = 0; // -1.0 (上) ~ +1.0 (下)
        this.targetLookX = 0;
        this.targetLookY = 0;
        this.lookTimer = Math.floor(Math.random() * 120);

        // まばたき (Blink)
        this.blinkProgress = 0; // 0 = 開眼, 1 = 完全閉眼
        this.isBlinking = false;
        this.blinkTimer = 100 + Math.floor(Math.random() * 200);

        // 表情モード: 'normal', 'happy', 'panic', 'falling'
        this.expression = 'normal';

        // 消去アニメーション用
        this.isClearing = false;
        this.clearTimer = 0;
        this.clearDuration = 36; // フレーム数
        this.flashAlpha = 0;
        this.shakeX = 0;
        this.shakeY = 0;

        // 落下中フラグ
        this.isFalling = false;
    }

    // 接続状態の更新
    setConnections(top, right, bottom, left) {
        this.connections.top = top;
        this.connections.right = right;
        this.connections.bottom = bottom;
        this.connections.left = left;
    }

    // 接地バウンドのトリガー（グニャッと潰れて跳ねる）
    triggerSquash(intensity = 0.45) {
        this.scaleY = 1.0 - intensity;
        this.scaleX = 1.0 + intensity * 0.6;
        this.scaleVy = 0.15;
        this.scaleVx = -0.1;
    }

    // 落下開始の伸び（縦長に伸びる）
    triggerStretch(intensity = 0.25) {
        this.scaleY = 1.0 + intensity;
        this.scaleX = 1.0 - intensity * 0.4;
    }

    // 視線ターゲットを設定（操作時や特定の方向）
    setLookDirection(x, y) {
        this.targetLookX = Math.max(-1, Math.min(1, x));
        this.targetLookY = Math.max(-1, Math.min(1, y));
    }

    // 消去アニメーション開始
    startClear() {
        this.isClearing = true;
        this.clearTimer = this.clearDuration;
        this.expression = 'panic';
    }

    update() {
        // 1. 接続アニメーションの進行（滑らかに繋がる）
        for (const dir of ['top', 'right', 'bottom', 'left']) {
            const target = this.connections[dir] ? 1.0 : 0.0;
            this.connProgress[dir] += (target - this.connProgress[dir]) * 0.25;
        }

        // 2. 弾性変形のバネ物理シミュレーション（Hookeの法則 + ダンピング）
        const k = 0.24;
        const damping = 0.72;

        const fxX = (this.targetScaleX - this.scaleX) * k;
        this.scaleVx = (this.scaleVx + fxX) * damping;
        this.scaleX += this.scaleVx;

        const fxY = (this.targetScaleY - this.scaleY) * k;
        this.scaleVy = (this.scaleVy + fxY) * damping;
        this.scaleY += this.scaleVy;

        // 3. アイドル時の微細な呼吸揺れ（サイン波）
        this.idlePhase += this.idleSpeed;
        const breath = Math.sin(this.idlePhase) * 0.035;

        // 4. 視線AIの更新
        this.lookTimer--;
        if (this.lookTimer <= 0) {
            this.lookTimer = 80 + Math.floor(Math.random() * 140);
            
            const connCount = (this.connections.top ? 1 : 0) +
                              (this.connections.right ? 1 : 0) +
                              (this.connections.bottom ? 1 : 0) +
                              (this.connections.left ? 1 : 0);

            if (connCount > 0 && Math.random() < 0.65) {
                // 繋がっている仲間の方を見る
                if (this.connections.right) this.targetLookX = 0.75;
                else if (this.connections.left) this.targetLookX = -0.75;
                else this.targetLookX = 0;

                if (this.connections.bottom) this.targetLookY = 0.65;
                else if (this.connections.top) this.targetLookY = -0.65;
                else this.targetLookY = 0;
            } else {
                // ランダムに周囲を見る
                this.targetLookX = (Math.random() - 0.5) * 1.5;
                this.targetLookY = (Math.random() - 0.5) * 1.5;
            }
        }

        // 視線を滑らかに補間
        this.lookX += (this.targetLookX - this.lookX) * 0.15;
        this.lookY += (this.targetLookY - this.lookY) * 0.15;

        // 5. まばたきアニメーション
        this.blinkTimer--;
        if (this.blinkTimer <= 0 && !this.isBlinking) {
            this.isBlinking = true;
            this.blinkProgress = 0;
        }

        if (this.isBlinking) {
            this.blinkProgress += 0.25;
            if (this.blinkProgress >= 1.0) {
                this.blinkProgress = 1.0;
                this.isBlinking = false;
                this.blinkTimer = 100 + Math.floor(Math.random() * 220);
            }
        } else if (this.blinkProgress > 0) {
            this.blinkProgress = Math.max(0, this.blinkProgress - 0.25);
        }

        // 6. 表情ステートの決定
        const connCount = (this.connections.top ? 1 : 0) +
                          (this.connections.right ? 1 : 0) +
                          (this.connections.bottom ? 1 : 0) +
                          (this.connections.left ? 1 : 0);
        
        if (this.isClearing) {
            this.expression = 'panic';
        } else if (this.isFalling) {
            this.expression = 'falling';
        } else if (connCount >= 2) {
            this.expression = 'happy';
        } else {
            this.expression = 'normal';
        }

        // 7. 消去アニメーション
        if (this.isClearing) {
            this.clearTimer--;
            // プルプル高速振動
            this.shakeX = (Math.random() - 0.5) * 7;
            this.shakeY = (Math.random() - 0.5) * 7;
            // 白熱発光点滅
            this.flashAlpha = Math.abs(Math.sin((this.clearDuration - this.clearTimer) * 0.6));
            // 消滅直前の膨張
            if (this.clearTimer < 8) {
                this.targetScaleX = 1.35;
                this.targetScaleY = 1.35;
            }
        } else {
            this.shakeX = 0;
            this.shakeY = 0;
            this.flashAlpha = 0;
        }

        return breath;
    }

    /**
     * ぷよの描画
     */
    draw(ctx, cx, cy, cellSize) {
        const breath = this.update();
        const r = cellSize * 0.44;

        ctx.save();
        ctx.translate(cx + this.shakeX, cy + this.shakeY);

        // スケール変形（Squash & Stretch + 呼吸揺れ）
        const curScaleX = this.scaleX + breath;
        const curScaleY = this.scaleY - breath;
        ctx.scale(curScaleX, curScaleY);

        // 1. スライム結合形状の描画
        this.drawSlimeBody(ctx, r, cellSize);

        // 2. 目の描画
        if (!this.isClearing || this.clearTimer > 6) {
            this.drawEyes(ctx, r);
        }

        // 3. 消去時の発光オーバーレイ
        if (this.flashAlpha > 0) {
            ctx.save();
            ctx.globalAlpha = this.flashAlpha * 0.8;
            ctx.fillStyle = '#ffffff';
            this.buildSlimePath(ctx, r, cellSize);
            ctx.fill();
            ctx.restore();
        }

        ctx.restore();
    }

    /**
     * スライムボディの描画（透過感・立体光沢・結合ネック）
     */
    drawSlimeBody(ctx, r, cellSize) {
        const c = this.colorData;
        const d = cellSize * 0.5;

        // スライムの外周パスを構築
        this.buildSlimePath(ctx, r, cellSize);

        // A. ベースカラー（透明感のあるラジアルグラデーション）
        const grad = ctx.createRadialGradient(-r * 0.25, -r * 0.3, r * 0.1, 0, r * 0.1, r * 1.3);
        grad.addColorStop(0, c.light);
        grad.addColorStop(0.45, c.main);
        grad.addColorStop(0.85, c.dark);
        grad.addColorStop(1.0, c.dark);

        ctx.fillStyle = grad;
        ctx.fill();

        // 外周の艶やかな輪郭線
        ctx.strokeStyle = c.dark;
        ctx.lineWidth = 2.2;
        ctx.stroke();

        // B. 底部の環境反射光（スライム特有のアンダーグロー）
        ctx.save();
        ctx.clip();

        const bottomGlow = ctx.createRadialGradient(0, r * 0.85, r * 0.05, 0, r * 0.6, r * 0.65);
        bottomGlow.addColorStop(0, c.light);
        bottomGlow.addColorStop(1, 'transparent');
        ctx.fillStyle = bottomGlow;
        ctx.beginPath();
        ctx.arc(0, r * 0.8, r * 0.7, 0, Math.PI * 2);
        ctx.fill();

        // C. 表面のハイライト光沢（ぷるぷるのゼリー光沢）
        // メインハイライト（左上）
        ctx.fillStyle = 'rgba(255, 255, 255, 0.75)';
        ctx.beginPath();
        ctx.ellipse(-r * 0.38, -r * 0.42, r * 0.3, r * 0.16, -Math.PI / 4, 0, Math.PI * 2);
        ctx.fill();

        // セカンダリハイライト（きらめき）
        ctx.fillStyle = 'rgba(255, 255, 255, 0.85)';
        ctx.beginPath();
        ctx.arc(-r * 0.18, -r * 0.56, r * 0.07, 0, Math.PI * 2);
        ctx.fill();

        // 右下の補助ハイライト（うっすらとしたツヤ）
        ctx.fillStyle = 'rgba(255, 255, 255, 0.22)';
        ctx.beginPath();
        ctx.ellipse(r * 0.38, r * 0.35, r * 0.2, r * 0.1, -Math.PI / 4, 0, Math.PI * 2);
        ctx.fill();

        // 結合部（ブリッジ）のツヤ
        if (this.connections.top) {
            ctx.fillStyle = 'rgba(255, 255, 255, 0.35)';
            ctx.fillRect(-r * 0.22, -d, r * 0.14, d);
        }
        if (this.connections.left) {
            ctx.fillStyle = 'rgba(255, 255, 255, 0.35)';
            ctx.fillRect(-d, -r * 0.22, d, r * 0.14);
        }

        ctx.restore();
    }

    /**
     * 高精度・もっちり連結メタボール輪郭パス
     */
    buildSlimePath(ctx, r, cellSize) {
        const d = cellSize * 0.5; // 隣のセル境界までの距離
        const bw = r * 0.72;      // 結合ブリッジの半幅
        const t = this.connProgress;

        ctx.beginPath();

        // 12時方向（上）から時計回りにパスを作成
        // --- 1. 上エッジ ---
        if (t.top > 0.05) {
            ctx.moveTo(-bw * t.top, -d);
            ctx.lineTo(bw * t.top, -d);
        } else {
            ctx.moveTo(0, -r);
        }

        // --- 2. 右上コーナー ---
        if (t.top > 0.05 && t.right > 0.05) {
            const kx = bw * 0.75;
            const ky = -bw * 0.75;
            ctx.quadraticCurveTo(kx, ky, d, -bw * t.right);
        } else if (t.top > 0.05) {
            ctx.bezierCurveTo(bw * t.top, -r * 0.35, r, -r * 0.35, r, 0);
        } else if (t.right > 0.05) {
            ctx.bezierCurveTo(r * 0.55, -r, r * 0.85, -bw * t.right, d, -bw * t.right);
        } else {
            ctx.bezierCurveTo(r * 0.55, -r, r, -r * 0.55, r, 0);
        }

        // --- 3. 右エッジ ---
        if (t.right > 0.05) {
            ctx.lineTo(d, bw * t.right);
        }

        // --- 4. 右下コーナー ---
        if (t.right > 0.05 && t.bottom > 0.05) {
            const kx = bw * 0.75;
            const ky = bw * 0.75;
            ctx.quadraticCurveTo(kx, ky, bw * t.bottom, d);
        } else if (t.right > 0.05) {
            ctx.bezierCurveTo(r * 0.85, bw * t.right, r * 0.55, r, 0, r);
        } else if (t.bottom > 0.05) {
            ctx.bezierCurveTo(r, r * 0.35, bw * t.bottom, r * 0.35, bw * t.bottom, d);
        } else {
            ctx.bezierCurveTo(r, r * 0.55, r * 0.55, r, 0, r);
        }

        // --- 5. 下エッジ ---
        if (t.bottom > 0.05) {
            ctx.lineTo(-bw * t.bottom, d);
        }

        // --- 6. 左下コーナー ---
        if (t.bottom > 0.05 && t.left > 0.05) {
            const kx = -bw * 0.75;
            const ky = bw * 0.75;
            ctx.quadraticCurveTo(kx, ky, -d, bw * t.left);
        } else if (t.bottom > 0.05) {
            ctx.bezierCurveTo(-bw * t.bottom, r * 0.35, -r, r * 0.35, -r, 0);
        } else if (t.left > 0.05) {
            ctx.bezierCurveTo(-r * 0.55, r, -r * 0.85, bw * t.left, -d, bw * t.left);
        } else {
            ctx.bezierCurveTo(-r * 0.55, r, -r, r * 0.55, -r, 0);
        }

        // --- 7. 左エッジ ---
        if (t.left > 0.05) {
            ctx.lineTo(-d, -bw * t.left);
        }

        // --- 8. 左上コーナー ---
        if (t.left > 0.05 && t.top > 0.05) {
            const kx = -bw * 0.75;
            const ky = -bw * 0.75;
            ctx.quadraticCurveTo(kx, ky, -bw * t.top, -d);
        } else if (t.left > 0.05) {
            ctx.bezierCurveTo(-r * 0.85, -bw * t.left, -r * 0.55, -r, 0, -r);
        } else if (t.top > 0.05) {
            ctx.bezierCurveTo(-r, -r * 0.35, -bw * t.top, -r * 0.35, -bw * t.top, -d);
        } else {
            ctx.bezierCurveTo(-r, -r * 0.55, -r * 0.55, -r, 0, -r);
        }

        ctx.closePath();
    }

    /**
     * 目の描画（視線・まばたき・表情）
     */
    drawEyes(ctx, r) {
        const eyeOffsetX = r * 0.36;
        const eyeOffsetY = -r * 0.05;
        const eyeRadiusX = r * 0.24;
        const eyeRadiusY = r * 0.28;

        const currentEyeRadiusY = eyeRadiusY * (1.0 - this.blinkProgress * 0.95);

        // 表情による目の描画
        if (this.expression === 'happy') {
            this.drawHappyEye(ctx, -eyeOffsetX, eyeOffsetY, eyeRadiusX);
            this.drawHappyEye(ctx, eyeOffsetX, eyeOffsetY, eyeRadiusX);
            return;
        }

        if (this.expression === 'panic') {
            this.drawPanicEye(ctx, -eyeOffsetX, eyeOffsetY, eyeRadiusX, eyeRadiusY);
            this.drawPanicEye(ctx, eyeOffsetX, eyeOffsetY, eyeRadiusX, eyeRadiusY);
            return;
        }

        // まばたき閉眼
        if (this.blinkProgress >= 0.9) {
            ctx.strokeStyle = '#1e293b';
            ctx.lineWidth = 2.5;
            ctx.beginPath();
            ctx.moveTo(-eyeOffsetX - eyeRadiusX * 0.7, eyeOffsetY);
            ctx.lineTo(-eyeOffsetX + eyeRadiusX * 0.7, eyeOffsetY);
            ctx.moveTo(eyeOffsetX - eyeRadiusX * 0.7, eyeOffsetY);
            ctx.lineTo(eyeOffsetX + eyeRadiusX * 0.7, eyeOffsetY);
            ctx.stroke();
            return;
        }

        // 通常の目
        const drawSingleEye = (ex, ey) => {
            ctx.save();

            // 1. 白目
            ctx.fillStyle = '#ffffff';
            ctx.beginPath();
            ctx.ellipse(ex, ey, eyeRadiusX, currentEyeRadiusY, 0, 0, Math.PI * 2);
            ctx.fill();

            ctx.strokeStyle = '#334155';
            ctx.lineWidth = 1.8;
            ctx.stroke();

            // 2. 瞳（黒目）の位置：視線オフセット
            const maxPupilShiftX = eyeRadiusX * 0.45;
            const maxPupilShiftY = currentEyeRadiusY * 0.45;
            const pupilX = ex + this.lookX * maxPupilShiftX;
            const pupilY = ey + this.lookY * maxPupilShiftY;
            const pupilRadius = eyeRadiusX * 0.58;

            ctx.fillStyle = '#0f172a';
            ctx.beginPath();
            ctx.arc(pupilX, pupilY, pupilRadius, 0, Math.PI * 2);
            ctx.fill();

            // 3. 瞳のハイライト
            ctx.fillStyle = '#ffffff';
            ctx.beginPath();
            ctx.arc(pupilX - pupilRadius * 0.35, pupilY - pupilRadius * 0.35, pupilRadius * 0.42, 0, Math.PI * 2);
            ctx.fill();

            ctx.restore();
        };

        drawSingleEye(-eyeOffsetX, eyeOffsetY);
        drawSingleEye(eyeOffsetX, eyeOffsetY);
    }

    /**
     * 笑顔（にっこり目）の描画
     */
    drawHappyEye(ctx, ex, ey, rx) {
        ctx.save();
        ctx.strokeStyle = '#0f172a';
        ctx.lineWidth = 2.8;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.arc(ex, ey + rx * 0.25, rx * 0.75, Math.PI * 1.15, Math.PI * 1.85);
        ctx.stroke();
        ctx.restore();
    }

    /**
     * 焦り目（ぐるぐるうずまき／点目／見開き）の描画
     */
    drawPanicEye(ctx, ex, ey, rx, ry) {
        ctx.save();
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.ellipse(ex, ey, rx * 1.15, ry * 1.15, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#0f172a';
        ctx.lineWidth = 2;
        ctx.stroke();

        const angle = Date.now() * 0.015;
        const shiftX = Math.cos(angle) * (rx * 0.4);
        const shiftY = Math.sin(angle) * (ry * 0.4);

        ctx.fillStyle = '#0f172a';
        ctx.beginPath();
        ctx.arc(ex + shiftX, ey + shiftY, rx * 0.35, 0, Math.PI * 2);
        ctx.fill();

        ctx.restore();
    }
}

window.Puyo = Puyo;
window.PUYO_COLORS = PUYO_COLORS;
window.COLOR_KEYS = COLOR_KEYS;
