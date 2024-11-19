document.addEventListener('DOMContentLoaded', () => {
    const socket = io();
    const roomCode = window.location.pathname.split('/')[2];
    const username = localStorage.getItem('username') || 
                     new URLSearchParams(window.location.search).get('username');
    const urlParams = new URLSearchParams(window.location.search);
    const roomPassword = urlParams.get('password');

    const chatMessages = document.getElementById('chat-messages');
    const messageInput = document.getElementById('message-input');
    const sendBtn = document.getElementById('send-btn');
    const userList = document.getElementById('user-list');

    const fileUpload = document.getElementById('file-upload');
    const imageBtn = document.getElementById('image-btn');
    const audioBtn = document.getElementById('audio-btn');
    const videoBtn = document.getElementById('video-btn');

    // Join room
    socket.emit('join-room', {
        roomCode,
        roomPassword,
        username,
        ipAddress: '127.0.0.1' // In production, get real IP
    });

    // Send message
    function sendMessage(message, type = 'text', metadata = {}) {
        if (message.trim()) {
            socket.emit('send-message', {
                roomCode,
                message,
                type,
                metadata
            });
            messageInput.value = '';
        }
    }

    sendBtn.addEventListener('click', () => {
        sendMessage(messageInput.value);
    });

    messageInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            sendMessage(messageInput.value);
        }
    });

    // File upload handling
    function handleFileUpload(fileType) {
        fileUpload.accept = fileType === 'image' ? 'image/*' : 
                             fileType === 'audio' ? 'audio/*' : 
                             fileType === 'video' ? 'video/*' : '*';
        fileUpload.click();
    }

    [imageBtn, audioBtn, videoBtn].forEach(btn => {
        btn.addEventListener('click', (e) => {
            const type = e.target.id.replace('-btn', '');
            handleFileUpload(type);
        });
    });

    fileUpload.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (file && file.size <= 5 * 1024 * 1024) { // 5MB limit
            const reader = new FileReader();
            reader.onload = (event) => {
                socket.emit('upload-file', {
                    base64: event.target.result,
                    type: file.type,
                    name: file.name
                });
            };
            reader.readAsDataURL(file);
        } else {
            alert('File too large. Max 5MB.');
        }
    });

    // Socket event listeners
    socket.on('connect', () => {
        console.log('Connected to server');
    });

    socket.on('chat-history', (messages) => {
        chatMessages.innerHTML = ''; // Clear previous messages
        messages.forEach(renderMessage);
    });

    socket.on('new-message', renderMessage);

    socket.on('user-list', (users) => {
        userList.innerHTML = '';
        users.forEach(user => {
            const li = document.createElement('li');
            li.textContent = `${user.username} (${user.countryCode})`;
            userList.appendChild(li);
        });
    });

    socket.on('join-error', (error) => {
        alert(error);
        window.location.href = '/';
    });

    function renderMessage(message) {
        const messageEl = document.createElement('div');
        messageEl.classList.add('message');
        messageEl.classList.add(
            message.username === username ? 'sent-message' : 'received-message'
        );

        let content = '';
        switch(message.type) {
            case 'text':
                content = message.message;
                break;
            case 'file':
                content = `<a href="${message.metadata.url}" target="_blank">View File</a>`;
                break;
            case 'spotify':
                content = `
                    <div class="spotify-message">
                        <img src="${message.metadata.artwork}" width="50" height="50">
                        <div>
                            <strong>${message.metadata.name}</strong>
                            <p>${message.metadata.artist}</p>
                        </div>
                    </div>
                `;
                break;
        }

        messageEl.innerHTML = `
            <strong>${message.username}</strong>
            <p>${content}</p>
            <small>${new Date(message.timestamp).toLocaleString()}</small>
        `;

        chatMessages.appendChild(messageEl);
        chatMessages.scrollTop = chatMessages.scrollHeight;
    }
});