const express = require('express');
const router = express.Router();

module.exports = function(db, users, transactions, cryptoPayRequest, updateCasinoBank, updateCasinoDemoBank, updateRTPStats) {

    // Функция применения промокода - ИСПРАВЛЕННАЯ ВЕРСИЯ
function applyPromoCode(telegramId, promoCode, depositAmount) {
    console.log(`🔍 Поиск промокода: ${promoCode} для пользователя ${telegramId}`);
    
    const promo = db.getCollection('promo_codes').findOne({ 
        code: promoCode.toUpperCase(),
        is_active: true 
    });
    
    if (!promo) {
        console.log(`❌ Промокод ${promoCode} не найден или неактивен`);
        return { success: false, error: 'Промокод не найден или неактивен' };
    }

    console.log(`📊 Найден промокод: ${promo.code}, бонус: ${promo.bonus_percent}%, использований: ${promo.used_count}/${promo.max_uses || 'безлимит'}`);

    // Проверяем лимит использований
    if (promo.max_uses && promo.used_count >= promo.max_uses) {
        console.log(`❌ Лимит использований промокода исчерпан: ${promo.used_count}/${promo.max_uses}`);
        return { success: false, error: 'Лимит использований промокода исчерпан' };
    }

    // Находим пользователя
    const user = users.findOne({ telegram_id: parseInt(telegramId) });
    if (!user) {
        return { success: false, error: 'Пользователь не найден' };
    }

    // Проверяем, не использовал ли уже пользователь промокод
    const userUsedPromo = transactions.findOne({
        user_id: user.$loki,
        promo_code: promo.code,
        status: 'completed'
    });

    if (userUsedPromo) {
        console.log(`❌ Пользователь ${telegramId} уже использовал промокод ${promo.code}`);
        return { success: false, error: 'Вы уже использовали этот промокод' };
    }

    // Применяем промокод
    const bonusAmount = depositAmount * (promo.bonus_percent / 100);
    const totalAmount = depositAmount + bonusAmount;
    
    // 🔥 ИСПРАВЛЕНИЕ: Правильно обновляем счетчик использований
    const updatedUsedCount = (promo.used_count || 0) + 1;
    db.getCollection('promo_codes').update({
        ...promo,
        used_count: updatedUsedCount
    });

    console.log(`🎁 Применен промокод ${promo.code} для пользователя ${telegramId}:`);
    console.log(`   💰 Депозит: ${depositAmount.toFixed(2)} TON`);
    console.log(`   🎁 Бонус: +${bonusAmount.toFixed(2)} TON (${promo.bonus_percent}%)`);
    console.log(`   💎 Итого: ${totalAmount.toFixed(2)} TON`);
    console.log(`   📊 Использований: ${updatedUsedCount}/${promo.max_uses || 'безлимит'}`);
    
    return {
        success: true,
        bonusAmount: bonusAmount,
        bonusPercent: promo.bonus_percent,
        totalAmount: totalAmount,
        promo: {
            code: promo.code,
            bonus_percent: promo.bonus_percent,
            description: promo.description,
            used_count: updatedUsedCount, // 🔥 Теперь правильное значение
            max_uses: promo.max_uses,
            is_public: promo.is_public
        }
    };
}

    // API: Создать инвойс для депозита
    router.post('/create-invoice', async (req, res) => {
    const { telegramId, amount, demoMode, promoCode } = req.body;

    console.log(`💰 Создание инвойса: пользователь ${telegramId}, сумма ${amount}, демо: ${demoMode}, промокод: ${promoCode}`);

    try {
        const user = users.findOne({ telegram_id: parseInt(telegramId) });
        
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        // 🔥 ИСПРАВЛЕНИЕ: Минимальный депозит 0.3 TON вместо 3 TON
        if (amount < 0.3) {
            return res.status(400).json({ error: 'Минимальный депозит: 0.3 TON' });
        }

        let finalAmount = parseFloat(amount);
        let bonusAmount = 0;
        let appliedPromoCode = null;
        let promoResult = null;

        // 🔥 НОВАЯ ЛОГИКА: Применяем промокод если передан
        if (promoCode && !demoMode) {
            console.log(`🎁 Применение промокода: ${promoCode}`);
            promoResult = applyPromoCode(telegramId, promoCode, amount);
            if (promoResult.success) {
                finalAmount = promoResult.totalAmount;
                bonusAmount = promoResult.bonusAmount;
                appliedPromoCode = promoCode.toUpperCase();
                console.log(`✅ Промокод применен: +${bonusAmount.toFixed(2)} TON (${promoResult.bonusPercent}%)`);
            } else {
                console.log(`❌ Ошибка промокода: ${promoResult.error}`);
                return res.status(400).json({ error: promoResult.error });
            }
        } else if (promoCode && demoMode) {
            console.log(`ℹ️ Промокоды не применяются в демо-режиме`);
        }

        const invoice = await cryptoPayRequest('createInvoice', {
            asset: 'TON',
            amount: amount.toString(), // Отправляем исходную сумму в Crypto Pay
            description: `Deposit for user ${telegramId}`,
            hidden_message: `Deposit ${amount} TON${bonusAmount > 0 ? ` + ${bonusAmount.toFixed(2)} TON bonus (${appliedPromoCode})` : ''}`,
            payload: JSON.stringify({
                telegram_id: telegramId,
                demo_mode: demoMode,
                amount: amount,
                final_amount: finalAmount, // Сохраняем итоговую сумму с бонусом
                bonus_amount: bonusAmount,
                promo_code: appliedPromoCode
            }),
            paid_btn_name: 'callback',
            paid_btn_url: 'https://t.me/your_bot',
            allow_comments: false
        }, demoMode);

        if (invoice.ok && invoice.result) {
            // Сохраняем транзакцию как ожидающую
            transactions.insert({
                user_id: user.$loki,
                amount: finalAmount, // Сохраняем итоговую сумму с бонусом
                original_amount: parseFloat(amount), // Сохраняем исходную сумму
                bonus_amount: bonusAmount,
                type: 'deposit',
                status: 'pending',
                invoice_id: invoice.result.invoice_id,
                demo_mode: demoMode,
                promo_code: appliedPromoCode,
                created_at: new Date()
            });

            console.log(`✅ Инвойс создан: ${invoice.result.invoice_id}`);
            
            res.json({
                success: true,
                invoice_url: invoice.result.pay_url,
                invoice_id: invoice.result.invoice_id,
                bonus_applied: bonusAmount > 0,
                bonus_amount: bonusAmount,
                bonus_percent: promoResult ? promoResult.bonusPercent : 0,
                final_amount: finalAmount,
                promo_code: appliedPromoCode
            });
        } else {
            console.log(`❌ Ошибка создания инвойса:`, invoice);
            res.status(500).json({ error: 'Failed to create invoice' });
        }
    } catch (error) {
        console.error('Create invoice error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

    // API: Проверить статус инвойса
    router.post('/check-invoice', async (req, res) => {
        const { invoiceId, demoMode } = req.body;

        try {
            const invoice = await cryptoPayRequest('getInvoices', {
                invoice_ids: invoiceId
            }, demoMode);

            if (invoice.ok && invoice.result.items.length > 0) {
                const invoiceData = invoice.result.items[0];
                
                if (invoiceData.status === 'paid') {
                    // Находим транзакцию и обновляем баланс
                    const transaction = transactions.findOne({ invoice_id: invoiceId });
                    
                    if (transaction && transaction.status === 'pending') {
                        const user = users.get(transaction.user_id);
                        
                        // 🔥 ОБНОВЛЕНИЕ: Используем final_amount вместо amount
                        const depositAmount = transaction.final_amount || transaction.amount;
                        
                        if (demoMode) {
                            users.update({
                                ...user,
                                demo_balance: user.demo_balance + depositAmount,
                                total_deposits: (user.total_deposits || 0) + depositAmount
                            });
                        } else {
                            users.update({
                                ...user,
                                main_balance: user.main_balance + depositAmount,
                                total_deposits: (user.total_deposits || 0) + depositAmount
                            });
                        }

                        // Обновляем статус транзакции
                        transactions.update({
                            ...transaction,
                            status: 'completed',
                            updated_at: new Date()
                        });

                        // 🔥 ОБНОВЛЯЕМ RTP СТАТИСТИКУ
                        if (!demoMode) {
                            updateRTPStats('realBank', depositAmount, 0);
                        }

                        res.json({ 
                            success: true, 
                            status: 'paid',
                            amount: depositAmount,
                            bonus_amount: transaction.bonus_amount || 0,
                            promo_code: transaction.promo_code
                        });
                    } else {
                        res.json({ success: false, status: 'not_found' });
                    }
                } else {
                    res.json({ success: true, status: invoiceData.status });
                }
            } else {
                res.json({ success: false, status: 'not_found' });
            }
        } catch (error) {
            console.error('Check invoice error:', error);
            res.status(500).json({ error: 'Server error' });
        }
    });

    // API: Создать вывод средств
    router.post('/create-withdrawal', async (req, res) => {
        const { telegramId, amount, address, demoMode } = req.body;

        try {
            const user = users.findOne({ telegram_id: parseInt(telegramId) });
            
            if (!user) {
                return res.status(404).json({ error: 'User not found' });
            }

            const balance = demoMode ? user.demo_balance : user.main_balance;
            
            if (balance < amount) {
                return res.status(400).json({ error: 'Недостаточно средств' });
            }

            // НОВАЯ ПРОВЕРКА: Отыгрыш x3 от общих депозитов
            const totalDeposits = user.total_deposits || 0;
            const requiredWager = totalDeposits * 3;
            
            // Считаем общую сумму ставок пользователя
            const userTransactions = transactions.find({ 
                user_id: user.$loki, 
                demo_mode: demoMode,
                status: 'completed'
            });
            
            const totalWagered = userTransactions
                .filter(t => t.type.includes('loss') || t.type.includes('bet'))
                .reduce((sum, t) => sum + Math.abs(t.amount), 0);

            if (totalWagered < requiredWager) {
                const remaining = requiredWager - totalWagered;
                return res.status(400).json({ 
                    error: 'Недостаточно отыгрыша',
                    wagered: totalWagered,
                    required: requiredWager,
                    remaining: remaining,
                    message: `Необходимо отыграть еще ${remaining.toFixed(2)} TON (x3 от депозитов)`
                });
            }

            if (demoMode) {
                // Для демо режима просто списываем баланс
                users.update({
                    ...user,
                    demo_balance: user.demo_balance - amount
                });

                transactions.insert({
                    user_id: user.$loki,
                    amount: -amount,
                    type: 'withdrawal',
                    status: 'completed',
                    demo_mode: true,
                    address: address,
                    created_at: new Date()
                });

                res.json({
                    success: true,
                    message: 'Withdrawal completed (demo mode)',
                    new_balance: user.demo_balance - amount
                });
            } else {
                // Для реального режима создаем вывод через Crypto Pay
                const transfer = await cryptoPayRequest('transfer', {
                    user_id: telegramId,
                    asset: 'TON',
                    amount: amount.toString(),
                    spend_id: `withdrawal_${Date.now()}_${telegramId}`
                }, false);

                if (transfer.ok && transfer.result) {
                    // Обновляем баланс пользователя и банк казино
                    users.update({
                        ...user,
                        main_balance: user.main_balance - amount
                    });
                    
                    updateCasinoBank(-amount);

                    transactions.insert({
                        user_id: user.$loki,
                        amount: -amount,
                        type: 'withdrawal',
                        status: 'completed',
                        demo_mode: false,
                        address: address,
                        hash: transfer.result.hash,
                        created_at: new Date()
                    });

                    res.json({
                        success: true,
                        message: 'Withdrawal completed',
                        hash: transfer.result.hash,
                        new_balance: user.main_balance - amount
                    });
                } else {
                    res.status(500).json({ error: 'Withdrawal failed' });
                }
            }
        } catch (error) {
            console.error('Create withdrawal error:', error);
            res.status(500).json({ error: 'Server error' });
        }
    });

    // API: Получить транзакции пользователя
    router.get('/transactions/:telegramId', async (req, res) => {
        const telegramId = parseInt(req.params.telegramId);

        try {
            const user = users.findOne({ telegram_id: telegramId });
            
            if (!user) {
                return res.status(404).json({ error: 'User not found' });
            }

            const userTransactions = transactions.find({ user_id: user.$loki })
                .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
                .slice(0, 50);

            res.json(userTransactions);
        } catch (error) {
            console.error('Get transactions error:', error);
            res.status(500).json({ error: 'Server error' });
        }
    });

    // API: Получить баланс пользователя
    router.get('/user/balance/:telegramId', async (req, res) => {
        const telegramId = parseInt(req.params.telegramId);
        // Только эти два пользователя могут использовать демо режим
        const isAdminUser = telegramId === 842428912 || telegramId === 1135073023;

        try {
            const user = users.findOne({ telegram_id: telegramId });
            
            if (!user) {
                // Создаем нового пользователя если не найден
                const newUser = users.insert({
                    telegram_id: telegramId,
                    main_balance: 0,
                    demo_balance: isAdminUser ? 50 : 0, // 50 TON для админов вместо 1000
                    total_deposits: 0, // Новое поле
                    created_at: new Date(),
                    demo_mode: false,
                    is_admin: telegramId === parseInt(process.env.OWNER_TELEGRAM_ID) || telegramId === 1135073023
                });
                
                res.json({
                    main_balance: newUser.main_balance,
                    demo_balance: newUser.demo_balance,
                    demo_mode: newUser.demo_mode,
                    is_admin: newUser.is_admin,
                    total_deposits: newUser.total_deposits
                });
            } else {
                res.json({
                    main_balance: user.main_balance,
                    demo_balance: user.demo_balance,
                    demo_mode: user.demo_mode,
                    is_admin: user.is_admin,
                    total_deposits: user.total_deposits || 0
                });
            }
        } catch (error) {
            console.error('Get balance error:', error);
            res.status(500).json({ error: 'Server error' });
        }
    });

    // API: Переключить демо режим (только для админов)
    router.post('/user/toggle-demo-mode', async (req, res) => {
        const { telegramId } = req.body;

        try {
            const user = users.findOne({ telegram_id: parseInt(telegramId) });
            
            if (!user) {
                return res.status(404).json({ error: 'User not found' });
            }

            // Проверяем, что это админ (только эти два ID могут использовать демо режим)
            if (parseInt(telegramId) !== 842428912 && parseInt(telegramId) !== 1135073023) {
                return res.status(403).json({ error: 'Demo mode not available' });
            }

            users.update({
                ...user,
                demo_mode: !user.demo_mode
            });

            console.log(`Пользователь ${telegramId} переключил демо режим: ${!user.demo_mode}`);

            res.json({
                success: true,
                demo_mode: !user.demo_mode
            });
        } catch (error) {
            console.error('Toggle demo mode error:', error);
            res.status(500).json({ error: 'Server error' });
        }
    });

    return router;
};