const express = require('express');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const cors = require('cors'); // Import the cors package
const ffmpeg = require('fluent-ffmpeg');

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

    const tempUploadPath = req.file.path; // Path to the file in /tmp/uploads
    // --- UNIFIED FORMAT STRATEGY: Always save as .webm ---
    // This ensures all files on disk are in a consistent, reliable format.
    const finalPath = path.join(PERSISTENT_STORAGE_PATH, `ahhh-${Date.now()}.webm`);
    
    try {
        // We will process the uploaded file to trim silence, then save it back to its final location.
        console.log(`Processing file from ${tempUploadPath} to ${finalPath}`);
        await trimAndSave(tempUploadPath, finalPath, req); // Pass the 'req' object
        console.log(`File successfully saved to persistent storage: ${finalPath}`);
        res.status(200).json({ message: 'Successfully added to the communal ahhh!', status: 'processed' });
    } catch (error) {
        console.error('Error processing upload:', error);
        // Clean up the final file if it was partially created on failure.
        if (fs.existsSync(finalPath)) {
            fs.unlinkSync(finalPath);
        }
        res.status(500).json({ message: 'Failed to process the new recording.', error: error.message });
    }
});

// --- API Endpoint 2: Serve the Master Drone (For Playback) ---
app.get('/api/master_drone', (req, res) => { // Removed async as we'll use callbacks
    try {
        const files = fs.readdirSync(PERSISTENT_STORAGE_PATH)
            .filter(file => file.endsWith('.webm') || file.endsWith('.mp4'))
            .map(file => { // Get stats for each file
                const filePath = path.join(PERSISTENT_STORAGE_PATH, file);
                try {
                    const stats = fs.statSync(filePath);
                    return { name: file, path: filePath, time: stats.mtime.getTime(), size: stats.size };
                } catch (e) {
                    console.error(`Could not stat file ${filePath}, skipping. Error: ${e.message}`);
                    return null; // If we can't get stats, ignore the file.
                }
            })
            .filter(file => file && file.size > 100) // Filter out nulls and any file smaller than 100 bytes.
            .sort((a, b) => b.time - a.time); // Sort descending, newest first

        // --- NEW: Validate each file with ffprobe to ensure it has an audio stream ---
        const validationPromises = files.map(file => {
            return new Promise((resolve) => {
                ffmpeg.ffprobe(file.path, (err, metadata) => {
                    // Check if there's an error OR if the streams array has an audio stream.
                    if (err || !metadata.streams.some(s => s.codec_type === 'audio')) {
                        console.warn(`WARN: Skipping invalid/corrupt file: ${file.name}`);
                        resolve(null); // Resolve with null if invalid
                    } else {
                        resolve(file); // Resolve with the file object if valid
                    }
                });
            });
        });

        Promise.all(validationPromises).then(validatedFiles => {
            const playlistFiles = validatedFiles.filter(Boolean); // Filter out any nulls (invalid files)

            console.log(`LOG: Found ${playlistFiles.length} valid recordings to play.`);

            if (playlistFiles.length === 0) {
                return res.status(404).send('The communal ahhh has not started yet!');
            }

            if (playlistFiles.length === 1) {
                const singleFilePath = playlistFiles[0].path;
                console.log(`Serving single file: ${singleFilePath}`);
                const mimeType = path.extname(singleFilePath) === '.mp4' ? 'audio/mp4' : 'audio/webm';
                res.setHeader('Content-Type', mimeType);
                return res.sendFile(singleFilePath);
            }

            let playlist = [];
            if (req.query.order === 'special') {
                const mostRecent = playlistFiles.shift();
                const others = playlistFiles;
                for (let i = others.length - 1; i > 0; i--) {
                    const j = Math.floor(Math.random() * (i + 1));
                    [others[i], others[j]] = [others[j], others[i]];
                }
                playlist = [mostRecent, ...others].map(f => f.path);
            } else {
                playlist = playlistFiles.reverse().map(f => f.path);
            }

            const command = ffmpeg();
            playlist.forEach(file => command.input(file));

            // --- UNIFIED FORMAT PIPELINE: Always stream WebM. ---
            // The files on disk are WebM, so we will stream WebM.
            // This avoids the on-the-fly Opus -> AAC conversion that is failing.
            res.setHeader('Content-Type', 'audio/webm');

            command.on('error', (err) => {
                console.error('FFmpeg streaming error:', err.message);
                if (!res.headersSent) {
                    res.status(500).send('Error during audio concatenation.');
                }
            });

            if (req.query.mode === 'sequential') {
                console.log(`LOG: Generating sequential stream with ${playlist.length} files.`);
                // --- STABILITY FIX: Use the simpler 'concat' filter instead of 'acrossfade' ---
                const inputs = playlist.map((_, index) => `[${index}:a]`).join('');
                const filter = `${inputs}concat=n=${playlist.length}:v=0:a=1[a]`;
                command.complexFilter(filter).outputOptions('-map', '[a]');
            } else {
                console.log(`LOG: Generating simultaneous (amix) stream with ${playlist.length} files.`);
                try {
                    command.complexFilter(`amix=inputs=${playlist.length}:duration=longest`);
                } catch (e) {
                    console.error("AMIX FILTER FAILED:", e);
                    return res.status(500).send('Failed to build audio mix filter.');
                }
            }

            command
                .outputOptions([
                    '-movflags faststart', // Optimizes the stream for web playback
                    '-b:a 192k'            // Set an explicit audio bitrate for compatibility
                ])
                .toFormat('webm').pipe(res, { end: true });
        });
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
function trimAndSave(inputPath, outputPath, req) { // Add 'req' as a parameter
    return new Promise((resolve, reject) => {
        try {
            const command = ffmpeg(inputPath);

            // --- DEFINITIVE STABILITY FIX ---
            // The silenceremove filter is unstable with AAC audio from iPhones.
            // We check the ORIGINAL filename extension from the upload.
            if (path.extname(req.file.originalname).toLowerCase() === '.mp4') {
                console.log('LOG: MP4 detected. Performing clean conversion to WebM without silence removal to ensure stability.');
                command.outputOptions(['-c:a libopus', '-b:a 160k', '-f webm']);
            } else {
                console.log('LOG: WebM detected. Applying silence removal.');
                command.complexFilter(['[0:a]silenceremove=start_periods=1:start_duration=1:start_threshold=0.02[trim1]','[trim1]areverse[rev1]','[rev1]silenceremove=start_periods=1:start_duration=1:start_threshold=0.02[trim2]','[trim2]areverse[out]']).outputOptions(['-map [out]', '-c:a libopus', '-b:a 160k', '-f webm']);
            }

            command.save(outputPath)
            .on('end', async () => {
                try {
                    // After saving, delete the original temporary upload.
                    if (fs.existsSync(inputPath)) {
                        fs.unlinkSync(inputPath);
                    }

                    // Asynchronously get file stats.
                    const stats = await fs.promises.stat(outputPath);
                    console.log(`LOG: Processed file saved. Size: ${stats.size} bytes.`);

                    if (stats.size < 400) { // Increased threshold for safety
                        // If the file is unreasonably small, it's corrupt.
                        await fs.promises.unlink(outputPath);
                        return reject(new Error(`Processed file was too small (${stats.size} bytes) and was discarded.`));
                    }
                    resolve(); // File is valid, resolve the promise.
                } catch (statError) {
                    reject(new Error(`Failed to verify output file: ${statError.message}`));
                }
            })
            .on('error', (err) => {
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
