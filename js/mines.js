let currentGame = null;
let isDemoMode = true;
let userData = null;
let currentUser = null;

// ==================== НОВЫЙ ФУНКЦИОНАЛ БАЛАНСА ИЗ ROCKET ====================

function openDepositModal() {
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
                telegramId: currentUser.id,
                amount: amount,
                demoMode: isDemoMode
            })
        });

        const result = await response.json();
        
        if (result.success) {
            if (isDemoMode) {
                await loadUserData();
                if (window.Telegram && window.Telegram.WebApp) {
                    window.Telegram.WebApp.showPopup({
                        title: "✅ Демо-пополнение",
                        message: `Демо-депозит ${amount} TON успешно зачислен!`,
                        buttons: [{ type: "ok" }]
                    });
                } else {
                    alert(`Демо-депозит ${amount} TON успешно зачислен!`);
                }
            } else {
                window.open(result.invoice_url, '_blank');
                if (window.Telegram && window.Telegram.WebApp) {
                    window.Telegram.WebApp.showPopup({
                        title: "Оплата TON",
                        message: `Откройте Crypto Bot для оплаты ${amount} TON`,
                        buttons: [{ type: "ok" }]
                    });
                } else {
                    alert(`Откройте Crypto Bot для оплаты ${amount} TON`);
                }
                checkDepositStatus(result.invoice_id);
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

async function checkDepositStatus(invoiceId) {
    const checkInterval = setInterval(async () => {
        try {
            const response = await fetch('/api/check-invoice', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    invoiceId: invoiceId,
                    demoMode: isDemoMode
                })
            });
            
            const result = await response.json();
            
            if (result.status === 'paid') {
                clearInterval(checkInterval);
                if (window.Telegram && window.Telegram.WebApp) {
                    window.Telegram.WebApp.showPopup({
                        title: "✅ Успешно",
                        message: 'Депозит успешно зачислен!',
                        buttons: [{ type: "ok" }]
                    });
                } else {
                    alert('Депозит успешно зачислен!');
                }
                await loadUserData();
            } else if (result.status === 'expired' || result.status === 'cancelled') {
                clearInterval(checkInterval);
                if (window.Telegram && window.Telegram.WebApp) {
                    window.Telegram.WebApp.showPopup({
                        title: "❌ Ошибка",
                        message: 'Платеж отменен или просрочен',
                        buttons: [{ type: "ok" }]
                    });
                } else {
                    alert('Платеж отменен или просрочен');
                }
            }
        } catch (error) {
            console.error('Status check error:', error);
        }
    }, 5000);
}

// Toast уведомления из Rocket
function showToast(type, title, message, duration = 3000) {
    const toastContainer = document.getElementById('toast-container') || createToastContainer();
    
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    
    const icons = {
        success: 'bi bi-check-circle-fill',
        error: 'bi bi-x-circle-fill',
        warning: 'bi bi-exclamation-triangle-fill',
        info: 'bi bi-info-circle-fill',
        win: 'bi bi-trophy-fill'
    };
    
    toast.innerHTML = `
        <i class="toast-icon ${icons[type] || icons.info}"></i>
        <div class="toast-content">
            <div class="toast-title">${title}</div>
            <div class="toast-message">${message}</div>
        </div>
        <button class="toast-close" onclick="this.parentElement.remove()">
            <i class="bi bi-x"></i>
        </button>
    `;
    
    toastContainer.appendChild(toast);
    
    setTimeout(() => {
        toast.classList.add('show');
    }, 10);
    
    if (duration > 0) {
        setTimeout(() => {
            toast.classList.remove('show');
            setTimeout(() => {
                if (toast.parentNode) {
                    toast.parentNode.removeChild(toast);
                }
            }, 300);
        }, duration);
    }
    
    return toast;
}

function createToastContainer() {
    const container = document.createElement('div');
    container.id = 'toast-container';
    container.className = 'toast-container';
    document.body.appendChild(container);
    return container;
}

function initializeUser() {
    const tg = window.Telegram.WebApp;
    if (tg.initDataUnsafe && tg.initDataUnsafe.user) {
        currentUser = {
            id: tg.initDataUnsafe.user.id,
            username: tg.initDataUnsafe.user.username || `User_${tg.initDataUnsafe.user.id}`,
            firstName: tg.initDataUnsafe.user.first_name,
            lastName: tg.initDataUnsafe.user.last_name
        };
    }
}

// Обработчик клика вне модального окна
window.onclick = function(event) {
    const depositModal = document.getElementById('deposit-modal');
    if (event.target === depositModal) {
        closeDepositModal();
    }
}

// ==================== ТВОЙ СТАРЫЙ КОД MINES (БЕЗ ИЗМЕНЕНИЙ) ====================

// Инициализация
document.addEventListener('DOMContentLoaded', function() {
    initializeUser();
    loadUserData();
    document.getElementById('startGame').addEventListener('click', startGame);
    document.getElementById('cashoutBtn').addEventListener('click', cashout);
});

function goBack() {
    window.location.href = 'index.html';
}

async function loadUserData() {
    try {
        const tg = window.Telegram.WebApp;
        if (tg.initDataUnsafe && tg.initDataUnsafe.user) {
            const telegramId = tg.initDataUnsafe.user.id;
            
            // Используем правильный endpoint для получения баланса
            const response = await fetch(`/api/user/balance/${telegramId}`);
            if (response.ok) {
                userData = await response.json();
                // Исправляем здесь - используем правильное поле баланса
                const balance = userData.demo_mode ? userData.demo_balance : userData.main_balance;
                document.getElementById('balance').textContent = balance.toFixed(2);
                isDemoMode = userData.demo_mode;
                document.getElementById('demo-badge').textContent = isDemoMode ? 'TESTNET' : 'MAINNET';
                document.getElementById('demo-badge').style.background = isDemoMode ? '#ffc107' : '#007bff';
                document.getElementById('demo-badge').style.display = isDemoMode ? 'block' : 'none';
            }
        }
    } catch (error) {
        console.error('Error loading user data:', error);
    }
}

async function startGame() {
    const betAmount = parseFloat(document.getElementById('betAmount').value);
    const minesCount = parseInt(document.getElementById('minesCount').value);
    
    if (betAmount < 0.1 || betAmount > 10) {
        showToast('error', 'Ошибка', 'Ставка должна быть от 0.1 до 10 TON');
        return;
    }

    try {
        const tg = window.Telegram.WebApp;
        const telegramId = tg.initDataUnsafe.user.id;

        // ИСПРАВЛЕННЫЙ ENDPOINT - убрал лишний слэш
        const response = await fetch('/api/mines/start', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                telegramId: telegramId,
                betAmount: betAmount,
                minesCount: minesCount,
                demoMode: isDemoMode
            })
        });

        if (!response.ok) {
            const error = await response.json();
            showToast('error', 'Ошибка', error.error || 'Ошибка начала игры');
            return;
        }

        const result = await response.json();
        if (result.success) {
            // Обновляем баланс после успешной ставки
            await updateBalance();
            
            // Создаем объект игры на клиенте
            currentGame = {
                gameId: result.game_id,
                betAmount: betAmount,
                minesCount: minesCount,
                revealedCells: [],
                gameOver: false,
                currentMultiplier: 1.00,
                demoMode: isDemoMode
            };
            
            setupGameUI();
            showToast('success', 'Успех', 'Игра началась!');
        } else {
            showToast('error', 'Ошибка', 'Ошибка начала игры');
        }
    } catch (error) {
        console.error('Error starting game:', error);
        showToast('error', 'Ошибка', 'Ошибка начала игры: ' + error.message);
    }
}

function setupGameUI() {
    document.getElementById('gameInfo').style.display = 'flex';
    document.getElementById('minesGrid').style.display = 'grid';
    document.getElementById('cashoutBtn').disabled = false;
    document.getElementById('startGame').disabled = true;

    updateMultiplier();
    createGrid();
}

function createGrid() {
    const grid = document.getElementById('minesGrid');
    grid.innerHTML = '';
    
    for (let i = 0; i < 25; i++) {
        const cell = document.createElement('div');
        cell.className = 'mine-cell';
        cell.dataset.index = i;
        cell.textContent = '?';
        
        cell.addEventListener('click', () => revealCell(i));
        grid.appendChild(cell);
    }
}

async function revealCell(cellIndex) {
    if (!currentGame || currentGame.gameOver) return;

    try {
        // ИСПРАВЛЕННЫЙ ENDPOINT
        const response = await fetch('/api/mines/open', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                gameId: currentGame.gameId,
                cellIndex: cellIndex,
                telegramId: window.Telegram.WebApp.initDataUnsafe.user.id
            })
        });

        if (!response.ok) {
            const error = await response.json();
            showToast('error', 'Ошибка', error.error || 'Ошибка открытия ячейки');
            return;
        }

        const result = await response.json();
        
        if (result.mine_hit) {
            // Попали на мину
            updateCellUI(cellIndex, true);
            endGame(false);
            showToast('error', 'Мина!', 'Вы попали на мину! Игра окончена.');
        } else {
            // Ячейка безопасна
            currentGame.revealedCells.push(cellIndex);
            currentGame.currentMultiplier = result.multiplier;
            updateCellUI(cellIndex, false);
            updateMultiplier();
            showToast('success', 'Успех!', `Безопасно! Множитель: ${result.multiplier.toFixed(2)}x`);
        }
    } catch (error) {
        console.error('Error revealing cell:', error);
        showToast('error', 'Ошибка', 'Ошибка открытия ячейки');
    }
}

function updateCellUI(cellIndex, isMine) {
    const cell = document.querySelector(`.mine-cell[data-index="${cellIndex}"]`);
    
    if (isMine) {
        cell.className = 'mine-cell mine';
        cell.textContent = '💣';
    } else {
        cell.className = 'mine-cell revealed';
        cell.textContent = '💰';
    }
    
    cell.style.pointerEvents = 'none';
}

function updateMultiplier() {
    document.getElementById('multiplier').textContent = currentGame.currentMultiplier.toFixed(2) + 'x';
    
    if (currentGame.betAmount > 0) {
        const potentialWin = currentGame.betAmount * currentGame.currentMultiplier;
        document.getElementById('potentialWin').textContent = potentialWin.toFixed(2);
    }
}

async function cashout() {
    if (!currentGame || currentGame.gameOver) return;

    try {
        // ИСПРАВЛЕННЫЙ ENDPOINT
        const response = await fetch('/api/mines/cashout', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                gameId: currentGame.gameId,
                telegramId: window.Telegram.WebApp.initDataUnsafe.user.id
            })
        });

        if (!response.ok) {
            const error = await response.json();
            showToast('error', 'Ошибка', error.error || 'Ошибка вывода средств');
            return;
        }

        const result = await response.json();
        if (result.success) {
            endGame(true, result.win_amount);
            await updateBalance();
            showToast('success', 'Поздравляем!', `Вы выиграли ${result.win_amount.toFixed(2)} TON!`);
        }
    } catch (error) {
        console.error('Error cashing out:', error);
        showToast('error', 'Ошибка', 'Ошибка вывода средств');
    }
}

function endGame(isWin, winAmount = 0) {
    document.getElementById('cashoutBtn').disabled = true;
    document.getElementById('startGame').disabled = false;

    const resultMessage = document.getElementById('resultMessage');
    resultMessage.style.display = 'block';

    if (isWin) {
        resultMessage.className = 'result-message win';
        resultMessage.textContent = `Поздравляем! Вы выиграли ${winAmount.toFixed(2)} TON!`;
    } else {
        resultMessage.className = 'result-message lose';
        resultMessage.textContent = 'Игра окончена! Вы проиграли.';
    }

    // Блокируем все ячейки
    document.querySelectorAll('.mine-cell').forEach(cell => {
        cell.style.pointerEvents = 'none';
    });
}

async function updateBalance() {
    try {
        const tg = window.Telegram.WebApp;
        const telegramId = tg.initDataUnsafe.user.id;
        
        const response = await fetch(`/api/user/balance/${telegramId}`);
        if (response.ok) {
            const userData = await response.json();
            // Исправляем здесь
            const balance = userData.demo_mode ? userData.demo_balance : userData.main_balance;
            document.getElementById('balance').textContent = balance.toFixed(2);
            
            // Анимация обновления баланса как в Rocket
            const balanceElement = document.getElementById('balance');
            balanceElement.classList.add('balance-updated');
            setTimeout(() => {
                balanceElement.classList.remove('balance-updated');
            }, 1000);
        }
    } catch (error) {
        console.error('Error updating balance:', error);
    }
}