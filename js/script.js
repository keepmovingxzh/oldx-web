// 状态变量
let isGestureMode = false;
let hands = null;
let camera = null;
let grabbedElement = null; // 当前被抓取的元素
const container = document.getElementById('card-container');
const cards = Array.from(document.querySelectorAll('.module-card'));
const cursor = document.getElementById('hand-cursor');
const statusText = document.getElementById('status-text');

// 物理/布局变量
let cardPositions = []; // 存储卡片的实时位置和速度

// 按钮点击事件
document.getElementById('gesture-btn').addEventListener('click', async () => {
    if (isGestureMode) return;
    
    isGestureMode = true;
    statusText.classList.remove('status-hidden');
    statusText.innerText = "正在启动视觉中枢...请允许摄像头权限";
    
    // 1. 布局转换：从 Grid 变为 Absolute
    switchToFreeLayout();

    // 2. 初始化 MediaPipe Hands
    initMediaPipe();
});

function switchToFreeLayout() {
    // 获取每个卡片当前的绝对位置
    const containerRect = container.getBoundingClientRect();
    
    cards.forEach((card, index) => {
        const rect = card.getBoundingClientRect();
        // 记录初始位置（相对于视口，但我们要转为相对于container或body）
        // 简单起见，我们直接用 fixed 或者 absolute relative to body
        // 这里使用 fixed 方便计算，或者 absolute top/left
        
        // 保存当前计算出的位置
        card.style.left = rect.left + 'px';
        card.style.top = rect.top + 'px';
        card.style.width = rect.width + 'px'; // 锁定宽度
        card.style.height = rect.height + 'px'; // 锁定高度
        
        // 存储物理状态
        cardPositions[index] = {
            x: rect.left,
            y: rect.top,
            width: rect.width,
            height: rect.height,
            vx: 0,
            vy: 0,
            element: card
        };
    });

    // 统一应用 absolute 定位
    cards.forEach(card => {
        card.classList.add('floating');
        card.style.position = 'fixed'; // 使用 fixed 避免滚动导致的计算复杂性
        // 移除 tilt 效果以免冲突，或者保留
        if (card.vanillaTilt) {
            card.vanillaTilt.destroy();
        }
    });
}

function initMediaPipe() {
    const videoElement = document.getElementsByClassName('input_video')[0];

    hands = new Hands({locateFile: (file) => {
        return `https://unpkg.com/@mediapipe/hands/${file}`;
    }});

    hands.setOptions({
        maxNumHands: 1,
        modelComplexity: 1,
        minDetectionConfidence: 0.7,
        minTrackingConfidence: 0.7
    });

    hands.onResults(onResults);

    camera = new Camera(videoElement, {
        onFrame: async () => {
            await hands.send({image: videoElement});
        },
        width: 640,
        height: 480
    });

    camera.start()
        .then(() => {
            statusText.innerText = "系统就绪。请举起手，捏合手指以抓取模块！";
            cursor.classList.remove('cursor-hidden');
        })
        .catch(err => {
            statusText.innerText = "摄像头启动失败：" + err;
            isGestureMode = false;
        });
}

function onResults(results) {
    if (!results.multiHandLandmarks || results.multiHandLandmarks.length === 0) {
        cursor.style.display = 'none';
        releaseGrab();
        return;
    }

    cursor.style.display = 'block';
    
    // 获取第一只手
    const landmarks = results.multiHandLandmarks[0];
    
    // 1. 计算手的位置 (使用食指根部和拇指根部的中间，或者直接用食指指尖)
    // 这里我们用食指指尖 (8) 和 拇指指尖 (4) 的中心作为“光标”
    const indexFinger = landmarks[8];
    const thumb = landmarks[4];
    
    const cursorX = (1 - ((indexFinger.x + thumb.x) / 2)) * window.innerWidth; // 镜像翻转
    const cursorY = ((indexFinger.y + thumb.y) / 2) * window.innerHeight;

    // 更新光标位置
    cursor.style.left = `${cursorX}px`;
    cursor.style.top = `${cursorY}px`;

    // 2. 检测捏合 (Pinch)
    // 计算拇指和食指的距离
    const distance = Math.hypot(
        (indexFinger.x - thumb.x) * window.innerWidth, // 考虑到屏幕比例
        (indexFinger.y - thumb.y) * window.innerHeight
    );
    
    const PINCH_THRESHOLD = 60; // 像素阈值

    if (distance < PINCH_THRESHOLD) {
        cursor.classList.add('pinching');
        handleGrab(cursorX, cursorY);
    } else {
        cursor.classList.remove('pinching');
        releaseGrab();
    }
    
    // 3. 执行物理更新 (排斥效果)
    updatePhysics();
}

function handleGrab(x, y) {
    if (grabbedElement) {
        // 正在抓取中，更新位置
        const index = cards.indexOf(grabbedElement);
        if (index !== -1) {
            // 移动中心到光标位置
            const width = cardPositions[index].width;
            const height = cardPositions[index].height;
            
            cardPositions[index].x = x - width / 2;
            cardPositions[index].y = y - height / 2;
            
            // 应用到 DOM
            updateCardDOM(index);
        }
    } else {
        // 尝试抓取
        // 检查光标是否在某个卡片上
        for (let i = 0; i < cardPositions.length; i++) {
            const pos = cardPositions[i];
            if (x >= pos.x && x <= pos.x + pos.width &&
                y >= pos.y && y <= pos.y + pos.height) {
                
                grabbedElement = pos.element;
                grabbedElement.classList.add('grabbed');
                break;
            }
        }
    }
}

function releaseGrab() {
    if (grabbedElement) {
        grabbedElement.classList.remove('grabbed');
        grabbedElement = null;
    }
}

function updatePhysics() {
    // 简单的排斥逻辑：如果不抓取的卡片和被抓取的卡片重叠，就推开它
    if (!grabbedElement) return; // 只有在抓取时才产生强力挤压效果，或者一直开启也可以

    const grabbedIndex = cards.indexOf(grabbedElement);
    if (grabbedIndex === -1) return;

    const grabbedPos = cardPositions[grabbedIndex];
    const center1 = {
        x: grabbedPos.x + grabbedPos.width / 2,
        y: grabbedPos.y + grabbedPos.height / 2
    };

    for (let i = 0; i < cardPositions.length; i++) {
        if (i === grabbedIndex) continue;

        const targetPos = cardPositions[i];
        const center2 = {
            x: targetPos.x + targetPos.width / 2,
            y: targetPos.y + targetPos.height / 2
        };

        // 计算中心距离
        const dx = center2.x - center1.x;
        const dy = center2.y - center1.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        
        // 简单的矩形碰撞判定稍复杂，这里用圆形近似来做排斥效果
        // 假设半径为卡片宽度的一半
        const minDist = (grabbedPos.width / 2) + (targetPos.width / 2) + 20; // 20px padding

        if (dist < minDist && dist > 0) {
            // 计算斥力方向
            const angle = Math.atan2(dy, dx);
            const pushDist = 5; // 每一帧推开的像素量
            
            targetPos.x += Math.cos(angle) * pushDist;
            targetPos.y += Math.sin(angle) * pushDist;
            
            // 边界检查 (可选，防止被推到屏幕外)
            // targetPos.x = Math.max(0, Math.min(window.innerWidth - targetPos.width, targetPos.x));
            // targetPos.y = Math.max(0, Math.min(window.innerHeight - targetPos.height, targetPos.y));

            updateCardDOM(i);
        }
    }
}

function updateCardDOM(index) {
    const pos = cardPositions[index];
    const el = cards[index];
    el.style.left = pos.x + 'px';
    el.style.top = pos.y + 'px';
}

// 普通鼠标辅助调试 (可选)
// document.addEventListener('mousemove', (e) => {
//     if (!isGestureMode) return;
//     // 这里可以模拟光标移动逻辑用于测试
// });