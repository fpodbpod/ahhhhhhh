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
// >>> FIX 1: Use the /tmp directory for writable paths on Render
const UPLOAD_DIR = '/tmp/uploads'; 
const AUDIO_DIR = '/tmp/audio';
const MASTER_FILE = path.join(AUDIO_DIR, 'master_drone.webm');

const upload = multer({ dest: UPLOAD_DIR }); 

// Ensure directories exist on server startup, using the writable /tmp paths
// The 'recursive: true' option handles creating parent directories if needed.
if (!fs.existsSync(AUDIO_DIR)) {
    fs.mkdirSync(AUDIO_DIR, { recursive: true });
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

    const newFilePath = req.file.path;
    
    try {
        console.log(`Starting compilation for file: ${req.file.originalname}`);
        await compileNewDrone(newFilePath);
        
        // This unlink should now work since the file is in /tmp/uploads
        fs.unlinkSync(newFilePath); 
        console.log('Compilation successful and temporary file removed.');
        res.status(200).send('Successfully added to the communal ahhh!');
    } catch (error) {
        // If compilation fails, the error message in the console will be essential
        console.error('Compilation Error:', error);
        
        // Ensure the temporary uploaded file is deleted even on failure
        if (fs.existsSync(newFilePath)) {
            fs.unlinkSync(newFilePath); 
        }
        res.status(500).send('Failed to compile the new recording.');
    }
});

// --- API Endpoint 2: Serve the Master Drone (For Playback) ---
app.get('/api/master_drone', (req, res) => {
    if (!fs.existsSync(MASTER_FILE)) {
        return res.status(404).send('The communal ahhh has not started yet!');
    }
    
    res.setHeader('Content-Type', 'audio/webm');
    res.sendFile(MASTER_FILE);
});

// --- API Endpoint 3: Reset All Recordings (Secret Endpoint) ---
app.post('/api/reset', (req, res) => {
    const { secret } = req.body;

    // The secret key you requested
    const RESET_SECRET_KEY = 'lulu';

    if (secret !== RESET_SECRET_KEY) {
        // If the key is wrong or missing, deny access
        return res.status(403).send('Forbidden: Invalid secret key.');
    }

    // If the key is correct, proceed with deletion
    try {
        if (fs.existsSync(MASTER_FILE)) {
            fs.unlinkSync(MASTER_FILE);
            console.log('LOG: Master drone file has been deleted by secret key.');
            res.status(200).send('The communal ahhh has been reset.');
        } else {
            res.status(200).send('Nothing to reset. The communal ahhh was already empty.');
        }
    } catch (error) {
        console.error('ERROR: Failed to reset recordings:', error);
        res.status(500).send('An error occurred while trying to reset the recordings.');
    }
});

// --- Audio Compilation with FFmpeg (The Core Logic) ---
function compileNewDrone(newRecordingPath) {
    return new Promise((resolve, reject) => {
        // tempOutputFile now correctly points to /tmp/audio
        const tempOutputFile = path.join(AUDIO_DIR, `temp_${Date.now()}.webm`);
        const crossfadeDuration = 0.5; // 0.5 seconds

        const isFirstRecording = !fs.existsSync(MASTER_FILE);
        const inputFiles = isFirstRecording ? [newRecordingPath] : [MASTER_FILE, newRecordingPath];

        let command = ffmpeg();
        inputFiles.forEach(file => command.input(file));

        if (isFirstRecording) {
            // First Recording: Trim silence and save as master
            console.log('First recording detected. Trimming silence...');
            command
                .complexFilter([
                    '[0:a]silenceremove=start_periods=1:start_duration=1:start_threshold=0.02[trim1]',
                    '[trim1]areverse[rev1]', 
                    '[rev1]silenceremove=start_periods=1:start_duration=1:start_threshold=0.02[trim2]',
                    '[trim2]areverse[out]', 
                ])
                .outputOptions([
                    '-map [out]', 
                    '-c:a libopus',
                    '-b:a 160k',
                    '-f webm'
                ])
                .save(MASTER_FILE)
                .on('end', () => resolve())
                .on('error', (err) => {
                    // If the first save fails, delete the potentially corrupt master file
                    if (fs.existsSync(MASTER_FILE)) {
                        fs.unlinkSync(MASTER_FILE);
                    }
                    reject(`FFmpeg Error (First): ${err.message}`);
                });

        } else {
            // Subsequent Recordings: Trim silence, crossfade, and save as new master
            console.log('Appending with crossfade...');
            const masterInputIndex = 0; 
            const newAhhhInputIndex = 1; 
            
            command
                .complexFilter([
                    // 1. Isolate and format the master file stream (Input 0)
                    `[${masterInputIndex}:a]aformat=sample_fmts=fltp:channel_layouts=stereo:sample_rates=48000[master]`,
                    
                    // 2. Trim and format the new recording (Input 1)
                    `[${newAhhhInputIndex}:a]silenceremove=start_periods=1:start_duration=1:start_threshold=0.02,areverse,silenceremove=start_periods=1:start_duration=1:start_threshold=0.02,areverse,aformat=sample_fmts=fltp:channel_layouts=stereo:sample_rates=48000[trimmed_new]`,
                    
                    // 3. Crossfade/Concatenate the two explicitly prepared and formatted streams
                    `[master][trimmed_new]acrossfade=d=${crossfadeDuration}:c1=tri[out]`,
                ])
                .outputOptions([
                    '-map [out]', 
                    '-c:a libopus',
                    '-b:a 160k',
                    '-f webm' 
                ])
                .save(tempOutputFile)
                .on('end', () => {
                    // This rename/move operation should now work within the writable /tmp directory
                    fs.renameSync(tempOutputFile, MASTER_FILE);
                    resolve();
                })
                .on('error', (err) => {
                    // If the crossfade fails, delete the temporary output file
                    if (fs.existsSync(tempOutputFile)) {
                        fs.unlinkSync(tempOutputFile);
                    }
                    reject(`FFmpeg Error (Crossfade): ${err.message}`);
                });
        }
    });
}

// --- Start Server ---
app.listen(port, () => {
    console.log(`Server listening on port ${port}`);
});
