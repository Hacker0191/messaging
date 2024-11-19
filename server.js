require('dotenv').config();
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const admin = require('firebase-admin');
const geoip = require('geoip-lite');
const path = require('path');
const axios = require('axios');
const SpotifyWebApi = require('spotify-web-api-node');
const cloudinary = require('cloudinary').v2;

// Firebase initialization
const firebaseConfig = {
  apiKey: process.env.FIREBASE_API_KEY,
  authDomain: process.env.FIREBASE_AUTH_DOMAIN,
  projectId: process.env.FIREBASE_PROJECT_ID,
  storageBucket: process.env.FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.FIREBASE_APP_ID
};

admin.initializeApp({
  credential: admin.credential.cert({
    type: "service_account",
    project_id: process.env.FIREBASE_PROJECT_ID,
    private_key_id: process.env.FIREBASE_PRIVATE_KEY_ID,
    private_key: process.env.FIREBASE_PRIVATE_KEY ? process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n') : '',
    client_email: process.env.FIREBASE_CLIENT_EMAIL,
    client_id: process.env.FIREBASE_CLIENT_ID
  })
});

const firestore = admin.firestore();

// Cloudinary configuration
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});

// Spotify configuration
const spotifyApi = new SpotifyWebApi({
  clientId: process.env.SPOTIFY_CLIENT_ID,
  clientSecret: process.env.SPOTIFY_CLIENT_SECRET
});

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

app.set('view engine', 'ejs');
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json({limit: '50mb'}));
app.use(express.urlencoded({limit: '50mb', extended: true}));

// Routes
app.get('/', (req, res) => {
  res.render('index');
});

app.get('/chat/:roomCode', (req, res) => {
  res.render('chat', { 
    roomCode: req.params.roomCode,
    username: req.query.username 
  });
});

// Socket.IO handling
const rooms = {};

io.on('connection', (socket) => {
  socket.on('join-room', async (data) => {
    const { roomCode, roomPassword, username, ipAddress } = data;
    const geo = geoip.lookup(ipAddress);
    const countryCode = geo ? geo.country : 'Unknown';

    // Check or create room in Firestore
    const roomRef = firestore.collection('rooms').doc(roomCode);
    const roomDoc = await roomRef.get();

    if (!roomDoc.exists) {
      // Create new room
      await roomRef.set({
        password: roomPassword,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      });
    } else {
      // Verify password for existing room
      const existingRoom = roomDoc.data();
      if (existingRoom.password !== roomPassword) {
        socket.emit('join-error', 'Incorrect room password');
        return;
      }
    }

    socket.join(roomCode);
    socket.roomCode = roomCode;
    socket.username = username;

    // Track room users
    if (!rooms[roomCode]) {
      rooms[roomCode] = {};
    }
    rooms[roomCode][socket.id] = { 
      username, 
      countryCode 
    };

    // Emit updated user list
    io.to(roomCode).emit('user-list', Object.values(rooms[roomCode]));

    // Retrieve previous messages
    try {
      const messagesRef = roomRef.collection('messages');
      const messagesSnapshot = await messagesRef.orderBy('timestamp', 'asc').get();
      const chatHistory = messagesSnapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));
      
      socket.emit('chat-history', chatHistory);
    } catch (error) {
      console.error('Error retrieving messages:', error);
    }
  });

  socket.on('send-message', async (messageData) => {
    const { roomCode, message, type, metadata } = messageData;
    
    try {
      const fullMessage = {
        username: socket.username,
        message,
        type,
        timestamp: admin.firestore.FieldValue.serverTimestamp(),
        metadata: metadata || {}
      };

      // Save to Firestore
      await firestore.collection('rooms').doc(roomCode)
        .collection('messages').add(fullMessage);

      // Broadcast message
      io.to(roomCode).emit('new-message', {
        ...fullMessage,
        timestamp: new Date() // Client-side timestamp
      });
    } catch (error) {
      console.error('Error sending message:', error);
    }
  });

  socket.on('disconnect', () => {
    if (socket.roomCode && rooms[socket.roomCode]) {
      delete rooms[socket.roomCode][socket.id];
      io.to(socket.roomCode).emit('user-list', Object.values(rooms[socket.roomCode]));
    }
  });

  // Spotify song search
  socket.on('spotify-search', async (query) => {
    try {
      // Get access token
      const tokenResponse = await spotifyApi.clientCredentialsGrant();
      spotifyApi.setAccessToken(tokenResponse.body['access_token']);

      // Search tracks
      const searchResults = await spotifyApi.searchTracks(query, { limit: 10 });
      const tracks = searchResults.body.tracks.items.map(track => ({
        id: track.id,
        name: track.name,
        artist: track.artists[0].name,
        album: track.album.name,
        artwork: track.album.images[0]?.url || '',
        previewUrl: track.preview_url || ''
      }));

      socket.emit('spotify-search-results', tracks);
    } catch (error) {
      console.error('Spotify search error:', error);
      socket.emit('spotify-search-error', 'Failed to search tracks');
    }
  });

  // Spotify song share
  socket.on('share-spotify-song', async (songData) => {
    try {
      const fullMessage = {
        username: socket.username,
        message: 'Shared a Spotify song',
        type: 'spotify',
        timestamp: admin.firestore.FieldValue.serverTimestamp(),
        metadata: songData
      };

      // Save to Firestore
      await firestore.collection('rooms').doc(socket.roomCode)
        .collection('messages').add(fullMessage);

      // Broadcast message
      io.to(socket.roomCode).emit('new-message', {
        ...fullMessage,
        timestamp: new Date() // Client-side timestamp
      });
    } catch (error) {
      console.error('Error sharing Spotify song:', error);
      socket.emit('spotify-share-error', 'Failed to share song');
    }
  });

  // File upload handling
  socket.on('upload-file', async (fileData) => {
    try {
      const uploadResult = await cloudinary.uploader.upload(fileData.base64, {
        resource_type: 'auto',
        folder: 'chat-uploads',
        max_bytes: 5 * 1024 * 1024 // 5MB limit
      });

      // Create message for file upload
      const fullMessage = {
        username: socket.username,
        message: 'Uploaded a file',
        type: 'file',
        timestamp: admin.firestore.FieldValue.serverTimestamp(),
        metadata: {
          url: uploadResult.secure_url,
          type: uploadResult.resource_type
        }
      };

      // Save to Firestore
      await firestore.collection('rooms').doc(socket.roomCode)
        .collection('messages').add(fullMessage);

      // Broadcast file upload
      io.to(socket.roomCode).emit('new-message', {
        ...fullMessage,
        timestamp: new Date() // Client-side timestamp
      });
    } catch (error) {
      console.error('File upload error:', error);
      socket.emit('upload-error', 'File upload failed');
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});