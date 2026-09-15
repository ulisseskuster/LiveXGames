/**
 * LiveX Cyber Roulette Engine
 * Renderizador de alta performance em Canvas 2D, síntese de áudio procedural
 * Web Audio API e física de desaceleração elástica server-authoritative.
 */

class CyberRouletteSound {
  constructor() {
    this.ctx = null;
    this.enabled = true;
  }

  init() {
    if (!this.ctx) {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (AudioContext) {
        this.ctx = new AudioContext();
      }
    }
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }
  }

  playTick(pitchOffset = 0) {
    if (!this.enabled) return;
    this.init();
    if (!this.ctx) return;

    try {
      const t = this.ctx.currentTime;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();

      osc.type = 'triangle';
      // Frequência rápida de estalo mecânico (700Hz - 900Hz)
      const freq = 750 + Math.random() * 150 + pitchOffset;
      osc.frequency.setValueAtTime(freq, t);
      osc.frequency.exponentialRampToValueAtTime(120, t + 0.035);

      gain.gain.setValueAtTime(0.35, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.035);

      osc.connect(gain);
      gain.connect(this.ctx.destination);

      osc.start(t);
      osc.stop(t + 0.04);
    } catch (e) {}
  }

  playWhoosh() {
    if (!this.enabled) return;
    this.init();
    if (!this.ctx) return;

    try {
      const t = this.ctx.currentTime;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(110, t);
      osc.frequency.exponentialRampToValueAtTime(320, t + 0.4);
      osc.frequency.exponentialRampToValueAtTime(80, t + 0.9);

      gain.gain.setValueAtTime(0.01, t);
      gain.gain.linearRampToValueAtTime(0.2, t + 0.3);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.9);

      osc.connect(gain);
      gain.connect(this.ctx.destination);

      osc.start(t);
      osc.stop(t + 0.95);
    } catch (e) {}
  }

  playWinFanfare() {
    if (!this.enabled) return;
    this.init();
    if (!this.ctx) return;

    try {
      const notes = [523.25, 659.25, 783.99, 1046.5, 1318.51]; // C5, E5, G5, C6, E6
      const start = this.ctx.currentTime;

      notes.forEach((note, index) => {
        const t = start + index * 0.09;
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();

        osc.type = index === notes.length - 1 ? 'sine' : 'triangle';
        osc.frequency.setValueAtTime(note, t);

        const duration = index === notes.length - 1 ? 0.7 : 0.22;
        gain.gain.setValueAtTime(0.25, t);
        gain.gain.exponentialRampToValueAtTime(0.001, t + duration);

        osc.connect(gain);
        gain.connect(this.ctx.destination);

        osc.start(t);
        osc.stop(t + duration);
      });
    } catch (e) {}
  }
}

class CyberParticleSystem {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.particles = [];
  }

  burst(x, y, count = 75, colors = ['#f59e0b', '#ec4899', '#06b6d4', '#10b981', '#ffffff']) {
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 3 + Math.random() * 9;
      this.particles.push({
        x,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - (1 + Math.random() * 3),
        size: 3 + Math.random() * 5,
        color: colors[Math.floor(Math.random() * colors.length)],
        alpha: 1,
        life: 1,
        decay: 0.012 + Math.random() * 0.015,
        gravity: 0.18,
        shape: Math.random() > 0.4 ? 'circle' : 'rect'
      });
    }
  }

  updateAndDraw() {
    if (this.particles.length === 0) return;

    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.x += p.vx;
      p.y += p.vy;
      p.vy += p.gravity;
      p.vx *= 0.98;
      p.life -= p.decay;
      p.alpha = Math.max(0, p.life);

      if (p.life <= 0) {
        this.particles.splice(i, 1);
        continue;
      }

      this.ctx.save();
      this.ctx.globalAlpha = p.alpha;
      this.ctx.fillStyle = p.color;
      this.ctx.shadowColor = p.color;
      this.ctx.shadowBlur = 8;

      if (p.shape === 'circle') {
        this.ctx.beginPath();
        this.ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        this.ctx.fill();
      } else {
        this.ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
      }
      this.ctx.restore();
    }
  }
}

class CyberRouletteWheel {
  constructor(canvasId, options = {}) {
    this.canvas = document.getElementById(canvasId);
    if (!this.canvas) throw new Error(`Canvas #${canvasId} não encontrado`);
    this.ctx = this.canvas.getContext('2d');

    this.segments = options.segments || [
      {
        id: 'fichas_15',
        name: '15 Moedas',
        icon: '🪙',
        label: '15 Moedas',
        color: '#059669',
        accent: '#10b981'
      },
      {
        id: 'nitro_booster',
        name: 'Nitro Booster',
        icon: '🔥',
        label: 'Nitro',
        color: '#ea580c',
        accent: '#ff705e'
      },
      {
        id: 'fichas_40',
        name: '40 Moedas',
        icon: '🪙',
        label: '40 Moedas',
        color: '#0891b2',
        accent: '#06b6d4'
      },
      {
        id: 'extra_life',
        name: '+1 Vida',
        icon: '❤️',
        label: '+1 Vida',
        color: '#db2777',
        accent: '#f43f5e'
      },
      {
        id: 'nos_injection',
        name: 'Injeção NOS',
        icon: '⚡',
        label: 'NOS 300',
        color: '#ca8a04',
        accent: '#eab308'
      },
      {
        id: 'shield_deflector',
        name: 'Escudo',
        icon: '🛡️',
        label: 'Escudo',
        color: '#2563eb',
        accent: '#3b82f6'
      },
      {
        id: 'fichas_100',
        name: '100 Moedas',
        icon: '🪙',
        label: '100 Moedas',
        color: '#7c3aed',
        accent: '#008cff'
      },
      {
        id: 'fichas_500',
        name: 'JACKPOT 500',
        icon: '👑',
        label: 'JACKPOT',
        color: '#b45309',
        accent: '#f59e0b'
      }
    ];

    this.sound = new CyberRouletteSound();
    this.particles = new CyberParticleSystem(this.canvas);

    this.currentAngle = 0; // Radianos
    this.isSpinning = false;
    this.pegCount = this.segments.length;
    this.lastPegPassed = -1;
    this.pinFlap = 0; // Balanço do ponteiro
    this.ledChaseOffset = 0;

    this.setupHighDpi();
    window.addEventListener('resize', () => this.setupHighDpi());
    this.startRenderLoop();
  }

  setupHighDpi() {
    const rect = this.canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const size = Math.min(rect.width || 420, rect.height || 420);

    this.canvas.width = size * dpr;
    this.canvas.height = size * dpr;
    this.ctx.scale(dpr, dpr);

    this.width = size;
    this.height = size;
    this.centerX = size / 2;
    this.centerY = size / 2;
    this.radius = size * 0.44;
  }

  setSegments(newSegments) {
    if (Array.isArray(newSegments) && newSegments.length > 0) {
      this.segments = newSegments;
      this.pegCount = newSegments.length;
    }
  }

  startRenderLoop() {
    const loop = () => {
      this.render();
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }

  render() {
    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.width, this.height);

    const segCount = this.segments.length;
    const sliceAngle = (Math.PI * 2) / segCount;

    // 1. Base Exterior: Anel de Neon Cibernético com LEDs
    ctx.save();
    ctx.translate(this.centerX, this.centerY);

    // Glow externo
    ctx.beginPath();
    ctx.arc(0, 0, this.radius + 14, 0, Math.PI * 2);
    ctx.fillStyle = '#0f172a';
    ctx.shadowColor = '#06b6d4';
    ctx.shadowBlur = 24;
    ctx.fill();

    // Aro Metálico Escuro
    ctx.beginPath();
    ctx.arc(0, 0, this.radius + 12, 0, Math.PI * 2);
    ctx.lineWidth = 14;
    ctx.strokeStyle = '#1e293b';
    ctx.stroke();

    // Aro Neon Dourado/Ciano
    ctx.beginPath();
    ctx.arc(0, 0, this.radius + 5, 0, Math.PI * 2);
    ctx.lineWidth = 2.5;
    ctx.strokeStyle = '#38bdf8';
    ctx.shadowColor = '#38bdf8';
    ctx.shadowBlur = 10;
    ctx.stroke();

    // LEDs dinâmicos ao redor da borda (Chase Lights)
    const ledCount = 24;
    this.ledChaseOffset += this.isSpinning ? 0.35 : 0.05;
    for (let i = 0; i < ledCount; i++) {
      const ledAngle = (i / ledCount) * Math.PI * 2;
      const lx = Math.cos(ledAngle) * (this.radius + 12);
      const ly = Math.sin(ledAngle) * (this.radius + 12);

      const isActive = Math.floor((i + this.ledChaseOffset) % ledCount) < 6;
      ctx.beginPath();
      ctx.arc(lx, ly, 3.5, 0, Math.PI * 2);
      ctx.fillStyle = isActive ? '#fbbf24' : '#334155';
      ctx.shadowColor = isActive ? '#fbbf24' : 'transparent';
      ctx.shadowBlur = isActive ? 12 : 0;
      ctx.fill();
    }

    // 2. Fatias da Roleta (Giram com this.currentAngle)
    ctx.rotate(this.currentAngle);

    for (let i = 0; i < segCount; i++) {
      const startAngle = i * sliceAngle;
      const endAngle = startAngle + sliceAngle;
      const seg = this.segments[i];

      // Desenho da fatia com gradiente
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.arc(0, 0, this.radius, startAngle, endAngle);
      ctx.closePath();

      const midAngle = startAngle + sliceAngle / 2;
      const grad = ctx.createRadialGradient(
        0,
        0,
        20,
        Math.cos(midAngle) * this.radius,
        Math.sin(midAngle) * this.radius,
        this.radius
      );
      grad.addColorStop(0, '#0f172a');
      grad.addColorStop(0.35, seg.color || '#334155');
      grad.addColorStop(1, seg.accent || '#475569');

      ctx.fillStyle = grad;
      ctx.fill();

      // Divisória chanfrada entre fatias
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(Math.cos(startAngle) * this.radius, Math.sin(startAngle) * this.radius);
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.25)';
      ctx.stroke();

      // Pino metálico na borda externa
      const pinX = Math.cos(startAngle) * (this.radius - 4);
      const pinY = Math.sin(startAngle) * (this.radius - 4);
      ctx.beginPath();
      ctx.arc(pinX, pinY, 3, 0, Math.PI * 2);
      ctx.fillStyle = '#f8fafc';
      ctx.shadowColor = '#ffffff';
      ctx.shadowBlur = 4;
      ctx.fill();

      // Conteúdo da fatia: Ícone + Rótulo em arco
      ctx.save();
      ctx.rotate(midAngle);
      ctx.textAlign = 'right';
      ctx.textBaseline = 'middle';

      // Ícone
      ctx.font = '24px "Segoe UI Emoji", "Apple Color Emoji", sans-serif';
      ctx.shadowColor = 'rgba(0, 0, 0, 0.8)';
      ctx.shadowBlur = 6;
      ctx.fillText(seg.icon || '🎁', this.radius - 16, 0);

      // Texto do Prêmio
      ctx.font = 'bold 12px "Outfit", "Inter", sans-serif';
      ctx.fillStyle = '#ffffff';
      ctx.shadowColor = '#000000';
      ctx.shadowBlur = 4;
      ctx.fillText(seg.label || seg.name, this.radius - 48, 0);

      ctx.restore();
    }

    ctx.restore(); // Restaura rotação das fatias

    // 3. Hub Central Magnético
    ctx.save();
    ctx.translate(this.centerX, this.centerY);

    // Círculo central escuro
    ctx.beginPath();
    ctx.arc(0, 0, 36, 0, Math.PI * 2);
    ctx.fillStyle = '#090d16';
    ctx.shadowColor = '#ec4899';
    ctx.shadowBlur = 18;
    ctx.fill();

    // Anel neon do hub
    ctx.beginPath();
    ctx.arc(0, 0, 34, 0, Math.PI * 2);
    ctx.lineWidth = 3;
    ctx.strokeStyle = '#f43f5e';
    ctx.stroke();

    // Ícone de estrela / raio central
    ctx.font = '20px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('⚡', 0, 0);

    ctx.restore();

    // 4. Ponteiro Superior / Ticker Mecânico (Fixo no topo apontando para baixo)
    ctx.save();
    ctx.translate(this.centerX, this.centerY - this.radius - 4);
    ctx.rotate(this.pinFlap); // Leve deflexão elástica por impacto do pino

    ctx.beginPath();
    ctx.moveTo(-10, -18);
    ctx.lineTo(10, -18);
    ctx.lineTo(0, 16); // Bico apontando para o centro
    ctx.closePath();

    const pointerGrad = ctx.createLinearGradient(0, -18, 0, 16);
    pointerGrad.addColorStop(0, '#f59e0b');
    pointerGrad.addColorStop(1, '#ef4444');
    ctx.fillStyle = pointerGrad;
    ctx.shadowColor = '#f59e0b';
    ctx.shadowBlur = 14;
    ctx.fill();

    ctx.lineWidth = 2;
    ctx.strokeStyle = '#ffffff';
    ctx.stroke();

    // Parafuso do ponteiro
    ctx.beginPath();
    ctx.arc(0, -12, 4, 0, Math.PI * 2);
    ctx.fillStyle = '#1e293b';
    ctx.fill();

    ctx.restore();

    // Efeito de mola no ponteiro
    this.pinFlap *= 0.82;

    // Atualiza e desenha partículas de vitória
    this.particles.updateAndDraw();
  }

  /**
   * Executa o giro até o segmento premiado decidido pelo servidor.
   * @param {number} targetSegmentIndex Índice do segmento premiado (0 a segments.length - 1)
   * @param {Function} onFinish Callback ao concluir o giro
   */
  spinTo(targetSegmentIndex, onFinish) {
    if (this.isSpinning) return;
    this.isSpinning = true;

    this.sound.playWhoosh();

    const segCount = this.segments.length;
    const sliceAngle = (Math.PI * 2) / segCount;

    // O ponteiro aponta para o topo (ângulo -PI/2 em coordenadas normais).
    // O centro do segmento `targetSegmentIndex` deve parar exatamente em -PI/2.
    // Ângulo do centro do segmento = targetSegmentIndex * sliceAngle + sliceAngle / 2.
    // Logo: (currentAngle + offset) % (2PI) deve alinhar o centro com o topo.
    // Target wheel angle:
    const baseRotations = 6 + Math.floor(Math.random() * 3); // 6 a 8 voltas completas
    const pointerAngle = -Math.PI / 2;
    const segmentCenterAngle = targetSegmentIndex * sliceAngle + sliceAngle / 2;

    // Adiciona uma variação aleatória suave dentro de 70% da largura da fatia para evitar que caia sempre na exata mesma linha
    const jitter = (Math.random() - 0.5) * (sliceAngle * 0.6);

    const targetModulo = pointerAngle - segmentCenterAngle + jitter;
    // Normaliza para frente
    const currentNorm = this.currentAngle % (Math.PI * 2);
    let diff = (targetModulo - currentNorm) % (Math.PI * 2);
    if (diff <= 0) diff += Math.PI * 2;

    const totalAngleToSpin = baseRotations * Math.PI * 2 + diff;
    const startAngle = this.currentAngle;
    const finalAngle = startAngle + totalAngleToSpin;

    const duration = 5400; // 5.4 segundos de giro suave e imersivo
    const startTime = performance.now();

    const animate = (now) => {
      const elapsed = now - startTime;
      const progress = Math.min(1, elapsed / duration);

      // Curva de desaceleração suave (Quartic Easing Out)
      const ease = 1 - Math.pow(1 - progress, 4);

      this.currentAngle = startAngle + totalAngleToSpin * ease;

      // Detecção de pinos passando no ponteiro para tocar o som de tick e vibrar o ponteiro
      const normalizedAngle = (this.currentAngle - pointerAngle) / sliceAngle;
      const currentPeg = Math.floor(normalizedAngle);

      if (currentPeg !== this.lastPegPassed) {
        this.lastPegPassed = currentPeg;
        this.pinFlap = 0.28 * (1 - progress * 0.5); // Deflexão elástica do ponteiro
        this.sound.playTick(progress * 100);
      }

      if (progress < 1) {
        requestAnimationFrame(animate);
      } else {
        this.isSpinning = false;
        this.currentAngle = finalAngle;

        // Fanfarra e explosão de partículas
        this.sound.playWinFanfare();
        this.particles.burst(this.centerX, this.centerY, 90);

        if (typeof onFinish === 'function') {
          setTimeout(() => {
            onFinish(this.segments[targetSegmentIndex]);
          }, 350);
        }
      }
    };

    requestAnimationFrame(animate);
  }
}

// Exporta para o escopo global do navegador
window.CyberRouletteWheel = CyberRouletteWheel;
window.CyberRouletteSound = CyberRouletteSound;
