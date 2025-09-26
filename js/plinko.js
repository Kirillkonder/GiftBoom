class PlinkoGame {
    constructor() {
        // Canvas setup
        this.canvas = document.getElementById('gameCanvas');
        this.ctx = this.canvas.getContext('2d');
        this.resizeCanvas();

        // Game state
        this.money = 3000;
        this.currentBet = 0;
        this.lastWin = 0;
        this.activeBalls = [];
        this.soundEnabled = true;
        this.bonusRound = false;
        this.bonusCounter = 0;

        // Physics constants
        this.gravity = 0.6;
        this.bounce = 0.7;
        this.friction = 0.99;

        // Game elements
        this.pegs = [];
        this.slots = [];
        this.activeBetButton = null;

        // Initialize game
        this.setupEventListeners();
        this.createPegs();
        this.createSlots();
        this.updateUI();

        // Animation frame
        this.animationId = null;
        
        // Start game loop
        this.gameLoop();
    }

    resizeCanvas() {
        const board = document.querySelector('.game-board');
        this.canvas.width = board.clientWidth;
        this.canvas.height = board.clientHeight;
        this.pegRadius = Math.min(this.canvas.width, this.canvas.height) * 0.015;
        this.ballRadius = this.pegRadius * 0.8;
    }

    setupEventListeners() {
        // Window resize
        window.addEventListener('resize', () => {
            this.resizeCanvas();
            this.pegs = [];
            this.createPegs();
        });

        // Drop ball button
        document.getElementById('dropBall').addEventListener('click', () => this.dropBall());

        // Reset game button
        document.getElementById('resetGame').addEventListener('click', () => this.resetGame());

        // Toggle sound button
        document.getElementById('toggleSound').addEventListener('click', () => this.toggleSound());

        // Bet buttons
        document.querySelectorAll('.bet-btn').forEach(btn => {
            if (!btn.classList.contains('custom-bet-btn')) {
                btn.addEventListener('click', () => {
                    if (btn.dataset.percent) {
                        // Handle percentage bets
                        const percent = parseFloat(btn.dataset.percent);
                        const betAmount = Math.floor(this.money * (percent / 100));
                        if (betAmount > 0) {
                            this.currentBet = betAmount;
                            this.updateActiveBetButton(btn);
                            this.updateUI();
                        }
                    } else {
                        // Handle fixed amount bets
                        const betAmount = parseInt(btn.dataset.bet);
                        if (betAmount && betAmount <= this.money) {
                            this.currentBet = betAmount;
                            this.updateActiveBetButton(btn);
                            this.updateUI();
                        }
                    }
                });
            }
        });

        // Custom bet handling
        const customBetInput = document.getElementById('customBet');
        const customBetBtn = document.querySelector('.custom-bet-btn');

        customBetBtn.addEventListener('click', () => {
            const customBetAmount = parseInt(customBetInput.value);
            if (customBetAmount > 0 && customBetAmount <= this.money) {
                this.currentBet = customBetAmount;
                document.querySelectorAll('.bet-btn').forEach(btn => btn.classList.remove('active'));
                this.updateUI();
            }
        });

        customBetInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                const customBetAmount = parseInt(customBetInput.value);
                if (customBetAmount > 0 && customBetAmount <= this.money) {
                    this.currentBet = customBetAmount;
                    document.querySelectorAll('.bet-btn').forEach(btn => btn.classList.remove('active'));
                    this.updateUI();
                }
            }
        });

        // Keyboard controls
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') this.dropBall();
            if (e.key === 'r' || e.key === 'R') this.resetGame();
        });

        // Drop zone interaction
        const dropZone = document.getElementById('dropZone');
        dropZone.addEventListener('mousemove', (e) => {
            if (this.currentBet > 0 && this.money >= this.currentBet) {
                const rect = dropZone.getBoundingClientRect();
                const x = e.clientX - rect.left;
                this.drawPreviewBall(x);
            }
        });

        dropZone.addEventListener('click', (e) => {
            if (this.currentBet > 0 && this.money >= this.currentBet) {
                const rect = dropZone.getBoundingClientRect();
                const x = e.clientX - rect.left;
                this.dropBallAt(x);
            } else if (this.currentBet === 0) {
                this.showMessage('Please select a bet amount first!');
            } else if (this.money < this.currentBet) {
                this.showMessage('Not enough money for this bet!');
            }
        });
    }

    createPegs() {
        const rows = 8;
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
        const slotElements = document.querySelectorAll('.slot');
        const slotWidth = this.canvas.width / slotElements.length;
        
        slotElements.forEach((element, index) => {
            const multiplier = parseFloat(element.dataset.value);
            this.slots.push({
                x: index * slotWidth,
                width: slotWidth,
                multiplier: multiplier
            });
        });
    }

    setBet(amount) {
        if (amount <= this.money) {
            this.currentBet = amount;
            this.updateUI();
        } else {
            this.showMessage('Not enough money for this bet!');
        }
    }

    dropBall() {
        if (this.currentBet > 0 && this.money >= this.currentBet) {
            const x = this.canvas.width / 2 + (Math.random() - 0.5) * (this.canvas.width / 4);
            this.dropBallAt(x);
        } else if (this.currentBet === 0) {
            this.showMessage('Please select a bet amount first!');
        } else if (this.money < this.currentBet) {
            this.showMessage('Not enough money for this bet!');
        }
    }

    dropBallAt(x) {
        // Deduct bet from money
        this.money -= this.currentBet;
        
        // Check if this ball should trigger bonus
        let isBonus = false;
        this.bonusCounter++;
        if (this.bonusCounter >= 3) {
            isBonus = Math.random() < 0.3;
            this.bonusCounter = 0;
        }

        const ball = {
            x: Math.max(this.ballRadius, Math.min(x, this.canvas.width - this.ballRadius)),
            y: this.ballRadius,
            vx: 0,
            vy: 0,
            radius: this.ballRadius,
            bet: this.currentBet,
            isBonus: isBonus
        };

        this.activeBalls.push(ball);
        // Keep the current bet but update UI for money changes
        this.updateUI();
        this.playSound('drop');
    }

    updateBall() {
        // Process each active ball
        for (let i = this.activeBalls.length - 1; i >= 0; i--) {
            const ball = this.activeBalls[i];

            // Apply gravity
            ball.vy += this.gravity;
            
            // Apply velocity
            ball.x += ball.vx;
            ball.y += ball.vy;

            // Apply friction
            ball.vx *= this.friction;
            ball.vy *= this.friction;

            // Check wall collisions
            if (ball.x - ball.radius < 0 || ball.x + ball.radius > this.canvas.width) {
                ball.vx *= -this.bounce;
                ball.x = ball.x - ball.radius < 0 ? ball.radius : this.canvas.width - ball.radius;
            }

            // Check peg collisions
            this.pegs.forEach(peg => {
                const dx = ball.x - peg.x;
                const dy = ball.y - peg.y;
                const distance = Math.sqrt(dx * dx + dy * dy);
                
                if (distance < ball.radius + peg.radius) {
                    // Calculate collision response
                    const angle = Math.atan2(dy, dx);
                    const speed = Math.sqrt(ball.vx * ball.vx + ball.vy * ball.vy);
                    
                    // Add some randomness to the bounce direction
                    const randomAngle = angle + (Math.random() - 0.5) * 0.2;
                    
                    ball.vx = Math.cos(randomAngle) * speed * this.bounce;
                    ball.vy = Math.sin(randomAngle) * speed * this.bounce;
                    
                    // Prevent sticking
                    const minDistance = ball.radius + peg.radius;
                    ball.x = peg.x + Math.cos(angle) * minDistance;
                    ball.y = peg.y + Math.sin(angle) * minDistance;

                    this.playSound('bounce');
                }
            });

            // Check if ball reached bottom
            if (ball.y + ball.radius > this.canvas.height) {
                this.handleBallInSlot(ball, i);
            }
        }
    }

    handleBallInSlot(ball, index) {
        // Calculate which slot the ball corresponds to based on its x-position
        const slotIndex = Math.floor((ball.x / this.canvas.width) * this.slots.length);
        const slot = this.slots[slotIndex];
        
        // Calculate winnings by multiplying bet by slot multiplier
        let winnings = Math.floor(ball.bet * parseFloat(slot.multiplier));
        if (ball.isBonus) {
            winnings *= 2;
        }
        
        this.money += winnings;
        this.lastWin = winnings;
        
        this.playSound('win');
        this.flashSlot(slotIndex);
        
        if (winnings >= ball.bet * 5) {
            this.createParticles(ball);
            if ('vibrate' in navigator) {
                navigator.vibrate(100);
            }
        }

        // Remove the ball
        this.activeBalls.splice(index, 1);
        this.updateUI();

        // Show win message for all wins
        const message = ball.isBonus ? 
            `$${winnings} (${slot.multiplier}x + BONUS)` : 
            `$${winnings} (${slot.multiplier}x)`;
        this.showBriefMessage(message);

        // Reset game when out of money without showing warning
        if (this.money < 1 && this.activeBalls.length === 0) {
            this.resetGame();
        }
    }

    flashSlot(slotIndex) {
        const slotElements = document.querySelectorAll('.slot');
        if (slotElements[slotIndex]) {
            const slot = slotElements[slotIndex];
            slot.style.transform = 'scale(1.1)';
            slot.style.boxShadow = '0 0 20px rgba(255, 255, 255, 0.8)';
            
            setTimeout(() => {
                slot.style.transform = '';
                slot.style.boxShadow = '';
            }, 1000);
        }
    }

    createParticles(ball) {
        // Simple confetti effect
        const colors = ['#FFD700', '#FF9900', '#FF3300', '#99FF33', '#33CCFF'];
        for (let i = 0; i < 50; i++) {
            const particle = document.createElement('div');
            particle.style.position = 'absolute';
            particle.style.left = `${ball.x}px`;
            particle.style.top = `${ball.y}px`;
            particle.style.width = '8px';
            particle.style.height = '8px';
            particle.style.backgroundColor = colors[Math.floor(Math.random() * colors.length)];
            particle.style.borderRadius = '50%';
            particle.style.transform = `rotate(${Math.random() * 360}deg)`;
            
            document.querySelector('.game-board').appendChild(particle);
            
            const angle = Math.random() * Math.PI * 2;
            const velocity = 5 + Math.random() * 8;
            const vx = Math.cos(angle) * velocity;
            const vy = Math.sin(angle) * velocity;
            
            let opacity = 1;
            const animate = () => {
                const currentLeft = parseFloat(particle.style.left);
                const currentTop = parseFloat(particle.style.top);
                
                particle.style.left = `${currentLeft + vx}px`;
                particle.style.top = `${currentTop + vy}px`;
                opacity -= 0.03;
                particle.style.opacity = opacity;
                
                if (opacity > 0) {
                    requestAnimationFrame(animate);
                } else {
                    particle.remove();
                }
            };
            
            requestAnimationFrame(animate);
        }
    }

    drawPreviewBall(x) {
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
        this.drawGame();
        
        this.ctx.beginPath();
        this.ctx.arc(
            Math.max(this.ballRadius, Math.min(x, this.canvas.width - this.ballRadius)),
            this.ballRadius,
            this.ballRadius,
            0,
            Math.PI * 2
        );
        this.ctx.fillStyle = 'rgba(255, 215, 0, 0.5)';
        this.ctx.fill();
    }

    drawGame() {
        // Draw pegs
        this.pegs.forEach(peg => {
            this.ctx.beginPath();
            this.ctx.arc(peg.x, peg.y, peg.radius, 0, Math.PI * 2);
            this.ctx.fillStyle = 'white';
            this.ctx.fill();
            
            // Add glow effect
            this.ctx.shadowBlur = 10;
            this.ctx.shadowColor = 'white';
            this.ctx.fill();
            this.ctx.shadowBlur = 0;
        });

        // Draw balls
        this.activeBalls.forEach(ball => {
            this.ctx.beginPath();
            this.ctx.arc(ball.x, ball.y, ball.radius, 0, Math.PI * 2);
            this.ctx.fillStyle = ball.isBonus ? '#FF9900' : 'var(--ball-color)';
            this.ctx.fill();
            
            // Add glow effect
            this.ctx.shadowBlur = 15;
            this.ctx.shadowColor = ball.isBonus ? '#FF9900' : 'var(--ball-color)';
            this.ctx.fill();
            this.ctx.shadowBlur = 0;
        });
        
        // Draw active ball count
        if (this.activeBalls.length > 0) {
            this.ctx.font = 'bold 14px Montserrat';
            this.ctx.fillStyle = 'white';
            this.ctx.textAlign = 'right';
            this.ctx.fillText(`Active Balls: ${this.activeBalls.length}`, this.canvas.width - 20, 30);
        }
    }

    gameLoop() {
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
        this.drawGame();
        
        if (this.activeBalls.length) {
            this.updateBall();
        }
        
        this.animationId = requestAnimationFrame(() => this.gameLoop());
    }

    updateUI() {
        document.getElementById('money').textContent = this.money;
        document.getElementById('currentBet').textContent = this.currentBet;
        document.getElementById('lastWin').textContent = this.lastWin;
        
        const dropButton = document.getElementById('dropBall');
        
        if (this.currentBet === 0 || this.currentBet > this.money) {
            dropButton.disabled = true;
            dropButton.classList.remove('glow-effect');
        } else {
            dropButton.disabled = false;
            dropButton.classList.add('glow-effect');
        }
        
        // Update bet buttons based on available money
        document.querySelectorAll('.bet-btn').forEach(btn => {
            if (!btn.classList.contains('custom-bet-btn')) {
                const betAmount = parseInt(btn.dataset.bet);
                if (betAmount > this.money) {
                    btn.disabled = true;
                    btn.classList.remove('active');
                } else {
                    btn.disabled = false;
                    // Keep the active state if it matches current bet
                    if (betAmount === this.currentBet) {
                        btn.classList.add('active');
                    }
                }
            }
        });
    }

    showMessage(text) {
        const overlay = document.getElementById('messageOverlay');
        const messageText = document.getElementById('messageText');
        messageText.innerHTML = `
            ${text}
            <div class="message-quote">
                "Hazard to najszybszy sposób na utratę pieniędzy i najwolniejszy na ich zarobienie."<br>
                - Amad Kornienko
            </div>
        `;
        overlay.classList.remove('hidden');
        
        document.getElementById('messageClose').onclick = () => {
            overlay.classList.add('hidden');
        };
    }
    
    showBriefMessage(text) {
        const message = document.createElement('div');
        message.className = 'floating-message';
        message.textContent = text;
        document.body.appendChild(message);
        
        setTimeout(() => {
            message.style.animation = 'slideOut 0.3s ease-out forwards';
            setTimeout(() => message.remove(), 300);
        }, 2000);
    }

    playSound(type) {
        if (!this.soundEnabled) return;
        
        const sounds = {
            drop: [261.63, 329.63],
            bounce: [440],
            win: [523.25, 659.25, 783.99]
        };

        try {
            const audioContext = new (window.AudioContext || window.webkitAudioContext)();
            sounds[type].forEach((frequency, i) => {
                const oscillator = audioContext.createOscillator();
                const gainNode = audioContext.createGain();
                
                oscillator.type = type === 'win' ? 'sine' : 'square';
                oscillator.frequency.value = frequency;
                
                gainNode.gain.setValueAtTime(0.1, audioContext.currentTime);
                gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.3);
                
                oscillator.connect(gainNode);
                gainNode.connect(audioContext.destination);
                
                oscillator.start();
                oscillator.stop(audioContext.currentTime + 0.3);
            });
        } catch (e) {
            console.error('WebAudio error:', e);
        }
    }

    toggleSound() {
        this.soundEnabled = !this.soundEnabled;
        const soundButton = document.getElementById('toggleSound');
        soundButton.textContent = this.soundEnabled ? '🔊' : '🔇';
    }

    resetGame() {
        this.money = 3000;
        this.currentBet = 0;
        this.lastWin = 0;
        this.activeBalls = [];
        this.bonusRound = false;
        this.bonusCounter = 0;
        
        // Reset active bet button
        document.querySelectorAll('.bet-btn').forEach(btn => {
            btn.classList.remove('active');
        });
        this.activeBetButton = null;
        
        this.updateUI();
    }

    updateActiveBetButton(activeBtn) {
        document.querySelectorAll('.bet-btn').forEach(btn => btn.classList.remove('active'));
        if (activeBtn) {
            activeBtn.classList.add('active');
        }
        const customBetInput = document.getElementById('customBet');
        customBetInput.value = '';
    }
}

// Start the game when the page loads
window.addEventListener('load', () => {
    const game = new PlinkoGame();
    
    // Add CSS for floating message
    const style = document.createElement('style');
    style.textContent = `
        .floating-message {
            animation: fadeIn 0.3s ease-out;
        }
        @keyframes fadeIn {
            from { opacity: 0; transform: translate(-50%, -70%); }
            to { opacity: 1; transform: translate(-50%, -50%); }
        }
    `;
    document.head.appendChild(style);

    // Show initial warning message
    game.showMessage('UWAGA: Hazard to nie zabawa! W prawdziwym kasynie zawsze przegrywasz. To jest tylko wersja demonstracyjna.');
}); 