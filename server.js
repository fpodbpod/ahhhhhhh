const express = require('express');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const cors = require('cors'); // Import the cors package

const app = express();
// Render assigns the port dynamically, so we use process.env.PORT
const port = process.env.PORT || 3000; 

// --- Configuration ---
// Use the persistent disk path you created on Render.
const PERSISTENT_STORAGE_PATH = '/var/data/ahhhhhhh_files'; // Final destination for processed files.
const UPLOAD_DIR = '/tmp/uploads'; // Temporary location for initial uploads.

// Configure multer to save files to the temporary upload directory.
const upload = multer({ dest: UPLOAD_DIR });

// Ensure both directories exist on server startup.
if (!fs.existsSync(PERSISTENT_STORAGE_PATH)) {
    fs.mkdirSync(PERSISTENT_STORAGE_PATH, { recursive: true });
}
if (!fs.existsSync(UPLOAD_DIR)) {
    fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

// Use the cors middleware to handle all CORS-related headers automatically.
// This is more robust than setting headers manually.
app.use(cors());

// --- NEW: Serve static files from a 'public' directory ---
// This tells Express that any files in the 'public' folder should be accessible to the web.
app.use(express.static(path.join(__dirname, 'public')));

// This ensures that when someone visits your site's root URL, they get your app.
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Middleware to parse JSON bodies (needed for the new reset endpoint)
app.use(express.json());

// --- API Endpoint 1: Upload New Recording ---
app.post('/api/upload', upload.single('audio'), async (req, res) => {
    if (!req.file) {
        return res.status(400).send('No audio file uploaded.');
    }
    
    try {
        // --- NEW "DUMB SERVER" STRATEGY ---
        // Simply move the uploaded file directly to persistent storage. No ffmpeg, no processing.
        const tempPath = req.file.path;
        const finalName = `ahhh-${Date.now()}${path.extname(req.file.originalname)}`;
        const finalPath = path.join(PERSISTENT_STORAGE_PATH, finalName);

        fs.renameSync(tempPath, finalPath);
        console.log(`LOG: File saved directly to ${finalPath}`);
        res.status(200).json({ message: 'Successfully added to the communal ahhh!', status: 'processed' });
    } catch (error) {
        console.error('Error saving upload:', error);
        res.status(500).json({ message: 'Failed to process the new recording.', error: error.message });
    }
});

// --- NEW API Endpoint: Serve the list of audio files ---
app.get('/api/playlist', (req, res) => {
    try {
        const files = fs.readdirSync(PERSISTENT_STORAGE_PATH).filter(f => f.endsWith('.mp4') || f.endsWith('.webm'));
        
        // Sort by creation time (newest first) based on the timestamp in the filename
        files.sort((a, b) => {
            const timeA = parseInt(a.split('-')[1]);
            const timeB = parseInt(b.split('-')[1]);
            return timeB - timeA;
        });

        // Special ordering: most recent first, then the rest shuffled
        if (req.query.order === 'special' && files.length > 1) {
            const mostRecent = files.shift();
            // Fisher-Yates shuffle
            for (let i = files.length - 1; i > 0; i--) {
                const j = Math.floor(Math.random() * (i + 1));
                [files[i], files[j]] = [files[j], files[i]];
            }
            files.unshift(mostRecent);
        }

        // Serve the audio files themselves from the persistent storage directory
        app.use('/audio', express.static(PERSISTENT_STORAGE_PATH));
        const urls = files.map(file => `/audio/${file}`);
        res.json(urls);
    } catch (error) {
        console.error('Error fetching playlist:', error);
        res.status(500).json({ error: 'Could not fetch playlist.' });
    }
});

// --- API Endpoint 3: Reset All Recordings (Secret Endpoint) ---
app.post('/api/reset', (req, res) => {
    const { secret } = req.body;
    const RESET_SECRET_KEY = process.env.RESET_SECRET || 'lulu'; // Use environment variable

    if (secret !== RESET_SECRET_KEY) {
        return res.status(403).send('Forbidden: Invalid secret key.');
    }

    try {
        const files = fs.readdirSync(PERSISTENT_STORAGE_PATH);
        if (files.length === 0) {
            return res.status(200).send('Nothing to reset. The communal ahhh was already empty.');
        }

        files.forEach(file => {
            fs.unlinkSync(path.join(PERSISTENT_STORAGE_PATH, file));
        });

        console.log('LOG: All recordings have been deleted by secret key.');
        res.status(200).send('The communal ahhh has been reset.');
    } catch (error) {
        console.error('ERROR: Failed to reset recordings:', error);
        res.status(500).send('An error occurred while trying to reset the recordings.');
    }
});

// --- Start Server ---
app.listen(port, () => {
    console.log(`Server listening on port ${port}`);
});
