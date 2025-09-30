class TonCasinoApp {
    constructor() {
        this.tg = window.Telegram.WebApp;
        this.userData = null;
        this.demoMode = false;
        this.isAdmin = false;
        this.init();
    }

    async init() {
        this.tg.expand();
        this.tg.ready();
        
        await this.loadUserData();
        this.checkAdminStatus();
        this.setupEventListeners();
        this.loadTransactionHistory();
        this.updateModeUI();
    }

 async checkAdminStatus() {
    try {
        const response = await fetch('/api/admin/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                telegramId: this.tg.initDataUnsafe.user.id,
                password: '1234'
            })
        });

        const result = await response.json();
        this.isAdmin = result.isAdmin;
        
        if (this.isAdmin) {
            this.showAdminButton();
        }
    } catch (error) {
        console.error('Admin check error:', error);
    }
}

    showAdminButton() {
        const adminBtn = document.getElementById('admin-button');
        if (adminBtn) {
            adminBtn.style.display = 'block';
        }
    }

 async loadUserData() {
    try {
        const response = await fetch(`/api/user/balance/${this.tg.initDataUnsafe.user.id}`);
        this.userData = await response.json();
        this.demoMode = this.userData.demo_mode;
        this.isAdminUser = this.tg.initDataUnsafe.user.id === 842428912 || this.tg.initDataUnsafe.user.id === 1135073023;
        this.updateUI();
    } catch (error) {
        console.error('Error loading user data:', error);
    }
}

    async loadTransactionHistory() {
        try {
            const response = await fetch(`/api/transactions/${this.tg.initDataUnsafe.user.id}`);
            const data = await response.json();
            this.updateTransactionHistory(data);
        } catch (error) {
            console.error('Error loading transactions:', error);
        }
    }

    async applyPromoCode() {
    const promoCodeInput = document.getElementById('promo-code-input');
    const promoCode = promoCodeInput.value.trim();
    
    if (!promoCode) {
        this.showError('Введите промокод');
        return;
    }
    
    try {
        const response = await fetch('/api/promo/apply', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                telegramId: this.tg.initDataUnsafe.user.id,
                promoCode: promoCode
            })
        });
        
        const result = await response.json();
        
        if (result.success) {
            // 🔥 ИСПРАВЛЕНО: используем правильное поле bonusPercent
            this.showPromoSuccess(`Промокод активирован! +${result.promo.bonusPercent}% к следующему депозиту`);
            promoCodeInput.value = '';
        } else {
            this.showPromoError(result.error);
        }
    } catch (error) {
        console.error('Apply promo error:', error);
        this.showPromoError('Ошибка при применении промокода');
    }
}

showPromoSuccess(message) {
    this.hidePromoMessage();
    
    const successDiv = document.createElement('div');
    successDiv.className = 'promo-success';
    successDiv.textContent = message;
    
    const promoSection = document.querySelector('.promo-section');
    promoSection.appendChild(successDiv);
    
    setTimeout(() => {
        this.hidePromoMessage();
    }, 5000);
}

showPromoError(message) {
    this.hidePromoMessage();
    
    const errorDiv = document.createElement('div');
    errorDiv.className = 'promo-error';
    errorDiv.textContent = message;
    
    const promoSection = document.querySelector('.promo-section');
    promoSection.appendChild(errorDiv);
    
    setTimeout(() => {
        this.hidePromoMessage();
    }, 5000);
}

hidePromoMessage() {
    const promoSection = document.querySelector('.promo-section');
    const successMsg = promoSection.querySelector('.promo-success');
    const errorMsg = promoSection.querySelector('.promo-error');
    
    if (successMsg) successMsg.remove();
    if (errorMsg) errorMsg.remove();
}

// 🔥 ИСПРАВЛЕННАЯ функция processDeposit - берет промокод из модалки
async processDeposit() {
    const amount = parseFloat(document.getElementById('deposit-amount').value);
    
    // 🔥 Берем промокод из модалки депозита (приоритет) или из секции промокодов
    const modalPromoInput = document.getElementById('deposit-promo-code');
    const pagePromoInput = document.getElementById('promo-code-input');
    const promoCode = (modalPromoInput?.value.trim()) || (pagePromoInput?.value?.trim()) || '';
    
    console.log(`💰 Депозит: сумма ${amount}, промокод: "${promoCode}"`);

    if (!amount || amount < 0.3) {
        this.showError('Минимальный депозит: 0.3 TON');
        return;
    }

    try {
        const response = await fetch('/api/create-invoice', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                telegramId: this.tg.initDataUnsafe.user.id,
                amount: amount,
                demoMode: this.demoMode,
                promoCode: promoCode
            })
        });

        const result = await response.json();
        
        console.log('📋 Результат создания инвойса:', result);
        
        if (result.success) {
            if (this.demoMode) {
                await this.loadUserData();
                this.tg.showPopup({
                    title: "✅ Демо-пополнение",
                    message: `Демо-депозит ${amount} TON успешно зачислен!`,
                    buttons: [{ type: "ok" }]
                });
            } else {
                let message = `Откройте Crypto Bot для оплаты ${amount} TON`;
                
                // 🔥 ИСПРАВЛЕНО: Проверяем правильные поля
                if (result.bonus_applied && result.bonus_amount > 0) {
                    message += `\n\n🎁 Бонус: +${result.bonus_amount.toFixed(2)} TON (${result.promo_code})`;
                    message += `\n💎 Итого будет зачислено: ${result.final_amount.toFixed(2)} TON`;
                    
                    // Очищаем промокод после успешного применения
                    if (modalPromoInput) modalPromoInput.value = '';
                    if (pagePromoInput) pagePromoInput.value = '';
                    
                    console.log(`✅ Промокод применен: +${result.bonus_amount.toFixed(2)} TON`);
                } else {
                    console.log('ℹ️ Промокод не применен или бонус 0');
                }
                
                window.open(result.invoice_url, '_blank');
                this.tg.showPopup({
                    title: "Оплата TON",
                    message: message,
                    buttons: [{ type: "ok" }]
                });
                this.checkDepositStatus(result.invoice_id, result.final_amount);
            }
            
            closeDepositModal();
        } else {
            console.log(`❌ Ошибка депозита:`, result.error);
            this.showError('Ошибка при создании депозита: ' + result.error);
        }
    } catch (error) {
        console.error('Deposit error:', error);
        this.showError('Ошибка при создании депозита');
    }
}

    updateTransactionHistory(transactions) {
        const transactionsContainer = document.getElementById('transactions');
        if (transactionsContainer) {
            transactionsContainer.innerHTML = '';
            
            transactions.forEach(transaction => {
                if (transaction.status === 'completed') {
                    const transactionElement = document.createElement('div');
                    transactionElement.className = 'transaction-item';
                    
                    const amountClass = transaction.amount > 0 ? 'transaction-positive' : 'transaction-negative';
                    const sign = transaction.amount > 0 ? '+' : '';
                    const modeBadge = transaction.demo_mode ? ' (TEST)' : ' (REAL)';
                    
                    transactionElement.innerHTML = `
                        <div class="transaction-info">
                            <div>${transaction.type.toUpperCase()}${modeBadge}</div>
                            <div class="transaction-date">${new Date(transaction.created_at).toLocaleDateString()}</div>
                        </div>
                        <div class="transaction-amount ${amountClass}">
                            ${sign}${transaction.amount} TON
                        </div>
                    `;
                    
                    transactionsContainer.appendChild(transactionElement);
                }
            });

            if (transactionsContainer.children.length === 0) {
                transactionsContainer.innerHTML = '<div class="no-transactions">Нет операций</div>';
            }
        }
    }

 updateUI() {
    if (this.userData) {
        const balanceElement = document.getElementById('balance');
        const modeSwitcher = document.querySelector('.mode-switcher');
        const modeBadgeElement = document.getElementById('mode-badge');
        const modeInfoElement = document.getElementById('mode-info');
        const modeButton = document.getElementById('mode-button');
        const depositModeInfo = document.getElementById('deposit-mode-info');
        const withdrawModeInfo = document.getElementById('withdraw-mode-info');
        
        if (modeSwitcher) {
            modeSwitcher.style.display = this.isAdminUser ? 'block' : 'none';
        }
        
        if (balanceElement) {
            const balance = this.demoMode ? this.userData.demo_balance : this.userData.main_balance;
            balanceElement.textContent = balance.toFixed(2);
        }
        
        if (modeBadgeElement && this.isAdminUser) {
            modeBadgeElement.textContent = this.demoMode ? 'TESTNET' : 'MAINNET';
            modeBadgeElement.className = this.demoMode ? 'mode-badge testnet' : 'mode-badge mainnet';
        }
        
        if (modeInfoElement && this.isAdminUser) {
            modeInfoElement.textContent = this.demoMode ? 
                '🔧 Тестовый режим - виртуальные TON' : 
                '🌐 Реальный режим - настоящие TON';
        }
        
        if (modeButton && this.isAdminUser) {
            modeButton.textContent = this.demoMode ? 
                '🔄 Перейти к реальным TON' : 
                '🔄 Перейти к тестовым TON';
            modeButton.className = this.demoMode ? 'btn btn-testnet' : 'btn btn-mainnet';
        }
        
        if (depositModeInfo) {
            depositModeInfo.textContent = this.demoMode ? 
                'Демо-пополнение (виртуальные TON)' : 
                'Реальное пополнение через Crypto Pay';
        }
        
        if (withdrawModeInfo) {
            withdrawModeInfo.textContent = this.demoMode ? 
                'Демо-вывод (виртуальные TON)' : 
                'Реальный вывод через Crypto Pay';
        }
    }
}

    updateModeUI() {
        const modeSwitch = document.getElementById('mode-switch');
        if (modeSwitch) {
            modeSwitch.checked = this.demoMode;
        }
    }

    async toggleMode() {
        try {
            const response = await fetch('/api/user/toggle-demo-mode', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    telegramId: this.tg.initDataUnsafe.user.id
                })
            });

            const result = await response.json();
            
            if (result.success) {
                this.demoMode = result.demo_mode;
                await this.loadUserData();
                
                this.tg.showPopup({
                    title: this.demoMode ? "🔧 Тестовый режим" : "🌐 Реальный режим",
                    message: this.demoMode ? 
                        "Переключено на тестовые TON" : 
                        "Переключено на реальные TON",
                    buttons: [{ type: "ok" }]
                });
                
                await this.loadTransactionHistory();
            }
        } catch (error) {
            console.error('Toggle mode error:', error);
        }
    }

    async openAdminPanel() {
        document.getElementById('admin-modal').style.display = 'block';
        await this.loadAdminData();
    }

    async closeAdminPanel() {
        document.getElementById('admin-modal').style.display = 'none';
    }

  async loadAdminData() {
    try {
        const response = await fetch(`/api/admin/dashboard/${this.tg.initDataUnsafe.user.id}`);
        const data = await response.json();
        
        document.getElementById('admin-bank-balance').textContent = data.bank_balance;
        document.getElementById('admin-demo-bank-balance').textContent = data.demo_bank_balance;
        document.getElementById('admin-total-users').textContent = data.total_users;
        document.getElementById('admin-total-transactions').textContent = data.total_transactions;
        
        const bankElements = document.querySelectorAll('.bank-balance');
        const demoBankElements = document.querySelectorAll('.demo-bank-balance');
        
        bankElements.forEach(el => {
            el.textContent = data.bank_balance;
        });
        
        demoBankElements.forEach(el => {
            el.textContent = data.demo_bank_balance;
        });
        
    } catch (error) {
        console.error('Admin data error:', error);
        alert('Ошибка загрузки админ-панели');
    }
}

    async withdrawProfit() {
        const amount = parseFloat(prompt('Сколько TON вывести?'));
        
        if (!amount || amount < 1) {
            alert('Введите корректную сумму');
            return;
        }

        try {
            const response = await fetch('/api/admin/withdraw-profit', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    telegramId: this.tg.initDataUnsafe.user.id,
                    amount: amount
                })
            });

            const result = await response.json();
            
            if (result.success) {
                alert(`Успешно выведено ${amount} TON! Hash: ${result.hash}`);
                await this.loadAdminData();
            } else {
                alert('Ошибка при выводе: ' + result.error);
            }
        } catch (error) {
            console.error('Withdraw profit error:', error);
            alert('Ошибка при выводе');
        }
    }

    async addDemoBalance() {
        const targetTelegramId = prompt('ID пользователя для пополнения:');
        const amount = parseFloat(prompt('Сумма для пополнения (тестовые TON):'));
        
        if (!targetTelegramId || !amount || amount < 1) {
            alert('Введите корректные данные');
            return;
        }

        try {
            const response = await fetch('/api/admin/add-demo-balance', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    telegramId: this.tg.initDataUnsafe.user.id,
                    targetTelegramId: targetTelegramId,
                    amount: amount
                })
            });

            const result = await response.json();
            
            if (result.success) {
                alert(`Успешно добавлено ${amount} тестовых TON пользователю ${targetTelegramId}`);
            } else {
                alert('Ошибка: ' + result.error);
            }
        } catch (error) {
            console.error('Add demo balance error:', error);
            alert('Ошибка при пополнении баланса');
        }
    }

    showError(message, details = null) {
        this.hideError();
        
        const errorDiv = document.createElement('div');
        errorDiv.id = 'error-message';
        errorDiv.className = 'error-message';
        
        let errorContent = `
            <div class="error-content">
                <div class="error-icon">⚠️</div>
                <div class="error-text">
                    <h4>Ошибка</h4>
                    <p>${message}</p>
                </div>
                <button class="error-close" onclick="app.hideError()">✕</button>
            </div>
        `;
        
        if (details && details.wagered !== undefined) {
            errorContent += `
                <div class="error-details">
                    <p><strong>Отыграно:</strong> ${details.wagered.toFixed(2)} TON</p>
                    <p><strong>Требуется:</strong> ${details.required.toFixed(2)} TON</p>
                    <p><strong>Осталось:</strong> ${details.remaining.toFixed(2)} TON</p>
                </div>
            `;
        }
        
        errorDiv.innerHTML = errorContent;
        
        errorDiv.style.cssText = `
            position: fixed;
            top: 20px;
            left: 50%;
            transform: translateX(-50%);
            z-index: 10000;
            background: linear-gradient(135deg, #ff6b6b, #ee5a52);
            color: white;
            border-radius: 12px;
            padding: 0;
            max-width: 90%;
            width: 400px;
            box-shadow: 0 10px 30px rgba(255, 107, 107, 0.3);
            animation: slideDown 0.3s ease-out;
        `;
        
        const style = document.createElement('style');
        style.textContent = `
            @keyframes slideDown {
                from {
                    opacity: 0;
                    transform: translateX(-50%) translateY(-20px);
                }
                to {
                    opacity: 1;
                    transform: translateX(-50%) translateY(0);
                }
            }
            
            .error-content {
                display: flex;
                align-items: flex-start;
                padding: 16px;
                gap: 12px;
            }
            
            .error-icon {
                font-size: 24px;
                margin-top: 2px;
            }
            
            .error-text {
                flex: 1;
            }
            
            .error-text h4 {
                margin: 0 0 8px 0;
                font-size: 16px;
                font-weight: bold;
            }
            
            .error-text p {
                margin: 0;
                font-size: 14px;
                line-height: 1.4;
            }
            
            .error-close {
                background: rgba(255, 255, 255, 0.2);
                border: none;
                color: white;
                width: 28px;
                height: 28px;
                border-radius: 50%;
                cursor: pointer;
                font-size: 14px;
                display: flex;
                align-items: center;
                justify-content: center;
                transition: background 0.2s;
            }
            
            .error-close:hover {
                background: rgba(255, 255, 255, 0.3);
            }
            
            .error-details {
                background: rgba(0, 0, 0, 0.1);
                padding: 12px 16px;
                border-top: 1px solid rgba(255, 255, 255, 0.1);
                border-radius: 0 0 12px 12px;
            }
            
            .error-details p {
                margin: 4px 0;
                font-size: 13px;
            }
        `;
        
        document.head.appendChild(style);
        document.body.appendChild(errorDiv);
        
        setTimeout(() => {
            this.hideError();
        }, 7000);
    }

    hideError() {
        const errorDiv = document.getElementById('error-message');
        if (errorDiv) {
            errorDiv.remove();
        }
    }

    async checkDepositStatus(invoiceId, expectedAmount = null) {
    console.log(`🔍 Проверка статуса инвойса: ${invoiceId}`);
    
    const checkInterval = setInterval(async () => {
        try {
            const response = await fetch('/api/check-invoice', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    invoiceId: invoiceId,
                    demoMode: this.demoMode
                })
            });
            
            const result = await response.json();
            
            if (result.status === 'paid') {
                clearInterval(checkInterval);
                
                let message = 'Депозит успешно зачислен!';
                if (result.bonus_amount > 0) {
                    message += `\n\n🎁 Бонус: +${result.bonus_amount.toFixed(2)} TON`;
                    message += `\n💎 Итого: ${result.amount.toFixed(2)} TON`;
                }
                
                this.tg.showPopup({
                    title: "✅ Успешно",
                    message: message,
                    buttons: [{ type: "ok" }]
                });
                
                await this.loadUserData();
                await this.loadTransactionHistory();
            } else if (result.status === 'expired' || result.status === 'cancelled') {
                clearInterval(checkInterval);
                this.tg.showPopup({
                    title: "❌ Ошибка",
                    message: 'Платеж отменен или просрочен',
                    buttons: [{ type: "ok" }]
                });
            }
        } catch (error) {
            console.error('Status check error:', error);
        }
    }, 5000);
}

    async processWithdraw() {
        const amount = parseFloat(document.getElementById('withdraw-amount').value);
        const address = document.getElementById('withdraw-address').value;

        if (!amount || amount < 1 || !address) {
            this.showError('Заполните все поля корректно');
            return;
        }

        try {
            const response = await fetch('/api/create-withdrawal', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    telegramId: this.tg.initDataUnsafe.user.id,
                    amount: amount,
                    address: address,
                    demoMode: this.demoMode
                })
            });

            const result = await response.json();
            
            if (result.success) {
                await this.loadUserData();
                
                this.tg.showPopup({
                    title: this.demoMode ? "✅ Демо-вывод" : "⏳ Вывод средств",
                    message: this.demoMode ? 
                        `Демо-вывод ${amount} TON успешно обработан!` :
                        `Запрос на вывод ${amount} TON отправлен! Ожидайте обработки.`,
                    buttons: [{ type: "ok" }]
                });
                
                closeWithdrawModal();
            } else {
                if (result.error === 'Недостаточно отыгрыша') {
                    this.showError(result.message || 'Недостаточно отыгрыша для вывода средств', {
                        wagered: result.wagered,
                        required: result.required,
                        remaining: result.remaining
                    });
                } else {
                    this.showError('Ошибка при выводе: ' + result.error);
                }
            }
        } catch (error) {
            console.error('Withdraw error:', error);
            this.showError('Ошибка при выводе средств');
        }
    }

    setupEventListeners() {
        window.onclick = function(event) {
            const depositModal = document.getElementById('deposit-modal');
            const withdrawModal = document.getElementById('withdraw-modal');
            const adminModal = document.getElementById('admin-modal');
            
            if (event.target === depositModal) closeDepositModal();
            if (event.target === withdrawModal) closeWithdrawModal();
            if (event.target === adminModal) this.closeAdminPanel();
        }.bind(this);
    }
}

// Глобальные функции
let app;

function openDepositModal() {
    document.getElementById('deposit-modal').style.display = 'block';
}

function closeDepositModal() {
    document.getElementById('deposit-modal').style.display = 'none';
    document.getElementById('deposit-amount').value = '';
    const modalPromo = document.getElementById('deposit-promo-code');
    if (modalPromo) modalPromo.value = '';
}

function openWithdrawModal() {
    document.getElementById('withdraw-modal').style.display = 'block';
}

function closeWithdrawModal() {
    document.getElementById('withdraw-modal').style.display = 'none';
    document.getElementById('withdraw-amount').value = '';
    document.getElementById('withdraw-address').value = '';
}

function openAdminPanel() {
    app.openAdminPanel();
}

function closeAdminPanel() {
    app.closeAdminPanel();
}

function toggleMode() {
    app.toggleMode();
}

function processDeposit() {
    app.processDeposit();
}

function processWithdraw() {
    app.processWithdraw();
}

function withdrawProfit() {
    app.withdrawProfit();
}

function addDemoBalance() { 
    app.addDemoBalance();
}

async function openPromoCodesAdmin() {
    document.getElementById('promocodes-admin-modal').style.display = 'block';
    await loadPromoCodesAdmin();
}

async function loadPromoCodesAdmin() {
    try {
        const response = await fetch(`/api/admin/promocodes/${app.tg.initDataUnsafe.user.id}`);
        const result = await response.json();
        
        if (result.success) {
            renderPromoCodesList(result.promoCodes);
        }
    } catch (error) {
        console.error('Load promocodes error:', error);
        alert('Ошибка загрузки промокодов');
    }
}

function renderPromoCodesList(promoCodes) {
    const container = document.getElementById('promocodes-list');
    if (!container) return;

    if (promoCodes.length === 0) {
        container.innerHTML = '<div class="no-promocodes">Нет созданных промокодов</div>';
        return;
    }

    container.innerHTML = promoCodes.map(promo => `
        <div class="promocode-item ${promo.is_active ? 'active' : 'inactive'}">
            <div class="promocode-header">
                <div class="promocode-code">${promo.code}</div>
                <div class="promocode-status">${promo.is_active ? '🟢 Активен' : '🔴 Неактивен'}</div>
            </div>
            <div class="promocode-details">
                <div class="promocode-bonus">+${promo.bonus_percent}% к депозиту</div>
                <div class="promocode-uses">Использован: ${promo.used_count || 0} раз</div>
                ${promo.max_uses ? `<div class="promocode-limit">Лимит: ${promo.max_uses} использований</div>` : '<div class="promocode-limit">Безлимитный</div>'}
                <div class="promocode-description">${promo.description || 'Нет описания'}</div>
                <div class="promocode-meta">
                    Создан: ${new Date(promo.created_at).toLocaleDateString()}
                    ${promo.is_public ? '• 📢 Публичный' : '• 🔒 Приватный'}
                </div>
            </div>
            <div class="promocode-actions">
                <button class="btn btn-small ${promo.is_active ? 'btn-secondary' : 'btn-primary'}" 
                        onclick="togglePromoCode('${promo.code}')">
                    ${promo.is_active ? 'Деактивировать' : 'Активировать'}
                </button>
                <button class="btn btn-small btn-danger" 
                        onclick="deletePromoCode('${promo.code}')">
                    Удалить
                </button>
            </div>
        </div>
    `).join('');
}

async function createNewPromoCode() {
    const code = document.getElementById('new-promo-code').value.trim();
    const bonusPercent = document.getElementById('new-promo-percent').value;
    const isPublic = document.getElementById('new-promo-public').checked;
    const description = document.getElementById('new-promo-description').value;
    const maxUses = document.getElementById('new-promo-max-uses').value;

    if (!code || !bonusPercent) {
        alert('Заполните код и процент бонуса');
        return;
    }

    try {
        const response = await fetch('/api/admin/promocodes/create', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                telegramId: app.tg.initDataUnsafe.user.id,
                code: code,
                bonusPercent: bonusPercent,
                isPublic: isPublic,
                description: description,
                maxUses: maxUses || null
            })
        });

        const result = await response.json();
        
        if (result.success) {
            alert(result.message);
            document.getElementById('new-promo-code').value = '';
            document.getElementById('new-promo-percent').value = '';
            document.getElementById('new-promo-description').value = '';
            document.getElementById('new-promo-max-uses').value = '';
            await loadPromoCodesAdmin();
        } else {
            alert('Ошибка: ' + result.error);
        }
    } catch (error) {
        console.error('Create promocode error:', error);
        alert('Ошибка при создании промокода');
    }
}

async function deletePromoCode(code) {
    if (!confirm(`Удалить промокод ${code}?`)) return;

    try {
        const response = await fetch('/api/admin/promocodes/delete', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                telegramId: app.tg.initDataUnsafe.user.id,
                code: code
            })
        });

        const result = await response.json();
        
        if (result.success) {
            alert(result.message);
            await loadPromoCodesAdmin();
        } else {
            alert('Ошибка: ' + result.error);
        }
    } catch (error) {
        console.error('Delete promocode error:', error);
        alert('Ошибка при удалении промокода');
    }
}

async function togglePromoCode(code) {
    try {
        const response = await fetch('/api/admin/promocodes/toggle', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                telegramId: app.tg.initDataUnsafe.user.id,
                code: code
            })
        });

        const result = await response.json();
        
        if (result.success) {
            await loadPromoCodesAdmin();
        } else {
            alert('Ошибка: ' + result.error);
        }
    } catch (error) {
        console.error('Toggle promocode error:', error);
        alert('Ошибка при изменении статуса промокода');
    }
}

function closePromoCodesAdmin() {
    document.getElementById('promocodes-admin-modal').style.display = 'none';
}

function applyPromoCode() {
    app.applyPromoCode();
}

document.addEventListener('DOMContentLoaded', function() {
    app = new TonCasinoApp();
});
