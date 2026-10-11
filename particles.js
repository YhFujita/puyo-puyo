/**
 * particles.js - スライム破裂飛沫・バブル・光の粒子・連鎖演出エフェクト
 */

class Particle {
    constructor(x, y, colorData) {
        this.x = x;
        this.y = y;
        this.colorData = colorData;
        const angle = Math.random() * Math.PI * 2;
        const speed = 2 + Math.random() * 6;
        this.vx = Math.cos(angle) * speed;
        this.vy = Math.sin(angle) * speed - 2.5; // 少し上向きに弾ける
        this.gravity = 0.25;
        this.radius = 4 + Math.random() * 5;
        this.alpha = 1.0;
        this.decay = 0.02 + Math.random() * 0.02;
        this.life = 1.0;
    }

    update() {
        this.vy += this.gravity;
        this.x += this.vx;
        this.y += this.vy;
        this.life -= this.decay;
        this.alpha = Math.max(0, this.life);
        return this.life > 0;
    }

    draw(ctx) {
        ctx.save();
        ctx.globalAlpha = this.alpha;
        
        // ゼリードロップの描画（ハイライト付きの小さな滴）
        const grad = ctx.createRadialGradient(
            this.x - this.radius * 0.3, this.y - this.radius * 0.3, this.radius * 0.1,
            this.x, this.y, this.radius
        );
        grad.addColorStop(0, '#ffffff');
        grad.addColorStop(0.3, this.colorData.main);
        grad.addColorStop(1, this.colorData.dark);

        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(this.x, this.y, this.radius, 0, Math.PI * 2);
        ctx.fill();

        ctx.restore();
    }
}

class Shockwave {
    constructor(x, y, color) {
        this.x = x;
        this.y = y;
        this.color = color;
        this.radius = 10;
        this.maxRadius = 36;
        this.alpha = 0.8;
    }

    update() {
        this.radius += 2.4;
        this.alpha -= 0.05;
        return this.alpha > 0;
    }

    draw(ctx) {
        ctx.save();
        ctx.globalAlpha = Math.max(0, this.alpha);
        ctx.strokeStyle = this.color;
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(this.x, this.y, this.radius, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
    }
}

class Sparkle {
    constructor(x, y) {
        this.x = x;
        this.y = y;
        this.vx = (Math.random() - 0.5) * 4;
        this.vy = (Math.random() - 0.5) * 4;
        this.size = 2 + Math.random() * 4;
        this.life = 1.0;
        this.decay = 0.03 + Math.random() * 0.02;
    }

    update() {
        this.x += this.vx;
        this.y += this.vy;
        this.life -= this.decay;
        return this.life > 0;
    }

    draw(ctx) {
        ctx.save();
        ctx.globalAlpha = Math.max(0, this.life);
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        // 4芒星の描画
        const s = this.size;
        ctx.moveTo(this.x, this.y - s * 1.5);
        ctx.lineTo(this.x + s * 0.4, this.y - s * 0.4);
        ctx.lineTo(this.x + s * 1.5, this.y);
        ctx.lineTo(this.x + s * 0.4, this.y + s * 0.4);
        ctx.moveTo(this.x, this.y + s * 1.5);
        ctx.lineTo(this.x - s * 0.4, this.y + s * 0.4);
        ctx.lineTo(this.x - s * 1.5, this.y);
        ctx.lineTo(this.x - s * 0.4, this.y - s * 0.4);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
    }
}

class FloatingText {
    constructor(x, y, text, color, fontSize = 24) {
        this.x = x;
        this.y = y;
        this.text = text;
        this.color = color;
        this.fontSize = fontSize;
        this.vy = -1.2;
        this.scale = 0.5;
        this.targetScale = 1.0;
        this.alpha = 1.0;
        this.life = 1.0;
        this.decay = 0.016;
    }

    update() {
        this.y += this.vy;
        if (this.scale < this.targetScale) {
            this.scale += 0.1;
        }
        this.life -= this.decay;
        this.alpha = Math.max(0, this.life);
        return this.life > 0;
    }

    draw(ctx) {
        ctx.save();
        ctx.globalAlpha = this.alpha;
        ctx.translate(this.x, this.y);
        ctx.scale(this.scale, this.scale);

        ctx.font = `900 ${this.fontSize}px 'Outfit', 'M PLUS Rounded 1c', sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';

        // 輪郭影
        ctx.strokeStyle = '#111827';
        ctx.lineWidth = 5;
        ctx.strokeText(this.text, 0, 0);

        // 文字本体
        ctx.fillStyle = this.color;
        ctx.fillText(this.text, 0, 0);

        ctx.restore();
    }
}

class ParticleManager {
    constructor() {
        this.particles = [];
        this.shockwaves = [];
        this.sparkles = [];
        this.texts = [];
    }

    createPopEffect(x, y, colorData) {
        // スライム飛沫
        for (let i = 0; i < 12; i++) {
            this.particles.push(new Particle(x, y, colorData));
        }
        // 衝撃波
        this.shockwaves.push(new Shockwave(x, y, colorData.main));
        // キラキラ
        for (let i = 0; i < 6; i++) {
            this.sparkles.push(new Sparkle(x, y));
        }
    }

    addText(x, y, text, color = '#fbbf24', fontSize = 28) {
        this.texts.push(new FloatingText(x, y, text, color, fontSize));
    }

    update() {
        this.particles = this.particles.filter(p => p.update());
        this.shockwaves = this.shockwaves.filter(s => s.update());
        this.sparkles = this.sparkles.filter(sp => sp.update());
        this.texts = this.texts.filter(t => t.update());
    }

    draw(ctx) {
        this.shockwaves.forEach(s => s.draw(ctx));
        this.particles.forEach(p => p.draw(ctx));
        this.sparkles.forEach(sp => sp.draw(ctx));
        this.texts.forEach(t => t.draw(ctx));
    }

    clear() {
        this.particles = [];
        this.shockwaves = [];
        this.sparkles = [];
        this.texts = [];
    }
}

window.particleManager = new ParticleManager();
