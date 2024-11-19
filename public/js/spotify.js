document.addEventListener('DOMContentLoaded', () => {
    const socket = io();
    const spotifyBtn = document.getElementById('spotify-btn');
    const spotifySearch = document.getElementById('spotify-search');
    const spotifyQuery = document.getElementById('spotify-query');
    const spotifyResults = document.getElementById('spotify-results');

    spotifyBtn.addEventListener('click', () => {
        spotifySearch.style.display = spotifySearch.style.display === 'none' ? 'block' : 'none';
    });

    spotifyQuery.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            const query = spotifyQuery.value.trim();
            if (query) {
                socket.emit('spotify-search', query);
            }
        }
    });

    socket.on('spotify-search-results', (tracks) => {
        spotifyResults.innerHTML = tracks.map(track => `
            <div class="spotify-track">
                <img src="${track.artwork}" width="50" height="50">
                <div>
                    <strong>${track.name}</strong>
                    <p>${track.artist} - ${track.album}</p>
                    <button onclick="shareSong('${track.name}', '${track.artist}', '${track.artwork}')">Share</button>
                </div>
            </div>
        `).join('');
    });

    // Attach to window to make accessible
    window.shareSong = (name, artist, artwork) => {
        socket.emit('share-spotify-song', { 
            name, 
            artist, 
            artwork 
        });
    };

    // Handle spotify share errors
    socket.on('spotify-share-error', (error) => {
        console.error('Spotify Share Error:', error);
        alert(error);
    });
});