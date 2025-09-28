// 🔥 ИЗМЕНЕННАЯ ФИЗИКА PLINKO: 
// 100% притяжение к маленьким множителям (0.4x и 0.8x)

class PlinkoGame {
    constructor() {
        // Game state
        this.currentUser = null;
        this.isDemoMode = false;
        this.currentBet = 0.1;
        this.balance = 0;
        this.difficultyMode = 'easy'; // легкий, средний, сложный
        
        // Canvas setup
        this.canvas = document.getElementById('gameCanvas');
        this.ctx = this.canvas.getContext('2d');
        this.resizeCanvas();

        // Game elements
        this.activeBalls = [];
        this.pegs = [];
        this.slots = [];

        // Physics
        this.gravity = 0.6;
        this.bounce = 0.7;
        this.friction = 0.99;

        // 🔥 ОБНОВЛЕННАЯ СИСТЕМА: Притяжение к маленьким множителям + 2 случайных шара
        this.ballsDropped = 0;
        this.nextRandomBallsAt = Math.floor(Math.random() * 26) + 25; // 25-50 шаров
        this.randomBallsRemaining = 0;
        this.randomBallsActive = 0;

        // Initialize
        this.setupEventListeners();
        this.createPegs();
        this.createSlots();
        this.initializeUser();
        this.setupGiftBoom();
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

        // Drop ball on canvas click
        this.canvas.addEventListener('click', (e) => {
            if (this.currentBet > 0 && this.balance >= this.currentBet) {
                const rect = this.canvas.getBoundingClientRect();
                const x = e.clientX - rect.left;
                this.dropBallAt(x);
            } else {
                this.showError('Недостаточно средств');
            }
        });
    }

    setupGiftBoom() {
        const giftBoomBall = document.getElementById('giftboomBall');
        if (giftBoomBall) {
            giftBoomBall.addEventListener('click', () => {
                this.dropBallFromGiftBoom();
            });
        }
    }

    dropBallFromGiftBoom() {
        if (this.currentBet > 0 && this.balance >= this.currentBet) {
            const centerX = this.canvas.width / 2;
            this.dropBallAt(centerX);
        } else {
            this.showError('Недостаточно средств');
        }
    }

    createPegs() {
        const rows = 10;
        const verticalSpacing = this.canvas.height / (rows + 2);

        // Базовый горизонтальный шаг как раньше — сохраняем общий вид
        const baseHorizontalSpacing = this.canvas.width / (rows + 1);
        const sideMargin = this.pegRadius + 2; // безопасный отступ, чтобы крайние колышки были полностью видны

        for (let row = 0; row < rows; row++) {
            const pegsInRow = row + 3;

            // Ширина ряда при базовом шаге
            let rowSpacing = baseHorizontalSpacing;
            let rowWidth = (pegsInRow - 1) * rowSpacing;

            // Максимальная ширина ряда с учётом отступов
            const maxRowWidth = this.canvas.width - sideMargin * 2;

            // Если ряд слишком широкый (актуально для нижних рядов), слегка уменьшаем шаг
            if (rowWidth > maxRowWidth) {
                rowSpacing = maxRowWidth / (pegsInRow - 1);
                rowWidth = maxRowWidth;
            }

            const startX = (this.canvas.width - rowWidth) / 2; // остаётся по центру

            for (let i = 0; i < pegsInRow; i++) {
                this.pegs.push({
                    x: startX + i * rowSpacing,
                    y: verticalSpacing * (row + 2),
                    radius: this.pegRadius
                });
            }
        }
    }

   createSlots() {
    const slotCount = 7;
    // 🔥 ИСПРАВЛЕНИЕ: Добавляем отступы с краев для полного отображения слотов
    const sideMargin = 10; // отступ с каждой стороны
    const availableWidth = this.canvas.width - (sideMargin * 2);
    const slotWidth = availableWidth / slotCount;
    
    // Множители по режимам сложности
    const multipliersByDifficulty = {
        easy: [5.8, 2.2, 0.8, 0.4, 0.8, 2.2, 5.8],    // Легкий (текущий)
        medium: [8.4, 4.7, 0.5, 0.2, 0.5, 4.7, 8.4],  // Средний
        hard: [15.6, 8.7, 0.2, 0.1, 0.2, 8.7, 15.6]   // Сложный
    };
    
    const multipliers = multipliersByDifficulty[this.difficultyMode];
    
    this.slots = [];
    for (let i = 0; i < slotCount; i++) {
        this.slots.push({
            x: sideMargin + (i * slotWidth), // 🔥 ИСПРАВЛЕНИЕ: Учитываем отступ слева
            width: slotWidth,
            multiplier: multipliers[i],
            index: i
        });
    }
    
    // Обновляем слоты в HTML
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
                
                // 🔥 ОБНОВЛЯЕМ ЦВЕТА В РЕАЛЬНОМ ВРЕМЕНИ
                // Удаляем все цветовые классы
                slotElements[index].className = 'slot';
                
                // Добавляем соответствующий цвет в зависимости от множителя
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
            // 🔥 ПРОВЕРКА БАЛАНСА ПЕРЕД СТАВКОЙ
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
                // Обновляем баланс сразу после ставки
                this.balance = result.new_balance;
                this.updateUI();
                
                // 🔥 ОБНОВЛЯЕМ СИСТЕМУ СЛУЧАЙНЫХ ШАРОВ
                this.ballsDropped++;
                
                // Проверяем, нужно ли сделать этот шар случайным
                let isRandomBall = false;
                if (this.ballsDropped >= this.nextRandomBallsAt && this.randomBallsRemaining > 0) {
                    isRandomBall = true;
                    this.randomBallsRemaining--;
                    this.randomBallsActive++;
                    console.log(`🎲 Случайный шар активирован! Осталось: ${this.randomBallsRemaining}`);
                }
                
                // Создаем шар с учетом случайности
                this.createBall(x, result.ball_id, isRandomBall);
                
                // Если случайные шары закончились, планируем следующий набор
                if (this.randomBallsRemaining === 0 && this.randomBallsActive === 0) {
                    this.nextRandomBallsAt = this.ballsDropped + Math.floor(Math.random() * 26) + 25; // 25-50 шаров
                    this.randomBallsRemaining = 2;
                    console.log(`🎯 Следующие случайные шары через ${this.nextRandomBallsAt - this.ballsDropped} шаров`);
                }
                
            } else {
                throw new Error(result.error || 'Ошибка при размещении ставки');
            }

        } catch (error) {
            console.error('Error dropping ball:', error);
            this.showError(error.message);
        }
    }

    createBall(startX, ballId, isRandomBall = false) {
        const ball = {
            id: ballId,
            x: startX,
            y: 0,
            radius: this.ballRadius,
            velocityX: 0,
            velocityY: 0,
            isDropping: true,
            multiplier: null,
            color: isRandomBall ? '#FFD700' : '#1e5cb8', // Золотой для случайных шаров
            isRandomBall: isRandomBall,
            hasLanded: false
        };

        this.activeBalls.push(ball);
        return ball;
    }

    updateBall(ball) {
        if (!ball.isDropping) return;

        // Apply gravity
        ball.velocityY += this.gravity;

        // Apply velocity
        ball.x += ball.velocityX;
        ball.y += ball.velocityY;

        // Apply friction
        ball.velocityX *= this.friction;
        ball.velocityY *= this.friction;

        // Check peg collisions
        this.checkPegCollisions(ball);

        // Check wall collisions
        this.checkWallCollisions(ball);

        // Check slot landing
        this.checkSlotLanding(ball);

        // Remove balls that fall off screen
        if (ball.y > this.canvas.height + 50) {
            ball.isDropping = false;
            this.activeBalls = this.activeBalls.filter(b => b !== ball);
        }
    }

    checkPegCollisions(ball) {
        for (const peg of this.pegs) {
            const dx = ball.x - peg.x;
            const dy = ball.y - peg.y;
            const distance = Math.sqrt(dx * dx + dy * dy);

            if (distance < ball.radius + peg.radius) {
                // Collision response
                const angle = Math.atan2(dy, dx);
                const targetX = peg.x + Math.cos(angle) * (ball.radius + peg.radius);
                const targetY = peg.y + Math.sin(angle) * (ball.radius + peg.radius);

                ball.x = targetX;
                ball.y = targetY;

                // 🔥 ИЗМЕНЕННАЯ ФИЗИКА: 85% шанс притяжения к маленьким множителям
                // Если это не случайный шар, применяем притяжение к маленьким множителям
                if (!ball.isRandomBall) {
                    // 85% шанс притяжения к маленьким множителям (0.4x и 0.8x)
                    if (Math.random() < 0.85) {
                        // Определяем направление к центральным слотам (индексы 2, 3, 4)
                        const centerX = this.canvas.width / 2;
                        const direction = centerX - ball.x > 0 ? 1 : -1;
                        
                        // Добавляем небольшое притяжение к центру
                        ball.velocityX += direction * 0.3;
                    } else {
                        // 15% шанс движения к большим множителям
                        const direction = Math.random() > 0.5 ? 1 : -1;
                        ball.velocityX += direction * 0.5;
                    }
                } else {
                    // 🔥 СЛУЧАЙНЫЕ ШАРЫ: Полностью случайное движение
                    ball.velocityX += (Math.random() - 0.5) * 2;
                }

                // Normal bounce physics
                const normalX = dx / distance;
                const normalY = dy / distance;
                const dotProduct = ball.velocityX * normalX + ball.velocityY * normalY;

                ball.velocityX = (ball.velocityX - 2 * dotProduct * normalX) * this.bounce;
                ball.velocityY = (ball.velocityY - 2 * dotProduct * normalY) * this.bounce;

                // Add some randomness
                ball.velocityX += (Math.random() - 0.5) * 0.5;
            }
        }
    }

    checkWallCollisions(ball) {
        // Left wall
        if (ball.x - ball.radius < 0) {
            ball.x = ball.radius;
            ball.velocityX = Math.abs(ball.velocityX) * this.bounce;
        }
        // Right wall
        if (ball.x + ball.radius > this.canvas.width) {
            ball.x = this.canvas.width - ball.radius;
            ball.velocityX = -Math.abs(ball.velocityX) * this.bounce;
        }
    }

    checkSlotLanding(ball) {
        if (ball.y + ball.radius >= this.canvas.height - 20 && !ball.hasLanded) {
            for (const slot of this.slots) {
                if (ball.x >= slot.x && ball.x <= slot.x + slot.width) {
                    ball.isDropping = false;
                    ball.hasLanded = true;
                    ball.multiplier = slot.multiplier;
                    
                    // 🔥 ОБНОВЛЯЕМ СТАТУС СЛУЧАЙНЫХ ШАРОВ
                    if (ball.isRandomBall) {
                        this.randomBallsActive--;
                        console.log(`🎲 Случайный шар приземлился! Активных: ${this.randomBallsActive}`);
                    }
                    
                    this.processBallResult(ball);
                    break;
                }
            }
        }
    }

    async processBallResult(ball) {
        try {
            const response = await fetch('/api/plinko/result', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    ballId: ball.id,
                    multiplier: ball.multiplier,
                    demoMode: this.isDemoMode
                })
            });

            if (response.ok) {
                const result = await response.json();
                if (result.success) {
                    this.balance = result.new_balance;
                    this.updateUI();
                    
                    // Show win notification for wins
                    if (ball.multiplier > 1) {
                        this.showWinNotification(ball.multiplier);
                    }
                }
            }
        } catch (error) {
            console.error('Error processing ball result:', error);
        }

        // Remove ball after delay
        setTimeout(() => {
            this.activeBalls = this.activeBalls.filter(b => b !== ball);
        }, 2000);
    }

    draw() {
        // Clear canvas
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

        // Draw pegs
        this.ctx.fillStyle = 'rgba(255, 255, 255, 0.3)';
        for (const peg of this.pegs) {
            this.ctx.beginPath();
            this.ctx.arc(peg.x, peg.y, peg.radius, 0, Math.PI * 2);
            this.ctx.fill();
        }

        // Draw slots
        for (const slot of this.slots) {
            this.ctx.fillStyle = 'rgba(255, 255, 255, 0.1)';
            this.ctx.fillRect(slot.x, this.canvas.height - 20, slot.width, 20);
        }

        // Draw balls
        for (const ball of this.activeBalls) {
            this.ctx.fillStyle = ball.color;
            this.ctx.beginPath();
            this.ctx.arc(ball.x, ball.y, ball.radius, 0, Math.PI * 2);
            this.ctx.fill();

            // Add glow effect for random balls
            if (ball.isRandomBall) {
                this.ctx.shadowColor = '#FFD700';
                this.ctx.shadowBlur = 15;
                this.ctx.fill();
                this.ctx.shadowBlur = 0;
            }

            // Draw multiplier if ball has landed
            if (ball.multiplier) {
                this.ctx.fillStyle = '#fff';
                this.ctx.font = '12px Arial';
                this.ctx.textAlign = 'center';
                this.ctx.fillText(
                    `${ball.multiplier}x`, 
                    ball.x, 
                    ball.y - ball.radius - 5
                );
            }
        }
    }

    gameLoop() {
        for (const ball of this.activeBalls) {
            this.updateBall(ball);
        }
        this.draw();
        requestAnimationFrame(() => this.gameLoop());
    }

    updateUI() {
        document.getElementById('balance').textContent = this.balance.toFixed(2);
        document.getElementById('betAmount').value = this.currentBet;
    }

    showError(message) {
        this.showToast(message, 'error');
    }

    showWinNotification(multiplier) {
        this.showToast(`🎉 Вы выиграли ${multiplier}x!`, 'success');
    }

    showToast(message, type = 'info') {
        const toast = document.createElement('div');
        toast.className = `toast ${type}`;
        toast.textContent = message;
        
        const container = document.getElementById('toast-container');
        container.appendChild(toast);
        
        setTimeout(() => toast.classList.add('show'), 100);
        setTimeout(() => {
            toast.classList.remove('show');
            setTimeout(() => container.removeChild(toast), 300);
        }, 3000);
    }

    changeDifficulty(mode) {
        this.difficultyMode = mode;
        
        // Update UI
        document.querySelectorAll('.difficulty-btn').forEach(btn => {
            btn.classList.remove('active');
        });
        document.querySelector(`[data-difficulty="${mode}"]`).classList.add('active');
        
        // Recreate slots with new multipliers
        this.createSlots();
        
        console.log(`🎯 Режим сложности изменен на: ${mode}`);
    }
}

// Global functions for UI interactions
function goBack() {
    window.history.back();
}

function openDepositModal() {
    document.getElementById('deposit-modal').style.display = 'block';
}

function closeDepositModal() {
    document.getElementById('deposit-modal').style.display = 'none';
}

function processDeposit() {
    const amount = parseFloat(document.getElementById('deposit-amount').value);
    if (amount && amount > 0) {
        // Здесь будет логика пополнения через Crypto Pay
        alert(`Пополнение на ${amount} TON будет обработано через Crypto Pay`);
        closeDepositModal();
    } else {
        alert('Введите корректную сумму');
    }
}

function changeDifficulty(mode) {
    if (window.plinkoGame) {
        window.plinkoGame.changeDifficulty(mode);
    }
}

function decreaseBet() {
    if (window.plinkoGame) {
        window.plinkoGame.currentBet = Math.max(0.1, window.plinkoGame.currentBet - 0.1);
        window.plinkoGame.updateUI();
    }
}

function increaseBet() {
    if (window.plinkoGame) {
        window.plinkoGame.currentBet = Math.min(100, window.plinkoGame.currentBet + 0.1);
        window.plinkoGame.updateUI();
    }
}

function validateBetAmount() {
    if (window.plinkoGame) {
        const input = document.getElementById('betAmount');
        let value = parseFloat(input.value);
        if (isNaN(value) || value < 0.1) value = 0.1;
        if (value > 100) value = 100;
        window.plinkoGame.currentBet = parseFloat(value.toFixed(1));
        window.plinkoGame.updateUI();
    }
}

// Initialize game when page loads
window.addEventListener('load', () => {
    window.plinkoGame = new PlinkoGame();
});

// Close modal when clicking outside
window.addEventListener('click', (e) => {
    const modal = document.getElementById('deposit-modal');
    if (e.target === modal) {
        closeDepositModal();
    }
});