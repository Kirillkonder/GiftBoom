 let currentGame = null;
        let isDemoMode = true;
        let userData = null;

        // Инициализация
        document.addEventListener('DOMContentLoaded', function() {
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
        alert('Ставка должна быть от 0.1 до 10 TON');
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
            alert(error.error || 'Ошибка начала игры');
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
        } else {
            alert('Ошибка начала игры');
        }
    } catch (error) {
        console.error('Error starting game:', error);
        alert('Ошибка начала игры: ' + error.message);
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
                alert(error.error || 'Ошибка открытия ячейки');
                return;
            }

            const result = await response.json();
            
            if (result.mine_hit) {
                // Попали на мину
                updateCellUI(cellIndex, true);
                endGame(false);
            } else {
                // Ячейка безопасна
                currentGame.revealedCells.push(cellIndex);
                currentGame.currentMultiplier = result.multiplier;
                updateCellUI(cellIndex, false);
                updateMultiplier();
            }
        } catch (error) {
            console.error('Error revealing cell:', error);
            alert('Ошибка открытия ячейки');
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
                        alert(error.error || 'Ошибка вывода средств');
                        return;
                    }

                    const result = await response.json();
                    if (result.success) {
                        endGame(true, result.win_amount);
                        await updateBalance();
                    }
                } catch (error) {
                    console.error('Error cashing out:', error);
                    alert('Ошибка вывода средств');
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
        }
    } catch (error) {
        console.error('Error updating balance:', error);
    }
}