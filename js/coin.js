let userBalance = {
    main_balance: 0,
    demo_balance: 0,
    demo_mode: false,
    is_admin: false
};

// Get Telegram ID from URL params or default for testing
const urlParams = new URLSearchParams(window.location.search);
const telegramId = urlParams.get('telegramId') || '842428912'; // Default admin ID for testing

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
    const balanceElement = document.getElementById('balanceAmount');
    const backBtn = document.getElementById('backBtn');
    
    // Load user balance on page load
    loadUserBalance();

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

            // Remove background on load
            removeBackground();

            // Bet controls
            decreaseBtn.addEventListener('click', function() {
                let currentValue = parseFloat(betInput.value) || 0.1;
                let newValue = Math.max(0.1, currentValue - 0.1);
                betInput.value = newValue.toFixed(1);
                updatePotentialWin();
            });

            increaseBtn.addEventListener('click', function() {
                let currentValue = parseFloat(betInput.value) || 0;
                let newValue = Math.min(10, currentValue + 0.1);
                betInput.value = newValue.toFixed(1);
                updatePotentialWin();
            });

            halfBtn.addEventListener('click', function() {
                let currentValue = parseFloat(betInput.value) || 0.1;
                let newValue = Math.max(0.1, currentValue / 2);
                betInput.value = newValue.toFixed(1);
                updatePotentialWin();
            });

            doubleBtn.addEventListener('click', function() {
                let currentValue = parseFloat(betInput.value) || 0.1;
                let newValue = Math.min(10, currentValue * 2);
                betInput.value = newValue.toFixed(1);
                updatePotentialWin();
            });

            // Update potential win
            function updatePotentialWin() {
                const betAmount = parseFloat(betInput.value) || 0;
                const winAmount = (betAmount * 1.96).toFixed(2);
                if (potentialWin) {
                    potentialWin.textContent = winAmount + ' TON';
                }
            }

            // Series toggle
            seriesToggle.addEventListener('click', function() {
                this.classList.toggle('active');
            });

            // Flip buttons
            flipButtons.forEach(btn => {
                btn.addEventListener('click', function() {
                    const side = this.getAttribute('data-side');
                    const betAmount = parseFloat(betInput.value) || 0.1;
                    
                    // Validate bet amount
                    if (betAmount < 0.1 || betAmount > 10) {
                        alert('Ставка должна быть от 0.1 до 10 TON');
                        return;
                    }
                    
                    // Check if user has enough balance
                    const currentBalance = userBalance.demo_mode ? userBalance.demo_balance : userBalance.main_balance;
                    if (betAmount > currentBalance) {
                        alert('Недостаточно средств для ставки!');
                        return;
                    }
                    
                    // Disable buttons during flip
                    flipButtons.forEach(b => b.disabled = true);
                    
                    // Add flip animation
                    coinImg.classList.add('flipping');
                    
                    // Make bet request to server
                    makeCoinflipBet(side, betAmount)
                        .then(result => {
                            setTimeout(() => {
                                coinImg.classList.remove('flipping');
                                
                                // Show result
                                showGameResult(result);
                                
                                // Update balance
                                if (userBalance.demo_mode) {
                                    userBalance.demo_balance = result.new_balance;
                                } else {
                                    userBalance.main_balance = result.new_balance;
                                }
                                updateBalanceDisplay();
                                
                                // Re-enable buttons
                                flipButtons.forEach(b => b.disabled = false);
                            }, 2000);
                        })
                        .catch(error => {
                            console.error('Bet error:', error);
                            coinImg.classList.remove('flipping');
                            flipButtons.forEach(b => b.disabled = false);
                            alert('Ошибка при совершении ставки');
                        });
                });
            });

            // Input validation
            betInput.addEventListener('input', function() {
                // Allow numbers and one decimal point
                this.value = this.value.replace(/[^0-9.]/g, '');
                
                // Ensure only one decimal point
                const parts = this.value.split('.');
                if (parts.length > 2) {
                    this.value = parts[0] + '.' + parts.slice(1).join('');
                }
                
                // Validate range
                const value = parseFloat(this.value);
                if (this.value && !isNaN(value)) {
                    if (value < 0.1) {
                        this.value = '0.1';
                    } else if (value > 10) {
                        this.value = '10.0';
                    }
                }
                
                updatePotentialWin();
            });

            // Back button functionality
            if (backBtn) {
                backBtn.addEventListener('click', function() {
                    // Go back to main page or previous page
                    window.history.back();
                });
            }

            // Initialize potential win
            updatePotentialWin();
        });

// Balance management functions
async function loadUserBalance() {
    try {
        const response = await fetch(`/api/user/balance/${telegramId}`);
        const data = await response.json();
        
        if (response.ok) {
            userBalance = data;
            updateBalanceDisplay();
        } else {
            console.error('Error loading balance:', data.error);
        }
    } catch (error) {
        console.error('Error loading balance:', error);
    }
}

function updateBalanceDisplay() {
    const balanceElement = document.getElementById('balanceAmount');
    
    if (userBalance.is_admin) {
        // For admins, show both real and demo balance
        const currentBalance = userBalance.demo_mode ? userBalance.demo_balance : userBalance.main_balance;
        const modeText = userBalance.demo_mode ? ' (ДЕМО)' : ' (РЕАЛ)';
        balanceElement.textContent = currentBalance.toFixed(2) + modeText;
        
        // Add click handler to toggle between demo and real mode
        balanceElement.style.cursor = 'pointer';
        balanceElement.onclick = toggleDemoMode;
    } else {
        // For regular users, show only real balance
        balanceElement.textContent = userBalance.main_balance.toFixed(2);
    }
}

async function toggleDemoMode() {
    if (!userBalance.is_admin) return;
    
    try {
        const response = await fetch('/api/user/toggle-demo-mode', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ telegramId: telegramId })
        });
        
        const data = await response.json();
        
        if (response.ok) {
            userBalance.demo_mode = data.demo_mode;
            updateBalanceDisplay();
        }
    } catch (error) {
        console.error('Error toggling demo mode:', error);
    }
}

// Game functions
async function makeCoinflipBet(selectedSide, betAmount) {
    try {
        const response = await fetch('/api/coinflip/bet', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                telegramId: telegramId,
                betAmount: betAmount,
                selectedSide: selectedSide,
                demoMode: userBalance.demo_mode
            })
        });
        
        const data = await response.json();
        
        if (!response.ok) {
            throw new Error(data.error || 'Server error');
        }
        
        return data;
    } catch (error) {
        console.error('Coinflip bet error:', error);
        throw error;
    }
}

function showGameResult(result) {
    const resultText = result.result === 'heads' ? 'Орел' : 'Решка';
    const winText = result.win ? 'Выигрыш!' : 'Проигрыш';
    const message = `${resultText} - ${winText}`;
    
    if (result.win) {
        console.log(`${message} Выиграно: ${result.win_amount.toFixed(2)} TON`);
    } else {
        console.log(message);
    }
    
    // You can add visual feedback here (modal, animation, etc.)
}