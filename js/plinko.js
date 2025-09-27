// 🔥 УЛУЧШЕННАЯ ФИЗИКА PLINKO: 
// 80% шанс попадания в слоты с множителями 0.8x и 0.4x
// 20% шанс попадания в слоты с множителями 2.2x и 5.8x

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

        // 🔥 NEW PHYSICS CYCLE SYSTEM
        this.physicsState = {
            totalBallsDropped: 0,
            ballsInCurrentCycle: 0,
            bigMultiplierHits: 0,
            cyclePhase: 'small_attraction', // Начинаем с притяжения к маленьким
            bigWindowSize: 3 // По умолчанию 3 шарика в окне больших
        };

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

                // 🔥 UPDATE PHYSICS CYCLE BEFORE ADDING BALL
                this.updatePhysicsCycle();
                
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

    // 🔥 NEW METHOD: Assign ball type based on physics cycle
    assignBallType(ball) {
    console.log(`🎮 Cycle Status: Phase=${this.physicsState.cyclePhase}, Balls=${this.physicsState.ballsInCurrentCycle}, BigHits=${this.physicsState.bigMultiplierHits}`);
    
    if (this.physicsState.cyclePhase === 'small_attraction') {
        // В фазе притяжения к маленьким множителям (30 шариков)
        ball.multiplierType = 'small_attraction';
        console.log(`🔻 Шарик ${this.physicsState.ballsInCurrentCycle}/30 - притяжение к маленьким множителям`);
    } else if (this.physicsState.cyclePhase === 'big_window') {
        // В окне больших множителей (1-5 шариков)
        ball.multiplierType = 'big_opportunity';
        console.log(`🔺 Шарик ${this.physicsState.ballsInCurrentCycle}/${this.physicsState.bigWindowSize} - окно больших множителей`);
    }
}

    // 🔥 NEW METHOD: Update physics cycle state
    updatePhysicsCycle() {
    this.physicsState.totalBallsDropped++;
    
    if (this.physicsState.cyclePhase === 'small_attraction') {
        this.physicsState.ballsInCurrentCycle++;
        
        // После 30 шариков переходим к большим множителям
        if (this.physicsState.ballsInCurrentCycle >= 30) {
            this.physicsState.cyclePhase = 'big_window';
            this.physicsState.ballsInCurrentCycle = 0;
            this.physicsState.bigMultiplierHits = 0;
            this.physicsState.bigWindowSize = Math.floor(Math.random() * 5) + 1; // 1-5 шариков
            console.log(`🔄 ПЕРЕХОД: Окно больших множителей (${this.physicsState.bigWindowSize} шариков)`);
        }
    } else if (this.physicsState.cyclePhase === 'big_window') {
        this.physicsState.ballsInCurrentCycle++;
        
        // После 1-5 шариков возвращаемся к маленьким множителям
        if (this.physicsState.ballsInCurrentCycle >= this.physicsState.bigWindowSize) {
            this.physicsState.cyclePhase = 'small_attraction';
            this.physicsState.ballsInCurrentCycle = 0;
            console.log(`🔄 ВОЗВРАТ: Притяжение к маленьким множителям (30 шариков)`);
        }
    }
}

    // 🔥 NEW METHOD: Track big multiplier hits
    trackBigMultiplierHit(slotIndex) {
        const highMultiplierSlots = [0, 1, 5, 6]; // 5.8x, 2.2x, 2.2x, 5.8x
        
        if (highMultiplierSlots.includes(slotIndex)) {
            this.physicsState.bigMultiplierHits++;
            console.log(`🎯 Попадание в большой множитель! Слот: ${slotIndex}, Всего попаданий: ${this.physicsState.bigMultiplierHits}`);
        }
    }

   // 🔥 NEW METHOD: Update physics cycle state
updatePhysicsCycle() {
    this.physicsState.totalBallsDropped++;
    
    if (this.physicsState.cyclePhase === 'small_attraction') {
        this.physicsState.ballsInCurrentCycle++;
        
        // После 30 шариков переходим к большим множителям
        if (this.physicsState.ballsInCurrentCycle >= 30) {
            this.physicsState.cyclePhase = 'big_window';
            this.physicsState.ballsInCurrentCycle = 0;
            this.physicsState.bigMultiplierHits = 0;
            this.physicsState.bigWindowSize = Math.floor(Math.random() * 5) + 1; // 1-5 шариков
            console.log(`🔄 ПЕРЕХОД: Окно больших множителей (${this.physicsState.bigWindowSize} шариков)`);
        }
    } else if (this.physicsState.cyclePhase === 'big_window') {
        this.physicsState.ballsInCurrentCycle++;
        
        // После 1-5 шариков возвращаемся к маленьким множителям
        if (this.physicsState.ballsInCurrentCycle >= this.physicsState.bigWindowSize) {
            this.physicsState.cyclePhase = 'small_attraction';
            this.physicsState.ballsInCurrentCycle = 0;
            console.log(`🔄 ВОЗВРАТ: Притяжение к маленьким множителям (30 шариков)`);
        }
    }
}

// 🔥 NEW METHOD: Assign ball type based on physics cycle
assignBallType(ball) {
    console.log(`🎮 Cycle Status: Phase=${this.physicsState.cyclePhase}, Balls=${this.physicsState.ballsInCurrentCycle}, BigHits=${this.physicsState.bigMultiplierHits}`);
    
    if (this.physicsState.cyclePhase === 'small_attraction') {
        // В фазе притяжения к маленьким множителям (30 шариков)
        ball.multiplierType = 'small_attraction';
        console.log(`🔻 Шарик ${this.physicsState.ballsInCurrentCycle}/30 - притяжение к маленьким множителям`);
    } else if (this.physicsState.cyclePhase === 'big_window') {
        // В окне больших множителей (1-5 шариков)
        ball.multiplierType = 'big_opportunity';
        console.log(`🔺 Шарик ${this.physicsState.ballsInCurrentCycle}/${this.physicsState.bigWindowSize} - окно больших множителей`);
    }
}

// 🔥 NEW METHOD: Update cycle display
updateCycleDisplay() {
    const cyclePhaseElement = document.getElementById('cycle-phase');
    const cycleStatsElement = document.getElementById('cycle-stats');
    
    if (cyclePhaseElement && cycleStatsElement) {
        if (this.physicsState.cyclePhase === 'small_attraction') {
            cyclePhaseElement.textContent = 'Фаза: Притяжение к маленьким множителям';
            cycleStatsElement.textContent = `Шариков в цикле: ${this.physicsState.ballsInCurrentCycle}/30 | Больших попаданий: ${this.physicsState.bigMultiplierHits}`;
        } else if (this.physicsState.cyclePhase === 'big_window') {
            cyclePhaseElement.textContent = 'Фаза: Окно больших множителей';
            cycleStatsElement.textContent = `Шариков в окне: ${this.physicsState.ballsInCurrentCycle}/${this.physicsState.bigWindowSize} | Больших попаданий: ${this.physicsState.bigMultiplierHits}`;
        }
    }
}

// 🔥 UPDATED: Physics with cycle-based attraction
updateBall() {
    for (let i = this.activeBalls.length - 1; i >= 0; i--) {
        const ball = this.activeBalls[i];

        // 🔥 УЛУЧШЕННАЯ ЗАЩИТА ОТ ЗАВИСАНИЯ
        const currentTime = Date.now();
        const ballLifetime = currentTime - (ball.createdAt || currentTime);
        const isStuckBall = ballLifetime > 8000;
        const isSlowBall = ball.y > this.canvas.height * 0.85 && Math.abs(ball.vy) < 0.15 && ballLifetime > 2000;
        const isFloatingBall = ballLifetime > 5000 && ball.y < this.canvas.height * 0.1;
        
        if ((ball.isFinished && currentTime - ball.finishedAt > 200) || isStuckBall || isSlowBall || isFloatingBall) {
            this.activeBalls.splice(i, 1);
            continue;
        }

        if (ball.isFinished) continue;

        // Apply physics
        ball.vy += this.gravity;
        ball.x += ball.vx;
        ball.y += ball.vy;
        ball.vx *= this.friction;
        ball.vy *= this.friction;
        
        // 🔥 CYCLE-BASED ATTRACTION SYSTEM
        const slotWidth = this.canvas.width / 7;
        const lowMultiplierSlots = [2, 3, 4]; // 0.8x, 0.4x, 0.8x
        const highMultiplierSlots = [0, 1, 5, 6]; // 5.8x, 2.2x, 2.2x, 5.8x
        
        // Определяем тип шарика ОДИН раз
        if (!ball.hasOwnProperty('multiplierType')) {
            this.assignBallType(ball);
        }
        
        // 🔥 ПРИМЕНЯЕМ ФИЗИКУ ПРИТЯЖЕНИЯ В ЗАВИСИМОСТИ ОТ ФАЗЫ ЦИКЛА
        if (ball.y > this.canvas.height * 0.6) {
            let targetSlot;
            
            if (ball.multiplierType === 'small_attraction') {
                // СИЛЬНОЕ притяжение к маленьким множителям (30 шариков)
                if (!ball.targetSlot) {
                    let minDistance = Infinity;
                    let closestSlot = 3; // Средний слот с 0.4x
                    
                    lowMultiplierSlots.forEach(slotIndex => {
                        const slotCenterX = (slotIndex + 0.5) * slotWidth;
                        const distance = Math.abs(ball.x - slotCenterX);
                        if (distance < minDistance) {
                            minDistance = distance;
                            closestSlot = slotIndex;
                        }
                    });
                    ball.targetSlot = closestSlot;
                }
                targetSlot = ball.targetSlot;
                
                const targetX = (targetSlot + 0.5) * slotWidth;
                const distanceToTarget = Math.abs(ball.x - targetX);
                
                // СИЛЬНОЕ притяжение к маленьким множителям
                if (distanceToTarget > slotWidth * 0.2) {
                    const heightProgress = Math.min(1.0, (ball.y - this.canvas.height * 0.6) / (this.canvas.height * 0.3));
                    const pullStrength = 0.004; // Увеличено притяжение
                    const adjustedPull = pullStrength * heightProgress;
                    
                    const pullDirection = (targetX - ball.x) / this.canvas.width;
                    ball.vx += pullDirection * adjustedPull;
                }
            } else if (ball.multiplierType === 'big_opportunity') {
                // СЛАБОЕ притяжение к большим множителям (1-5 шариков)
                if (!ball.targetSlot) {
                    ball.targetSlot = highMultiplierSlots[Math.floor(Math.random() * highMultiplierSlots.length)];
                }
                targetSlot = ball.targetSlot;
                
                const targetX = (targetSlot + 0.5) * slotWidth;
                const distanceToTarget = Math.abs(ball.x - targetX);
                
                // Слабое притяжение к большим множителям
                if (distanceToTarget > slotWidth * 0.4) {
                    const heightProgress = Math.min(1.0, (ball.y - this.canvas.height * 0.7) / (this.canvas.height * 0.2));
                    const pullStrength = 0.001; // Очень слабое притяжение
                    const adjustedPull = pullStrength * heightProgress;
                    
                    const pullDirection = (targetX - ball.x) / this.canvas.width;
                    ball.vx += pullDirection * adjustedPull;
                }
            }
        }

        // Остальная физика без изменений
        if (ball.x - ball.radius < 0 || ball.x + ball.radius > this.canvas.width) {
            ball.vx *= -this.bounce;
            ball.x = ball.x - ball.radius < 0 ? ball.radius : this.canvas.width - ball.radius;
        }

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

        // 🔥 ЛОГИКА ЗАВЕРШЕНИЯ ШАРИКА
        const bottomThreshold = this.canvas.height - 10;
        const isAtBottom = ball.y + ball.radius > bottomThreshold;
        
        if (isAtBottom && !ball.isFinished) {
            ball.isFinished = true;
            ball.finishedAt = Date.now();
            
            const slotWidth = this.canvas.width / this.slots.length;
            const ballCenterX = ball.x;
            const slotIndex = Math.floor(ballCenterX / slotWidth);
            const finalSlotIndex = Math.max(0, Math.min(this.slots.length - 1, slotIndex));
            
            console.log(`🎯 Шарик упал в позицию X: ${ballCenterX.toFixed(1)}, слот: ${finalSlotIndex}`);
            
            // 🔥 TRACK BIG MULTIPLIER HITS FOR CYCLE SYSTEM
            this.trackBigMultiplierHit(finalSlotIndex);
            
            ball.x = (finalSlotIndex + 0.5) * slotWidth;
            ball.y = this.canvas.height - 5;
            ball.vx = 0;
            ball.vy = 0;
            
            setTimeout(() => {
                this.handleBallInSlot(ball, finalSlotIndex);
            }, 50);
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
        
        // Update bet amount display if exists
        const currentBetElement = document.getElementById('currentBet');
        if (currentBetElement) {
            currentBetElement.textContent = this.currentBet.toFixed(1) + ' TON';
        }
        
        // Update bet amount input if exists  
        const betAmountElement = document.getElementById('betAmount') || document.getElementById('bet-amount');
        if (betAmountElement) {
            betAmountElement.textContent = this.currentBet.toFixed(1);
        }

        // 🔥 NEW: Update cycle information display
        this.updateCycleDisplay();

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

    // 🔥 NEW METHOD: Update cycle display
    updateCycleDisplay() {
    const cyclePhaseElement = document.getElementById('cycle-phase');
    const cycleStatsElement = document.getElementById('cycle-stats');
    
    if (cyclePhaseElement && cycleStatsElement) {
        if (this.physicsState.cyclePhase === 'small_attraction') {
            cyclePhaseElement.textContent = 'Фаза: Притяжение к маленьким множителям';
            cycleStatsElement.textContent = `Шариков в цикле: ${this.physicsState.ballsInCurrentCycle}/30 | Больших попаданий: ${this.physicsState.bigMultiplierHits}`;
        } else if (this.physicsState.cyclePhase === 'big_window') {
            cyclePhaseElement.textContent = 'Фаза: Окно больших множителей';
            cycleStatsElement.textContent = `Шариков в окне: ${this.physicsState.ballsInCurrentCycle}/${this.physicsState.bigWindowSize} | Больших попаданий: ${this.physicsState.bigMultiplierHits}`;
        }
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