const express = require('express');
const router = express.Router();

module.exports = function(db, users, transactions, cryptoPayRequest, updateCasinoBank, updateCasinoDemoBank, updateRTPStats) {

    // API: Создать инвойс для депозита
    // API: Создать инвойс для депозита
router.post('/create-invoice', async (req, res) => {
    const { telegramId, amount, demoMode } = req.body;

    try {
        const user = users.findOne({ telegram_id: parseInt(telegramId) });
        
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        // МИНИМАЛЬНЫЙ ДЕПОЗИТ: 0.1 TON (минимально возможный для Crypto Bot)
        if (amount < 0.1) {
            return res.status(400).json({ error: 'Минимальный депозит: 0.1 TON' });
        }

        const invoice = await cryptoPayRequest('createInvoice', {
            asset: 'TON',
            amount: amount.toString(),
            description: `Deposit for user ${telegramId}`,
            hidden_message: `Deposit ${amount} TON`,
            payload: JSON.stringify({
                telegram_id: telegramId,
                demo_mode: demoMode,
                amount: amount
            }),
            paid_btn_name: 'callback',
            paid_btn_url: 'https://t.me/your_bot',
            allow_comments: false
        }, demoMode);

        if (invoice.ok && invoice.result) {
            // Сохраняем транзакцию как ожидающую
            transactions.insert({
                user_id: user.$loki,
                amount: amount,
                type: 'deposit',
                status: 'pending',
                invoice_id: invoice.result.invoice_id,
                demo_mode: demoMode,
                created_at: new Date()
            });

            res.json({
                success: true,
                invoice_url: invoice.result.pay_url,
                invoice_id: invoice.result.invoice_id
            });
        } else {
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
                        
                        if (demoMode) {
                            users.update({
                                ...user,
                                demo_balance: user.demo_balance + transaction.amount,
                                total_deposits: (user.total_deposits || 0) + transaction.amount
                            });
                        } else {
                            users.update({
                                ...user,
                                main_balance: user.main_balance + transaction.amount,
                                total_deposits: (user.total_deposits || 0) + transaction.amount
                            });
                        }

                        // Обновляем статус транзакции
                        transactions.update({
                            ...transaction,
                            status: 'completed',
                            updated_at: new Date()
                        });

                        res.json({ 
                            success: true, 
                            status: 'paid',
                            amount: transaction.amount
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