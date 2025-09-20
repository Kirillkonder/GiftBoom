// coin.js
document.addEventListener('DOMContentLoaded', function() {
    // Элементы DOM
    const coinImage = document.getElementById('coinImage');
    const betAmountInput = document.getElementById('betAmount');
    const decreaseBtn = document.getElementById('decreaseBtn');
    const increaseBtn = document.getElementById('increaseBtn');
    const halfBtn = document.getElementById('halfBtn');
    const doubleBtn = document.getElementById('doubleBtn');
    const flipHeadsBtn = document.querySelector('.flip-btn[data-side="heads"]');
    const flipTailsBtn = document.querySelector('.flip-btn[data-side="tails"]');
    const balanceElement = document.querySelector('.balance span:nth-child(2)');
    const closeBtn = document.querySelector('.close-btn');
    const menuDots = document.querySelector('.menu-dots');

    // Переменные состояния
    let currentBalance = 0;
    let currentBet = 1.0;
    let demoMode = false;
    let telegramId = null;
    let isFlipping = false;

    // Убираем фон у монетки
    coinImage.style.backgroundColor = 'transparent';

    // Инициализация
    async function init() {
        // Получаем Telegram WebApp данные
        if (window.Telegram && Telegram.WebApp) {
            telegramId = Telegram.WebApp.initDataUnsafe.user?.id;
            if (telegramId) {
                await loadUserBalance();
                await updateBalanceDisplay();
            }
        }
        
        // Устанавливаем начальную ставку
        updateBetAmount(currentBet);
        setupEventListeners();
    }

    // Загрузка баланса пользователя
    async function loadUserBalance() {
        try {
            const response = await fetch(`/api/user/balance/${telegramId}`);
            if (response.ok) {
                const data = await response.json();
                currentBalance = demoMode ? data.demo_balance : data.main_balance;
                demoMode = data.demo_mode;
            }
        } catch (error) {
            console.error('Ошибка загрузки баланса:', error);
        }
    }

    // Обновление отображения баланса
    async function updateBalanceDisplay() {
        if (balanceElement) {
            balanceElement.textContent = Math.floor(currentBalance);
        }
    }

    // Обновление суммы ставки
    function updateBetAmount(amount) {
        currentBet = Math.max(0.1, Math.min(10, amount)); // Ограничение 0.1-10 TON
        betAmountInput.value = currentBet.toFixed(1);
        updatePotentialWin();
    }

    // Расчет потенциального выигрыша
    function updatePotentialWin() {
        const potentialWin = currentBet * 1.96; // Множитель 1.96x
        const potentialWinElement = document.getElementById('potentialWin');
        if (potentialWinElement) {
            potentialWinElement.textContent = `${potentialWin.toFixed(2)} TON`;
        }
    }

    // Настройка обработчиков событий
    function setupEventListeners() {
        // Кнопки изменения ставки
        decreaseBtn.addEventListener('click', () => {
            updateBetAmount(currentBet - 0.1);
        });

        increaseBtn.addEventListener('click', () => {
            updateBetAmount(currentBet + 0.1);
        });

        // Кнопки множителей
        halfBtn.addEventListener('click', () => {
            updateBetAmount(currentBet / 2);
        });

        doubleBtn.addEventListener('click', () => {
            updateBetAmount(currentBet * 2);
        });

        // Прямое редактирование ставки
        betAmountInput.addEventListener('change', (e) => {
            let value = parseFloat(e.target.value);
            if (isNaN(value)) value = 1.0;
            updateBetAmount(value);
        });

        // Кнопки выбора стороны
        flipHeadsBtn.addEventListener('click', () => {
            if (!isFlipping && currentBet > 0) {
                flipCoin('heads');
            }
        });

        flipTailsBtn.addEventListener('click', () => {
            if (!isFlipping && currentBet > 0) {
                flipCoin('tails');
            }
        });

        // Кнопка закрытия
        closeBtn.addEventListener('click', () => {
            if (window.Telegram && Telegram.WebApp) {
                Telegram.WebApp.close();
            } else {
                window.history.back();
            }
        });

        // Кнопка меню
        menuDots.addEventListener('click', () => {
            // Здесь можно добавить функционал меню
            console.log('Menu clicked');
        });
    }

    // Функция броска монеты
    async function flipCoin(selectedSide) {
        if (isFlipping) return;
        
        isFlipping = true;
        
        // Проверяем достаточно ли средств
        if (currentBet > currentBalance) {
            alert('Недостаточно средств для ставки');
            isFlipping = false;
            return;
        }

        // Блокируем кнопки во время броска
        flipHeadsBtn.disabled = true;
        flipTailsBtn.disabled = true;

        // Анимация броска
        coinImage.classList.add('flipping');
        
        try {
            // Отправляем запрос на сервер для определения результата
            const response = await fetch('/api/coinflip/bet', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    telegramId: telegramId,
                    betAmount: currentBet,
                    selectedSide: selectedSide,
                    demoMode: demoMode
                })
            });

            if (response.ok) {
                const result = await response.json();
                
                // Ждем завершения анимации
                setTimeout(() => {
                    // Обновляем баланс
                    currentBalance = demoMode ? result.new_demo_balance : result.new_main_balance;
                    updateBalanceDisplay();
                    
                    // Показываем результат
                    showResult(result.win, result.winAmount, selectedSide);
                    
                    // Сбрасываем состояние
                    coinImage.classList.remove('flipping');
                    flipHeadsBtn.disabled = false;
                    flipTailsBtn.disabled = false;
                    isFlipping = false;
                    
                }, 2000); // Время анимации
                
            } else {
                throw new Error('Ошибка сервера');
            }
            
        } catch (error) {
            console.error('Ошибка броска монеты:', error);
            coinImage.classList.remove('flipping');
            flipHeadsBtn.disabled = false;
            flipTailsBtn.disabled = false;
            isFlipping = false;
            alert('Ошибка соединения с сервером');
        }
    }

    // Показать результат
    function showResult(isWin, winAmount, selectedSide) {
        const message = isWin ? 
            `Поздравляем! Вы выиграли ${winAmount.toFixed(2)} TON` : 
            `К сожалению, вы проиграли ${currentBet.toFixed(2)} TON`;
        
        alert(message);
        
        // Можно добавить более красивый вывод результата
        // Например, изменить цвет монетки или показать всплывающее окно
    }

    // Запуск инициализации
    init();
});