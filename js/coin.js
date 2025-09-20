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
                
                // Get user balance
                const response = await fetch(`/api/user/balance/${telegramId}`);
                const data = await response.json();
                
                if (data.error) {
                    console.error('Error getting balance:', data.error);
                    return;
                }
                
                userBalance = demoMode ? data.demo_balance : data.main_balance;
                demoMode = data.demo_mode || false;
                
                // Update balance display
                updateBalanceDisplay();
                
                // Set close button functionality (back button)
                closeBtn.addEventListener('click', function() {
                    if (tg && tg.close) {
                        tg.close();
                    } else {
                        window.history.back();
                    }
                });
                
            } else {
                console.log('Not in Telegram environment');
                // For testing outside Telegram
                userBalance = 100;
                updateBalanceDisplay();
            }
            
        } catch (error) {
            console.error('Initialization error:', error);
        }
    }

    // Update balance display
    function updateBalanceDisplay() {
        if (balanceElement) {
            balanceElement.textContent = Math.floor(userBalance);
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
        let currentValue = parseInt(betInput.value) || 0;
        if (currentValue > 1) {
            betInput.value = currentValue - 1;
        }
    });

    increaseBtn.addEventListener('click', function() {
        let currentValue = parseInt(betInput.value) || 0;
        betInput.value = currentValue + 1;
    });

    halfBtn.addEventListener('click', function() {
        let currentValue = parseInt(betInput.value) || 0;
        betInput.value = Math.max(1, Math.floor(currentValue / 2));
    });

    doubleBtn.addEventListener('click', function() {
        let currentValue = parseInt(betInput.value) || 0;
        betInput.value = currentValue * 2;
    });

    // Flip buttons
    flipButtons.forEach(btn => {
        btn.addEventListener('click', function() {
            const side = this.getAttribute('data-side');
            const betAmount = parseInt(betInput.value) || 0;
            
            // Check if user has enough balance
            if (betAmount > userBalance) {
                alert('Недостаточно средств');
                return;
            }
            
            // Add flip animation
            coinImg.classList.add('flipping');
            
            // Remove animation after completion
            setTimeout(() => {
                coinImg.classList.remove('flipping');
                
                // Simulate random result
                const result = Math.random() < 0.5 ? 'heads' : 'tails';
                const won = result === side;
                
                // Show result
                if (won) {
                    console.log('You won!');
                    // Here you would call the API to process win
                } else {
                    console.log('You lost!');
                    // Here you would call the API to process loss
                }
            }, 2000);
        });
    });

    // Input validation
    betInput.addEventListener('input', function() {
        this.value = this.value.replace(/[^0-9]/g, '');
        if (parseInt(this.value) < 1) {
            this.value = '1';
        }
        
        // Ensure bet doesn't exceed balance
        const betAmount = parseInt(this.value) || 0;
        if (betAmount > userBalance) {
            this.value = userBalance;
        }
    });

    // Initialize the game
    removeBackground();
    initGame();
});