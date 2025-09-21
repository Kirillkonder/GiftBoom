// rocketRoutes.js
const express = require('express');
const router = express.Router();

module.exports = function(rocketGame, db, users, transactions, rocketGames, rocketBets, updateCasinoBank, updateCasinoDemoBank, updateRTPStats, getUserDisplayName, broadcastRocketUpdate) {

    // API: Сделать ставку в Rocket
    router.post('/rocket/bet', async (req, res) => {
        const { telegramId, betAmount, demoMode, username } = req.body;

        try {
            const user = users.findOne({ telegram_id: parseInt(telegramId) });
            
            if (!user) {
                return res.status(404).json({ error: 'User not found' });
            }

            // ПРОВЕРКА: Уже есть ставка от этого пользователя
            const existingBet = rocketGame.players.find(p => 
               p.userId == telegramId && !p.isBot
            );
            
            if (existingBet) {
                return res.status(400).json({ error: 'Вы уже сделали ставку в этом раунде' });
            }

            // ПРОВЕРКА: Время для ставок истекло
            if (rocketGame.status !== 'counting' || Date.now() > rocketGame.endBetTime) {
                return res.status(400).json({ error: 'Время для ставок закончилось' });
            }

            const balance = demoMode ? user.demo_balance : user.main_balance;
            
            if (balance < betAmount) {
                return res.status(400).json({ error: 'Недостаточно средств' });
            }

            // Списываем ставку
            if (demoMode) {
                users.update({
                    ...user,
                    demo_balance: user.demo_balance - betAmount
                });
                updateCasinoDemoBank(betAmount); // Ставка идет в демо-банк
                updateRTPStats('demoBank', betAmount, 0);
            } else {
                users.update({
                    ...user,
                    main_balance: user.main_balance - betAmount
                });
                updateCasinoBank(betAmount); // Ставка идет в реальный банк
                updateRTPStats('realBank', betAmount, 0);
            }

            // Добавляем игрока в текущую игру
            const player = {
                userId: telegramId,
                name: username || getUserDisplayName(user),
                betAmount: parseFloat(betAmount),
                demoMode: demoMode,
                cashedOut: false,
                cashoutMultiplier: null,
                winAmount: 0,
                isBot: false
            };

            rocketGame.players.push(player);

            // Функция broadcastRocketUpdate должна быть доступна в этом контексте
            if (typeof broadcastRocketUpdate === 'function') {
                broadcastRocketUpdate();
            }

            res.json({
                success: true,
                new_balance: demoMode ? user.demo_balance - betAmount : user.main_balance - betAmount
            });
        } catch (error) {
            console.error('Rocket bet error:', error);
            res.status(500).json({ error: 'Server error' });
        }
    });

    // API: Забрать выигрыш в Rocket
    router.post('/rocket/cashout', async (req, res) => {
        const { telegramId } = req.body;

        try {
            const user = users.findOne({ telegram_id: parseInt(telegramId) });
            
            if (!user) {
                return res.status(404).json({ error: 'User not found' });
            }

            if (rocketGame.status !== 'flying') {
                return res.status(400).json({ error: 'Нельзя забрать выигрыш сейчас' });
            }

            // Находим игрока
            const player = rocketGame.players.find(p => p.userId == telegramId && !p.isBot);
            
            if (!player || player.cashedOut) {
                return res.status(400).json({ error: 'Игрок не найден или уже забрал выигрыш' });
            }

            // Начисляем выигрыш
            const winAmount = player.betAmount * rocketGame.multiplier;
            
            if (player.demoMode) {
                users.update({
                    ...user,
                    demo_balance: user.demo_balance + winAmount
                });
                updateCasinoDemoBank(-winAmount); // Выплата из демо-банка
                updateRTPStats('demoBank', 0, winAmount);
            } else {
                users.update({
                    ...user,
                    main_balance: user.main_balance + winAmount
                });
                updateCasinoBank(-winAmount); // Выплата из реального банка
                updateRTPStats('realBank', 0, winAmount);
            }

            // Обновляем данные игрока
            player.cashedOut = true;
            player.cashoutMultiplier = rocketGame.multiplier;
            player.winAmount = winAmount;

            // Функция broadcastRocketUpdate должна быть доступна в этом контексте
            if (typeof broadcastRocketUpdate === 'function') {
                broadcastRocketUpdate();
            }

            res.json({
                success: true,
                multiplier: rocketGame.multiplier,
                winAmount: winAmount,
                new_balance: player.demoMode ? user.demo_balance + winAmount : user.main_balance + winAmount
            });
        } catch (error) {
            console.error('Rocket cashout error:', error);
            res.status(500).json({ error: 'Server error' });
        }
    });

    // API: Получить историю Rocket
    router.get('/rocket/history', async (req, res) => {
        try {
            res.json(rocketGame.history.slice(0, 20));
        } catch (error) {
            console.error('Get rocket history error:', error);
            res.status(500).json({ error: 'Server error' });
        }
    });

    // API: Получить текущую игру Rocket
    router.get('/rocket/current', async (req, res) => {
        try {
            res.json(rocketGame);
        } catch (error) {
            console.error('Get current rocket game error:', error);
            res.status(500).json({ error: 'Server error' });
        }
    });

    return router;
};