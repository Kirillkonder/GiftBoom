// 🔥 ИЗМЕНЕННАЯ ФИЗИКА PLINKO: 
// 85% шанс попадания в слоты с множителями 0.8x и 0.4x
// 15% шанс попадания в слоты с множителями 2.2x и 5.8x

class PlinkoGame {
    constructor() {
        // Game state
        this.currentUser = null;
        this.isDemoMode = false;
        this.currentBet = 0.1;
        this.balance = 0;
        
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

        // Initialize
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

    createPegs() {
        const rows = 10;
        const spacing = this.canvas.height / (rows + 2);
        const horizontalSpacing = this.canvas.width / (rows + 1);

        for (let row = 0; row < rows; row++) {
            const pegsInRow = row + 3;
            const startX = (this.canvas.width - (pegsInRow - 1) * horizontalSpacing) / 2;

            for (let i = 0; i < pegsInRow; i++) {
                this.pegs.push({
                    x: startX + i * horizontalSpacing,
                    y: spacing * (row + 2),
                    radius: this.pegRadius
                });
            }
        }
    }

   createSlots() {
    const slotCount = 7;
    const slotWidth = this.canvas.width / slotCount;
    
    // Множители: БОЛЬШИЕ по краям (5.8x), МАЛЕНЬКИЕ в центре (0.4x)
    const multipliers = [5.8, 2.2, 0.8, 0.4, 0.8, 2.2, 5.8];
    
    for (let i = 0; i < slotCount; i++) {
        this.slots.push({
            x: i * slotWidth,
            width: slotWidth,
            multiplier: multipliers[i],
            index: i
        });
    }
    
    console.log('🎯 Слоты созданы:', this.slots.map(s => `${s.multiplier}x`).join(' | '));
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
                    demoMode: this.isDemoMode
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
                
                // Create ball
                const ball = {
                    x: Math.max(this.ballRadius, Math.min(x, this.canvas.width - this.ballRadius)),
                    y: this.ballRadius,
                    vx: (Math.random() - 0.5) * 2,
                    vy: 0,
                    radius: this.ballRadius,
                    bet: this.currentBet,
                    gameId: result.game_id,
                    isFinished: false,
                    finishedAt: 0,
                    createdAt: Date.now() // 🔥 ДОБАВЛЕНО: Время создания шарика
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

    async handleBallInSlot(ball, slotIndex) {
        try {
            // 🔥 ТОЧНОЕ ОПРЕДЕЛЕНИЕ СЛОТА И МНОЖИТЕЛЯ
            const slotWidth = this.canvas.width / this.slots.length;
            const ballCenterX = ball.x;
            const calculatedSlotIndex = Math.floor(ballCenterX / slotWidth);
            const finalSlotIndex = Math.max(0, Math.min(this.slots.length - 1, calculatedSlotIndex));
            
            const realMultiplier = this.slots[finalSlotIndex].multiplier;
            
            console.log(`🎯 Шарик упал в слот ${finalSlotIndex}, множитель: ${realMultiplier}x`);

            const response = await fetch('/api/plinko/drop', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    gameId: ball.gameId,
                    telegramId: this.currentUser.id,
                    finalSlot: finalSlotIndex,
                    realMultiplier: realMultiplier
                })
            });

            if (!response.ok) {
                throw new Error('Ошибка при обработке выигрыша');
            }

            const result = await response.json();
            
            if (result.success) {
                // 🔥 ОБНОВЛЯЕМ БАЛАНС ПОСЛЕ ВЫИГРЫША
                this.balance = result.new_balance;
                this.updateUI();
            }
        } catch (error) {
            console.error('Handle ball error:', error);
        }
    }

   updateBall() {
    for (let i = this.activeBalls.length - 1; i >= 0; i--) {
        const ball = this.activeBalls[i];

        // 🔥 УЛУЧШЕННОЕ ИСПРАВЛЕНИЕ: Если шарик завершен более 300мс назад ИЛИ висит слишком долго - удаляем
        const currentTime = Date.now();
        const ballLifetime = currentTime - (ball.createdAt || currentTime);
        const isStuckBall = ballLifetime > 10000; // Шарик висит более 10 секунд
        const isSlowBall = ball.y > this.canvas.height * 0.9 && Math.abs(ball.vy) < 0.1 && ballLifetime > 3000; // Медленный шарик внизу
        
        if ((ball.isFinished && currentTime - ball.finishedAt > 300) || isStuckBall || isSlowBall) {
            if (isStuckBall) {
                console.log(`🔄 Удаляем зависший шарик (${ballLifetime}ms)`);
            }
            if (isSlowBall) {
                console.log(`🔄 Удаляем медленный шарик (${ballLifetime}ms, y:${ball.y.toFixed(1)}, vy:${ball.vy.toFixed(3)})`);
            }
            this.activeBalls.splice(i, 1);
            continue;
        }

        // 🔥 ПРОВЕРКА: Если шарик уже завершен, пропускаем физику
        if (ball.isFinished) {
            continue;
        }

        // Apply physics с улучшениями
        ball.vy += this.gravity;
        ball.x += ball.vx;
        ball.y += ball.vy;
        ball.vx *= this.friction;
        ball.vy *= this.friction;
        
        // 🔥 ПРЕДОТВРАЩЕНИЕ ЗАВИСАНИЯ: Минимальная скорость вниз
        if (ball.y > this.canvas.height * 0.5 && Math.abs(ball.vy) < 0.3) {
            ball.vy = Math.max(ball.vy, 0.3);
        }

        // 🔥 УЛУЧШЕННАЯ ФИЗИКА: Более естественное притяжение
        // Притяжение работает когда шар ниже 50% высоты поля (было 30%)
        if (ball.y > this.canvas.height * 0.5) {
            const slotWidth = this.canvas.width / 7;
            const lowMultiplierSlots = [2, 3, 4]; // Слоты с низкими множителями
            const highMultiplierSlots = [0, 1, 5, 6]; // Слоты с высокими множителями
            
            // Определяем тип шарика (только один раз)
            if (!ball.hasOwnProperty('isHighMultiplier')) {
                ball.isHighMultiplier = Math.random() < 0.15; // 15% шанс на высокий множитель
                console.log(`🎯 Шарик создан: ${ball.isHighMultiplier ? 'высокий' : 'низкий'} множитель`);
            }
            
            let targetSlot;
            if (ball.isHighMultiplier) {
                // Для высоких множителей - случайный выбор из доступных слотов
                targetSlot = highMultiplierSlots[Math.floor(Math.random() * highMultiplierSlots.length)];
            } else {
                // Для низких множителей - находим ближайший низкий слот
                let minDistance = Infinity;
                targetSlot = 3; // По умолчанию центральный слот
                
                lowMultiplierSlots.forEach(slotIndex => {
                    const slotCenterX = (slotIndex + 0.5) * slotWidth;
                    const distance = Math.abs(ball.x - slotCenterX);
                    if (distance < minDistance) {
                        minDistance = distance;
                        targetSlot = slotIndex;
                    }
                });
            }
            
            const targetX = (targetSlot + 0.5) * slotWidth;
            const distanceToTarget = Math.abs(ball.x - targetX);
            
            // 🔥 УМЕНЬШЕННАЯ СИЛА ПРИТЯЖЕНИЯ для более естественного движения
            if (distanceToTarget > 5) {
                // Высота влияет на силу притяжения (чем ниже, тем сильнее)
                const heightFactor = Math.min(1.0, (ball.y - this.canvas.height * 0.5) / (this.canvas.height * 0.4));
                
                // СИЛА ПРИТЯЖЕНИЯ УМЕНЬШЕНА В 2-3 РАЗА
                const basePullStrength = ball.isHighMultiplier ? 0.002 : 0.003; // Было 0.004 и 0.007
                const distanceFactor = (distanceToTarget / this.canvas.width) * (ball.isHighMultiplier ? 0.004 : 0.006); // Уменьшено
                const pullStrength = (basePullStrength + distanceFactor) * (1 + heightFactor * (ball.isHighMultiplier ? 1 : 2)); // Уменьшено
                
                const pullDirection = targetX - ball.x;
                ball.vx += pullDirection * pullStrength;
                
                // СЛАБОЕ вертикальное притяжение
                ball.vy += (ball.isHighMultiplier ? 0.008 : 0.012) * heightFactor; // Уменьшено
            }
            
            // 🔥 УМЕНЬШЕННАЯ коррекция в нижней части
            if (ball.y > this.canvas.height * 0.8) { // Было 0.7
                const finalPullStrength = ball.isHighMultiplier ? 0.006 : 0.009; // Уменьшено
                const finalPullDirection = targetX - ball.x;
                ball.vx += finalPullDirection * finalPullStrength;
                
                // Меньшее замедление
                if (Math.abs(ball.x - targetX) > slotWidth * 0.4) { // Увеличена граница
                    ball.vx *= ball.isHighMultiplier ? 0.95 : 0.92; // Меньшее замедление
                }
            }
            
            // 🔥 УМЕНЬШЕННАЯ Финальная коррекция
            if (ball.y > this.canvas.height * 0.9) { // Было 0.85
                const criticalPullStrength = ball.isHighMultiplier ? 0.010 : 0.015; // Уменьшено
                const criticalPullDirection = targetX - ball.x;
                ball.vx += criticalPullDirection * criticalPullStrength;
                
                // Менее агрессивная коррекция
                if (Math.abs(ball.x - targetX) > slotWidth * 0.3) { // Увеличена граница
                    ball.vx = (targetX - ball.x) * (ball.isHighMultiplier ? 0.05 : 0.07); // Уменьшено
                }
            }
        }

        // Wall collisions
        if (ball.x - ball.radius < 0 || ball.x + ball.radius > this.canvas.width) {
            ball.vx *= -this.bounce;
            ball.x = ball.x - ball.radius < 0 ? ball.radius : this.canvas.width - ball.radius;
        }

        // Peg collisions
        this.pegs.forEach(peg => {
            const dx = ball.x - peg.x;
            const dy = ball.y - peg.y;
            const distance = Math.sqrt(dx * dx + dy * dy);
            
            if (distance < ball.radius + peg.radius) {
                const angle = Math.atan2(dy, dx);
                const speed = Math.sqrt(ball.vx * ball.vx + ball.vy * ball.vy);
                
                const randomAngle = angle + (Math.random() - 0.5) * 0.1;
                
                ball.vx = Math.cos(randomAngle) * speed * this.bounce;
                ball.vy = Math.sin(randomAngle) * speed * this.bounce;
                
                const minDistance = ball.radius + peg.radius;
                ball.x = peg.x + Math.cos(angle) * minDistance;
                ball.y = peg.y + Math.sin(angle) * minDistance;
            }
        });

        // 🔥 ИСПРАВЛЕННАЯ ЛОГИКА: Check if ball reached bottom
        const bottomThreshold = this.canvas.height - 15;
        const isAtBottom = ball.y + ball.radius > bottomThreshold;
        
        if (isAtBottom && !ball.isFinished) {
            // Помечаем шарик как завершенный ДО обработки
            ball.isFinished = true;
            ball.finishedAt = Date.now();
            
            const slotWidth = this.canvas.width / this.slots.length;
            const ballCenterX = ball.x;
            const slotIndex = Math.floor(ballCenterX / slotWidth);
            const finalSlotIndex = Math.max(0, Math.min(this.slots.length - 1, slotIndex));
            
            console.log(`🎯 Шарик упал в позицию X: ${ballCenterX.toFixed(1)}, слот: ${finalSlotIndex}`);
            
            // Обрабатываем результат с задержкой для анимации
            setTimeout(() => {
                this.handleBallInSlot(ball, finalSlotIndex);
            }, 100);
        }
    }
}

    drawGame() {
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

        // Draw pegs
        this.pegs.forEach(peg => {
            this.ctx.beginPath();
            this.ctx.arc(peg.x, peg.y, peg.radius, 0, Math.PI * 2);
            this.ctx.fillStyle = 'rgba(255, 255, 255, 0.3)';
            this.ctx.fill();
        });

        // Draw balls
        this.activeBalls.forEach(ball => {
            // 🔥 НЕ РИСУЕМ ЗАВЕРШЕННЫЕ ШАРИКИ
            if (ball.isFinished) return;
            
            this.ctx.beginPath();
            this.ctx.arc(ball.x, ball.y, ball.radius, 0, Math.PI * 2);
            this.ctx.fillStyle = '#1e5cb8';
            this.ctx.fill();
            
            // Add glow
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
        document.getElementById('currentBet').textContent = this.currentBet.toFixed(1) + ' TON';
        
        // Update bet amount input
        document.getElementById('betAmount').value = this.currentBet.toFixed(1);

        // Enable/disable drop button
        const dropButton = document.getElementById('dropBall');
        dropButton.disabled = this.currentBet === 0 || this.currentBet > this.balance;
        
        // Обновляем стиль кнопки в зависимости от состояния
        if (this.currentBet > this.balance) {
            dropButton.style.background = 'linear-gradient(135deg, #ff4757, #ff6b81)';
            dropButton.textContent = 'Недостаточно средств';
        } else {
            dropButton.style.background = 'linear-gradient(135deg, #1e5cb8, #2668b3)';
            dropButton.textContent = 'Бросить шар';
        }
    }

    // Bet controls
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

    // Notification system - оставил только ошибку "Недостаточно средств"
    showToast(type, title, message, duration = 3000) {
        // 🔥 УБРАЛ ВСЕ УВЕДОМЛЕНИЯ КРОМЕ ОШИБОК
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
    // 🔥 ИСПРАВЛЕНО: Перенаправляем на главную страницу как в ракетке
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

// Deposit functions (from rocket.js)
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
                // Обновляем баланс после демо-депозита
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

// Initialize game when page loads
window.addEventListener('load', () => {
    window.plinkoGame = new PlinkoGame();
});

// Close modal when clicking outside
window.onclick = function(event) {
    const modal = document.getElementById('deposit-modal');
    if (event.target === modal) {
        closeDepositModal();
    }
}