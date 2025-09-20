// Initialize app
        document.addEventListener('DOMContentLoaded', function() {
            const coinImg = document.getElementById('coinImage');
            const betInput = document.getElementById('betAmount');
            const decreaseBtn = document.getElementById('decreaseBtn');
            const increaseBtn = document.getElementById('increaseBtn');
            const halfBtn = document.getElementById('halfBtn');
            const doubleBtn = document.getElementById('doubleBtn');
            const flipButtons = document.querySelectorAll('.flip-btn');
            const seriesToggle = document.getElementById('seriesToggle');
            const potentialWin = document.getElementById('potentialWin');

            // Remove background from coin image
            async function removeBackground() {
                try {
                    const response = await fetch('/coin.png');
                    const blob = await response.blob();
                    
                    // Create image element
                    const img = new Image();
                    img.crossOrigin = 'anonymous';
                    
                    img.onload = function() {
                        // Create canvas
                        const canvas = document.createElement('canvas');
                        const ctx = canvas.getContext('2d');
                        
                        canvas.width = img.naturalWidth;
                        canvas.height = img.naturalHeight;
                        ctx.drawImage(img, 0, 0);
                        
                        // Get image data
                        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
                        const data = imageData.data;
                        
                        // Simple background removal based on transparency
                        for (let i = 0; i < data.length; i += 4) {
                            const r = data[i];
                            const g = data[i + 1];
                            const b = data[i + 2];
                            
                            // Check if pixel is close to white/gray background
                            if (r > 200 && g > 200 && b > 200) {
                                data[i + 3] = 0; // Make transparent
                            }
                        }
                        
                        ctx.putImageData(imageData, 0, 0);
                        coinImg.src = canvas.toDataURL('image/png');
                    };
                    
                    img.src = URL.createObjectURL(blob);
                } catch (error) {
                    console.log('Background removal failed, using original image');
                }
            }

            // Remove background on load
            removeBackground();

            // Bet controls
            decreaseBtn.addEventListener('click', function() {
                let currentValue = parseInt(betInput.value) || 0;
                if (currentValue > 1) {
                    betInput.value = currentValue - 1;
                    updatePotentialWin();
                }
            });

            increaseBtn.addEventListener('click', function() {
                let currentValue = parseInt(betInput.value) || 0;
                betInput.value = currentValue + 1;
                updatePotentialWin();
            });

            halfBtn.addEventListener('click', function() {
                let currentValue = parseInt(betInput.value) || 0;
                betInput.value = Math.max(1, Math.floor(currentValue / 2));
                updatePotentialWin();
            });

            doubleBtn.addEventListener('click', function() {
                let currentValue = parseInt(betInput.value) || 0;
                betInput.value = currentValue * 2;
                updatePotentialWin();
            });

            // Update potential win
            function updatePotentialWin() {
                const betAmount = parseInt(betInput.value) || 0;
                const winAmount = Math.floor(betAmount * 1.96);
                potentialWin.textContent = winAmount + ' TON';
            }

            // Series toggle
            seriesToggle.addEventListener('click', function() {
                this.classList.toggle('active');
            });

            // Flip buttons
            flipButtons.forEach(btn => {
                btn.addEventListener('click', function() {
                    const side = this.getAttribute('data-side');
                    
                    // Add flip animation
                    coinImg.classList.add('flipping');
                    
                    // Remove animation after completion
                    setTimeout(() => {
                        coinImg.classList.remove('flipping');
                        
                        // Simulate random result
                        const result = Math.random() < 0.5 ? 'heads' : 'tails';
                        const won = result === side;
                        
                        // Show result (you can add more visual feedback here)
                        if (won) {
                            console.log('You won!');
                        } else {
                            console.log('You lost!');
                        }
                    }, 2000);
                });
            });

            // Input validation
            betInput.addEventListener('input', function() {
                this.value = this.value.replace(/[^0-9]/g, '');
                if (parseInt(this.value) < 1) {
                    this.value = '1';
                }
                updatePotentialWin();
            });

            // Initialize potential win
            updatePotentialWin();
        });