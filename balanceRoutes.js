const express = require('express');
const router = express.Router();

module.exports = function(db, dbFunctions) {
    const {
        findUserByTelegramId, createUser, updateUserBalance, toggleDemoMode,
        createTransaction, findTransactionByInvoiceId, updateTransactionStatus, getUserTransactions,
        getCasinoBank, getCasinoDemoBank, updateCasinoBank, updateCasinoDemoBank,
        findPromoCode, updatePromoCodeUsedCount,
        updateRTPStats
    } = dbFunctions;

    // 🔥 ИСПРАВЛЕННАЯ функция расчета промокода
    async function calculatePromoCode(telegramId, promoCode, depositAmount) {
        console.log(`🔍 Поиск промокода: ${promoCode} для пользователя ${telegramId}`);
        
        const promo = await findPromoCode(promoCode);
        
        if (!promo) {
            console.log(`❌ Промокод ${promoCode} не найден или неактивен`);
            return { success: false, error: 'Промокод не найден или неактивен' };
        }

        console.log(`📊 Найден промокод: ${promo.code}, бонус: ${promo.bonus_percent}%, использований: ${promo.used_count || 0}/${promo.max_uses || 'безлимит'}`);

        // Проверяем лимит использований
        if (promo.max_uses && (promo.used_count || 0) >= promo.max_uses) {
            console.log(`❌ Лимит использований промокода исчерпан: ${promo.used_count}/${promo.max_uses}`);
            return { success: false, error: 'Лимит использований промокода исчерпан' };
        }

        // Находим пользователя
        const user = await findUserByTelegramId(telegramId);
        if (!user) {
            return { success: false, error: 'Пользователь не найден' };
        }

        // Проверяем, не использовал ли уже пользователь этот промокод в завершенных транзакциях
        // Для этого нужно получить все транзакции пользователя и проверить
        const userTransactions = await getUserTransactions(user.id);
        const userUsedPromo = userTransactions.find(t => 
            t.promo_code === promo.code && t.status === 'completed'
        );

        if (userUsedPromo) {
            console.log(`❌ Пользователь ${telegramId} уже использовал промокод ${promo.code}`);
            return { success: false, error: 'Вы уже использовали этот промокод' };
        }

        // Рассчитываем бонус
        const bonusAmount = Number(depositAmount) * (promo.bonus_percent / 100);
        const totalAmount = Number(depositAmount) + bonusAmount;
        
        console.log(`🎁 Промокод ${promo.code}:`);
        console.log(`   💰 Депозит: ${depositAmount} TON`);
        console.log(`   🎁 Бонус: +${bonusAmount.toFixed(2)} TON (${promo.bonus_percent}%)`);
        console.log(`   💎 Итого: ${totalAmount.toFixed(2)} TON`);
        
        return {
            success: true,
            bonusAmount: bonusAmount,
            bonusPercent: promo.bonus_percent,
            totalAmount: totalAmount,
            promo: {
                code: promo.code,
                bonus_percent: promo.bonus_percent,
                description: promo.description,
                used_count: promo.used_count || 0,
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
            let user = await findUserByTelegramId(parseInt(telegramId));
            
            if (!user) {
                user = await createUser(parseInt(telegramId));
            }

            const amt = Number(amount);
            if (!amt || amt < 0.3) {
                return res.status(400).json({ error: 'Минимальный депозит: 0.3 TON' });
            }

            let finalAmount = amt;
            let bonusAmount = 0;
            let appliedPromoCode = null;
            let promoResult = null;

            // 🔥 ПРИМЕНЯЕМ ПРОМОКОД (только расчет, used_count не трогаем)
            if (promoCode && !demoMode) {
                console.log(`🎁 Применение промокода: ${promoCode}`);
                promoResult = await calculatePromoCode(telegramId, promoCode, amt);
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
                amount: amt.toString(),
                description: `Deposit for user ${telegramId}`,
                hidden_message: `Deposit ${amt} TON${bonusAmount > 0 ? ` + ${bonusAmount.toFixed(2)} TON bonus (${appliedPromoCode})` : ''}`,
                payload: JSON.stringify({
                    telegram_id: telegramId,
                    demo_mode: demoMode,
                    amount: amt,
                    final_amount: finalAmount,
                    bonus_amount: bonusAmount,
                    promo_code: appliedPromoCode
                }),
                paid_btn_name: 'callback',
                paid_btn_url: 'https://t.me/your_bot',
                allow_comments: false
            }, demoMode);

            if (invoice.ok && invoice.result) {
                // Сохраняем транзакцию как pending
                await createTransaction({
                    user_id: user.id,
                    amount: finalAmount,
                    original_amount: amt,
                    bonus_amount: bonusAmount,
                    type: 'deposit',
                    status: 'pending',
                    invoice_id: invoice.result.invoice_id,
                    demo_mode: demoMode,
                    promo_code: appliedPromoCode
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
                    const transaction = await findTransactionByInvoiceId(invoiceId);
                    
                    if (transaction && transaction.status === 'pending') {
                        const user = await findUserByTelegramId(transaction.user_id);
                        const depositAmount = transaction.amount || 0;
                        
                        if (demoMode) {
                            await updateUserBalance(user.telegram_id, user.main_balance, user.demo_balance + depositAmount, user.total_deposits + depositAmount);
                        } else {
                            await updateUserBalance(user.telegram_id, user.main_balance + depositAmount, user.demo_balance, user.total_deposits + depositAmount);
                        }

                        // Обновляем статус транзакции
                        await updateTransactionStatus(transaction.id, 'completed');

                        // 🔥 ОБНОВЛЯЕМ RTP СТАТИСТИКУ
                        if (!demoMode) {
                            updateRTPStats('realBank', depositAmount, 0);
                        }

                        // 🔥 ИНКРЕМЕНТ ПРОМОКОДА ТОЛЬКО ПРИ УСПЕШНОЙ ОПЛАТЕ
                        if (!demoMode && transaction.promo_code) {
                            await updatePromoCodeUsedCount(transaction.promo_code);
                            console.log(`🎁 Промокод ${transaction.promo_code} использован!`);
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
            const user = await findUserByTelegramId(parseInt(telegramId));
            
            if (!user) {
                return res.status(404).json({ error: 'User not found' });
            }

            const balance = demoMode ? user.demo_balance : user.main_balance;
            
            if (balance < amount) {
                return res.status(400).json({ error: 'Недостаточно средств' });
            }

            // Проверка отыгрыша x3
            const totalDeposits = user.total_deposits || 0;
            const requiredWager = totalDeposits * 3;
            
            const userTransactions = await getUserTransactions(user.id);
            const totalWager = userTransactions
                .filter(t => t.type === 'bet' && !t.demo_mode)
                .reduce((sum, t) => sum + (t.amount || 0), 0);

            if (!demoMode && totalWager < requiredWager) {
                const remaining = requiredWager - totalWager;
                return res.status(400).json({ 
                    error: `Необходимо отыграть еще ${remaining.toFixed(2)} TON для вывода` 
                });
            }

            // Создаем транзакцию вывода
            const transaction = await createTransaction({
                user_id: user.id,
                amount: -amount,
                type: 'withdrawal',
                status: 'pending',
                demo_mode: demoMode,
                details: { address }
            });

            // Обновляем баланс пользователя
            if (demoMode) {
                await updateUserBalance(user.telegram_id, user.main_balance, user.demo_balance - amount);
            } else {
                await updateUserBalance(user.telegram_id, user.main_balance - amount, user.demo_balance);
            }

            res.json({ 
                success: true, 
                transaction_id: transaction.id,
                new_balance: demoMode ? user.demo_balance - amount : user.main_balance - amount
            });
        } catch (error) {
            console.error('Create withdrawal error:', error);
            res.status(500).json({ error: 'Server error' });
        }
    });

    // API: Получить баланс пользователя
    router.get('/balance/:telegramId', async (req, res) => {
        const telegramId = parseInt(req.params.telegramId);

        try {
            let user = await findUserByTelegramId(telegramId);
            
            if (!user) {
                user = await createUser(telegramId);
            }

            const realBank = await getCasinoBank();
            const demoBank = await getCasinoDemoBank();

            res.json({
                success: true,
                main_balance: user.main_balance || 0,
                demo_balance: user.demo_balance || 0,
                total_deposits: user.total_deposits || 0,
                demo_mode: user.demo_mode || false,
                is_admin: user.is_admin || false,
                casino_bank: realBank ? realBank.total_balance : 0,
                casino_demo_bank: demoBank ? demoBank.total_balance : 0
            });
        } catch (error) {
            console.error('Get balance error:', error);
            res.status(500).json({ error: 'Server error' });
        }
    });

    // API: Переключить демо-режим
    router.post('/toggle-demo', async (req, res) => {
        const { telegramId } = req.body;

        try {
            const demoMode = await toggleDemoMode(parseInt(telegramId));
            res.json({ success: true, demo_mode: demoMode });
        } catch (error) {
            console.error('Toggle demo error:', error);
            res.status(500).json({ error: 'Server error' });
        }
    });

    // API: Получить историю транзакций
    router.get('/transactions/:telegramId', async (req, res) => {
        const telegramId = parseInt(req.params.telegramId);
        const limit = parseInt(req.query.limit) || 50;

        try {
            const user = await findUserByTelegramId(telegramId);
            
            if (!user) {
                return res.json({ success: true, transactions: [] });
            }

            const transactions = await getUserTransactions(user.id, limit);
            res.json({ success: true, transactions });
        } catch (error) {
            console.error('Get transactions error:', error);
            res.status(500).json({ error: 'Server error' });
        }
    });

    // API: Проверить промокод
    router.post('/check-promo', async (req, res) => {
        const { telegramId, promoCode, depositAmount } = req.body;

        try {
            const result = await calculatePromoCode(telegramId, promoCode, depositAmount);
            res.json(result);
        } catch (error) {
            console.error('Check promo error:', error);
            res.status(500).json({ error: 'Server error' });
        }
    });

    return router;
};