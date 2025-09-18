// Компонент заголовка с профилем пользователя
function loadHeader() {
    const header = document.getElementById('header');
    
    if (window.Telegram.WebApp.initDataUnsafe.user) {
        const user = window.Telegram.WebApp.initDataUnsafe.user;
        
        header.innerHTML = `
            <div class="header">
                <div class="user-header">
                    <div class="avatar">👤</div>
                    <div class="user-info">
                        <div class="username">${user.first_name || user.username || 'Пользователь'}</div>
                        <div class="user-id">ID: ${user.id}</div>
                    </div>
                </div>
            </div>
        `;
    } else {
        header.innerHTML = `
            <div class="header">
                <div class="user-header">
                    <div class="avatar">👤</div>
                    <div class="user-info">
                        <div class="username">Гость</div>
                        <div class="user-id">Авторизуйтесь</div>
                    </div>
                </div>
            </div>
        `;
    }
}

// Загружаем header при старте
document.addEventListener('DOMContentLoaded', loadHeader);