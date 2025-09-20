// Управление игровым меню и модальными окнами игр
function openGame(gameType) {
    if (gameType === 'mines') {
        // Перенаправляем на страницу mines.html
        window.location.href = 'mines.html';
    } else if (gameType === 'rocket') {
        // Перенаправляем на страницу rocket.html
        window.location.href = 'rocket.html';
    } else if (gameType === 'coin') {
        // Перенаправляем на страницу coin.html (новая игра)
        window.location.href = 'coin.html';
    
    } else if (gameType === 'plinko'){
        window.location.href = 'plinko.html';

    } else {
        // Для других игр показываем модальные окна
        document.getElementById(`game-${gameType}-modal`).style.display = 'block';
    }
}

function closeGameModal(gameType) {
    document.getElementById(`game-${gameType}-modal`).style.display = 'none';
}

// Закрытие модальных окон игр при клике вне их
window.onclick = function(event) {
    const depositModal = document.getElementById('deposit-modal');
    const withdrawModal = document.getElementById('withdraw-modal');
    const adminModal = document.getElementById('admin-modal');
    
    // Игровые модальные окна
    const minesModal = document.getElementById('game-mines-modal');
    const contractsModal = document.getElementById('game-contracts-modal');
    const casesModal = document.getElementById('game-cases-modal');
    const rocketModal = document.getElementById('game-rocket-modal');
    
    if (event.target === depositModal) {
        closeDepositModal();
    }
    if (event.target === withdrawModal) {
        closeWithdrawModal();
    }
    if (event.target === adminModal) {
        closeAdminPanel();
    }
    if (event.target === minesModal) {
        closeGameModal('mines');
    }
    if (event.target === contractsModal) {
        closeGameModal('contracts');
    }
    if (event.target === casesModal) {
        closeGameModal('cases');
    }
    if (event.target === rocketModal) {
        closeGameModal('rocket');
    }
}