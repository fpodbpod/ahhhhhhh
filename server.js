const express = require('express');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const ffmpeg = require('fluent-ffmpeg');

const app = express();
// Render assigns the port dynamically, so we use process.env.PORT
const port = process.env.PORT || 3000; 

// --- Configuration ---
// Destination for temporary uploads (Render requires this directory)
const upload = multer({ dest: 'uploads/' }); 
// Path for the master sound file
const AUDIO_DIR = path.join(__dirname, 'audio');
const MASTER_FILE = path.join(AUDIO_DIR, 'master_drone.webm');

// Ensure directories exist on server startup
if (!fs.existsSync(AUDIO_DIR)) {
    fs.mkdirSync(AUDIO_DIR);
}
if (!fs.existsSync(path.join(__dirname, 'uploads'))) {
    fs.mkdirSync(path.join(__dirname, 'uploads'));
}

// Middleware to allow your Cargo site (different domain) to talk to the server
app.use((req, res, next) => {
    // You should restrict this to your Cargo domain for production
    res.header('Access-Control-Allow-Origin', '*'); 
    res.header('Access-Control-Allow-Methods', 'GET,POST');
    res.header('Access-Control-Allow-Headers', 'Content-Type');
    next();
});

// --- API Endpoint 1: Upload New Recording ---
app.post('/api/upload', upload.single('audio'), async (req, res) => {
    if (!req.file) {
        return res.status(400).send('No audio file uploaded.');
    }

    const newFilePath = req.file.path; // Path to the temporary upload
    
    try {
        console.log(`Starting compilation for file: ${req.file.originalname}`);
        await compileNewDrone(newFilePath);
        
        // Clean up the temporary upload file
        fs.unlinkSync(newFilePath);
        console.log('Compilation successful and temporary file removed.');
        res.status(200).send('Successfully added to the communal ahhh!');
    } catch (error) {
        console.error('Compilation Error:', error);
        // Clean up temporary file even if compilation fails
        fs.unlinkSync(newFilePath); 
        res.status(500).send('Failed to compile the new recording.');
    }
});

// --- API Endpoint 2: Serve the Master Drone (For Playback) ---
app.get('/api/master_drone', (req, res) => {
    if (!fs.existsSync(MASTER_FILE)) {
        // If the file doesn't exist, send a silent 1-second placeholder
        return res.status(404).send('The communal ahhh has not started yet!');
    }
    
    // Set content type for streaming the audio file
    res.setHeader('Content-Type', 'audio/webm');
    res.sendFile(MASTER_FILE);
});

// --- Audio Compilation with FFmpeg (The Core Logic) ---
function compileNewDrone(newRecordingPath) {
    return new Promise((resolve, reject) => {
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
                    // FIX: Explicitly label the input stream [0:a] to avoid "Cannot find a matching stream" error
                    '[0:a]silenceremove=start_periods=1:start_duration=1:start_threshold=0.02[trim1]',
                    '[trim1]areverse[rev1]', 
                    '[rev1]silenceremove=start_periods=1:start_duration=1:start_threshold=0.02[trim2]',
                    '[trim2]areverse[out]', // Label the final stream [out]
                ])
                .outputOptions([
                    '-map [out]', // CRITICAL: Map the labeled output stream
                    '-c:a libopus'
                ])
                .save(MASTER_FILE)
                .on('end', () => resolve())
                .on('error', (err) => reject(`FFmpeg Error (First): ${err.message}`));

        } else {
            // Subsequent Recordings: Trim silence, crossfade, and save as new master
            console.log('Appending with crossfade...');
            const masterInputIndex = 0;
            const newAhhhInputIndex = 1;
            
            command
                .complexFilter([
                    // 1. Trim silence from the new recording
                    `[${newAhhhInputIndex}:a]silenceremove=start_periods=1:start_duration=1:start_threshold=0.02,areverse,silenceremove=start_periods=1:start_duration=1:start_threshold=0.02,areverse[trimmed_new]`,
                    
                    // 2. Crossfade/Concatenate the master and the trimmed new ahhh
                    `[${masterInputIndex}:a][trimmed_new]acrossfade=d=${crossfadeDuration}:c1=tri[out]`, // The master input also needs the :a stream selector
                ], 'out')
                .outputOptions([
                    '-map [out]', 
                    '-c:a libopus' 
                ])
                .save(tempOutputFile)
                .on('end', () => {
                    // Replace the old master file with the new combined file
                    fs.renameSync(tempOutputFile, MASTER_FILE);
                    resolve();
                })
                .on('error', (err) => reject(`FFmpeg Error (Crossfade): ${err.message}`));
        }
    });
}

// --- Start Server ---
app.listen(port, () => {
    console.log(`Server listening on port ${port}`);
});
