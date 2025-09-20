// Initialize app
document.addEventListener('DOMContentLoaded', function() {
    const coinImg = document.getElementById('coinImage');
    const betInput = document.getElementById('betAmount');
    const decreaseBtn = document.getElementById('decreaseBtn');
    const increaseBtn = document.getElementById('increaseBtn');
    const halfBtn = document.getElementById('halfBtn');
    const doubleBtn = document.getElementById('doubleBtn');
    const flipButtons = document.querySelectorAll('.flip-btn');
    const balanceElement = document.querySelector('.balance span:last-child');
    const closeBtn = document.querySelector('.close-btn');
    
    let userBalance = 0;
    let demoMode = false;
    let telegramId = null;

    // Initialize the game
    async function initGame() {
        try {
            // Get Telegram WebApp data
            const tg = window.Telegram?.WebApp;
            if (tg && tg.initDataUnsafe && tg.initDataUnsafe.user) {
                telegramId = tg.initDataUnsafe.user.id;
                
                // Get user balance from server
                const response = await fetch(`/api/user/balance/${telegramId}`);
                const data = await response.json();
                
                if (data.error) {
                    console.error('Error getting balance:', data.error);
                    return;
                }
                
                userBalance = demoMode ? data.demo_balance : data.main_balance;
                demoMode = data.demo_mode;
                
                // Update balance display
                balanceElement.textContent = Math.floor(userBalance);
                
                // Set max bet to current balance
                const maxBet = Math.floor(userBalance);
                if (parseInt(betInput.value) > maxBet) {
                    betInput.value = maxBet;
                    updatePotentialWin();
                }
            }
        } catch (error) {
            console.error('Initialization error:', error);
        }
    }

    // Remove background from coin image
    async function removeBackground() {
        try {
            const response = await fetch('/coin.png');
            const blob = await response.blob();
            
            // Create image element
            const img = new Image();
            img.crossOrigin = 'anonymous';
            
            img.onload = function() {
                // Create canvas
                const canvas = document.createElement('canvas');
                const ctx = canvas.getContext('2d');
                
                canvas.width = img.naturalWidth;
                canvas.height = img.naturalHeight;
                ctx.drawImage(img, 0, 0);
                
                // Get image data
                const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
                const data = imageData.data;
                
                // Simple background removal based on transparency
                for (let i = 0; i < data.length; i += 4) {
                    const r = data[i];
                    const g = data[i + 1];
                    const b = data[i + 2];
                    
                    // Check if pixel is close to white/gray background
                    if (r > 200 && g > 200 && b > 200) {
                        data[i + 3] = 0; // Make transparent
                    }
                }
                
                ctx.putImageData(imageData, 0, 0);
                coinImg.src = canvas.toDataURL('image/png');
            };
            
            img.src = URL.createObjectURL(blob);
        } catch (error) {
            console.log('Background removal failed, using original image');
        }
    }

    // Close button handler (back button)
    closeBtn.addEventListener('click', function() {
        // Go back to previous page or close the game
        if (window.history.length > 1) {
            window.history.back();
        } else {
            // If no history, try to close Telegram WebApp
            const tg = window.Telegram?.WebApp;
            if (tg) {
                tg.close();
            }
        }
    });

    // Bet controls
    decreaseBtn.addEventListener('click', function() {
        let currentValue = parseInt(betInput.value) || 0;
        if (currentValue > 1) {
            betInput.value = currentValue - 1;
            updatePotentialWin();
        }
    });

    increaseBtn.addEventListener('click', function() {
        let currentValue = parseInt(betInput.value) || 0;
        const maxBet = Math.floor(userBalance);
        betInput.value = Math.min(currentValue + 1, maxBet);
        updatePotentialWin();
    });

    halfBtn.addEventListener('click', function() {
        let currentValue = parseInt(betInput.value) || 0;
        betInput.value = Math.max(1, Math.floor(currentValue / 2));
        updatePotentialWin();
    });

    doubleBtn.addEventListener('click', function() {
        let currentValue = parseInt(betInput.value) || 0;
        const maxBet = Math.floor(userBalance);
        betInput.value = Math.min(currentValue * 2, maxBet);
        updatePotentialWin();
    });

    // Update potential win
    function updatePotentialWin() {
        const betAmount = parseInt(betInput.value) || 0;
        const winAmount = Math.floor(betAmount * 1.96);
        document.getElementById('potentialWin').textContent = winAmount + ' TON';
    }

    // Flip buttons
    flipButtons.forEach(btn => {
        btn.addEventListener('click', async function() {
            const side = this.getAttribute('data-side');
            const betAmount = parseInt(betInput.value) || 0;
            
            if (betAmount > userBalance) {
                alert('Недостаточно средств');
                return;
            }
            
            if (betAmount < 1) {
                alert('Минимальная ставка: 1 TON');
                return;
            }
            
            // Add flip animation
            coinImg.classList.add('flipping');
            
            try {
                // Place bet
                const response = await fetch('/api/coinflip/bet', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        telegramId: telegramId,
                        betAmount: betAmount,
                        side: side,
                        demoMode: demoMode
                    })
                });
                
                const result = await response.json();
                
                if (result.success) {
                    // Update balance
                    userBalance = demoMode ? result.new_demo_balance : result.new_main_balance;
                    balanceElement.textContent = Math.floor(userBalance);
                    
                    // Show result
                    if (result.win) {
                        alert(`Вы выиграли ${result.winAmount} TON!`);
                    } else {
                        alert('Вы проиграли');
                    }
                } else {
                    alert('Ошибка: ' + result.error);
                }
            } catch (error) {
                console.error('Bet error:', error);
                alert('Ошибка соединения');
            } finally {
                // Remove animation
                setTimeout(() => {
                    coinImg.classList.remove('flipping');
                }, 2000);
            }
        });
    });

    // Input validation
    betInput.addEventListener('input', function() {
        this.value = this.value.replace(/[^0-9]/g, '');
        if (parseInt(this.value) < 1) {
            this.value = '1';
        }
        
        // Ensure bet doesn't exceed balance
        const maxBet = Math.floor(userBalance);
        if (parseInt(this.value) > maxBet) {
            this.value = maxBet;
        }
        
        updatePotentialWin();
    });

    // Initialize the game
    removeBackground();
    initGame();
    updatePotentialWin();
});