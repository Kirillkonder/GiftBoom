// Initialize app
document.addEventListener('DOMContentLoaded', function() {
    const coinImg = document.getElementById('coinImage');
    const betInput = document.getElementById('betAmount');
    const decreaseBtn = document.getElementById('decreaseBtn');
    const increaseBtn = document.getElementById('increaseBtn');
    const halfBtn = document.getElementById('halfBtn');
    const doubleBtn = document.getElementById('doubleBtn');
    const flipButtons = document.querySelectorAll('.flip-btn');
    const seriesToggle = document.getElementById('seriesToggle');
    const potentialWin = document.getElementById('potentialWin');
    const balanceElement = document.querySelector('.balance span:last-child');
    const closeBtn = document.querySelector('.close-btn');
    
    let userData = {
        telegramId: null,
        mainBalance: 0,
        demoBalance: 0,
        demoMode: false,
        isAdmin: false
    };

    // Initialize the game
    async function initGame() {
        try {
            // Get Telegram WebApp data
            const tg = window.Telegram?.WebApp;
            if (tg) {
                tg.ready();
                tg.expand();
                
                // Get user data from Telegram
                const tgUser = tg.initDataUnsafe?.user;
                if (tgUser) {
                    userData.telegramId = tgUser.id;
                    
                    // Get user balance from server
                    await getUserBalance();
                    
                    // Update UI
                    updateBalanceDisplay();
                    updatePotentialWin();
                }
            } else {
                // For testing without Telegram
                userData.telegramId = 842428912; // Test admin ID
                await getUserBalance();
                updateBalanceDisplay();
                updatePotentialWin();
            }
        } catch (error) {
            console.error('Initialization error:', error);
        }
    }

    // Get user balance from server
    async function getUserBalance() {
        try {
            const response = await fetch(`/api/user/balance/${userData.telegramId}`);
            const data = await response.json();
            
            if (data.error) {
                console.error('Balance fetch error:', data.error);
                return;
            }
            
            userData.mainBalance = data.main_balance;
            userData.demoBalance = data.demo_balance;
            userData.demoMode = data.demo_mode;
            userData.isAdmin = data.is_admin;
            
        } catch (error) {
            console.error('Failed to fetch balance:', error);
        }
    }

    // Update balance display
    function updateBalanceDisplay() {
        const balance = userData.demoMode ? userData.demoBalance : userData.mainBalance;
        balanceElement.textContent = Math.floor(balance);
        
        // Update bet input max value
        const maxBet = Math.min(balance, 1000);
        if (parseInt(betInput.value) > maxBet) {
            betInput.value = maxBet;
            updatePotentialWin();
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

    // Bet controls
    decreaseBtn.addEventListener('click', function() {
        let currentValue = parseInt(betInput.value) || 1;
        if (currentValue > 1) {
            betInput.value = currentValue - 1;
            updatePotentialWin();
        }
    });

    increaseBtn.addEventListener('click', function() {
        let currentValue = parseInt(betInput.value) || 1;
        const maxBet = Math.min(userData.demoMode ? userData.demoBalance : userData.mainBalance, 1000);
        if (currentValue < maxBet) {
            betInput.value = currentValue + 1;
            updatePotentialWin();
        }
    });

    halfBtn.addEventListener('click', function() {
        let currentValue = parseInt(betInput.value) || 1;
        betInput.value = Math.max(1, Math.floor(currentValue / 2));
        updatePotentialWin();
    });

    doubleBtn.addEventListener('click', function() {
        let currentValue = parseInt(betInput.value) || 1;
        const maxBet = Math.min(userData.demoMode ? userData.demoBalance : userData.mainBalance, 1000);
        betInput.value = Math.min(currentValue * 2, maxBet);
        updatePotentialWin();
    });

    // Update potential win
    function updatePotentialWin() {
        const betAmount = parseInt(betInput.value) || 1;
        const winAmount = Math.floor(betAmount * 1.96);
        potentialWin.textContent = winAmount + ' TON';
    }

    // Series toggle
    seriesToggle.addEventListener('click', function() {
        this.classList.toggle('active');
    });

    // Flip buttons
    flipButtons.forEach(btn => {
        btn.addEventListener('click', async function() {
            const side = this.getAttribute('data-side');
            const betAmount = parseInt(betInput.value) || 1;
            
            // Check balance
            const currentBalance = userData.demoMode ? userData.demoBalance : userData.mainBalance;
            if (betAmount > currentBalance) {
                alert('Недостаточно средств!');
                return;
            }
            
            // Add flip animation
            coinImg.classList.add('flipping');
            
            try {
                // Start coinflip game
                const response = await fetch('/api/coinflip/start', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        telegramId: userData.telegramId,
                        betAmount: betAmount,
                        chosenSide: side,
                        demoMode: userData.demoMode
                    })
                });
                
                const result = await response.json();
                
                if (result.success) {
                    // Update balance
                    if (userData.demoMode) {
                        userData.demoBalance = result.new_balance;
                    } else {
                        userData.mainBalance = result.new_balance;
                    }
                    updateBalanceDisplay();
                    
                    // Show result
                    setTimeout(() => {
                        coinImg.classList.remove('flipping');
                        
                        if (result.win) {
                            alert(`🎉 Вы выиграли ${result.win_amount} TON!`);
                        } else {
                            alert('💥 Вы проиграли!');
                        }
                    }, 2000);
                    
                } else {
                    alert('Ошибка: ' + result.error);
                    coinImg.classList.remove('flipping');
                }
                
            } catch (error) {
                console.error('Flip error:', error);
                coinImg.classList.remove('flipping');
                alert('Ошибка соединения');
            }
        });
    });

    // Close/Back button
    closeBtn.addEventListener('click', function() {
        // Go back to previous page or close
        if (window.history.length > 1) {
            window.history.back();
        } else {
            // Close WebApp if in Telegram
            if (window.Telegram?.WebApp) {
                window.Telegram.WebApp.close();
            }
        }
    });

    // Input validation
    betInput.addEventListener('input', function() {
        this.value = this.value.replace(/[^0-9]/g, '');
        if (!this.value || parseInt(this.value) < 1) {
            this.value = '1';
        }
        
        // Limit max bet
        const maxBet = Math.min(userData.demoMode ? userData.demoBalance : userData.mainBalance, 1000);
        if (parseInt(this.value) > maxBet) {
            this.value = maxBet.toString();
        }
        
        updatePotentialWin();
    });

    // Initialize the game
    removeBackground();
    initGame();
});