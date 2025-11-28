const express = require('express');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const ffmpeg = require('fluent-ffmpeg');
// >>> FIX 2: Import the static FFmpeg path
const ffmpegStatic = require('@ffmpeg-installer/ffmpeg').path; 

// >>> FIX 2: Tell fluent-ffmpeg where to find the binary
ffmpeg.setFfmpegPath(ffmpegStatic); 

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

// Middleware to parse JSON bodies (needed for the new reset endpoint)
app.use(express.json());

// Middleware to allow your Cargo site (different domain) to talk to the server
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type');

    // Handle preflight requests (the browser sends an OPTIONS request first)
    if (req.method === 'OPTIONS') {
        return res.sendStatus(204);
    }

    next();
});

// --- API Endpoint 1: Upload New Recording ---
app.post('/api/upload', upload.single('audio'), async (req, res) => {
    if (!req.file) {
        return res.status(400).send('No audio file uploaded.');
    }

    const tempUploadPath = req.file.path; // Path to the file in /tmp/uploads
    const finalPath = path.join(PERSISTENT_STORAGE_PATH, `ahhh-${Date.now()}.webm`); // Define the final destination path
    
    try {
        // We will process the uploaded file to trim silence, then save it back to its final location.
        console.log(`Processing file from ${tempUploadPath} to ${finalPath}`);
        await trimAndSave(tempUploadPath, finalPath);
        console.log(`File successfully saved to persistent storage: ${finalPath}`);
        res.status(200).json({ message: 'Successfully added to the communal ahhh!', status: 'processed' });
    } catch (error) {
        console.error('Error processing upload:', error);
        // Clean up the final file if it was partially created on failure.
        if (fs.existsSync(finalPath)) {
            fs.unlinkSync(finalPath);
        }
        res.status(500).send('Failed to process the new recording.');
    }
});

// --- API Endpoint 2: Serve the Master Drone (For Playback) ---
app.get('/api/master_drone', async (req, res) => {
    try {
        const files = fs.readdirSync(PERSISTENT_STORAGE_PATH)
            .filter(file => file.endsWith('.webm'))
            .map(file => ({
                name: file,
                path: path.join(PERSISTENT_STORAGE_PATH, file),
                time: fs.statSync(path.join(PERSISTENT_STORAGE_PATH, file)).mtime.getTime(),
            }))
            .sort((a, b) => b.time - a.time); // Sort descending, newest first

        if (files.length === 0) {
            return res.status(404).send('The communal ahhh has not started yet!');
        }

        let playlist = [];
        // Handle the `order=special` query from the frontend
        if (req.query.order === 'special' && files.length > 1) {
            const mostRecent = files.shift(); // Takes the newest file out
            const others = files;

            // Fisher-Yates shuffle for the rest of the files
            for (let i = others.length - 1; i > 0; i--) {
                const j = Math.floor(Math.random() * (i + 1));
                [others[i], others[j]] = [others[j], others[i]];
            }
            playlist = [mostRecent, ...others].map(f => f.path);
        } else {
            // Default behavior: play all files concatenated in chronological order
            playlist = files.reverse().map(f => f.path); // reverse to get oldest first
        }

        if (playlist.length === 1) {
            // If there's only one file, just send it directly.
            // res.sendFile requires an absolute path, which is already in playlist[0].
            const singleFilePath = playlist[0];
            console.log(`Serving single file: ${singleFilePath}`);
            return res.sendFile(singleFilePath);
        }

        // Use ffmpeg to concatenate the playlist and stream it to the user.
        const command = ffmpeg();
        playlist.forEach(file => command.input(file));

        res.setHeader('Content-Type', 'audio/webm');

        command
            .on('error', (err) => {
                console.error('FFmpeg streaming error:', err.message);
                // End the response if an error occurs and headers haven't been sent
                if (!res.headersSent) {
                    // Don't try to send a response if headers are already sent
                    res.status(500).send('Error during audio concatenation.');
                }
            })
            // Use mergeToFile and pass the response stream directly.
            // This correctly tells ffmpeg to concatenate all the inputs.
            .mergeToFile(res, PERSISTENT_STORAGE_PATH);

    } catch (error) {
        console.error('Error serving master drone:', error);
        res.status(500).send('Could not generate the communal ahhh.');
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

// --- Audio Processing Helper Function ---
function trimAndSave(inputPath, outputPath) {
    return new Promise((resolve, reject) => {
        try {
            ffmpeg(inputPath)
                .complexFilter([
                    // Trim silence from both start and end of the recording
                    '[0:a]silenceremove=start_periods=1:start_duration=1:start_threshold=0.02[trim1]',
                    '[trim1]areverse[rev1]',
                    '[rev1]silenceremove=start_periods=1:start_duration=1:start_threshold=0.02[trim2]',
                    '[trim2]areverse[out]',
                ])
                .outputOptions(['-map [out]', '-c:a libopus', '-b:a 160k', '-f webm'])
                .save(outputPath)
                .on('end', () => {
                    // After successfully saving the trimmed file, delete the original temporary upload.
                    if (fs.existsSync(inputPath)) {
                        fs.unlinkSync(inputPath);
                    }
                    resolve();
                })
                .on('error', (err) => {
                    // This will now safely reject the promise without crashing.
                    reject(new Error(`FFmpeg processing error: ${err.message}`));
                });
        } catch (error) {
            // This outer catch will handle any synchronous errors during ffmpeg setup.
            reject(new Error(`FFmpeg setup failed: ${error.message}`));
        }
    });
}

// --- Start Server ---
app.listen(port, () => {
    console.log(`Server listening on port ${port}`);
});
