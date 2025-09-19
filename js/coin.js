// Initialize app
console.log('Coinflip game initialized');
console.log('Telegram WebApp available:', !!window.Telegram?.WebApp);
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
        
        // ДОБАВИТЬ ЭТУ СТРОКУ:
        updateBalanceDisplay();
        
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

    // Show notification message
    function showNotification(message, isWin = false) {
        // Remove existing notification if any
        const existingNotification = document.querySelector('.coinflip-notification');
        if (existingNotification) {
            existingNotification.remove();
        }
        
        const notification = document.createElement('div');
        notification.className = `coinflip-notification ${isWin ? 'win' : 'lose'}`;
        notification.innerHTML = `
            <div class="notification-content">
                <span class="notification-icon">${isWin ? '🎉' : '💥'}</span>
                <span class="notification-text">${message}</span>
            </div>
        `;
        
        document.body.appendChild(notification);
        
        // Show notification
        setTimeout(() => {
            notification.classList.add('show');
        }, 100);
        
        // Hide after 3 seconds
        setTimeout(() => {
            notification.classList.remove('show');
            setTimeout(() => {
                notification.remove();
            }, 300);
        }, 3000);
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
   // В функции flipButtons исправьте обработку ошибок
flipButtons.forEach(btn => {
    btn.addEventListener('click', async function() {
        const side = this.getAttribute('data-side');
        const betAmount = parseInt(betInput.value) || 1;
        
        // Проверка баланса
        const currentBalance = userData.demoMode ? userData.demoBalance : userData.mainBalance;
        if (betAmount > currentBalance) {
            showNotification('Недостаточно средств!', false);
            return;
        }
        
        if (betAmount < 1) {
            showNotification('Минимальная ставка: 1 TON', false);
            return;
        }
        
        // Блокируем кнопки
        flipButtons.forEach(button => {
            button.disabled = true;
            button.style.opacity = '0.5';
        });
        
        // Анимация
        coinImg.classList.add('flipping');
        
        try {
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
                // Обновляем баланс
                if (userData.demoMode) {
                    userData.demoBalance = result.new_balance;
                } else {
                    userData.mainBalance = result.new_balance;
                }
                updateBalanceDisplay();
                
                // Показываем результат
                setTimeout(() => {
                    coinImg.classList.remove('flipping');
                    if (result.win) {
                        showNotification(`Вы выиграли ${result.win_amount} TON!`, true);
                    } else {
                        showNotification(`Вы проиграли ${betAmount} TON!`, false);
                    }
                }, 1000);
                
            } else {
                showNotification('Ошибка: ' + result.error, false);
                coinImg.classList.remove('flipping');
            }
            
        } catch (error) {
            console.error('Flip error:', error);
            coinImg.classList.remove('flipping');
            showNotification('Ошибка соединения', false);
        }
        
        // Разблокируем кнопки через 2 секунды
        setTimeout(() => {
            flipButtons.forEach(button => {
                button.disabled = false;
                button.style.opacity = '1';
            });
        }, 2000);
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

    // Input validation - only allow whole numbers
   betInput.addEventListener('input', function() {
    // Сохраняем курсор позицию
    const cursorPosition = this.selectionStart;
    
    // Удаляем все кроме цифр
    let newValue = this.value.replace(/[^0-9]/g, '');
    
    // Если пусто или 0, ставим 1
    if (!newValue || parseInt(newValue) < 1) {
        newValue = '1';
    }
    
    // Получаем текущий баланс
    const currentBalance = userData.demoMode ? userData.demoBalance : userData.mainBalance;
    const maxBet = Math.min(currentBalance, 1000);
    
    // Ограничиваем максимальную ставку
    if (parseInt(newValue) > maxBet) {
        newValue = maxBet.toString();
    }
    
    this.value = newValue;
    
    // Восстанавливаем позицию курсора
    this.setSelectionRange(cursorPosition, cursorPosition);
    
    updatePotentialWin();
});

    // Prevent paste with non-numeric values
    betInput.addEventListener('paste', function(e) {
        e.preventDefault();
        const pasteData = e.clipboardData.getData('text');
        const numericValue = pasteData.replace(/[^0-9]/g, '');
        document.execCommand('insertText', false, numericValue);
    });

    // Initialize the game
    removeBackground();
    initGame();
});

// Add CSS for notifications
const notificationStyles = `
    .coinflip-notification {
        position: fixed;
        top: 20px;
        left: 50%;
        transform: translateX(-50%) translateY(-100px);
        background: rgba(0, 0, 0, 0.9);
        padding: 15px 25px;
        border-radius: 15px;
        z-index: 1000;
        backdrop-filter: blur(10px);
        border: 2px solid;
        min-width: 250px;
        text-align: center;
        transition: all 0.3s ease;
        opacity: 0;
    }
    
    .coinflip-notification.show {
        transform: translateX(-50%) translateY(0);
        opacity: 1;
    }
    
    .coinflip-notification.win {
        border-color: #00ff00;
        background: rgba(0, 100, 0, 0.9);
    }
    
    .coinflip-notification.lose {
        border-color: #ff0000;
        background: rgba(100, 0, 0, 0.9);
    }
    
    .notification-content {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 10px;
    }
    
    .notification-icon {
        font-size: 24px;
    }
    
    .notification-text {
        font-size: 16px;
        font-weight: 600;
        color: white;
    }
`;

// Inject notification styles
const styleSheet = document.createElement('style');
styleSheet.textContent = notificationStyles;
document.head.appendChild(styleSheet);