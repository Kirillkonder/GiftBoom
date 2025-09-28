class PlinkoGame {
    constructor() {
        // Game state
        this.currentUser = null;
        this.isDemoMode = false;
        this.currentBet = 0.1;
        this.balance = 0;
        this.difficultyMode = 'easy';
        
        // Canvas setup
        this.canvas = document.getElementById('gameCanvas');
        this.ctx = this.canvas.getContext('2d');
        this.resizeCanvas();

        // Game elements
        this.activeBalls = [];
        this.pegs = [];
        this.slots = [];

        // 🔥 ФИЗИКА КАК В 1WIN - ВЫСОКАЯ ВОЛАТИЛЬНОСТЬ
        this.gravity = 0.8;
        this.bounce = 0.65;
        this.friction = 0.985;

        // 🔥 СИСТЕМА СЛУЧАЙНЫХ БОЛЬШИХ ВЫИГРЫШЕЙ
        this.ballsDropped = 0;
        this.bigWinCounter = 0;
        this.nextBigWinAt = Math.floor(Math.random() * 15) + 10;
        this.consecutiveSmallWins = 0;

        this.setupEventListeners();
        this.createPegs();
        this.createSlots();
        this.initializeUser();
        this.gameLoop();
    }

    async initializeUser() {
        const tg = window.Telegram.WebApp;
        if (tg.initDataUnsafe && tg.initDataUnsafe.user) {
            this.currentUser = {
                id: tg.initDataUnsafe.user.id,
                username: tg.initDataUnsafe.user.username || `User_${tg.initDataUnsafe.user.id}`
            };
            await this.loadUserData();
        }
        this.updateUI();
    }

    async loadUserData() {
        try {
            const response = await fetch(`/api/user/balance/${this.currentUser.id}`);
            if (response.ok) {
                const userData = await response.json();
                this.balance = userData.demo_mode ? userData.demo_balance : userData.main_balance;
                this.isDemoMode = userData.demo_mode;
                document.getElementById('demo-badge').style.display = this.isDemoMode ? 'block' : 'none';
                this.updateUI();
            }
        } catch (error) {
            console.error('Error loading user data:', error);
        }
    }

    resizeCanvas() {
        const board = document.querySelector('.game-board');
        this.canvas.width = board.clientWidth;
        this.canvas.height = board.clientHeight;
        this.pegRadius = Math.min(this.canvas.width, this.canvas.height) * 0.012;
        this.ballRadius = this.pegRadius * 1.2;
    }

    setupEventListeners() {
        window.addEventListener('resize', () => {
            this.resizeCanvas();
            this.pegs = [];
            this.createPegs();
        });

        document.getElementById('dropBall').addEventListener('click', () => this.dropBall());
    }

    createPegs() {
        const rows = 12;
        const verticalSpacing = this.canvas.height / (rows + 2);
        const baseHorizontalSpacing = this.canvas.width / (rows + 1);
        const sideMargin = this.pegRadius + 2;

        for (let row = 0; row < rows; row++) {
            const pegsInRow = row + 3;
            let rowSpacing = baseHorizontalSpacing;
            let rowWidth = (pegsInRow - 1) * rowSpacing;
            const maxRowWidth = this.canvas.width - sideMargin * 2;

            if (rowWidth > maxRowWidth) {
                rowSpacing = maxRowWidth / (pegsInRow - 1);
                rowWidth = maxRowWidth;
            }

            const startX = (this.canvas.width - rowWidth) / 2;

            for (let i = 0; i < pegsInRow; i++) {
                const randomOffset = (Math.random() - 0.5) * 8;
                this.pegs.push({
                    x: startX + i * rowSpacing + randomOffset,
                    y: verticalSpacing * (row + 2) + (Math.random() - 0.5) * 5,
                    radius: this.pegRadius
                });
            }
        }
    }

    createSlots() {
        const slotCount = 7;
        const sideMargin = 10;
        const availableWidth = this.canvas.width - (sideMargin * 2);
        const slotWidth = availableWidth / slotCount;
        
        const multipliersByDifficulty = {
            easy: [5.8, 2.2, 0.8, 0.4, 0.8, 2.2, 5.8],
            medium: [8.4, 4.7, 0.5, 0.2, 0.5, 4.7, 8.4],
            hard: [15.6, 8.7, 0.2, 0.1, 0.2, 8.7, 15.6]
        };
        
        const multipliers = multipliersByDifficulty[this.difficultyMode];
        
        this.slots = [];
        for (let i = 0; i < slotCount; i++) {
            this.slots.push({
                x: sideMargin + (i * slotWidth),
                width: slotWidth,
                multiplier: multipliers[i],
                index: i
            });
        }
        
        this.updateSlotsDisplay();
        
        console.log(`🎯 Слоты созданы для режима ${this.difficultyMode}:`, this.slots.map(s => `${s.multiplier}x`).join(' | '));
    }

    updateSlotsDisplay() {
        const slotsContainer = document.getElementById('slots');
        if (slotsContainer) {
            const slotElements = slotsContainer.querySelectorAll('.slot');
            this.slots.forEach((slot, index) => {
                if (slotElements[index]) {
                    slotElements[index].textContent = `${slot.multiplier}x`;
                    slotElements[index].setAttribute('data-value', slot.multiplier.toString());
                    
                    slotElements[index].className = 'slot';
                    
                    if (slot.multiplier >= 5) {
                        slotElements[index].classList.add('high-multiplier');
                    } else if (slot.multiplier >= 2) {
                        slotElements[index].classList.add('medium-multiplier');
                    } else if (slot.multiplier >= 0.8) {
                        slotElements[index].classList.add('low-multiplier');
                    } else {
                        slotElements[index].classList.add('lowest-multiplier');
                    }
                }
            });
        }
    }

    // 🔥 НОВАЯ СИСТЕМА ГЕНЕРАЦИИ РЕЗУЛЬТАТОВ КАК В 1WIN
    generatePlinkoResult() {
        const random = Math.random() * 100;
        
        // 🔥 ВЫСОКАЯ ВОЛАТИЛЬНОСТЬ: 70% малые выигрыши, 25% средние, 5% крупные
        if (this.bigWinCounter > 0) {
            // Принудительный большой выигрыш
            this.bigWinCounter--;
            const bigMultipliers = [5.8, 8.4, 15.6, 26.0, 100.0];
            return bigMultipliers[Math.floor(Math.random() * bigMultipliers.length)];
        }

        if (random < 70) {
            // 70% - малые выигрыши (0.2x - 1.5x)
            this.consecutiveSmallWins++;
            return 0.2 + Math.random() * 1.3;
        } else if (random < 95) {
            // 25% - средние выигрыши (1.5x - 5x)
            this.consecutiveSmallWins = 0;
            return 1.5 + Math.random() * 3.5;
        } else {
            // 5% - крупные выигрыши (5x - 100x)
            this.consecutiveSmallWins = 0;
            
            // После 10+ малых выигрышей подряд увеличиваем шанс большого
            if (this.consecutiveSmallWins >= 10) {
                return 20 + Math.random() * 80;
            }
            
            return 5 + Math.random() * 95;
        }
    }

    async dropBall() {
        if (this.currentBet > 0 && this.balance >= this.currentBet) {
            const x = this.canvas.width / 2;
            this.dropBallAt(x);
        } else {
            this.showError('Недостаточно средств');
        }
    }

    async dropBallAt(x) {
        try {
            if (this.balance < this.currentBet) {
                this.showError('Недостаточно средств');
                return;
            }

            const response = await fetch('/api/plinko/start', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    telegramId: this.currentUser.id,
                    betAmount: this.currentBet,
                    rows: 10,
                    demoMode: this.isDemoMode,
                    difficultyMode: this.difficultyMode
                })
            });

            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.error || 'Ошибка при размещении ставки');
            }

            const result = await response.json();
            
            if (result.success) {
                this.balance = result.new_balance;
                this.updateUI();
                
                const ball = {
                    x: Math.max(this.ballRadius, Math.min(x, this.canvas.width - this.ballRadius)),
                    y: this.ballRadius,
                    vx: (Math.random() - 0.5) * 4,
                    vy: 0,
                    radius: this.ballRadius,
                    bet: this.currentBet,
                    gameId: result.game_id,
                    isFinished: false,
                    finishedAt: 0,
                    createdAt: Date.now()
                };

                this.activeBalls.push(ball);
                this.updateUI();

            } else {
                throw new Error(result.error);
            }
        } catch (error) {
            console.error('Drop ball error:', error);
            this.showError(error.message || 'Ошибка при размещении ставки');
        }
    }

    // 🔥 ФИЗИКА С ВЫСОКОЙ СЛУЧАЙНОСТЬЮ КАК В 1WIN
    updateBall() {
        for (let i = this.activeBalls.length - 1; i >= 0; i--) {
            const ball = this.activeBalls[i];

            const currentTime = Date.now();
            const ballLifetime = currentTime - (ball.createdAt || currentTime);
            if ((ball.isFinished && currentTime - ball.finishedAt > 300) || ballLifetime > 15000) {
                this.activeBalls.splice(i, 1);
                continue;
            }

            if (ball.isFinished) continue;

            // 🔥 УСИЛЕННАЯ ФИЗИКА С БОЛЬШЕЙ СЛУЧАЙНОСТЬЮ
            ball.vy += this.gravity;
            
            // 🔥 СИЛЬНЫЕ СЛУЧАЙНЫЕ ВОЗДЕЙСТВИЯ КАК В 1WIN
            ball.vx += (Math.random() - 0.5) * 0.8;
            ball.vy += (Math.random() - 0.5) * 0.3;
            
            ball.x += ball.vx;
            ball.y += ball.vy;
            ball.vx *= this.friction;
            ball.vy *= this.friction;

            // 🔥 ХАОТИЧЕСКОЕ ДВИЖЕНИЕ - ШАРИК МОЖЕТ ПОЛЕТЕТЬ КУДА УГОДНО
            if (Math.random() < 0.3) {
                ball.vx += (Math.random() - 0.5) * 4;
                ball.vy += (Math.random() - 0.3) * 2;
            }

            // Столкновения со стенами
            if (ball.x - ball.radius < 0 || ball.x + ball.radius > this.canvas.width) {
                ball.vx *= -this.bounce;
                ball.vx += (Math.random() - 0.5) * 2;
                ball.x = ball.x - ball.radius < 0 ? ball.radius : this.canvas.width - ball.radius;
            }

            // Столкновения с колышками - БОЛЕЕ ХАОТИЧНЫЕ
            this.pegs.forEach(peg => {
                const dx = ball.x - peg.x;
                const dy = ball.y - peg.y;
                const distance = Math.sqrt(dx * dx + dy * dy);
                
                if (distance < ball.radius + peg.radius) {
                    const angle = Math.atan2(dy, dx);
                    const speed = Math.sqrt(ball.vx * ball.vx + ball.vy * ball.vy);
                    
                    const randomBounce = angle + (Math.random() - 0.5) * 1.0;
                    
                    ball.vx = Math.cos(randomBounce) * speed * this.bounce;
                    ball.vy = Math.sin(randomBounce) * speed * this.bounce;
                    
                    ball.vx += (Math.random() - 0.5) * 1.5;
                    ball.vy += (Math.random() - 0.5) * 1.0;
                    
                    const minDistance = ball.radius + peg.radius;
                    ball.x = peg.x + Math.cos(angle) * minDistance;
                    ball.y = peg.y + Math.sin(angle) * minDistance;
                }
            });

            // Проверка достижения низа
            const bottomThreshold = this.canvas.height - 15;
            const isAtBottom = ball.y + ball.radius > bottomThreshold;
            
            if (isAtBottom && !ball.isFinished) {
                ball.isFinished = true;
                ball.finishedAt = Date.now();
                
                // 🔥 ГЕНЕРАЦИЯ РЕЗУЛЬТАТА ПО АЛГОРИТМУ 1WIN
                this.ballsDropped++;
                
                if (this.ballsDropped >= this.nextBigWinAt) {
                    this.bigWinCounter = 1 + Math.floor(Math.random() * 2);
                    this.nextBigWinAt = this.ballsDropped + Math.floor(Math.random() * 20) + 15;
                    console.log(`🎰 АКТИВИРОВАН БОЛЬШОЙ ВЫИГРЫШ! Осталось: ${this.bigWinCounter}`);
                }

                const finalMultiplier = this.generatePlinkoResult();
                
                let closestSlot = 0;
                let minDiff = Infinity;
                
                this.slots.forEach((slot, index) => {
                    const diff = Math.abs(slot.multiplier - finalMultiplier);
                    if (diff < minDiff) {
                        minDiff = diff;
                        closestSlot = index;
                    }
                });

                console.log(`🎯 Результат: ${finalMultiplier.toFixed(2)}x, слот: ${closestSlot}`);
                
                setTimeout(() => {
                    this.handleBallInSlot(ball, closestSlot, finalMultiplier);
                }, 100);
            }
        }
    }

    async handleBallInSlot(ball, slotIndex, realMultiplier) {
        try {
            const response = await fetch('/api/plinko/drop', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    gameId: ball.gameId,
                    telegramId: this.currentUser.id,
                    finalSlot: slotIndex,
                    realMultiplier: realMultiplier
                })
            });

            if (!response.ok) {
                throw new Error('Ошибка при обработке выигрыша');
            }

            const result = await response.json();
            
            if (result.success) {
                this.balance = result.new_balance;
                this.updateUI();
                
                if (realMultiplier >= 10) {
                    this.showBigWinNotification(realMultiplier, result.win_amount);
                }
            }
        } catch (error) {
            console.error('Handle ball error:', error);
        }
    }

    // 🔥 ФУНКЦИЯ ДЛЯ КРУПНЫХ ВЫИГРЫШЕЙ
    showBigWinNotification(multiplier, winAmount) {
        const notification = document.createElement('div');
        notification.className = 'big-win-notification';
        notification.innerHTML = `
            <div class="big-win-content">
                <div class="big-win-icon">🎰</div>
                <div class="big-win-text">
                    <div class="big-win-title">ОГРОМНЫЙ ВЫИГРЫШ!</div>
                    <div class="big-win-multiplier">${multiplier.toFixed(2)}x</div>
                    <div class="big-win-amount">+${winAmount.toFixed(2)} TON</div>
                </div>
            </div>
        `;
        
        document.body.appendChild(notification);
        
        setTimeout(() => notification.classList.add('show'), 100);
        setTimeout(() => {
            notification.classList.remove('show');
            setTimeout(() => notification.remove(), 1000);
        }, 5000);
    }

    drawGame() {
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

        this.pegs.forEach(peg => {
            this.ctx.beginPath();
            this.ctx.arc(peg.x, peg.y, peg.radius, 0, Math.PI * 2);
            this.ctx.fillStyle = 'rgba(255, 255, 255, 0.3)';
            this.ctx.fill();
        });

        this.activeBalls.forEach(ball => {
            if (ball.isFinished) return;
            
            this.ctx.beginPath();
            this.ctx.arc(ball.x, ball.y, ball.radius, 0, Math.PI * 2);
            this.ctx.fillStyle = '#1e5cb8';
            this.ctx.fill();
            
            this.ctx.shadowBlur = 10;
            this.ctx.shadowColor = '#1e5cb8';
            this.ctx.fill();
            this.ctx.shadowBlur = 0;
        });
    }

    gameLoop() {
        this.drawGame();
        this.updateBall();
        requestAnimationFrame(() => this.gameLoop());
    }

    updateUI() {
        document.getElementById('balance').textContent = this.balance.toFixed(2);
        document.getElementById('betAmount').value = this.currentBet.toFixed(1);

        const dropButton = document.getElementById('dropBall');
        dropButton.disabled = this.currentBet === 0 || this.currentBet > this.balance;
        
        if (this.currentBet > this.balance) {
            dropButton.style.background = 'linear-gradient(135deg, #1e5cb8, #1e5cb8)';
            dropButton.textContent = 'Недостаточно средств';
        } else {
            dropButton.style.background = 'linear-gradient(135deg, #1e5cb8, #2668b3)';
            dropButton.textContent = 'Бросить шар';
        }
    }

    decreaseBet() {
        if (this.currentBet > 0.1) {
            this.currentBet = Math.max(0.1, this.currentBet - 0.1);
            this.updateUI();
        }
    }

    increaseBet() {
        if (this.currentBet < 100) {
            this.currentBet = Math.min(100, this.currentBet + 0.1);
            this.updateUI();
        }
    }

    validateBetAmount() {
        const betInput = document.getElementById('betAmount');
        let value = parseFloat(betInput.value);
        
        if (isNaN(value)) {
            value = 0.1;
        }
        
        value = Math.max(0.1, Math.min(100, value));
        betInput.value = value.toFixed(1);
        this.currentBet = value;
        this.updateUI();
    }

    showToast(type, title, message, duration = 3000) {
        if (type !== 'error') return;
        
        const toastContainer = document.getElementById('toast-container');
        const toast = document.createElement('div');
        toast.className = `toast toast-${type}`;
        
        const icons = {
            error: 'bi bi-x-circle-fill'
        };
        
        toast.innerHTML = `
            <i class="toast-icon ${icons[type]}"></i>
            <div class="toast-content">
                <div class="toast-title">${title}</div>
                <div class="toast-message">${message}</div>
            </div>
            <button class="toast-close" onclick="this.parentElement.remove()">
                <i class="bi bi-x"></i>
            </button>
        `;
        
        toastContainer.appendChild(toast);
        
        setTimeout(() => toast.classList.add('show'), 10);
        setTimeout(() => {
            toast.classList.remove('show');
            setTimeout(() => toast.remove(), 300);
        }, duration);
    }

    showError(message) {
        this.showToast('error', 'Ошибка', message);
    }
}

// Global functions
function goBack() {
    window.location.href = 'index.html';
}

function decreaseBet() {
    window.plinkoGame.decreaseBet();
}

function increaseBet() {
    window.plinkoGame.increaseBet();
}

function validateBetAmount() {
    window.plinkoGame.validateBetAmount();
}

async function openDepositModal() {
    document.getElementById('deposit-modal').style.display = 'block';
}

function closeDepositModal() {
    document.getElementById('deposit-modal').style.display = 'none';
    document.getElementById('deposit-amount').value = '';
}

async function processDeposit() {
    const amount = parseFloat(document.getElementById('deposit-amount').value);
    
    if (!amount || amount < 1) {
        alert('Минимальный депозит: 1 TON');
        return;
    }

    try {
        const response = await fetch('/api/create-invoice', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                telegramId: window.plinkoGame.currentUser.id,
                amount: amount,
                demoMode: window.plinkoGame.isDemoMode
            })
        });

        const result = await response.json();
        
        if (result.success) {
            if (window.plinkoGame.isDemoMode) {
                await window.plinkoGame.loadUserData();
                alert(`Демо-депозит ${amount} TON успешно зачислен!`);
            } else {
                window.open(result.invoice_url, '_blank');
                alert(`Откройте Crypto Bot для оплаты ${amount} TON`);
            }
            
            closeDepositModal();
        } else {
            alert('Ошибка при создании депозита: ' + result.error);
        }
    } catch (error) {
        console.error('Deposit error:', error);
        alert('Ошибка при создании депозита');
    }
}

// Функция смены режима сложности
function changeDifficulty(difficulty) {
    if (window.plinkoGame) {
        window.plinkoGame.difficultyMode = difficulty;
        
        document.querySelectorAll('.difficulty-btn').forEach(btn => {
            btn.classList.remove('active');
            if (btn.getAttribute('data-difficulty') === difficulty) {
                btn.classList.add('active');
            }
        });
        
        window.plinkoGame.createSlots();
        
        console.log(`🎯 Режим изменен на: ${difficulty}`);
    }
}

window.onclick = function(event) {
    const modal = document.getElementById('deposit-modal');
    if (event.target === modal) {
        closeDepositModal();
    }
}

// 🔥 CSS ДЛЯ УВЕДОМЛЕНИЙ О БОЛЬШИХ ВЫИГРЫШАХ
const bigWinCSS = `
.big-win-notification {
    position: fixed;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%) scale(0.5);
    background: linear-gradient(135deg, #ffd700, #ff6b00);
    border: 3px solid #ffeb3b;
    border-radius: 20px;
    padding: 20px;
    color: #000;
    font-weight: bold;
    text-align: center;
    z-index: 10000;
    opacity: 0;
    transition: all 0.5s cubic-bezier(0.68, -0.55, 0.265, 1.55);
    box-shadow: 0 0 50px rgba(255, 215, 0, 0.8);
}

.big-win-notification.show {
    opacity: 1;
    transform: translate(-50%, -50%) scale(1);
}

.big-win-content {
    display: flex;
    align-items: center;
    gap: 15px;
}

.big-win-icon {
    font-size: 3em;
    animation: bounce 0.5s infinite alternate;
}

.big-win-text {
    text-align: left;
}

.big-win-title {
    font-size: 1.2em;
    margin-bottom: 5px;
}

.big-win-multiplier {
    font-size: 2em;
    color: #e91e63;
    text-shadow: 2px 2px 4px rgba(0,0,0,0.3);
}

.big-win-amount {
    font-size: 1.5em;
    color: #4caf50;
}

@keyframes bounce {
    from { transform: scale(1); }
    to { transform: scale(1.2); }
}
`;

// Добавляем стили в документ
const style = document.createElement('style');
style.textContent = bigWinCSS;
document.head.appendChild(style);

window.addEventListener('load', () => {
    window.plinkoGame = new PlinkoGame();
});