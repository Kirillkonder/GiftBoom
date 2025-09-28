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
        this.gravity = 0.8; // Увеличил гравитацию
        this.bounce = 0.65; // Меньше отскок - более реалистично
        this.friction = 0.985; // Меньше трение - больше движения

        // 🔥 СИСТЕМА СЛУЧАЙНЫХ БОЛЬШИХ ВЫИГРЫШЕЙ
        this.ballsDropped = 0;
        this.bigWinCounter = 0;
        this.nextBigWinAt = Math.floor(Math.random() * 15) + 10; // 10-25 шаров
        this.consecutiveSmallWins = 0;

        this.setupEventListeners();
        this.createPegs();
        this.createSlots();
        this.initializeUser();
        this.gameLoop();
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

    // 🔥 ФИЗИКА С ВЫСОКОЙ СЛУЧАЙНОСТЬЮ КАК В 1WIN
    updateBall() {
        for (let i = this.activeBalls.length - 1; i >= 0; i--) {
            const ball = this.activeBalls[i];

            // Удаление старых шаров
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
            ball.vx += (Math.random() - 0.5) * 0.8; // Увеличил случайность
            ball.vy += (Math.random() - 0.5) * 0.3;
            
            ball.x += ball.vx;
            ball.y += ball.vy;
            ball.vx *= this.friction;
            ball.vy *= this.friction;

            // 🔥 ХАОТИЧЕСКОЕ ДВИЖЕНИЕ - ШАРИК МОЖЕТ ПОЛЕТЕТЬ КУДА УГОДНО
            if (Math.random() < 0.3) { // 30% шанс на резкое изменение траектории
                ball.vx += (Math.random() - 0.5) * 4;
                ball.vy += (Math.random() - 0.3) * 2;
            }

            // Столкновения со стенами
            if (ball.x - ball.radius < 0 || ball.x + ball.radius > this.canvas.width) {
                ball.vx *= -this.bounce;
                // 🔥 СЛУЧАЙНЫЙ ОТСКОК ОТ СТЕНОК
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
                    
                    // 🔥 СЛУЧАЙНЫЙ УГОЛ ОТСКОКА КАК В 1WIN
                    const randomBounce = angle + (Math.random() - 0.5) * 1.0; // Увеличил разброс
                    
                    ball.vx = Math.cos(randomBounce) * speed * this.bounce;
                    ball.vy = Math.sin(randomBounce) * speed * this.bounce;
                    
                    // 🔥 ДОПОЛНИТЕЛЬНЫЙ СЛУЧАЙНЫЙ ИМПУЛЬС
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
                
                // Проверяем, не пришло ли время для большого выигрыша
                if (this.ballsDropped >= this.nextBigWinAt) {
                    this.bigWinCounter = 1 + Math.floor(Math.random() * 2); // 1-2 больших выигрыша
                    this.nextBigWinAt = this.ballsDropped + Math.floor(Math.random() * 20) + 15; // 15-35 шаров
                    console.log(`🎰 АКТИВИРОВАН БОЛЬШОЙ ВЫИГРЫШ! Осталось: ${this.bigWinCounter}`);
                }

                const finalMultiplier = this.generatePlinkoResult();
                
                // Находим ближайший слот по множителю
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
                
                // 🔥 УВЕДОМЛЕНИЕ О БОЛЬШОМ ВЫИГРЫШЕ
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

    // Остальные методы остаются без изменений...
    createPegs() {
        const rows = 12; // Увеличил количество рядов для большей случайности
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
                // 🔥 СЛУЧАЙНОЕ СМЕЩЕНИЕ КОЛЫШКОВ ДЛЯ БОЛЬШЕГО ХАОСА
                const randomOffset = (Math.random() - 0.5) * 8;
                this.pegs.push({
                    x: startX + i * rowSpacing + randomOffset,
                    y: verticalSpacing * (row + 2) + (Math.random() - 0.5) * 5,
                    radius: this.pegRadius
                });
            }
        }
    }

    // ... остальной код без изменений
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